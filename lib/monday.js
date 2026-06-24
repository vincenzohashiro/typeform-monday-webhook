const BOARD_ID = "5089650058";

const MAX_RETRIES = 4;
const BASE_DELAY_MS = 500;

async function mondayQuery(query, variables = {}, _attempt = 0) {
  const token = process.env.MONDAY_API_KEY;
  if (!token) throw Object.assign(new Error("Monday API token not configured — set MONDAY_API_KEY"), { code: "NO_TOKEN" });

  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
      "API-Version": "2025-01",
    },
    body: JSON.stringify({ query, variables }),
  });

  // HTTP 429 — respect Retry-After if present, otherwise exponential backoff
  if (res.status === 429) {
    if (_attempt >= MAX_RETRIES) throw Object.assign(new Error("Monday rate limit exceeded after retries"), { code: "RATE_LIMIT" });
    const retryAfter = parseInt(res.headers.get("Retry-After") ?? "0", 10);
    const delay = retryAfter > 0 ? retryAfter * 1000 : BASE_DELAY_MS * 2 ** _attempt;
    await new Promise(r => setTimeout(r, delay));
    return mondayQuery(query, variables, _attempt + 1);
  }

  const json = await res.json();

  // Complexity budget exceeded — same retry logic
  const isComplexity = json.errors?.some(e =>
    e.extensions?.code === "ComplexityException" || e.message?.toLowerCase().includes("complexity")
  );
  if (isComplexity) {
    if (_attempt >= MAX_RETRIES) throw Object.assign(new Error("Monday complexity budget exceeded after retries"), { code: "RATE_LIMIT" });
    await new Promise(r => setTimeout(r, BASE_DELAY_MS * 2 ** _attempt));
    return mondayQuery(query, variables, _attempt + 1);
  }

  if (json.errors?.length) {
    const msg = json.errors[0].message;
    const code = msg.toLowerCase().includes("column") ? "COLUMN_ERROR" : "API_ERROR";
    throw Object.assign(new Error(msg), { code });
  }

  return json.data;
}

export async function getBoardColumns() {
  const data = await mondayQuery(
    `query { boards(ids: [${BOARD_ID}]) { columns { id title type } } }`
  );
  return data.boards[0]?.columns ?? [];
}

export async function findItem(columnId, value) {
  const data = await mondayQuery(
    `query ($boardId: ID!, $colId: String!, $val: String!) {
       items_page_by_column_values(
         board_id: $boardId
         columns: [{ column_id: $colId, column_values: [$val] }]
         limit: 1
       ) { items { id name } }
     }`,
    { boardId: BOARD_ID, colId: columnId, val: value }
  );
  return data.items_page_by_column_values.items[0] ?? null;
}

export async function updateItem(itemId, columnValues) {
  try {
    await mondayQuery(
      `mutation ($boardId: ID!, $itemId: ID!, $cv: JSON!) {
         change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $cv) { id }
       }`,
      { boardId: BOARD_ID, itemId, cv: JSON.stringify(columnValues) }
    );
    return { failed: [] };
  } catch (batchErr) {
    // Rate/token limit and auth errors are not recoverable per-column — re-throw immediately
    if (!["COLUMN_ERROR", "API_ERROR"].includes(batchErr.code)) throw batchErr;

    // Batch failed due to a bad column value — retry each column individually
    const failed = [];
    for (const [colId, val] of Object.entries(columnValues)) {
      try {
        await mondayQuery(
          `mutation ($boardId: ID!, $itemId: ID!, $colId: String!, $val: JSON!) {
             change_column_value(board_id: $boardId, item_id: $itemId, column_id: $colId, value: $val) { id }
           }`,
          { boardId: BOARD_ID, itemId, colId, val: JSON.stringify(val) }
        );
      } catch (colErr) {
        // Rate/token limit mid-loop: stop immediately, don't hammer the API further
        if (colErr.code === "RATE_LIMIT" || colErr.code === "NO_TOKEN") throw colErr;
        failed.push({ id: colId, error: colErr.message });
      }
    }
    return { failed };
  }
}

export async function getItemDetails(itemId, columnIds) {
  const data = await mondayQuery(
    `query ($itemIds: [ID!]!, $columnIds: [String!]) {
       items(ids: $itemIds) {
         id
         name
         column_values(ids: $columnIds) { id text value }
       }
     }`,
    { itemIds: [itemId], columnIds }
  );
  return data.items[0] ?? null;
}

export async function postUpdate(itemId, body) {
  await mondayQuery(
    `mutation ($itemId: ID!, $body: String!) {
       create_update(item_id: $itemId, body: $body) { id }
     }`,
    { itemId, body }
  );
}

export async function getBoardItems(boardId, columnIds) {
  const items = [];
  let cursor = null;
  do {
    const data = await mondayQuery(
      `query ($boardId: ID!, $columnIds: [String!], $cursor: String) {
         boards(ids: [$boardId]) {
           items_page(limit: 500, cursor: $cursor) {
             cursor
             items {
               id
               name
               column_values(ids: $columnIds) { id text value }
             }
           }
         }
       }`,
      { boardId, columnIds, cursor }
    );
    const page = data.boards[0]?.items_page;
    if (!page) break;
    items.push(...page.items);
    cursor = page.cursor ?? null;
  } while (cursor);
  return items;
}

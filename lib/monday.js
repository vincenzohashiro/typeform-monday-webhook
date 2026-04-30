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
      "API-Version": "2024-01",
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
  await mondayQuery(
    `mutation ($boardId: ID!, $itemId: ID!, $cv: JSON!) {
       change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $cv) { id }
     }`,
    { boardId: BOARD_ID, itemId, cv: JSON.stringify(columnValues) }
  );
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

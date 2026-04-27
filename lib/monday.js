const BOARD_ID = "5089650058";

async function mondayQuery(query, variables = {}) {
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

  const json = await res.json();

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

export async function postUpdate(itemId, body) {
  await mondayQuery(
    `mutation ($itemId: ID!, $body: String!) {
       create_update(item_id: $itemId, body: $body) { id }
     }`,
    { itemId, body }
  );
}

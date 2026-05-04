const BOARD_ID     = "5052697723";
const GROUP_ID     = "topics"; // "Ny Kontakt" group
const MAX_RETRIES  = 3;
const BASE_DELAY   = 500;

// Meta field name → Monday column mapping
// Standard fields (full_name, email, phone_number) are predictable.
// Custom question field names are confirmed from first test lead — check raw[] in the log.
const FIELD_MAP = {
  "email":                              { colId: "email_mkwx219b",   type: "email", label: "Email"       },
  "phone_number":                       { colId: "phone_mkwx7cez",   type: "phone", label: "Telefon"     },
  "hvor_gammel_er_du?":                 { colId: "text_mm30m1dw",      type: "text", label: "Alder"      },
  "hvornår_er_du_bedst_at_træffe?":     { colId: "long_text_mkykhe2h", type: "text", label: "Bedste tid" },
};

export async function fetchLeadData(leadId) {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) throw Object.assign(new Error("META_PAGE_ACCESS_TOKEN not set"), { code: "NO_META_TOKEN" });

  const res  = await fetch(
    `https://graph.facebook.com/v25.0/${leadId}?fields=field_data,created_time&access_token=${encodeURIComponent(token)}`
  );
  const json = await res.json();
  if (json.error) throw Object.assign(new Error(json.error.message), { code: "META_API_ERROR" });
  return json;
}

export async function createMondayItemFromLead(leadData) {
  const token = process.env.MONDAY_API_KEY;
  if (!token) throw Object.assign(new Error("MONDAY_API_KEY not configured"), { code: "NO_TOKEN" });

  const colValues = {};
  let itemName    = "Meta Lead";
  const raw       = [];

  for (const field of leadData.field_data ?? []) {
    const value = (field.values?.[0] ?? "").trim();
    raw.push({ name: field.name, value });

    if (field.name === "full_name") { itemName = (value && !value.startsWith("<")) ? value : "Meta Lead"; continue; }

    const mapping = FIELD_MAP[field.name];
    if (mapping && value) {
      const formatted = formatValue(mapping.type, value);
      if (formatted !== null) colValues[mapping.colId] = formatted;
    }
  }

  colValues["color_mkwx19y8"] = { label: "Meta" };

  const hasColumns = Object.keys(colValues).length > 0;
  const reqBody = {
    query: hasColumns
      ? `mutation ($name: String!, $cv: JSON!) {
           create_item(board_id: ${BOARD_ID}, group_id: "${GROUP_ID}", item_name: $name, column_values: $cv) { id name }
         }`
      : `mutation ($name: String!) {
           create_item(board_id: ${BOARD_ID}, group_id: "${GROUP_ID}", item_name: $name) { id name }
         }`,
    variables: hasColumns ? { name: itemName, cv: JSON.stringify(colValues) } : { name: itemName },
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res  = await fetch("https://api.monday.com/v2", {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2025-01" },
      body:    JSON.stringify(reqBody),
    });

    if (res.status === 429) {
      if (attempt >= MAX_RETRIES) throw Object.assign(new Error("Monday rate limit exceeded"), { code: "RATE_LIMIT" });
      const retryAfter = parseInt(res.headers.get("Retry-After") ?? "0", 10);
      await new Promise(r => setTimeout(r, retryAfter > 0 ? retryAfter * 1000 : BASE_DELAY * 2 ** attempt));
      continue;
    }

    const json = await res.json();

    const isComplexity = json.errors?.some(e =>
      e.extensions?.code === "ComplexityException" || e.message?.toLowerCase().includes("complexity")
    );
    if (isComplexity) {
      if (attempt >= MAX_RETRIES) throw Object.assign(new Error("Monday complexity budget exceeded"), { code: "RATE_LIMIT" });
      await new Promise(r => setTimeout(r, BASE_DELAY * 2 ** attempt));
      continue;
    }

    if (json.errors?.length) {
      const err    = json.errors[0];
      const detail = err.extensions ? ` | ext: ${JSON.stringify(err.extensions)}` : "";
      console.error("Monday create_item error:", err.message + detail, "| colValues:", JSON.stringify(colValues));
      throw Object.assign(new Error(err.message), { code: "API_ERROR" });
    }

    return { itemId: json.data.create_item.id, itemName, raw };
  }
}

function formatValue(type, value) {
  switch (type) {
    case "email": return { email: value, text: value };
    case "phone": return /[\d+\-\s()]{5,}/.test(value) ? { phone: value, countryShortName: "DK" } : null;
    default:      return value;
  }
}

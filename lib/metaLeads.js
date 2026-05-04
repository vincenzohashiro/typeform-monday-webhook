const BOARD_ID = "5052697723";

// Meta field name → Monday column mapping
// Standard fields (full_name, email, phone_number) are predictable.
// Custom question field names are confirmed from first test lead — check raw[] in the log.
const FIELD_MAP = {
  "email":        { colId: "email_mkwx219b",   type: "email", label: "Email"       },
  "phone_number": { colId: "phone_mkwx7cez",   type: "phone", label: "Telefon"     },
  // Custom questions — slugified Danish text. Verify these against raw[] after first lead.
  "hvor_gammel_er_du":               { colId: "text_mm30m1dw",      type: "text", label: "Alder"      },
  "hvornr_er_du_bedst_at_trffe":     { colId: "long_text_mkykhe2h", type: "text", label: "Bedste tid" },
  "hvornaar_er_du_bedst_at_traeffe": { colId: "long_text_mkykhe2h", type: "text", label: "Bedste tid" },
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

    if (field.name === "full_name") { itemName = value || "Meta Lead"; continue; }

    const mapping = FIELD_MAP[field.name];
    if (mapping && value) {
      const formatted = formatValue(mapping.type, value);
      if (formatted !== null) colValues[mapping.colId] = formatted;
    }
  }

  // Mark source as Meta
  colValues["color_mkwx19y8"] = { label: "Meta" };

  const res  = await fetch("https://api.monday.com/v2", {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  token,
      "API-Version":  "2024-01",
    },
    body: JSON.stringify({
      query: `mutation ($boardId: ID!, $name: String!, $cv: JSON!) {
        create_item(board_id: $boardId, item_name: $name, column_values: $cv) { id name }
      }`,
      variables: { boardId: BOARD_ID, name: itemName, cv: JSON.stringify(colValues) },
    }),
  });

  const json = await res.json();
  if (json.errors?.length) {
    const err = json.errors[0];
    const detail = err.extensions ? ` | ext: ${JSON.stringify(err.extensions)}` : "";
    console.error("Monday create_item error:", err.message + detail, "| colValues:", JSON.stringify(colValues));
    throw Object.assign(new Error(err.message), { code: "API_ERROR" });
  }

  return { itemId: json.data.create_item.id, itemName, raw };
}

function formatValue(type, value) {
  switch (type) {
    case "email": return { email: value, text: value };
    case "phone": return /[\d+\-\s()]{5,}/.test(value) ? { phone: value, countryShortName: "DK" } : null;
    default:      return value;
  }
}

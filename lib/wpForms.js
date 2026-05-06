const BOARD_ID    = "5052697723";
const GROUP_ID    = "topics";
const MAX_RETRIES = 3;
const BASE_DELAY  = 500;

// WordPress sanitize_title equivalent: lowercase, strip diacritics, hyphens for spaces
function slug(str) {
  return String(str)
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-");
}

const FIELD_MAP = {
  "email":                          { colId: "email_mkwx219b",    type: "email"  },
  "telefon":                        { colId: "phone_mkwx7cez",    type: "phone"  },
  "phone":                          { colId: "phone_mkwx7cez",    type: "phone"  },
  "phone-number":                   { colId: "phone_mkwx7cez",    type: "phone"  },
  "telefonnummer":                  { colId: "phone_mkwx7cez",    type: "phone"  },
  "kilde":                          { colId: "color_mkwx19y8",    type: "status" },
  "hvornar-er-du-bedst-at-traffe":  { colId: "long_text_mkykhe2h", type: "text" },
  "hvornar-er-du-bedst-at-traeffe": { colId: "long_text_mkykhe2h", type: "text" },
  "bedst-at-traffe":                { colId: "long_text_mkykhe2h", type: "text" },
  "traffe-tidspunkt":               { colId: "long_text_mkykhe2h", type: "text" },
  "hvor-gammel-er-du":              { colId: "text_mm30m1dw",     type: "text"  },
  "alder":                          { colId: "text_mm30m1dw",     type: "text"  },
};

const NAME_FIELDS = new Set(["navn", "name", "fulde-navn", "fuldt-navn"]);

export async function createMondayItemFromWPForm(payload) {
  const token = process.env.MONDAY_API_KEY;
  if (!token) throw Object.assign(new Error("MONDAY_API_KEY not configured"), { code: "NO_TOKEN" });

  const colValues = {};
  let itemName    = `Entry #${payload.entry_id}`;
  const raw       = [];

  for (const field of payload.fields ?? []) {
    const value = String(field.value ?? "").trim();
    const key   = slug(field.name ?? "");
    raw.push({ name: field.name, slug: key, value });

    if (field.type === "file-upload" || !value) continue;

    if (NAME_FIELDS.has(key)) { itemName = value; continue; }

    const mapping = FIELD_MAP[key];
    if (!mapping) continue;

    const formatted = formatValue(mapping.type, value);
    if (formatted !== null) colValues[mapping.colId] = formatted;
  }

  // Default source to "Hjemmeside" if the form didn't supply a kilde field
  if (!colValues["color_mkwx19y8"]) {
    colValues["color_mkwx19y8"] = { label: "Website" };
  }

  const hasColumns = Object.keys(colValues).length > 0;
  const reqBody = {
    query: hasColumns
      ? `mutation ($name: String!, $cv: JSON!) {
           create_item(board_id: ${BOARD_ID}, group_id: "${GROUP_ID}", item_name: $name, column_values: $cv) { id name }
         }`
      : `mutation ($name: String!) {
           create_item(board_id: ${BOARD_ID}, group_id: "${GROUP_ID}", item_name: $name) { id name }
         }`,
    variables: hasColumns
      ? { name: itemName, cv: JSON.stringify(colValues) }
      : { name: itemName },
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch("https://api.monday.com/v2", {
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
      const err = json.errors[0];
      console.error("Monday create_item error (WPForms):", err.message, "| colValues:", JSON.stringify(colValues));
      throw Object.assign(new Error(err.message), { code: "API_ERROR" });
    }

    return { itemId: json.data.create_item.id, itemName, raw };
  }
}

function formatValue(type, value) {
  switch (type) {
    case "email":  return { email: value, text: value };
    case "phone":  return /[\d+\-\s()]{5,}/.test(value) ? { phone: value, countryShortName: "DK" } : null;
    case "status": return { label: value };
    default:       return value;
  }
}

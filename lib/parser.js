import { DateTime } from "luxon";

// Typeform field REF → Monday column (refs from actual webhook payload)
const REF_MAP = {
  // ── Search / identification (no Monday column update) ──────────────────────
  "03f77119-bdde-435d-88f7-5a1d861c3d05": { search: "email" },
  "1905169f-2cdc-4cb7-b66c-960a9da591c4": { search: "phone" },

  // ── Form fields → Monday columns ───────────────────────────────────────────
  "15ab6816-1f9c-46c2-9105-5d0c39a3188d": { id: "dropdown_mm0xvt81",   type: "dropdown",                       label: "Bekræfter dokument"      },
  "66e27996-7459-4b60-92fb-50be612d036a": { id: "text_mm0ne0b0",        type: "text",                           label: "Navn"                    },
  "d10a7951-6fc2-43d9-a027-3a1092feb839": { id: "color_mm0xw8e6",       type: "status",                         label: "Metode"                  },
  "00e65123-e6cd-4013-a8d4-f912ddf6dcc3": { id: "color_mm0x5j9a",       type: "status",                         label: "Pakke"                   },
  "35f3c8c3-db0e-44e8-acde-d5f6fe9a7d3f": { id: "color_mm29z796",       type: "status",                         label: "Tillægspriser"           },
  "dd4e5d79-aabb-40ff-b52c-06e9aed0c4f9": { id: "dropdown_mm0xyf9m",   type: "dropdown",                       label: "Kroniske sygdomme"       },
  "a7b7e09b-8af2-495d-9a9e-177b7ed1dfda": { id: "short_texttybbc18j",  type: "text",                           label: "Yderligere helbredsinfo" },
  "108b6f57-ff1e-456e-a072-b8decfc54258": { id: "dropdown_mm0xb2s9",   type: "dropdown",                       label: "Forhøjet blodtryk"       },
  "a6d8dd25-738a-44d7-9b43-3b73fa173da8": { id: "dropdown_mm0xnpvt",   type: "dropdown",                       label: "Ankomstlufthavn"         },
  "5d3791be-3419-41b4-874f-61553249f539": { id: "datewtur8fqa",         type: "date",   convertTime: true,      label: "Ankomstdato og -tid"     },
  "9a154b8c-803d-43f1-b66f-c9cb4dbac2e9": { id: "short_textgodfvnkl",  type: "text",                           label: "Flynummer (ankomst)"     },
  "1b512b78-a81a-4ddf-8a70-2780134a71d1": { id: "date4oq7pl6n",         type: "date",                           label: "Operationsdato"          },
  "56601e06-0612-46b8-aac0-ad910d9ce511": { id: "dropdown_mm0wscyn",   type: "dropdown",                       label: "Hjemrejselufthavn"       },
  "b181d2bd-2561-4fd4-87a2-db9b3d8474e6": { id: "datet2v5h8xu",         type: "date",   convertTime: true,      label: "Hjemrejsedato og -tid"   },
  "b4242bd8-567b-47e0-af70-ebbcdacaf2ca": { id: "short_textlqh0zj0g",  type: "text",                           label: "Flynummer (hjemrejse)"   },
  "f90df4eb-9c90-4d1a-bcb8-b7ff55437281": { id: "single_selectdohyims",type: "status",                         label: "Antal rejsende"          },
  "90fea3a6-1fc2-4386-839e-b534833400cb": { id: "long_textgirve6aq",    type: "text",                           label: "Ekstra passagerer"       },
  "0d3ee98e-5832-4ef9-a5fc-49183412f60a": { id: "single_selectvzc53dm",type: "status",                         label: "Single seng"             },
  "9f749ce4-ba2c-40b8-89ab-4743757f6948": { id: "color_mm0x58vp",       type: "status",                         label: "Medietilladelse"         },
};

// ── Date/time parsing ─────────────────────────────────────────────────────────
function parseDateValue(raw) {
  let s = String(raw).trim();
  s = s.replace(/[()]/g, "");
  s = s.replace(/\bkl\.?\s*/gi, " ").trim();

  // D(D)/M(M)/YY(YY) + optional time with : or .
  const m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})(?:[\sT,]+(\d{1,2})[\.\:](\d{2}))?/);
  if (m) {
    return {
      dateStr: `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`,
      timeStr: m[4] ? `${m[4].padStart(2,"0")}:${m[5]}` : null,
    };
  }

  const iso = s.match(/^(\d{4}-\d{2}-\d{2})[\sT](\d{1,2}:\d{2})/);
  if (iso) return { dateStr: iso[1], timeStr: iso[2].padStart(5, "0") };

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return { dateStr: s.slice(0, 10), timeStr: null };

  return { dateStr: null, timeStr: null };
}

// ── Timezone: Turkish → Danish (subtract 1 hour, TR is UTC+3, DK is UTC+2 CEST) ──
// e.g. 12:34 TR → 11:34 DK stored directly in Monday
function convertTRtoDK(dateStr, timeStr) {
  const tr = DateTime.fromISO(`${dateStr}T${timeStr}`, { zone: "Europe/Istanbul" });
  if (!tr.isValid) throw Object.assign(
    new Error(`Invalid datetime: "${dateStr} ${timeStr}"`),
    { code: "TIME_PARSE" }
  );
  const dk = tr.setZone("Europe/Copenhagen");
  return {
    date:  dk.toISODate(),
    time:  dk.toFormat("HH:mm:ss"),
    label: `${dk.toFormat("HH:mm")} DK (was ${timeStr} TR)`,
  };
}

// ── Raw value extractor ───────────────────────────────────────────────────────
function getRawValue(answer) {
  const t = answer.type;
  if (t === "choice")  return answer.choice?.label  ?? null;
  if (t === "choices") return answer.choices?.labels?.join(", ") ?? null;
  return answer[t] ?? null;
}

// ── Format a value for Monday ─────────────────────────────────────────────────
function formatForMonday(mapping, val) {
  const s = String(val).trim();
  switch (mapping.type) {
    case "text":     return s;
    case "status":   return { label: s };
    case "dropdown": return { labels: [s] };
    case "date": {
      const { dateStr, timeStr } = parseDateValue(s);
      if (!dateStr) return null;
      if (mapping.convertTime) {
        if (!timeStr) return { date: dateStr, _label: `${mapping.label}: ${dateStr} (no time — conversion skipped)` };
        const dk = convertTRtoDK(dateStr, timeStr);
        return { date: dk.date, time: dk.time, _label: `${mapping.label}: ${dk.label}` };
      }
      return { date: dateStr };
    }
  }
}

// ── Core mapping logic (shared by webhook + resend) ───────────────────────────
function mapFields(fields) {
  const colValues  = {};
  const colLabels  = {}; // id → human label, used for error diagnostics
  const timeLabels = [];
  const warnings   = [];
  let searchValue  = null;
  let name         = null;

  for (const f of fields) {
    const mapping = REF_MAP[f.ref];

    // Fallback type-based detection for email/phone if ref not in map
    if (!mapping) {
      if (f.type === "email" && !searchValue)        searchValue = f.value;
      if (f.type === "phone_number" && !searchValue) searchValue = f.value;
      continue;
    }

    if (mapping.search === "email") { searchValue = f.value; continue; }
    if (mapping.search === "phone") { if (!searchValue) searchValue = f.value; continue; }

    if (!f.value) continue;

    let formatted;
    try {
      formatted = formatForMonday(mapping, f.value);
    } catch (e) {
      warnings.push(`${mapping.label ?? f.ref}: ${e.message}`);
      continue;
    }

    if (!formatted) {
      warnings.push(`${mapping.label ?? f.ref}: could not parse "${f.value}"`);
      continue;
    }

    if (formatted._label) {
      timeLabels.push(formatted._label);
      const { _label, ...rest } = formatted;
      colValues[mapping.id] = rest;
    } else {
      colValues[mapping.id] = formatted;
    }

    colLabels[mapping.id] = { label: mapping.label, type: mapping.type, raw: String(f.value) };
    if (mapping.id === "text_mm0ne0b0") name = f.value;
  }

  return { colValues, colLabels, searchValue, name, timeLabels, warnings };
}

// ── parseAnswers: called from webhook with raw Typeform answers ───────────────
export function parseAnswers(answers) {
  const raw = [];
  const fields = answers.map(a => {
    const val = getRawValue(a);
    const entry = { ref: a.field?.ref, type: a.type, title: a.field?.title ?? "", value: val };
    raw.push(entry);
    return entry;
  });

  const result = mapFields(fields);
  return { ...result, raw };
}

// ── buildFromRaw: called from resend with stored raw data ─────────────────────
export function buildFromRaw(raw) {
  return mapFields(raw);
}

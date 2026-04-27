import { DateTime } from "luxon";

// Typeform field title → Monday column ID + how to format the value
const COLUMN_MAP = [
  { title: "Navn",                                 id: "text_mm0ne0b0",        type: "text"     },
  { title: "Jeg bekræfter at have læst",           id: "dropdown_mm0xvt81",    type: "dropdown" },
  { title: "Angiv venligst metode",                id: "color_mm0xw8e6",       type: "status"   },
  { title: "Angiv venligst pakke",                 id: "color_mm0x5j9a",       type: "status"   },
  { title: "Yderligere pakke tillægspriser",        id: "color_mm29z796",       type: "status"   },
  { title: "Har du nogle kroniske sygdomme",       id: "dropdown_mm0xyf9m",    type: "dropdown" },
  { title: "Udfyld venligst yderligere",           id: "short_texttybbc18j",   type: "text"     },
  { title: "Har du forhøjet blodtryk",             id: "dropdown_mm0xb2s9",    type: "dropdown" },
  { title: "Ankomstlufthavn",                      id: "dropdown_mm0xnpvt",    type: "dropdown" },
  { title: "Ankomstdato og -tid",                  id: "datewtur8fqa",         type: "date",    convertTime: true },
  { title: "Flynummer (ankomst)",                  id: "short_textgodfvnkl",   type: "text"     },
  { title: "Operationsdato",                       id: "date4oq7pl6n",         type: "date"     },
  { title: "Hjemrejselufthavn",                    id: "dropdown_mm0wscyn",    type: "dropdown" },
  { title: "Hjemrejsedato og -tid",                id: "datet2v5h8xu",         type: "date",    convertTime: true },
  { title: "Flynummer (hjemrejse)",                id: "short_textlqh0zj0g",   type: "text"     },
  { title: "Hvor mange rejsende",                  id: "single_selectdohyims", type: "status"   },
  { title: "Navn + efternavn",                     id: "long_textgirve6aq",    type: "text"     },
  { title: "Ønsker I single seng",                 id: "single_selectvzc53dm", type: "status"   },
  { title: "Jeg giver Håreksperten tilladelse",    id: "color_mm0x58vp",       type: "status"   },
];

// ── Date/time parsing ─────────────────────────────────────────────────────────
// Handles every variation seen from users:
//   03/08/2026 20:05   →  standard
//   5/7/2026 17:10     →  single-digit day/month
//   (04/05/2026) 19:15 →  parentheses
//   03/06/26 kl.17.10  →  2-digit year, Danish "kl.", dot time separator
//   14/5/2026 03.40    →  dot time separator
//   07/05/2026 kl 16:00 → "kl " with space
// Always returns { dateStr: "YYYY-MM-DD", timeStr: "HH:MM" | null }
function parseDateValue(raw) {
  // Step 1 — strip noise
  let s = String(raw).trim();
  s = s.replace(/[()]/g, "");                    // remove parentheses
  s = s.replace(/\bkl\.?\s*/gi, " ").trim();     // remove Danish "kl." / "kl "

  // Step 2 — match D(D)/M(M)/YY(YY) [optional time H(H)[:.](MM)]
  const m = s.match(
    /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})(?:[\sT,]+(\d{1,2})[\.\:](\d{2}))?/
  );
  if (m) {
    const day   = m[1].padStart(2, "0");
    const month = m[2].padStart(2, "0");
    const year  = m[3].length === 2 ? `20${m[3]}` : m[3]; // expand 2-digit year
    return {
      dateStr: `${year}-${month}-${day}`,
      timeStr: m[4] ? `${m[4].padStart(2, "0")}:${m[5]}` : null,
    };
  }

  // Step 3 — ISO datetime: "YYYY-MM-DD HH:MM" or "YYYY-MM-DDTHH:MM"
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})[\sT](\d{1,2}:\d{2})/);
  if (iso) return { dateStr: iso[1], timeStr: iso[2].padStart(5, "0") };

  // Step 4 — ISO date only: "YYYY-MM-DD"
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return { dateStr: s.slice(0, 10), timeStr: null };

  // Unparseable
  return { dateStr: null, timeStr: null };
}

// ── Timezone conversion ───────────────────────────────────────────────────────
// Turkish time (UTC+3, no DST) → Danish time (CET/CEST, handles DST automatically)
function convertTRtoDK(dateStr, timeStr) {
  const tr = DateTime.fromISO(`${dateStr}T${timeStr}`, { zone: "Europe/Istanbul" });
  if (!tr.isValid) throw Object.assign(
    new Error(`Invalid date/time: "${dateStr} ${timeStr}" — ${tr.invalidExplanation}`),
    { code: "TIME_PARSE" }
  );
  const dk = tr.setZone("Europe/Copenhagen");
  return {
    date:  dk.toISODate(),
    time:  dk.toFormat("HH:mm:ss"),
    label: `${dk.toFormat("HH:mm")} DK (was ${timeStr} TR)`,
  };
}

// ── Raw value from Typeform answer ────────────────────────────────────────────
function getRawValue(answer) {
  const t = answer.type;
  if (t === "choice")  return answer.choice?.label  ?? null;
  if (t === "choices") return answer.choices?.labels?.join(", ") ?? null;
  return answer[t] ?? null;
}

// ── Format a value for Monday.com ─────────────────────────────────────────────
function formatForMonday(mapping, val) {
  const s = String(val).trim();

  switch (mapping.type) {
    case "text":
      return s;

    case "status":
      return { label: s };

    case "dropdown":
      return { labels: [s] };

    case "date": {
      const { dateStr, timeStr } = parseDateValue(s);

      if (!dateStr) return null; // unparseable — skip this column

      if (mapping.convertTime) {
        if (!timeStr) {
          // Date present but no time — store date, flag missing time in label
          return { date: dateStr, _label: `${dateStr} (no time provided — conversion skipped)` };
        }
        const dk = convertTRtoDK(dateStr, timeStr);
        return { date: dk.date, time: dk.time, _label: dk.label };
      }

      return { date: dateStr };
    }
  }
}

// ── Main export ───────────────────────────────────────────────────────────────
export function parseAnswers(answers) {
  const colValues  = {};
  const raw        = [];
  const timeLabels = [];
  const warnings   = [];
  let searchValue  = null;
  let name         = null;

  for (const a of answers) {
    const title = a.field?.title ?? "";
    const ref   = a.field?.ref;
    const val   = getRawValue(a);

    raw.push({ ref, type: a.type, title, value: val });

    // Email / phone → used to find the Monday item
    if (a.type === "email")                        searchValue = val;
    if (a.type === "phone_number" && !searchValue) searchValue = val;

    // Name detection
    if (!name && a.field?.title?.toLowerCase().startsWith("navn") && !title.toLowerCase().includes("efternavn på evt")) {
      name = val;
    }

    if (!val) continue;

    // Match to Monday column by title
    const mapping = COLUMN_MAP.find(m =>
      title.toLowerCase().includes(m.title.toLowerCase())
    );
    if (!mapping) continue;

    let formatted;
    try {
      formatted = formatForMonday(mapping, val);
    } catch (e) {
      warnings.push(`${title}: ${e.message}`);
      continue;
    }

    if (!formatted) {
      warnings.push(`${title}: could not parse value "${val}" — column skipped`);
      continue;
    }

    // Pull out the human-readable time label before saving to Monday
    if (formatted._label) {
      timeLabels.push(`${title}: ${formatted._label}`);
      const { _label, ...rest } = formatted;
      colValues[mapping.id] = rest;
    } else {
      colValues[mapping.id] = formatted;
    }
  }

  return { colValues, searchValue, name, raw, timeLabels, warnings };
}

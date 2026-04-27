import { DateTime } from "luxon";

// Typeform field title → Monday column ID + how to format the value
const COLUMN_MAP = [
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
// Accepts any reasonable user input and returns { dateStr: "YYYY-MM-DD", timeStr: "HH:MM" | null }
function parseDateValue(raw) {
  const s = String(raw).trim();

  // "DD/MM/YYYY HH:MM" or "D/M/YYYY H:MM" — slashes, optional single digits
  const dmy = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})[\s,T]+(\d{1,2}):(\d{2})/);
  if (dmy) {
    return {
      dateStr: `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`,
      timeStr: `${dmy[4].padStart(2, "0")}:${dmy[5]}`,
    };
  }

  // "DD/MM/YYYY" — date only, various separators
  const dmyOnly = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (dmyOnly) {
    return {
      dateStr: `${dmyOnly[3]}-${dmyOnly[2].padStart(2, "0")}-${dmyOnly[1].padStart(2, "0")}`,
      timeStr: null,
    };
  }

  // "YYYY-MM-DD HH:MM" or "YYYY-MM-DDTHH:MM"
  const isodt = s.match(/^(\d{4}-\d{2}-\d{2})[\sT](\d{1,2}:\d{2})/);
  if (isodt) return { dateStr: isodt[1], timeStr: isodt[2].padStart(5, "0") };

  // "YYYY-MM-DD" — ISO date only
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return { dateStr: s.slice(0, 10), timeStr: null };

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

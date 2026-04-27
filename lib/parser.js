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

// Turkish time (UTC+3, no DST) → Danish time (CET/CEST, auto DST)
function convertTRtoDK(dateStr, timeStr) {
  try {
    const tr = DateTime.fromISO(`${dateStr}T${timeStr}`, { zone: "Europe/Istanbul" });
    if (!tr.isValid) throw new Error(tr.invalidExplanation);
    const dk = tr.setZone("Europe/Copenhagen");
    return {
      date: dk.toISODate(),
      time: dk.toFormat("HH:mm:ss"),
      label: `${dk.toFormat("HH:mm")} DK (was ${timeStr} TR)`,
    };
  } catch (e) {
    throw Object.assign(new Error(`Time conversion failed: ${e.message}`), { code: "TIME_PARSE" });
  }
}

function getRawValue(answer) {
  const t = answer.type;
  if (t === "choice")  return answer.choice?.label  ?? null;
  if (t === "choices") return answer.choices?.labels?.join(", ") ?? null;
  return answer[t] ?? null;
}

function formatForMonday(mapping, val) {
  const s = String(val);
  switch (mapping.type) {
    case "text":     return s;
    case "status":   return { label: s };
    case "dropdown": return { labels: [s] };
    case "date": {
      // Date value may arrive as "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM:SS.000Z"
      const dateStr = s.slice(0, 10);
      const timePart = s.length > 10 ? s.slice(11, 16) : null; // "HH:MM" if present

      if (mapping.convertTime && timePart) {
        const dk = convertTRtoDK(dateStr, timePart);
        return { date: dk.date, time: dk.time, _label: dk.label };
      }
      return { date: dateStr };
    }
  }
}

export function parseAnswers(answers) {
  const colValues  = {};
  const raw        = [];
  const timeLabels = [];
  let searchValue  = null;
  let name         = null;

  for (const a of answers) {
    const title = a.field?.title ?? "";
    const ref   = a.field?.ref;
    const val   = getRawValue(a);

    raw.push({ ref, type: a.type, title, value: val });

    // Email / phone → used to find the Monday item
    if (a.type === "email")                          searchValue = val;
    if (a.type === "phone_number" && !searchValue)   searchValue = val;

    // Name (first short_text that isn't a time pattern)
    if (!name && ["text", "short_text"].includes(a.type) && !/^\d{1,2}:\d{2}$/.test(val ?? "")) {
      name = val;
    }

    if (!val) continue;

    // Match to Monday column by title substring
    const mapping = COLUMN_MAP.find(m =>
      title.toLowerCase().includes(m.title.toLowerCase())
    );
    if (!mapping) continue;

    const formatted = formatForMonday(mapping, val);
    if (!formatted) continue;

    // Extract the time label before storing (it's not a real Monday field)
    if (formatted._label) {
      timeLabels.push(`${title}: ${formatted._label}`);
      const { _label, ...rest } = formatted;
      colValues[mapping.id] = rest;
    } else {
      colValues[mapping.id] = formatted;
    }
  }

  return { colValues, searchValue, name, raw, timeLabels };
}

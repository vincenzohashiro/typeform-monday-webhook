import { DateTime } from "luxon";

export function convertTime(dateStr, timeStr) {
  try {
    const tr = DateTime.fromISO(`${dateStr}T${timeStr}`, { zone: "Europe/Istanbul" });
    if (!tr.isValid) throw new Error(tr.invalidExplanation);
    const dk = tr.setZone("Europe/Copenhagen");
    return {
      date: dk.toISODate(),
      hour: dk.hour,
      minute: dk.minute,
      label: `${dk.toFormat("HH:mm")} DK (was ${timeStr} TR)`,
    };
  } catch (e) {
    throw Object.assign(new Error(`Time conversion failed: ${e.message}`), { code: "TIME_PARSE" });
  }
}

function getRawValue(answer) {
  const t = answer.type;
  if (t === "choice")  return answer.choice?.label ?? null;
  if (t === "choices") return answer.choices?.labels?.join(", ") ?? null;
  return answer[t] ?? null;
}

export function parseAnswers(answers) {
  const f = { raw: [] };

  for (const a of answers) {
    const val = getRawValue(a);
    const ref  = a.field?.ref;

    f.raw.push({ ref, type: a.type, title: a.field?.title, value: val });

    // Auto-detect by field type
    if (a.type === "email")        f.email = val;
    if (a.type === "date")         f.date  = String(val);
    if (a.type === "phone_number") f.phone = val;
    if (["text", "short_text"].includes(a.type) && /^\d{1,2}:\d{2}$/.test(val ?? "")) f.time = val;
    if (!f.name && ["text", "short_text"].includes(a.type) && f.time !== val) f.name = val;

    // Env var ref overrides
    if (process.env.SEARCH_FIELD_REF && ref === process.env.SEARCH_FIELD_REF) f.searchOverride = val;
    if (process.env.TIME_FIELD_REF   && ref === process.env.TIME_FIELD_REF)   f.time = val;
    if (process.env.DATE_FIELD_REF   && ref === process.env.DATE_FIELD_REF)   f.date = String(val);
    if (process.env.NAME_FIELD_REF   && ref === process.env.NAME_FIELD_REF)   f.name = val;
  }

  f.searchValue = f.searchOverride ?? f.email ?? f.phone ?? null;
  return f;
}

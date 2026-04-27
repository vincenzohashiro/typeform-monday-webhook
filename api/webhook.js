import { kv } from "@vercel/kv";
import { findItem, updateItem, postUpdate } from "../lib/monday.js";
import { parseAnswers, convertTime } from "../lib/parser.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { form_response } = req.body ?? {};

  if (!form_response) {
    await saveEvent({ type: "failed", code: "INVALID_PAYLOAD", detail: "Missing form_response in body" });
    return res.status(400).json({ error: "Invalid payload" });
  }

  const answers    = form_response.answers ?? [];
  const fields     = parseAnswers(answers);
  const identifier = fields.searchValue ?? "(unknown)";

  try {
    if (!fields.searchValue) {
      throw Object.assign(
        new Error("No email or phone found in Typeform response"),
        { code: "INVALID_PAYLOAD" }
      );
    }

    const searchCol = process.env.SEARCH_COLUMN ?? "email";
    const item      = await findItem(searchCol, fields.searchValue);

    if (!item) {
      throw Object.assign(
        new Error(`No item found where column [${searchCol}] = "${fields.searchValue}"`),
        { code: "ITEM_NOT_FOUND" }
      );
    }

    const colValues = {};
    let timeLabel   = null;

    if (fields.date && fields.time) {
      const dk = convertTime(fields.date, fields.time);
      timeLabel = dk.label;

      colValues[process.env.TIME_COLUMN ?? "hour"] = { hour: dk.hour, minute: dk.minute };
      colValues[process.env.DATE_COLUMN ?? "date"] = { date: dk.date };
    }

    if (Object.keys(colValues).length) await updateItem(item.id, colValues);

    await postUpdate(
      item.id,
      [
        "**New Typeform booking**",
        `Name: ${fields.name ?? "N/A"}`,
        `Contact: ${identifier}`,
        timeLabel ? `Appointment: ${timeLabel}` : null,
        `Submitted: ${form_response.submitted_at ?? new Date().toISOString()}`,
      ]
        .filter(Boolean)
        .join("\n")
    );

    await saveEvent({ type: "success", identifier, name: fields.name, itemId: item.id, itemName: item.name, timeLabel, raw: fields.raw });
    res.json({ ok: true, itemId: item.id });

  } catch (err) {
    await saveEvent({ type: "failed", identifier, name: fields.name, code: err.code ?? "UNKNOWN", detail: err.message, raw: fields.raw });
    res.status(500).json({ error: err.message, code: err.code });
  }
}

async function saveEvent(entry) {
  try {
    await kv.lpush("events", JSON.stringify({ id: Date.now(), ts: new Date().toISOString(), ...entry }));
    await kv.ltrim("events", 0, 299);
  } catch (e) {
    console.error("KV write failed:", e.message);
  }
}

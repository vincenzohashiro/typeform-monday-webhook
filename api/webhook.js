import { kv } from "@vercel/kv";
import { findItem, updateItem, postUpdate } from "../lib/monday.js";
import { parseAnswers } from "../lib/parser.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { form_response } = req.body ?? {};

  if (!form_response) {
    await saveEvent({ type: "failed", code: "INVALID_PAYLOAD", detail: "Missing form_response in body" });
    return res.status(400).json({ error: "Invalid payload" });
  }

  const answers                                                        = form_response.answers ?? [];
  const { colValues, searchValue, name, raw, timeLabels, warnings }    = parseAnswers(answers);
  const identifier                                                      = searchValue ?? "(unknown)";

  try {
    if (!searchValue) {
      throw Object.assign(
        new Error("No email or phone found in Typeform response"),
        { code: "INVALID_PAYLOAD" }
      );
    }

    // Find the Monday item by email
    const item = await findItem("email_mkza7v62", searchValue);

    if (!item) {
      throw Object.assign(
        new Error(`No Monday item found where [email_mkza7v62] = "${searchValue}"`),
        { code: "ITEM_NOT_FOUND" }
      );
    }

    // Always set these two status columns on successful submission
    colValues["color_mm0x1y1w"] = { label: "Yes" };
    colValues["color_mkzbweje"] = { label: "Email 3 sendt" };

    // Update all mapped columns in one call
    await updateItem(item.id, colValues);

    // Post update comment
    await postUpdate(
      item.id,
      [
        "Form submitted on time ✅",
        `Email sendt: ${identifier}`,
        `Form submitted: Yes`,
        ...timeLabels,
      ].join("\n")
    );

    await saveEvent({
      type:      "success",
      identifier,
      name,
      itemId:    item.id,
      itemName:  item.name,
      timeLabels,
      warnings,
      columns:   Object.keys(colValues).length,
      raw,
    });

    res.json({ ok: true, itemId: item.id, columnsUpdated: Object.keys(colValues).length });

  } catch (err) {
    await saveEvent({
      type:   "failed",
      identifier,
      name,
      code:   err.code ?? "UNKNOWN",
      detail: err.message,
      raw,
    });
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

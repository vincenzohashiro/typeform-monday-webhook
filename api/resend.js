import { kv } from "@vercel/kv";
import { findItem, updateItem, postUpdate } from "../lib/monday.js";
import { buildFromRaw } from "../lib/parser.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { eventId } = req.body ?? {};
  if (!eventId) return res.status(400).json({ error: "eventId required" });

  // Find the stored event
  const all    = await kv.lrange("events", 0, 299);
  const events = all.map(e => (typeof e === "string" ? JSON.parse(e) : e));
  const event  = events.find(e => String(e.id) === String(eventId));

  if (!event)           return res.status(404).json({ error: "Event not found" });
  if (!event.raw?.length) return res.status(400).json({ error: "No raw data stored for this event" });

  const { colValues, searchValue, name, timeLabels, warnings } = buildFromRaw(event.raw);

  try {
    if (!searchValue) throw Object.assign(
      new Error("No email found in stored data"),
      { code: "INVALID_PAYLOAD" }
    );

    const item = await findItem("email_mkza7v62", searchValue);
    if (!item) throw Object.assign(
      new Error(`No Monday item found for "${searchValue}"`),
      { code: "ITEM_NOT_FOUND" }
    );

    colValues["color_mm0x1y1w"] = { label: "Yes" };
    colValues["color_mkzbweje"] = { label: "Email 3 sendt" };

    await updateItem(item.id, colValues);
    await postUpdate(item.id, [
      "**Typeform booking resent**",
      `Contact: ${searchValue}`,
      ...timeLabels,
    ].join("\n"));

    // Log the resend
    await kv.lpush("events", JSON.stringify({
      id:        Date.now(),
      ts:        new Date().toISOString(),
      type:      "success",
      resent:    true,
      identifier: searchValue,
      name,
      itemId:    item.id,
      itemName:  item.name,
      timeLabels,
      warnings,
      columns:   Object.keys(colValues).length,
      raw:       event.raw,
    }));
    await kv.ltrim("events", 0, 299);

    res.json({ ok: true, itemId: item.id, columnsUpdated: Object.keys(colValues).length });
  } catch (err) {
    res.status(500).json({ error: err.message, code: err.code });
  }
}

import { kv } from "@vercel/kv";

// One-shot: clear a stale calendar KV entry so Monday stops retrying
// GET /api/clear-cal-kv?itemId=2881892175
export default async function handler(req, res) {
  const itemId = req.query?.itemId;
  if (!itemId) return res.status(400).json({ error: "itemId query param required" });

  const kvKey = `cal:${itemId}`;
  const existing = await kv.get(kvKey);
  if (!existing) return res.json({ ok: true, note: "No KV entry found for this item" });

  await kv.del(kvKey);
  res.json({ ok: true, cleared: kvKey, was: existing });
}

import { kv } from "@vercel/kv";
import { createMondayItemFromWPForm } from "../lib/wpForms.js";

async function logEntry(entry) {
  try {
    await kv.lpush("wpforms_leads", JSON.stringify({ ...entry, ts: new Date().toISOString() }));
    await kv.ltrim("wpforms_leads", 0, 199);
  } catch {}
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // Verify shared secret if configured
  const secret = process.env.WPFORMS_WEBHOOK_SECRET;
  if (secret) {
    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${secret}`) return res.status(401).json({ error: "Unauthorized" });
  }

  const payload = req.body ?? {};
  const entryId = String(payload.entry_id ?? "");
  if (!entryId) return res.status(400).json({ error: "Missing entry_id" });

  // Idempotency — skip if already processed
  const already = await kv.get(`wpforms_entry:${entryId}`);
  if (already) return res.status(200).json({ ok: true, duplicate: true });

  try {
    const { itemId, itemName, raw } = await createMondayItemFromWPForm(payload);
    await kv.set(`wpforms_entry:${entryId}`, { itemId, createdAt: new Date().toISOString() });
    await logEntry({ action: "created", entryId, itemId, itemName, raw, fields: payload.fields ?? [] });
    res.status(200).json({ ok: true, itemId });
  } catch (err) {
    await logEntry({ action: "error", entryId, error: err.message, code: err.code ?? "UNKNOWN", fields: payload.fields ?? [] });
    res.status(200).json({ ok: false, error: err.message });
  }
}

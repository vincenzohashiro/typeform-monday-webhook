import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const tab = req.query.tab;
  if (!["meta", "typeform", "calendar", "wpforms"].includes(tab)) {
    return res.status(400).json({ error: "invalid tab" });
  }
  await kv.set(`failed_reset_ts:${tab}`, new Date().toISOString());
  res.json({ ok: true });
}

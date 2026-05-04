import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  const [entries, failedResetTs] = await Promise.all([
    kv.lrange("meta_leads", 0, 49),
    kv.get("failed_reset_ts:meta"),
  ]);
  const events = entries.map(e => (typeof e === "string" ? JSON.parse(e) : e));
  res.json({ events, failedResetTs: failedResetTs ?? null });
}

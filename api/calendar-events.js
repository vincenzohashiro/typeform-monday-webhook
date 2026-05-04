import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  const [entries, failedResetTs] = await Promise.all([
    kv.lrange("cal_events", 0, 49),
    kv.get("failed_reset_ts:calendar"),
  ]);
  const events = entries.map(e => (typeof e === "string" ? JSON.parse(e) : e));
  res.json({ events, failedResetTs: failedResetTs ?? null });
}

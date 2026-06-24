import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  const tab     = req.query.tab === "wpforms" ? "wpforms" : req.query.tab === "email" ? "email" : req.query.tab === "calendar" ? "calendar" : "meta";
  const listKey = tab === "wpforms" ? "wpforms_leads" : tab === "email" ? "email_logs" : tab === "calendar" ? "cal_events" : "meta_leads";
  const [entries, failedResetTs] = await Promise.all([
    kv.lrange(listKey, 0, 49),
    kv.get(`failed_reset_ts:${tab}`),
  ]);
  const events = entries.map(e => (typeof e === "string" ? JSON.parse(e) : e));
  res.json({ events, failedResetTs: failedResetTs ?? null });
}

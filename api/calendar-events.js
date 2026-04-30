import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const entries = await kv.lrange("cal_events", 0, 49);
  const parsed  = entries.map(e => (typeof e === "string" ? JSON.parse(e) : e));
  res.json(parsed);
}

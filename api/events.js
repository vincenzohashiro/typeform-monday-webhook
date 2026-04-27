import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  try {
    const raw    = await kv.lrange("events", 0, 299);
    const events = raw.map(e => (typeof e === "string" ? JSON.parse(e) : e));
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

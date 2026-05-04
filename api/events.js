import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  try {
    const [raw, failedResetTs] = await Promise.all([
      kv.lrange("events", 0, 299),
      kv.get("failed_reset_ts:typeform"),
    ]);
    const events = raw.map(e => (typeof e === "string" ? JSON.parse(e) : e));
    res.json({ events, failedResetTs: failedResetTs ?? null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

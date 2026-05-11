import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const tab = req.query.tab;

  // Full calendar KV wipe (absorbed from reset-cal.js)
  if (tab === "cal-full-reset") {
    const deleted = [];
    await kv.del("cal_events");
    deleted.push("cal_events");
    let cursor = 0;
    do {
      const [nextCursor, keys] = await kv.scan(cursor, { match: "cal:*", count: 100 });
      cursor = Number(nextCursor);
      if (keys.length) {
        await Promise.all(keys.map(k => kv.del(k)));
        deleted.push(...keys);
      }
    } while (cursor !== 0);
    return res.json({ ok: true, deleted });
  }

  if (!["meta", "typeform", "calendar", "wpforms", "email"].includes(tab)) {
    return res.status(400).json({ error: "invalid tab" });
  }
  await kv.set(`failed_reset_ts:${tab}`, new Date().toISOString());
  res.json({ ok: true });
}

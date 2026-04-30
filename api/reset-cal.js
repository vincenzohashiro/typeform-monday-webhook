import { kv } from "@vercel/kv";

// Full reset: clears the sync log and all cal:{itemId} KV entries
// GET /api/reset-cal
export default async function handler(req, res) {
  const deleted = [];

  // Clear the sync log
  await kv.del("cal_events");
  deleted.push("cal_events");

  // Scan and delete all cal:{itemId} entries
  let cursor = 0;
  do {
    const [nextCursor, keys] = await kv.scan(cursor, { match: "cal:*", count: 100 });
    cursor = Number(nextCursor);
    if (keys.length) {
      await Promise.all(keys.map(k => kv.del(k)));
      deleted.push(...keys);
    }
  } while (cursor !== 0);

  res.json({ ok: true, deleted });
}

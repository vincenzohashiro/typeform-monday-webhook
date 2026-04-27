import { getBoardColumns } from "../lib/monday.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  try {
    const columns = await getBoardColumns();
    res.json({ ok: true, columns });
  } catch (err) {
    res.json({ ok: false, code: err.code, error: err.message });
  }
}

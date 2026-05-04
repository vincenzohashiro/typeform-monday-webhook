import { kv } from "@vercel/kv";
import { fetchLeadData, createMondayItemFromLead } from "../lib/metaLeads.js";

async function logEntry(entry) {
  try {
    await kv.lpush("meta_leads", JSON.stringify({ ...entry, ts: new Date().toISOString() }));
    await kv.ltrim("meta_leads", 0, 199);
  } catch {}
}

export default async function handler(req, res) {
  // GET: Meta webhook verification challenge
  if (req.method === "GET") {
    const mode      = req.query["hub.mode"];
    const token     = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: "Verification failed" });
  }

  if (req.method !== "POST") return res.status(405).end();

  const body = req.body ?? {};
  if (body.object !== "page") return res.status(200).json({ ignored: "not a page event" });

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen") continue;

      const leadId = String(change.value.leadgen_id);

      // Idempotency — skip if already processed
      const already = await kv.get(`meta_lead:${leadId}`);
      if (already) continue;

      try {
        const leadData             = await fetchLeadData(leadId);
        const { itemId, itemName, raw } = await createMondayItemFromLead(leadData);

        await kv.set(`meta_lead:${leadId}`, { itemId, createdAt: new Date().toISOString() });
        await logEntry({ action: "created", leadId, itemId, itemName, raw });
      } catch (err) {
        await logEntry({ action: "error", leadId, error: err.message, code: err.code ?? "UNKNOWN" });
      }
    }
  }

  res.status(200).json({ ok: true });
}

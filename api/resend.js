import { kv } from "@vercel/kv";
import { findItem, updateItem, postUpdate, getItemDetails, getBoardItems } from "../lib/monday.js";
import { buildFromRaw } from "../lib/parser.js";
import { createMondayItemFromWPForm } from "../lib/wpForms.js";
import { sendEmail } from "../lib/gmail.js";
import { BOARD_EMAIL_CONFIG, EMAIL_CONFIG } from "../lib/emailConfig.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { eventId, source, entryId } = req.body ?? {};

  // ── WPForms resend ──────────────────────────────────────────────────────────
  if (source === "wpforms") {
    const all     = await kv.lrange("wpforms_leads", 0, 49);
    const entries = all.map(e => (typeof e === "string" ? JSON.parse(e) : e));
    const entry   = entries.find(e => String(e.entryId) === String(entryId));

    if (!entry)              return res.status(404).json({ error: "Entry not found" });
    if (!entry.fields?.length) return res.status(400).json({ error: "No field data stored for this entry" });

    try {
      // Remove idempotency key so the resend isn't blocked
      await kv.del(`wpforms_entry:${entryId}`);
      const payload              = { entry_id: entryId, fields: entry.fields };
      const { itemId, itemName, raw } = await createMondayItemFromWPForm(payload);
      await kv.set(`wpforms_entry:${entryId}`, { itemId, createdAt: new Date().toISOString() });
      await kv.lpush("wpforms_leads", JSON.stringify({
        action: "created", entryId, itemId, itemName, raw, fields: entry.fields, resent: true,
        ts: new Date().toISOString(),
      }));
      await kv.ltrim("wpforms_leads", 0, 199);
      return res.json({ ok: true, itemId });
    } catch (err) {
      return res.status(500).json({ error: err.message, code: err.code });
    }
  }

  // ── Email resend ────────────────────────────────────────────────────────────
  if (source === "email") {
    const { itemId, emailType, boardId } = req.body ?? {};
    if (!itemId || !emailType || !boardId) return res.status(400).json({ error: "itemId, emailType, boardId required" });

    const boardCfg = BOARD_EMAIL_CONFIG[String(boardId)];
    if (!boardCfg) return res.status(400).json({ error: "Unknown board" });

    const emailCfg = EMAIL_CONFIG[emailType];
    if (!emailCfg?.subject) return res.status(400).json({ error: "Email template not configured" });

    try {
      const item     = await getItemDetails(String(itemId), [boardCfg.emailColumnId]);
      const emailCol = item?.column_values?.find(c => c.id === boardCfg.emailColumnId);
      const to       = emailCol?.text?.trim();
      if (!to) return res.status(400).json({ error: "No email on Monday item" });

      const itemName = item.name ?? "Kunde";

      // Clear idempotency lock so this resend can proceed
      await kv.del(`email_sent:${itemId}:${emailType}`);

      await sendEmail({
        to,
        subject:        emailCfg.subject,
        bodyText:       emailCfg.body(itemName),
        attachmentUrls: emailCfg.attachments,
      });

      await kv.set(`email_sent:${itemId}:${emailType}`, 1, { ex: 60 * 60 * 24 * 30 });
      const emailLabel = emailType.replace("email", "Email ");
      const sentAt     = new Date().toLocaleString("da-DK", { dateStyle: "short", timeStyle: "short" });
      postUpdate(String(itemId), `✉️ ${emailLabel} sendt (gensendt)\nSendt: ${sentAt}\nStatus: Sendt ✓`).catch(() => {});
      await kv.lpush("email_logs", JSON.stringify({
        action: "sent", boardId: String(boardId), itemId: String(itemId),
        itemName, emailType, to, resent: true, ts: new Date().toISOString(),
      }));
      await kv.ltrim("email_logs", 0, 199);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Typeform resend (existing logic) ───────────────────────────────────────
  if (!eventId) return res.status(400).json({ error: "eventId required" });

  // Find the stored event
  const all    = await kv.lrange("events", 0, 299);
  const events = all.map(e => (typeof e === "string" ? JSON.parse(e) : e));
  const event  = events.find(e => String(e.id) === String(eventId));

  if (!event)           return res.status(404).json({ error: "Event not found" });
  if (!event.raw?.length) return res.status(400).json({ error: "No raw data stored for this event" });

  const { colValues, searchValue, name, timeLabels, warnings } = buildFromRaw(event.raw);

  try {
    if (!searchValue) throw Object.assign(
      new Error("No email found in stored data"),
      { code: "INVALID_PAYLOAD" }
    );

    const item = await findItem("email_mkza7v62", searchValue);
    if (!item) throw Object.assign(
      new Error(`No Monday item found for "${searchValue}"`),
      { code: "ITEM_NOT_FOUND" }
    );

    colValues["color_mm0x1y1w"] = { label: "Yes" };
    colValues["color_mkzbweje"] = { label: "Email 3 sendt" };

    await updateItem(item.id, colValues);
    await postUpdate(item.id, [
      "Form submitted on time ✅ (resent)",
      `Email sendt: ${searchValue}`,
      `Form submitted: Yes`,
      ...timeLabels,
    ].join("\n"));

    // Mark the original token as processed so any pending Typeform retries are ignored
    const token = event.raw?.find?.(f => f.ref === "__token__")?.value ?? null;
    if (token) await kv.set(`tf_token:${token}`, 1, { ex: 60 * 60 * 24 * 30 });

    // Log the resend
    await kv.lpush("events", JSON.stringify({
      id:        Date.now(),
      ts:        new Date().toISOString(),
      type:      "success",
      resent:    true,
      identifier: searchValue,
      name,
      itemId:    item.id,
      itemName:  item.name,
      timeLabels,
      warnings,
      columns:   Object.keys(colValues).length,
      raw:       event.raw,
    }));
    await kv.ltrim("events", 0, 299);

    res.json({ ok: true, itemId: item.id, columnsUpdated: Object.keys(colValues).length });
  } catch (err) {
    res.status(500).json({ error: err.message, code: err.code });
  }
}

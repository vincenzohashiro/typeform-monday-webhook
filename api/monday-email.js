import { kv } from "@vercel/kv";
import { getItemDetails, postUpdate } from "../lib/monday.js";
import { sendEmail } from "../lib/gmail.js";
import { BOARD_EMAIL_CONFIG, EMAIL_CONFIG } from "../lib/emailConfig.js";

async function logEntry(entry) {
  try {
    await kv.lpush("email_logs", JSON.stringify({ ...entry, ts: new Date().toISOString() }));
    await kv.ltrim("email_logs", 0, 199);
  } catch {}
}

export default async function handler(req, res) {
  if (req.body?.challenge) return res.json({ challenge: req.body.challenge });
  if (req.method !== "POST") return res.status(405).end();

  const { event } = req.body ?? {};
  if (!event) return res.status(400).json({ error: "No event" });

  const boardId  = String(event.boardId);
  const itemId   = String(event.pulseId);
  const itemName = event.pulseName ?? "Kunde";
  const columnId = event.columnId;
  const newLabel = event.value?.label?.text ?? "";

  const boardCfg = BOARD_EMAIL_CONFIG[boardId];
  if (!boardCfg) return res.status(200).json({ ignored: "unknown board" });
  if (columnId !== boardCfg.statusColumnId) return res.status(200).json({ ignored: "untracked column" });

  const emailType = boardCfg.triggers[newLabel];
  if (!emailType) return res.status(200).json({ ignored: "untracked label" });

  const emailCfg = EMAIL_CONFIG[emailType];
  if (!emailCfg?.subject) {
    await logEntry({ action: "error", boardId, itemId, itemName, emailType, error: "Email template not configured yet" });
    return res.status(200).json({ ok: false, error: "Email template not configured" });
  }

  try {
    const item     = await getItemDetails(itemId, [boardCfg.emailColumnId]);
    const emailCol = item?.column_values?.find(c => c.id === boardCfg.emailColumnId);
    const to       = emailCol?.text?.trim();

    if (!to) {
      await logEntry({ action: "error", boardId, itemId, itemName, emailType, error: "No email on item" });
      return res.status(200).json({ ok: false, error: "No email on item" });
    }

    // Atomic idempotency — SET NX claims the lock before sending
    const idemKey = `email_sent:${itemId}:${emailType}`;
    const claimed = await kv.set(idemKey, 1, { ex: 60 * 60 * 24 * 30, nx: true });
    if (!claimed) {
      await logEntry({ action: "duplicate", boardId, itemId, itemName, emailType, to });
      return res.status(200).json({ ok: true, duplicate: true });
    }

    // Retry up to 3 times before giving up
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await sendEmail({
          to,
          subject:        emailCfg.subject,
          bodyText:       emailCfg.body(itemName),
          attachmentUrls: emailCfg.attachments,
        });
        const emailLabel = emailType.replace("email", "Email ");
        const sentAt     = new Date().toLocaleString("da-DK", { dateStyle: "short", timeStyle: "short" });
        postUpdate(itemId, `✉️ ${emailLabel} sendt\nSendt: ${sentAt}\nStatus: Sendt ✓`).catch(() => {});
        await logEntry({ action: "sent", boardId, itemId, itemName, emailType, to });
        return res.json({ ok: true });
      } catch (err) {
        lastErr = err;
        if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 1500));
      }
    }

    // All 3 attempts failed — release lock so manual resend can retry
    await kv.del(idemKey);
    await logEntry({ action: "error", boardId, itemId, itemName, emailType, error: lastErr.message, to });
    return res.status(500).json({ error: lastErr.message });

  } catch (err) {
    await logEntry({ action: "error", boardId, itemId, itemName, emailType, error: err.message });
    return res.status(500).json({ error: err.message });
  }
}

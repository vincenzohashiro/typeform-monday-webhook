import { kv } from "@vercel/kv";
import { getBoardItems, postUpdate } from "../lib/monday.js";
import { sendEmail } from "../lib/gmail.js";
import { BOARD_EMAIL_CONFIG, EMAIL_CONFIG } from "../lib/emailConfig.js";

const BOARD_ID     = "5052958230";
const DATE_COL     = "date_mkxmb3rn";
const EMAIL_TYPE   = "email4";
const WINDOW_DAYS  = 14;

function daysUntil(dateStr) {
  const target = new Date(dateStr + "T00:00:00Z");
  const today  = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

export default async function handler(req, res) {
  // Allow Vercel cron (Authorization: Bearer <CRON_SECRET>) or direct POST for manual trigger
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).end();
  }

  const boardCfg = BOARD_EMAIL_CONFIG[BOARD_ID];
  const emailCfg = EMAIL_CONFIG[EMAIL_TYPE];

  const items = await getBoardItems(BOARD_ID, [boardCfg.emailColumnId, DATE_COL]);

  let sent = 0, skipped = 0, errors = 0;

  for (const item of items) {
    const dateCol  = item.column_values.find(c => c.id === DATE_COL);
    const emailCol = item.column_values.find(c => c.id === boardCfg.emailColumnId);

    const dateStr = dateCol?.text?.trim();
    const to      = emailCol?.text?.trim();

    if (!dateStr || !to) { skipped++; continue; }

    const days = daysUntil(dateStr);

    // Only act within the 14-day window (0 = day of operation, 14 = first trigger day)
    if (days > WINDOW_DAYS || days < 0) { skipped++; continue; }

    // Atomic lock — skip if already sent
    const idemKey = `email_sent:${item.id}:${EMAIL_TYPE}`;
    const claimed = await kv.set(idemKey, 1, { ex: 60 * 60 * 24 * 30, nx: true });
    if (!claimed) { skipped++; continue; }

    try {
      await sendEmail({
        to,
        subject:        emailCfg.subject,
        bodyText:       emailCfg.body(item.name),
        attachmentUrls: emailCfg.attachments,
      });

      const sentAt = new Date().toLocaleString("da-DK", { dateStyle: "short", timeStyle: "short" });
      postUpdate(item.id, `✉️ Email 4 sendt (automatisk – ${days} dage før operation)\nSendt: ${sentAt}\nStatus: Sendt ✓`).catch(() => {});

      await kv.lpush("email_logs", JSON.stringify({
        action: "sent", boardId: BOARD_ID, itemId: item.id, itemName: item.name,
        emailType: EMAIL_TYPE, to, auto: true, daysUntil: days, ts: new Date().toISOString(),
      }));
      await kv.ltrim("email_logs", 0, 199);
      sent++;
    } catch (err) {
      await kv.del(idemKey); // release lock so tomorrow's run can retry
      await kv.lpush("email_logs", JSON.stringify({
        action: "error", boardId: BOARD_ID, itemId: item.id, itemName: item.name,
        emailType: EMAIL_TYPE, error: err.message, to, ts: new Date().toISOString(),
      }));
      await kv.ltrim("email_logs", 0, 199);
      errors++;
    }
  }

  res.json({ ok: true, sent, skipped, errors });
}

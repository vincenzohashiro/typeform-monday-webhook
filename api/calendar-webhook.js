import { kv } from "@vercel/kv";
import { BOARDS, STATUS_CREATE, STATUS_DELETE, CALENDAR_ID } from "../lib/calendarBoards.js";
import { getItemDetails } from "../lib/monday.js";
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from "../lib/googleCalendar.js";

function parseDateColumnValue(raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { dateStr: parsed?.date ?? null, timeStr: parsed?.time ?? null };
  } catch {
    return { dateStr: null, timeStr: null };
  }
}

function buildDescription(columnValues, descColumns) {
  return descColumns
    .map(col => {
      const cv = columnValues.find(c => c.id === col.id);
      return cv?.text ? `${col.label}: ${cv.text}` : null;
    })
    .filter(Boolean)
    .join("\n");
}

async function logEntry(entry) {
  try {
    await kv.lpush("cal_events", JSON.stringify({ ...entry, ts: new Date().toISOString() }));
    await kv.ltrim("cal_events", 0, 199);
  } catch {}
}

export default async function handler(req, res) {
  // Monday webhook challenge verification (fires once when you register the webhook)
  if (req.body?.challenge) return res.json({ challenge: req.body.challenge });
  if (req.method !== "POST") return res.status(405).end();

  const { event } = req.body ?? {};
  if (!event) return res.status(400).json({ error: "No event in payload" });

  // Monday uses pulseId (legacy name) for item ID in webhook payloads
  const boardId  = String(event.boardId);
  const itemId   = String(event.pulseId);
  const itemName = event.pulseName ?? "";
  const columnId = event.columnId;

  const boardConfig = BOARDS[boardId];
  if (!boardConfig) return res.status(200).json({ ignored: "unknown board" });

  const isStatusChange = columnId === boardConfig.statusColumnId;
  const isDateChange   = columnId === boardConfig.dateColumnId;
  if (!isStatusChange && !isDateChange) return res.status(200).json({ ignored: "untracked column" });

  const kvKey = `cal:${itemId}`;

  try {
    // ── Status changed ────────────────────────────────────────────────────────
    if (isStatusChange) {
      const newStatus = event.value?.label?.text;

      if (newStatus === STATUS_CREATE) {
        const allColumnIds = [boardConfig.dateColumnId, ...boardConfig.descriptionColumns.map(c => c.id)];
        const item = await getItemDetails(itemId, allColumnIds);
        if (!item) return res.status(200).json({ ignored: "item not found" });

        const dateCol = item.column_values.find(c => c.id === boardConfig.dateColumnId);
        const { dateStr, timeStr } = parseDateColumnValue(dateCol?.value);
        if (!dateStr) return res.status(200).json({ ignored: "no date set on item" });

        const description = buildDescription(item.column_values, boardConfig.descriptionColumns);
        const eventId = await createCalendarEvent({ title: itemName, dateStr, timeStr, description, calendarId: CALENDAR_ID });

        await kv.set(kvKey, { eventId, boardId, createdAt: new Date().toISOString() });
        await logEntry({ action: "created", itemId, itemName, boardId, eventId });
        return res.json({ ok: true, action: "created", eventId });
      }

      if (newStatus === STATUS_DELETE) {
        const stored = await kv.get(kvKey);
        if (stored?.eventId) {
          await deleteCalendarEvent({ eventId: stored.eventId, calendarId: CALENDAR_ID });
          await kv.del(kvKey);
          await logEntry({ action: "deleted", itemId, itemName, boardId, eventId: stored.eventId });
        }
        return res.json({ ok: true, action: "deleted" });
      }

      return res.status(200).json({ ignored: "untracked status value" });
    }

    // ── Date changed ──────────────────────────────────────────────────────────
    if (isDateChange) {
      const stored = await kv.get(kvKey);
      if (!stored?.eventId) return res.status(200).json({ ignored: "no calendar event exists for this item" });

      // New date comes directly from the webhook payload
      const { dateStr, timeStr } = parseDateColumnValue(event.value);
      if (!dateStr) return res.status(200).json({ ignored: "no date in webhook payload" });

      // Fetch description columns for updated description
      const descColumnIds = boardConfig.descriptionColumns.map(c => c.id);
      const item = await getItemDetails(itemId, descColumnIds);
      const description = item ? buildDescription(item.column_values, boardConfig.descriptionColumns) : "";

      await updateCalendarEvent({ eventId: stored.eventId, title: itemName, dateStr, timeStr, description, calendarId: CALENDAR_ID });
      await logEntry({ action: "updated", itemId, itemName, boardId, eventId: stored.eventId });
      return res.json({ ok: true, action: "updated" });
    }
  } catch (err) {
    await logEntry({ action: "error", itemId, itemName, boardId, error: err.message });
    return res.status(500).json({ error: err.message, code: err.code ?? "UNKNOWN" });
  }
}

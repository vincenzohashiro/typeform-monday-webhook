import { kv } from "@vercel/kv";
import { BOARDS, STATUS_CREATE, STATUS_DELETE } from "../lib/calendarBoards.js";
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

function isGoneError(err) {
  const httpStatus = err.response?.status ?? err.code ?? err.status;
  return [404, 410].includes(Number(httpStatus))
    || /resource has been deleted|not found|gone/i.test(err.message ?? "")
    || /resource has been deleted|not found/i.test(JSON.stringify(err.response?.data ?? ""));
}

async function logEntry(entry) {
  try {
    await kv.lpush("cal_events", JSON.stringify({ ...entry, ts: new Date().toISOString() }));
    await kv.ltrim("cal_events", 0, 199);
  } catch {}
}

export default async function handler(req, res) {
  if (req.body?.challenge) return res.json({ challenge: req.body.challenge });
  if (req.method !== "POST") return res.status(405).end();

  const { event } = req.body ?? {};
  if (!event) return res.status(400).json({ error: "No event in payload" });

  const boardId  = String(event.boardId);
  const itemId   = String(event.pulseId);
  const itemName = event.pulseName ?? "";
  const columnId = event.columnId;

  const boardConfig = BOARDS[boardId];
  if (!boardConfig) return res.status(200).json({ ignored: "unknown board" });

  const isStatusChange = columnId === boardConfig.statusColumnId;
  const dateCol = boardConfig.dateColumns.find(d => d.id === columnId);
  const isDateChange = !!dateCol;
  if (!isStatusChange && !isDateChange) return res.status(200).json({ ignored: "untracked column" });

  try {
    // ── Status changed ────────────────────────────────────────────────────────
    if (isStatusChange) {
      const newStatus = event.value?.label?.text;

      if (newStatus === STATUS_CREATE) {
        const allColumnIds = [
          ...boardConfig.dateColumns.map(d => d.id),
          ...boardConfig.descriptionColumns.map(c => c.id),
        ];
        const item = await getItemDetails(itemId, allColumnIds);
        if (!item) return res.status(200).json({ ignored: "item not found" });

        const description = buildDescription(item.column_values, boardConfig.descriptionColumns);
        const results = [];

        for (const dc of boardConfig.dateColumns) {
          const col = item.column_values.find(c => c.id === dc.id);
          const { dateStr, timeStr } = parseDateColumnValue(col?.value);
          if (!dateStr) continue;

          const kvKey = `cal:${itemId}:${dc.id}`;
          const title = `${itemName} — ${dc.label}`;

          const existing = await kv.get(kvKey);
          if (existing?.eventId) {
            try {
              await updateCalendarEvent({ eventId: existing.eventId, title, dateStr, timeStr, description, calendarId: boardConfig.calendarId });
              results.push({ column: dc.id, action: "deduplicated", eventId: existing.eventId });
              await logEntry({ action: "deduplicated", itemId, itemName, boardId, column: dc.id, columnLabel: dc.label, eventId: existing.eventId });
              continue;
            } catch (updateErr) {
              if (!isGoneError(updateErr)) throw updateErr;
              await kv.del(kvKey);
            }
          }

          const eventId = await createCalendarEvent({ title, dateStr, timeStr, description, calendarId: boardConfig.calendarId });
          await kv.set(kvKey, { eventId, boardId, column: dc.id, createdAt: new Date().toISOString() });
          results.push({ column: dc.id, action: "created", eventId });
          await logEntry({ action: "created", itemId, itemName, boardId, column: dc.id, columnLabel: dc.label, eventId });
        }

        if (!results.length) return res.status(200).json({ ignored: "no dates set on item" });
        return res.json({ ok: true, results });
      }

      if (newStatus === STATUS_DELETE) {
        const deleted = [];
        for (const dc of boardConfig.dateColumns) {
          const kvKey = `cal:${itemId}:${dc.id}`;
          const stored = await kv.get(kvKey);
          if (!stored?.eventId) continue;
          try {
            await deleteCalendarEvent({ eventId: stored.eventId, calendarId: boardConfig.calendarId });
          } catch (delErr) {
            if (!isGoneError(delErr)) throw delErr;
          }
          await kv.del(kvKey);
          deleted.push({ column: dc.id, eventId: stored.eventId });
          await logEntry({ action: "deleted", itemId, itemName, boardId, column: dc.id, columnLabel: dc.label, eventId: stored.eventId });
        }
        return res.json({ ok: true, action: "deleted", count: deleted.length });
      }

      return res.status(200).json({ ignored: "untracked status value" });
    }

    // ── Date changed ──────────────────────────────────────────────────────────
    if (isDateChange) {
      const kvKey = `cal:${itemId}:${dateCol.id}`;
      const { dateStr, timeStr } = parseDateColumnValue(event.value);
      const title = `${itemName} — ${dateCol.label}`;

      // Date cleared — delete the calendar event if one exists
      if (!dateStr) {
        const stored = await kv.get(kvKey);
        if (!stored?.eventId) return res.status(200).json({ ignored: "no date and no event" });
        try {
          await deleteCalendarEvent({ eventId: stored.eventId, calendarId: boardConfig.calendarId });
        } catch (delErr) {
          if (!isGoneError(delErr)) throw delErr;
        }
        await kv.del(kvKey);
        await logEntry({ action: "cleared", itemId, itemName, boardId, column: dateCol.id, columnLabel: dateCol.label, eventId: stored.eventId });
        return res.json({ ok: true, action: "cleared" });
      }

      const descColumnIds = boardConfig.descriptionColumns.map(c => c.id);
      const item = await getItemDetails(itemId, descColumnIds);
      const description = item ? buildDescription(item.column_values, boardConfig.descriptionColumns) : "";

      const stored = await kv.get(kvKey);

      // Existing event — update it
      if (stored?.eventId) {
        try {
          await updateCalendarEvent({ eventId: stored.eventId, title, dateStr, timeStr, description, calendarId: boardConfig.calendarId });
          await logEntry({ action: "updated", itemId, itemName, boardId, column: dateCol.id, columnLabel: dateCol.label, eventId: stored.eventId });
          return res.json({ ok: true, action: "updated" });
        } catch (updateErr) {
          if (!isGoneError(updateErr)) throw updateErr;
          await kv.del(kvKey);
          await logEntry({ action: "stale_cleared", itemId, itemName, boardId, column: dateCol.id, columnLabel: dateCol.label, eventId: stored.eventId });
        }
      }

      // No existing event — auto-create one since the date was set
      const eventId = await createCalendarEvent({ title, dateStr, timeStr, description, calendarId: boardConfig.calendarId });
      await kv.set(kvKey, { eventId, boardId, column: dateCol.id, createdAt: new Date().toISOString() });
      await logEntry({ action: "auto_created", itemId, itemName, boardId, column: dateCol.id, columnLabel: dateCol.label, eventId });
      return res.json({ ok: true, action: "auto_created", eventId });
    }
  } catch (err) {
    await logEntry({ action: "error", itemId, itemName, boardId, column: columnId, error: err.message });
    return res.status(500).json({ error: err.message, code: err.code ?? "UNKNOWN" });
  }
}

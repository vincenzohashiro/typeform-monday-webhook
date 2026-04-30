import { google } from "googleapis";
import { DateTime } from "luxon";

function getClient() {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) throw Object.assign(
    new Error("Google OAuth credentials not configured — set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN"),
    { code: "NO_GCAL_CREDS" }
  );

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: "v3", auth });
}

// Times are stored as Danish local time — use them directly as Europe/Copenhagen.
function buildEventTimes(dateStr, timeStr) {
  const start = timeStr
    ? DateTime.fromISO(`${dateStr}T${timeStr}`, { zone: "Europe/Copenhagen" })
    : DateTime.fromISO(`${dateStr}T09:00:00`,   { zone: "Europe/Copenhagen" });

  const end = start.plus({ minutes: 30 });

  return {
    start: { dateTime: start.toISO({ suppressMilliseconds: true }), timeZone: "Europe/Copenhagen" },
    end:   { dateTime: end.toISO({ suppressMilliseconds: true }),   timeZone: "Europe/Copenhagen" },
  };
}

export async function createCalendarEvent({ title, dateStr, timeStr, description, calendarId }) {
  const calendar = getClient();
  const times    = buildEventTimes(dateStr, timeStr);

  const res = await calendar.events.insert({
    calendarId,
    requestBody: { summary: title, description, ...times },
  });

  return res.data.id;
}

export async function updateCalendarEvent({ eventId, title, dateStr, timeStr, description, calendarId }) {
  const calendar = getClient();
  const times    = buildEventTimes(dateStr, timeStr);

  await calendar.events.patch({
    calendarId,
    eventId,
    requestBody: { summary: title, description, ...times },
  });
}

export async function deleteCalendarEvent({ eventId, calendarId }) {
  const calendar = getClient();
  await calendar.events.delete({ calendarId, eventId });
}

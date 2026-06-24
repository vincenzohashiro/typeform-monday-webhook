import { google } from "googleapis";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const checks = {};

  // 1. Monday API
  checks.monday = await testMonday();

  // 2. Google OAuth (shared by Calendar + Gmail)
  checks.google = await testGoogle();

  // 3. Gmail send capability
  checks.gmail = await testGmail(checks.google.auth);

  // 4. Google Calendar access
  checks.calendar = await testCalendar(checks.google.auth);

  // 5. Vercel KV
  checks.kv = await testKV();

  // 6. Blob storage
  checks.blob = await testBlob();

  // 7. Meta
  checks.meta = testMeta();

  const allOk = Object.values(checks).every(c => c.ok);
  res.json({ ok: allOk, checks });
}

async function testMonday() {
  const token = process.env.MONDAY_API_KEY;
  if (!token) return { ok: false, error: "MONDAY_API_KEY not set" };
  try {
    const r = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2025-01" },
      body: JSON.stringify({ query: "query { me { id name } }" }),
    });
    const json = await r.json();
    if (json.errors?.length) return { ok: false, error: json.errors[0].message };
    return { ok: true, user: json.data.me.name };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function testGoogle() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId) return { ok: false, error: "GOOGLE_CLIENT_ID not set", auth: null };
  if (!clientSecret) return { ok: false, error: "GOOGLE_CLIENT_SECRET not set", auth: null };
  if (!refreshToken) return { ok: false, error: "GOOGLE_REFRESH_TOKEN not set", auth: null };

  try {
    const auth = new google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials({ refresh_token: refreshToken });
    const { token } = await auth.getAccessToken();
    if (!token) return { ok: false, error: "Failed to get access token — refresh token may be revoked", auth: null };
    return { ok: true, auth };
  } catch (e) {
    const msg = e.message || "";
    let hint = "";
    if (msg.includes("invalid_client")) hint = " — Client ID or Secret is wrong, or the OAuth client was deleted in Google Cloud Console";
    if (msg.includes("invalid_grant")) hint = " — Refresh token is expired or revoked. Regenerate it via the OAuth consent flow";
    if (msg.includes("unauthorized_client")) hint = " — OAuth consent screen may be in 'Testing' mode (tokens expire after 7 days). Set it to 'Production'";
    return { ok: false, error: msg + hint, auth: null };
  }
}

async function testGmail(auth) {
  if (!auth) return { ok: false, error: "Skipped — Google OAuth failed" };
  const gmailUser = process.env.GMAIL_USER;
  if (!gmailUser) return { ok: false, error: "GMAIL_USER not set" };
  try {
    const gmail = google.gmail({ version: "v1", auth });
    const profile = await gmail.users.getProfile({ userId: "me" });
    return { ok: true, email: profile.data.emailAddress };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function testCalendar(auth) {
  if (!auth) return { ok: false, error: "Skipped — Google OAuth failed" };
  try {
    const calendar = google.calendar({ version: "v3", auth });
    const list = await calendar.calendarList.list({ maxResults: 5 });
    const names = (list.data.items ?? []).map(c => c.summary);
    return { ok: true, calendars: names };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function testKV() {
  try {
    const { kv } = await import("@vercel/kv");
    await kv.ping();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function testBlob() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return { ok: false, error: "BLOB_READ_WRITE_TOKEN not set" };
  return { ok: true };
}

function testMeta() {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const verify = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (!token) return { ok: false, error: "META_PAGE_ACCESS_TOKEN not set" };
  if (!verify) return { ok: false, error: "META_WEBHOOK_VERIFY_TOKEN not set" };
  return { ok: true };
}

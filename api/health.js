import { google } from "googleapis";
import { BOARDS } from "../lib/calendarBoards.js";
import { BOARD_EMAIL_CONFIG } from "../lib/emailConfig.js";

async function mondayAPI(query, variables = {}) {
  const token = process.env.MONDAY_API_KEY;
  const r = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2025-01" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await r.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

export default async function handler(req, res) {
  // POST: register Monday webhooks
  if (req.method === "POST") {
    const token = process.env.MONDAY_API_KEY;
    if (!token) return res.status(500).json({ error: "MONDAY_API_KEY not set" });

    const baseUrl = `https://typeform-monday-webhook.vercel.app`;
    const results = [];

    // Collect all board IDs from both configs
    const allBoardIds = new Set([...Object.keys(BOARDS), ...Object.keys(BOARD_EMAIL_CONFIG)]);

    for (const boardId of allBoardIds) {
      // List existing webhooks for this board
      try {
        const data = await mondayAPI(`query ($boardId: ID!) { webhooks(board_id: $boardId) { id board_id url event } }`, { boardId });
        const existing = data.webhooks ?? [];

        // Delete webhooks pointing to wrong URLs
        for (const wh of existing) {
          const isOurs = wh.url.includes("calendar-webhook") || wh.url.includes("monday-email");
          const isWrongDomain = isOurs && !wh.url.startsWith(baseUrl);
          if (isWrongDomain) {
            await mondayAPI(`mutation ($id: ID!) { delete_webhook(id: $id) { id } }`, { id: wh.id });
            results.push({ action: "deleted", boardId, url: wh.url, webhookId: wh.id });
          }
        }

        // Re-check what's left after deletion
        const afterData = await mondayAPI(`query ($boardId: ID!) { webhooks(board_id: $boardId) { id url } }`, { boardId });
        const remaining = afterData.webhooks ?? [];

        // Create calendar webhook if board is in BOARDS config
        if (BOARDS[boardId]) {
          const calUrl = `${baseUrl}/api/calendar-webhook`;
          const hasCalendar = remaining.some(w => w.url === calUrl);
          if (!hasCalendar) {
            const d = await mondayAPI(
              `mutation ($boardId: ID!, $url: String!) { create_webhook(board_id: $boardId, url: $url, event: change_column_value) { id board_id } }`,
              { boardId: Number(boardId), url: calUrl }
            );
            results.push({ action: "created", boardId, url: calUrl, webhookId: d.create_webhook.id });
          } else {
            results.push({ action: "exists", boardId, url: calUrl });
          }
        }

        // Create email webhook if board is in EMAIL config
        if (BOARD_EMAIL_CONFIG[boardId]) {
          const emailUrl = `${baseUrl}/api/monday-email`;
          const hasEmail = remaining.some(w => w.url === emailUrl);
          if (!hasEmail) {
            const d = await mondayAPI(
              `mutation ($boardId: ID!, $url: String!) { create_webhook(board_id: $boardId, url: $url, event: change_column_value) { id board_id } }`,
              { boardId: Number(boardId), url: emailUrl }
            );
            results.push({ action: "created", boardId, url: emailUrl, webhookId: d.create_webhook.id });
          } else {
            results.push({ action: "exists", boardId, url: emailUrl });
          }
        }
      } catch (e) {
        results.push({ action: "error", boardId, error: e.message });
      }
    }

    return res.json({ ok: true, results });
  }

  if (req.method !== "GET") return res.status(405).end();

  const checks = {};

  checks.monday = await testMonday();
  checks.google = await testGoogle();
  checks.gmail = await testGmail(checks.google.auth);
  checks.calendar = await testCalendar(checks.google.auth);
  checks.kv = await testKV();
  checks.blob = await testBlob();
  checks.meta = testMeta();

  // Check Monday webhooks
  checks.webhooks = await testWebhooks();

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

async function testWebhooks() {
  const token = process.env.MONDAY_API_KEY;
  if (!token) return { ok: false, error: "MONDAY_API_KEY not set" };

  const correctBase = "https://typeform-monday-webhook.vercel.app";
  const allBoardIds = [...new Set([...Object.keys(BOARDS), ...Object.keys(BOARD_EMAIL_CONFIG)])];
  const issues = [];

  try {
    for (const boardId of allBoardIds) {
      const data = await mondayAPI(`query ($boardId: ID!) { webhooks(board_id: $boardId) { id url event } }`, { boardId });
      const webhooks = data.webhooks ?? [];

      const hasCalendar = BOARDS[boardId] && webhooks.some(w => w.url === `${correctBase}/api/calendar-webhook`);
      const hasEmail = BOARD_EMAIL_CONFIG[boardId] && webhooks.some(w => w.url === `${correctBase}/api/monday-email`);
      const wrongUrls = webhooks.filter(w => (w.url.includes("calendar-webhook") || w.url.includes("monday-email")) && !w.url.startsWith(correctBase));

      if (BOARDS[boardId] && !hasCalendar) issues.push(`Board ${boardId}: missing calendar webhook`);
      if (BOARD_EMAIL_CONFIG[boardId] && !hasEmail) issues.push(`Board ${boardId}: missing email webhook`);
      for (const w of wrongUrls) issues.push(`Board ${boardId}: wrong URL → ${w.url}`);
    }

    if (issues.length) return { ok: false, error: issues.join("; ") };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

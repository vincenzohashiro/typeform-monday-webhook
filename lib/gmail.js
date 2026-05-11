import { google } from "googleapis";

function buildMimeEmail({ to, from, subject, bodyText, attachments }) {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const subjectEncoded = `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;

  const lines = [
    `From: =?UTF-8?B?${Buffer.from("Håreksperten").toString("base64")}?= <${from}>`,
    `To: ${to}`,
    `Subject: ${subjectEncoded}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    bodyText,
  ];

  for (const att of attachments) {
    lines.push(
      "",
      `--${boundary}`,
      `Content-Type: application/pdf; name="${att.filename}"`,
      `Content-Disposition: attachment; filename="${att.filename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      att.data.toString("base64"),
    );
  }

  lines.push("", `--${boundary}--`);
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

export async function sendEmail({ to, subject, bodyText, attachmentUrls = [] }) {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

  const gmail = google.gmail({ version: "v1", auth });
  const from  = process.env.GMAIL_USER;

  const attachments = await Promise.all(
    attachmentUrls.map(async ({ url, filename }) => {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
      });
      if (!res.ok) throw new Error(`Failed to fetch attachment ${filename}: ${res.status}`);
      return { filename, data: Buffer.from(await res.arrayBuffer()) };
    })
  );

  const raw = buildMimeEmail({ to, from, subject, bodyText, attachments });
  await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
}

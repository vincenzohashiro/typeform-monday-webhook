import { kv } from "@vercel/kv";
import { findItem, updateItem, postUpdate } from "../lib/monday.js";
import { parseAnswers } from "../lib/parser.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { form_response } = req.body ?? {};

  if (!form_response) {
    await saveEvent({ type: "failed", code: "INVALID_PAYLOAD", detail: "Missing form_response in body" });
    return res.status(400).json({ error: "Invalid payload" });
  }

  // Idempotency: skip if we already successfully processed this form response
  const responseToken = form_response.token;
  if (responseToken) {
    const already = await kv.get(`tf_token:${responseToken}`);
    if (already) return res.status(200).json({ ignored: "already processed", token: responseToken });
  }

  const answers                                                        = form_response.answers ?? [];
  const { colValues, colLabels, searchValue, name, raw, timeLabels, warnings } = parseAnswers(answers);
  if (responseToken) raw.push({ ref: "__token__", value: responseToken });
  const identifier                                                      = searchValue ?? "(unknown)";

  try {
    if (!searchValue) {
      throw Object.assign(
        new Error("No email or phone found in Typeform response"),
        { code: "INVALID_PAYLOAD" }
      );
    }

    // Find the Monday item by email
    const item = await findItem("email_mkza7v62", searchValue);

    if (!item) {
      throw Object.assign(
        new Error(`No Monday item found where [email_mkza7v62] = "${searchValue}"`),
        { code: "ITEM_NOT_FOUND" }
      );
    }

    // Always set these two status columns on successful submission
    colValues["color_mm0x1y1w"] = { label: "Yes" };
    colValues["color_mkzbweje"] = { label: "Email 3 sendt" };

    // Update all mapped columns — falls back to per-column on validation errors
    const { failed } = await updateItem(item.id, colValues);

    const colFailWarnings = failed.map(f => {
      const info = colLabels[f.id];
      return `${info?.label ?? f.id} (${f.id}): ${f.error}`;
    });
    const allWarnings = [...warnings, ...colFailWarnings];

    // Post update comment
    await postUpdate(
      item.id,
      [
        "Form submitted on time ✅",
        `Email sendt: ${identifier}`,
        `Form submitted: Yes`,
        ...timeLabels,
        ...(colFailWarnings.length ? [`⚠ Column errors: ${colFailWarnings.join("; ")}`] : []),
      ].join("\n")
    );

    await saveEvent({
      type:      "success",
      identifier,
      name,
      itemId:    item.id,
      itemName:  item.name,
      timeLabels,
      warnings:  allWarnings,
      columns:   Object.keys(colValues).length - failed.length,
      raw,
    });

    // Mark this response as processed so Typeform retries are ignored
    if (responseToken) {
      await kv.set(`tf_token:${responseToken}`, 1, { ex: 60 * 60 * 24 * 30 }); // 30-day TTL
    }

    res.json({ ok: true, itemId: item.id, columnsUpdated: Object.keys(colValues).length - failed.length, columnsFailed: failed.length });

  } catch (err) {
    await saveEvent({
      type:      "failed",
      identifier,
      name,
      code:      err.code ?? "UNKNOWN",
      detail:    err.message,
      colLabels,
      raw,
    });
    // Return 200 for business logic failures so Typeform stops retrying.
    // Return 500 only for unexpected server errors (Monday/KV down) so Typeform will retry.
    const isBusinessError = ["ITEM_NOT_FOUND", "INVALID_PAYLOAD"].includes(err.code);
    res.status(isBusinessError ? 200 : 500).json({ error: err.message, code: err.code });
  }
}

async function saveEvent(entry) {
  try {
    await kv.lpush("events", JSON.stringify({ id: Date.now(), ts: new Date().toISOString(), ...entry }));
    await kv.ltrim("events", 0, 299);
  } catch (e) {
    console.error("KV write failed:", e.message);
  }
}

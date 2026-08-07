export interface DemoEntryNotification {
  name: string;
  email: string;
  enteredAt: number;
  city?: string;
  region?: string;
  country?: string;
  source?: string;
  deviceType?: string;
  browser?: string;
  os?: string;
}

function clean(value: string | undefined, max = 160) {
  if (!value) return undefined;
  let decoded = value;
  try { decoded = decodeURIComponent(value); } catch { /* Keep the header as received. */ }
  return decoded.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) || undefined;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] || character);
}

export function formatDemoEntryLocation(input: Pick<DemoEntryNotification, "city" | "region" | "country">) {
  return [clean(input.city, 80), clean(input.region, 80), clean(input.country, 80)]
    .filter((value, index, values): value is string => !!value && values.indexOf(value) === index)
    .join(", ") || "Location unavailable";
}

function formatTime(timestamp: number) {
  const date = new Date(timestamp);
  return {
    pacific: new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium", timeStyle: "long", timeZone: "America/Los_Angeles",
    }).format(date),
    utc: date.toISOString().replace("T", " ").replace(".000Z", " UTC"),
  };
}

export function createDemoEntryNotification(input: DemoEntryNotification) {
  const name = clean(input.name, 120) || "Unknown visitor";
  const email = clean(input.email, 254) || "Email unavailable";
  const location = formatDemoEntryLocation(input);
  const source = clean(input.source, 100) || "Direct / unknown";
  const device = [clean(input.deviceType, 40), clean(input.browser, 80), clean(input.os, 80)]
    .filter(Boolean).join(" · ") || "Device unavailable";
  const time = formatTime(input.enteredAt);
  const rows = [
    ["Name", name], ["Email", email], ["Entered", `${time.pacific} (Pacific)`],
    ["UTC", time.utc], ["Location", location], ["Source", source], ["Device", device],
  ];
  const htmlRows = rows.map(([label, value]) => `<tr><td style="padding:10px 12px;color:#7c8499;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #eceef5">${escapeHtml(label)}</td><td style="padding:10px 12px;color:#17192a;font-size:14px;font-weight:600;border-bottom:1px solid #eceef5">${escapeHtml(value)}</td></tr>`).join("");
  return {
    subject: `VideoFlow demo started: ${name}`,
    text: `A visitor entered the VideoFlow demo.\n\n${rows.map(([label, value]) => `${label}: ${value}`).join("\n")}\n\nOpen analytics: https://devlaunchlearn.com/admin`,
    html: `<!doctype html><html><head><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><style>:root{color-scheme:light only;supported-color-schemes:light only}u+.body .gmail-blend-screen{background:#000;mix-blend-mode:screen}u+.body .gmail-blend-difference{background:#000;mix-blend-mode:difference}</style></head><body class="body" style="margin:0;padding:32px 16px;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif"><div style="max-width:620px;margin:0 auto"><div style="margin-bottom:18px;font-size:22px;font-weight:800;color:#17192a">Video<span style="color:#6d5bfc">Flow</span></div><div style="overflow:hidden;border:1px solid #e2e5ee;border-radius:20px;background:#fff"><div style="padding:30px;background:#17162d;color:#fff"><p style="margin:0 0 8px;color:#b8aeff;-webkit-text-fill-color:#b8aeff;font-size:11px;font-weight:800;letter-spacing:2px">NEW DEMO VISITOR</p><div class="gmail-blend-screen"><div class="gmail-blend-difference"><h1 style="margin:0;color:#fff;-webkit-text-fill-color:#fff;font-size:28px;line-height:36px">${escapeHtml(name)} entered the demo.</h1></div></div></div><div style="padding:22px"><table role="presentation" style="width:100%;border-collapse:collapse">${htmlRows}</table><a href="https://devlaunchlearn.com/admin" style="display:inline-block;margin-top:22px;padding:12px 18px;border-radius:10px;background:#6d5bfc;color:#fff;-webkit-text-fill-color:#fff;font-size:13px;font-weight:700;text-decoration:none"><span class="gmail-blend-screen"><span class="gmail-blend-difference">Open demo analytics</span></span></a></div></div></div></body></html>`,
  };
}

export async function sendDemoEntryNotification(input: DemoEntryNotification) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.VIDEOFLOW_DEMO_NOTIFICATION_FROM;
  const to = process.env.VIDEOFLOW_DEMO_NOTIFICATION_TO;
  if (!apiKey || !from || !to) return false;
  const message = createDemoEntryNotification(input);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: [to], subject: message.subject, html: message.html, text: message.text,
        tags: [{ name: "product", value: "videoflow" }, { name: "category", value: "demo_entry_alert" }],
      }),
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

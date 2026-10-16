import webpush from "npm:web-push@3.6.7";
import {
  buildTwilioTemplateForm,
  deliveryUpdate,
  dispatchTwilioTemplate,
  safeLogSnapshot,
} from "./whatsapp-logic.mjs";

const APP_URL = "https://remyster.github.io/solo-leveling/";
const APP_ORIGIN = new URL(APP_URL).origin;
const cors = {
  "Access-Control-Allow-Origin": APP_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; }
}

function required(name) {
  const value = Deno.env.get(name);
  if (!value) throw new HttpError(503, `missing_${name}`);
  return value;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function database(path, options = {}) {
  const response = await fetch(`${required("SUPABASE_URL")}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: required("SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: `Bearer ${required("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json", Prefer: "return=representation",
      ...options.headers,
    },
  });
  if (!response.ok) throw new HttpError(503, `database_${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

let ownerCache = null;
let ownerRequest = null;

async function loadOwner() {
  const response = await fetch(
    `${required("SUPABASE_URL")}/auth/v1/admin/users/${required("REMINDER_OWNER_ID")}`,
    { headers: { apikey: required("SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: `Bearer ${required("SUPABASE_SERVICE_ROLE_KEY")}` } },
  );
  if (!response.ok) throw new HttpError(503, "owner_lookup_failed");
  const user = await response.json();
  if (!user.email || !user.email_confirmed_at) throw new HttpError(503, "owner_email_unverified");
  return user;
}

async function owner() {
  const ownerId = required("REMINDER_OWNER_ID");
  if (ownerCache?.id === ownerId && ownerCache.expiresAt > Date.now())
    return ownerCache.user;
  if (!ownerRequest) {
    ownerRequest = loadOwner().then(user => {
      ownerCache = { id: ownerId, user, expiresAt: Date.now() + 15 * 60 * 1000 };
      return user;
    }).finally(() => { ownerRequest = null; });
  }
  return ownerRequest;
}

async function authenticate(request) {
  const token = request.headers.get("Authorization");
  if (!token?.startsWith("Bearer ")) throw new HttpError(401, "login_required");
  const response = await fetch(`${required("SUPABASE_URL")}/auth/v1/user`, {
    headers: { apikey: required("SUPABASE_SERVICE_ROLE_KEY"), Authorization: token },
  });
  if (!response.ok) throw new HttpError(401, "login_required");
  const user = await response.json();
  if (user.id !== required("REMINDER_OWNER_ID")) throw new HttpError(403, "owner_only");
  return user;
}

function subscriptionValid(subscription) {
  if (!subscription || typeof subscription.endpoint !== "string" ||
      subscription.endpoint.length > 4096) return false;
  let url;
  try { url = new URL(subscription.endpoint); } catch { return false; }
  const allowed = url.hostname === "web.push.apple.com" ||
    url.hostname.endsWith(".push.apple.com") || url.hostname === "fcm.googleapis.com" ||
    url.hostname === "updates.push.services.mozilla.com";
  return allowed && url.protocol === "https:" && !url.username && !url.password &&
    ["p256dh", "auth"].every(key => typeof subscription.keys?.[key] === "string" &&
      /^[A-Za-z0-9_-]+={0,2}$/.test(subscription.keys[key]) &&
      subscription.keys[key].length >= 20 && subscription.keys[key].length <= 256);
}

function tomorrowDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = name => parts.find(p => p.type === name).value;
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

const hhmm = value => String(value || "").slice(0, 5);
const dayLabel = date => new Intl.DateTimeFormat("nl-NL", {
  timeZone: "Europe/Amsterdam", weekday: "long", day: "numeric", month: "long",
}).format(new Date(`${date}T12:00:00Z`));
const short = (value, max = 90) => {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

// Haalt de taak, het lijstje of de planning van morgen op, zodat mail en push de naam tonen.
// Teamacties (team_id) blijven bewust neutraal: daar staan geen namen of details in.
async function details(job) {
  if (job.task_id) {
    const rows = await database(`work_tasks?id=eq.${job.task_id}&select=titel,waar,begin_tijd,eind_tijd,deadline,team_id`);
    return { task: rows[0] || null };
  }
  if (job.item_id) {
    const rows = await database(`work_items?id=eq.${job.item_id}&select=tekst`);
    return { item: rows[0] || null };
  }
  if (job.kind === "daily_email") {
    const date = tomorrowDate();
    const tasks = await database(`work_tasks?project=eq.pwn&status=neq.klaar&deadline=eq.${date}&select=titel,waar,begin_tijd,eind_tijd,team_id&order=begin_tijd.asc.nullslast`);
    return { date, tasks };
  }
  return {};
}

function message(kind, info = {}) {
  if (kind === "item_email" || kind === "item_push") {
    const text = short(info.item?.tekst, 300);
    return {
      title: text ? `🔔 ${short(text, 70)}` : "WerkHub: herinnering aan je lijstje",
      text: `${text || "Je hebt een herinnering ingesteld bij een notitie."}\n\nOpen je lijstjes: ${APP_URL}?tab=dump`,
    };
  }
  if (kind === "test_email" || kind === "test_push") return {
    title: "WerkHub: testherinnering",
    text: `Dit is een test, geen geplande taakherinnering. ${APP_URL}?tab=projecten`,
  };
  if (kind === "daily_email") {
    const tasks = info.tasks || [];
    const date = info.date || tomorrowDate();
    const lines = tasks.map(task => {
      const name = task.team_id ? "Teamactie (details in WerkHub)" : short(task.titel, 120);
      const when = task.begin_tijd ? `${hhmm(task.begin_tijd)}${task.eind_tijd ? `–${hhmm(task.eind_tijd)}` : ""}` : "hele dag";
      const where = !task.team_id && task.waar ? ` · ${short(task.waar, 60)}` : "";
      return `• ${when}  ${name}${where}`;
    });
    return {
      title: tasks.length ? `📅 Morgen: ${tasks.length === 1 ? (tasks[0].team_id ? "1 taak" : short(tasks[0].titel, 60)) : `${tasks.length} taken`}` : "📅 Morgen: niks gepland",
      text: `Planning voor ${dayLabel(date)}:\n\n${lines.length ? lines.join("\n") : "Geen taken met deze datum."}\n\nControleer ook je echte agenda.\nOpen in WerkHub: ${APP_URL}?tab=projecten&datum=${date}`,
    };
  }
  const task = info.task;
  if (!task || task.team_id) return {
    title: "⏰ WerkHub: een taak begint over 45 minuten",
    text: `Een geplande taak begint binnenkort. Open WerkHub voor de details. ${APP_URL}?tab=projecten`,
  };
  const when = `${hhmm(task.begin_tijd)}${task.eind_tijd ? `–${hhmm(task.eind_tijd)}` : ""}`;
  return {
    title: `⏰ ${hhmm(task.begin_tijd)} ${short(task.titel, 70)}`,
    text: `${short(task.titel, 200)}\nOm ${when}${task.waar ? `\nWaar: ${short(task.waar, 120)}` : ""}\n\nBegint over ongeveer 45 minuten.\nOpen in WerkHub: ${APP_URL}?tab=projecten`,
  };
}

async function sendEmail(user, job) {
  const content = message(job.kind, await details(job));
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${required("RESEND_API_KEY")}`,
      "Content-Type": "application/json", "Idempotency-Key": `werkhub-${job.id}` },
    body: JSON.stringify({
      from: required("REMINDER_EMAIL_FROM"), to: [user.email],
      subject: content.title, text: content.text,
    }),
  });
  if (!response.ok) throw new HttpError(503, `email_${response.status}`);
}

async function sendPush(userId, job) {
  webpush.setVapidDetails(required("VAPID_SUBJECT"),
    required("VAPID_PUBLIC_KEY"), required("VAPID_PRIVATE_KEY"));
  const subscriptions = await database(`work_push_subscriptions?user_id=eq.${userId}`);
  if (!subscriptions.length) throw new HttpError(503, "push_no_subscription");
  const content = message(job.kind, await details(job));
  let delivered = 0;
  let retry = false;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, JSON.stringify({ title: content.title, body: content.text,
        tab: job.kind === "item_push" ? "dump" : "projecten",
        tag: `werkhub-${job.id}` }), { TTL: 3600, timeout: 10000 });
      delivered++;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await database(`work_push_subscriptions?id=eq.${subscription.id}`, { method: "DELETE" });
      } else {
        retry = true;
      }
    }
  }
  if (retry || !delivered) throw new HttpError(503, "push_delivery_failed");
}

async function deliverJobs() {
  const userId = required("REMINDER_OWNER_ID");
  const jobs = await database("rpc/work_claim_reminders", {
    method: "POST", body: JSON.stringify({ p_user_id: userId }),
  });
  let sent = 0, failed = 0;
  for (const job of jobs) {
    try {
      if (job.kind === "task_push" || job.kind === "item_push") await sendPush(userId, job);
      else await sendEmail(await owner(), job);
      await database(`work_reminder_jobs?id=eq.${job.id}`, {
        method: "PATCH", body: JSON.stringify({
          status: "sent", sent_at: new Date().toISOString(), last_error: null,
        }),
      });
      sent++;
    } catch (error) {
      failed++;
      // Alleen een foutcode bewaren, nooit adressen, pushkeys of taakinhoud.
      await database(`work_reminder_jobs?id=eq.${job.id}`, {
        method: "PATCH", body: JSON.stringify({
          status: job.attempts >= 5 ? "failed" : "pending",
          last_error: error instanceof HttpError ? error.message : "delivery_failed",
        }),
      });
    }
  }
  return { sent, failed };
}

function whatsappMode() {
  if (Deno.env.get("WHATSAPP_TEST_MODE") === "1") return "mock";
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
  const from = Deno.env.get("TWILIO_WHATSAPP_FROM") || "";
  const to = Deno.env.get("WHATSAPP_TO_NUMBER") || "";
  const contentSid = Deno.env.get("TWILIO_CONTENT_SID") || "";
  const valid = /^AC[a-f0-9]{32}$/i.test(accountSid) && authToken.length >= 20 &&
    /^whatsapp:\+\d{8,15}$/.test(from) && /^whatsapp:\+\d{8,15}$/.test(to) &&
    /^HX[a-f0-9]{32}$/i.test(contentSid);
  return Deno.env.get("WHATSAPP_LIVE_ENABLED") === "1" && valid ? "live" : "off";
}

async function sendWhatsApp(job) {
  const testMode = Deno.env.get("WHATSAPP_TEST_MODE") === "1";
  if (testMode) return { outcome: "mock" };
  if (whatsappMode() !== "live") {
    return { outcome: "retry", code: "whatsapp_not_configured" };
  }

  const accountSid = required("TWILIO_ACCOUNT_SID");
  const authToken = required("TWILIO_AUTH_TOKEN");
  const form = buildTwilioTemplateForm({
    from: required("TWILIO_WHATSAPP_FROM"),
    to: required("WHATSAPP_TO_NUMBER"),
    contentSid: required("TWILIO_CONTENT_SID"),
    task: { titel: job.title, deadline: job.deadline },
  });
  return dispatchTwilioTemplate({
    fetchFn: fetch,
    endpoint: `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
    form,
    signal: AbortSignal.timeout(15_000),
  });
}

async function deliverWhatsAppJobs() {
  const userId = required("REMINDER_OWNER_ID");
  const jobs = await database("rpc/work_claim_whatsapp_jobs", {
    method: "POST",
    body: JSON.stringify({ p_user_id: userId }),
  });

  let sent = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const result = await sendWhatsApp(job);
      const update = deliveryUpdate(result, job.attempts);
      await database(`work_whatsapp_events?id=eq.${job.id}`, {
        method: "PATCH",
        body: JSON.stringify(update),
      });
      console.info("workhub-whatsapp dispatch", safeLogSnapshot({
        eventId: job.id, attempts: job.attempts, result,
      }));
      if (result.outcome === "accepted" || result.outcome === "mock") sent++;
      else failed++;
    } catch (error) {
      failed++;
      const result = { outcome: "unknown", code: "dispatch_interrupted" };
      await database(`work_whatsapp_events?id=eq.${job.id}`, {
        method: "PATCH",
        body: JSON.stringify(deliveryUpdate(result, job.attempts)),
      });
      console.warn("workhub-whatsapp dispatch", safeLogSnapshot({
        eventId: job.id, attempts: job.attempts, result,
      }));
    }
  }
  return { sent, failed };
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const action = new URL(request.url).pathname.split("/").pop();
    if (action === "dispatch") {
      if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
      if (request.headers.get("x-reminder-secret") !== required("REMINDER_CRON_SECRET"))
        throw new HttpError(401, "scheduler_only");
      const reminderResult = await deliverJobs();
      const whatsappResult = await deliverWhatsAppJobs();
      return json({ reminder: reminderResult, whatsapp: whatsappResult });
    }
    const user = await authenticate(request);
    if (action === "dispatch-whatsapp" && request.method === "POST") {
      return json({ whatsapp: await deliverWhatsAppJobs() });
    }
    if (action === "status" && request.method === "GET") {
      const settings = await database(`work_reminder_settings?user_id=eq.${user.id}`);
      const whatsappSettings = await database(`work_whatsapp_settings?user_id=eq.${user.id}`);
      const subscriptions = await database(
        `work_push_subscriptions?user_id=eq.${user.id}&select=id`,
      );
      const failures = await database(
        `work_reminder_jobs?user_id=eq.${user.id}&status=eq.failed&select=kind,last_error&limit=5`,
      );
      const whatsappIssues = await database(
        `work_whatsapp_events?user_id=eq.${user.id}&status=in.(failed,unknown)&select=status,last_error&limit=5`,
      );
      const mode = whatsappMode();
      return json({ settings: settings[0] || null,
        whatsappEnabled: !!whatsappSettings[0]?.enabled,
        subscriptions: subscriptions.length, failures,
        vapidPublicKey: Deno.env.get("VAPID_PUBLIC_KEY") || null,
        emailConfigured: !!Deno.env.get("RESEND_API_KEY") && !!Deno.env.get("REMINDER_EMAIL_FROM"),
        whatsappConfigured: mode !== "off", whatsappMode: mode, whatsappIssues,
      });
    }
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    let body;
    try { body = await request.json(); }
    catch { throw new HttpError(400, "invalid_json"); }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new HttpError(400, "invalid_body");
    if (action === "settings") {
      const reminderKeys = ["daily_email", "task_email", "task_push"];
      for (const key of reminderKeys) {
        if (Object.prototype.hasOwnProperty.call(body, key) && typeof body[key] !== "boolean")
          throw new HttpError(400, "invalid_settings");
      }
      if (Object.prototype.hasOwnProperty.call(body, "whatsapp_enabled") && typeof body.whatsapp_enabled !== "boolean")
        throw new HttpError(400, "invalid_settings");
      if (body.daily_email || body.task_email) {
        required("RESEND_API_KEY"); required("REMINDER_EMAIL_FROM");
        await owner();
      }
      if (body.task_push) {
        required("VAPID_PUBLIC_KEY"); required("VAPID_PRIVATE_KEY"); required("VAPID_SUBJECT");
        const subscriptions = await database(`work_push_subscriptions?user_id=eq.${user.id}&select=id`);
        if (!subscriptions.length) throw new HttpError(400, "enable_push_on_device_first");
      }
      if (body.whatsapp_enabled) {
        if (whatsappMode() === "off") throw new HttpError(400, "whatsapp_not_configured");
      }
      const reminderSettings = await database("work_reminder_settings?on_conflict=user_id", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({
          user_id: user.id,
          daily_email: !!body.daily_email,
          task_email: !!body.task_email,
          task_push: !!body.task_push,
        }),
      });
      let whatsappSettings = await database(`work_whatsapp_settings?user_id=eq.${user.id}`);
      if (Object.prototype.hasOwnProperty.call(body, "whatsapp_enabled")) {
        whatsappSettings = await database("work_whatsapp_settings?on_conflict=user_id", {
          method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify({
            user_id: user.id,
            enabled: body.whatsapp_enabled,
            enabled_at: body.whatsapp_enabled ? new Date().toISOString() : null,
            opt_in_confirmed_at: body.whatsapp_enabled ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          }),
        });
      }
      return json({ reminder: reminderSettings, whatsapp: whatsappSettings });
    }
    if (action === "subscribe") {
      if (!subscriptionValid(body)) throw new HttpError(400, "invalid_subscription");
      await database("work_push_subscriptions?on_conflict=endpoint", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({ user_id: user.id, endpoint: body.endpoint,
          p256dh: body.keys.p256dh, auth: body.keys.auth }),
      });
      return json({ saved: true });
    }
    if (action === "unsubscribe") {
      if (typeof body.endpoint !== "string") throw new HttpError(400, "invalid_subscription");
      await database(`work_push_subscriptions?user_id=eq.${user.id}&endpoint=eq.${encodeURIComponent(body.endpoint)}`,
        { method: "DELETE" });
      return json({ removed: true });
    }
    if (action === "test-email") {
      const userDetails = await owner();
      await sendEmail(userDetails, { id: crypto.randomUUID(), kind: "test_email" });
      return json({ accepted: true });
    }
    if (action === "test-push") {
      await sendPush(user.id, { id: crypto.randomUUID(), kind: "test_push" });
      return json({ accepted: true });
    }
    if (action === "test-whatsapp") {
      const mode = whatsappMode();
      if (mode === "off") throw new HttpError(400, "whatsapp_not_configured");
      const result = await sendWhatsApp({ title: "WerkHub test", deadline: null });
      if (!["accepted", "mock"].includes(result.outcome)) {
        throw new HttpError(503, result.code || "whatsapp_test_failed");
      }
      return json({ accepted: true, mode });
    }
    throw new HttpError(404, "unknown_action");
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const code = error instanceof HttpError ? error.message : "request_failed";
    console.error("werkhub-reminders", status, code);
    return json({ error: code }, status);
  }
});

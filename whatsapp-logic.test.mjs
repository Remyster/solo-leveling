import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDedupKey,
  buildTemplateVariables,
  buildTwilioTemplateForm,
  deliveryUpdate,
  dispatchTwilioTemplate,
  safeLogSnapshot,
  shouldQueueWhatsAppTask,
} from "../supabase/functions/werkhub-reminders/whatsapp-logic.mjs";

const personal = {
  id: "task-42",
  project: "pwn",
  status: "backlog",
  taaktype: "taak",
  team_id: null,
  titel: "Fictieve pompcontrole",
  deadline: "2026-10-15",
};

test("only a new enabled personal PWN task is eligible", () => {
  assert.equal(shouldQueueWhatsAppTask(personal), true);
  assert.equal(shouldQueueWhatsAppTask(personal, "UPDATE"), false);
  assert.equal(shouldQueueWhatsAppTask(personal, "INSERT", false), false);
  assert.equal(shouldQueueWhatsAppTask({ ...personal, team_id: "team-1" }), false);
  assert.equal(shouldQueueWhatsAppTask({ ...personal, taaktype: "subtaak" }), false);
  assert.equal(shouldQueueWhatsAppTask({ ...personal, status: "klaar" }), false);
});

test("template contains only title and deadline and never Body", () => {
  const task = {
    ...personal,
    notitie: "NIET VERSTUREN",
    waar: "NIET VERSTUREN",
    wie: "NIET VERSTUREN",
    bijlage_url: "NIET VERSTUREN",
  };
  const form = buildTwilioTemplateForm({
    from: `whatsapp:+${"1".repeat(11)}`,
    to: `whatsapp:+${"2".repeat(11)}`,
    contentSid: "HX0123456789abcdef0123456789abcdef",
    task,
  });
  assert.equal(form.has("Body"), false);
  assert.equal(form.get("ContentSid"), "HX0123456789abcdef0123456789abcdef");
  assert.deepEqual(JSON.parse(form.get("ContentVariables")), {
    "1": "Fictieve pompcontrole",
    "2": "2026-10-15",
  });
  assert.doesNotMatch(form.toString(), /NIET\+VERSTUREN|notitie|bijlage/i);
  assert.deepEqual(buildTemplateVariables({ titel: "Taak", deadline: null }), {
    "1": "Taak",
    "2": "Niet ingesteld",
  });
});

test("accepted provider response records SID without exposing content", async () => {
  const calls = [];
  const result = await dispatchTwilioTemplate({
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 201, json: async () => ({ sid: "SM-test", status: "queued" }) };
    },
    endpoint: "https://api.twilio.test/Messages.json",
    authorization: "Basic test-secret",
    form: new URLSearchParams({ ContentSid: "HX-test", ContentVariables: "{}" }),
  });
  assert.equal(calls.length, 1);
  assert.equal(result.outcome, "accepted");
  assert.equal(result.providerMessageSid, "SM-test");
  const update = deliveryUpdate(result, 1, new Date("2026-10-14T12:00:00Z"));
  assert.equal(update.status, "accepted");
  assert.equal(update.provider_message_sid, "SM-test");
});

test("explicit temporary rejection retries with backoff", async () => {
  const result = await dispatchTwilioTemplate({
    fetchFn: async () => ({ ok: false, status: 503 }),
    endpoint: "https://api.twilio.test/Messages.json",
    authorization: "Basic test-secret",
    form: new URLSearchParams(),
  });
  assert.deepEqual(result, { outcome: "retry", code: "provider_http_503" });
  const update = deliveryUpdate(result, 2, new Date("2026-10-14T12:00:00Z"));
  assert.equal(update.status, "queued");
  assert.equal(update.available_at, "2026-10-14T12:15:00.000Z");
});

test("permanent rejection fails and ambiguous request never retries", async () => {
  const rejected = await dispatchTwilioTemplate({
    fetchFn: async () => ({ ok: false, status: 400 }),
    endpoint: "https://api.twilio.test/Messages.json",
    authorization: "Basic test-secret",
    form: new URLSearchParams(),
  });
  assert.equal(deliveryUpdate(rejected, 1).status, "failed");

  const ambiguous = await dispatchTwilioTemplate({
    fetchFn: async () => { throw new Error("timeout after send"); },
    endpoint: "https://api.twilio.test/Messages.json",
    authorization: "Basic test-secret",
    form: new URLSearchParams(),
  });
  assert.equal(ambiguous.outcome, "unknown");
  assert.equal(deliveryUpdate(ambiguous, 1).status, "unknown");
});

test("safe logs and deduplication contain no task or provider details", () => {
  const snapshot = safeLogSnapshot({
    eventId: "event-1",
    attempts: 2,
    result: { outcome: "retry", code: "provider_http_503" },
    task: personal,
    token: "secret",
  });
  assert.deepEqual(snapshot, {
    eventId: "event-1",
    attempts: 2,
    outcome: "retry",
    code: "provider_http_503",
  });
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /pompcontrole|2026-10-15|secret|whatsapp:/i);
  assert.equal(buildDedupKey(personal), buildDedupKey(personal));
  assert.equal(buildDedupKey(personal), "task:task-42");
});

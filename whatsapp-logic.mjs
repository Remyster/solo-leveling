const MAX_TITLE_LENGTH = 120;
const RETRY_MINUTES = [5, 15, 60, 180, 720];

function cleanTitle(value) {
  const title = String(value || "").trim().replace(/\s+/g, " ");
  if (!title) return "Nieuwe taak";
  return title.length > MAX_TITLE_LENGTH
    ? `${title.slice(0, MAX_TITLE_LENGTH - 3)}...`
    : title;
}

function cleanDeadline(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))
    ? String(value)
    : "Niet ingesteld";
}

export function shouldQueueWhatsAppTask(task, operation = "INSERT", enabled = true) {
  if (!enabled || operation !== "INSERT" || !task?.id) return false;
  if (task.project !== "pwn" || task.team_id) return false;
  if ((task.taaktype || "taak") !== "taak") return false;
  return (task.status || "backlog") !== "klaar";
}

export function buildTemplateVariables(task) {
  return {
    "1": cleanTitle(task?.titel || task?.title),
    "2": cleanDeadline(task?.deadline),
  };
}

export function buildTwilioTemplateForm({ from, to, contentSid, task }) {
  if (![from, to].every(value => /^whatsapp:\+\d{8,15}$/.test(String(value || "")))) {
    throw new Error("invalid_whatsapp_number");
  }
  if (!/^HX[a-f0-9]{32}$/i.test(String(contentSid || ""))) {
    throw new Error("invalid_content_sid");
  }
  return new URLSearchParams({
    From: from,
    To: to,
    ContentSid: contentSid,
    ContentVariables: JSON.stringify(buildTemplateVariables(task)),
  });
}

export async function dispatchTwilioTemplate({
  fetchFn,
  endpoint,
  authorization,
  form,
  signal,
}) {
  let response;
  try {
    response = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: form.toString(),
      signal,
    });
  } catch {
    return { outcome: "unknown", code: "provider_outcome_unknown" };
  }

  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 425 ||
      response.status === 429 || response.status >= 500;
    return {
      outcome: retryable ? "retry" : "failed",
      code: `provider_http_${response.status}`,
    };
  }

  let result;
  try {
    result = await response.json();
  } catch {
    return { outcome: "unknown", code: "provider_response_invalid" };
  }
  if (typeof result?.sid !== "string" || !result.sid) {
    return { outcome: "unknown", code: "provider_sid_missing" };
  }
  return {
    outcome: "accepted",
    providerMessageSid: result.sid,
    providerStatus: typeof result.status === "string" ? result.status : "accepted",
  };
}

export function retryAt(attempts, now = new Date()) {
  const index = Math.min(Math.max(Number(attempts) - 1, 0), RETRY_MINUTES.length - 1);
  return new Date(now.getTime() + RETRY_MINUTES[index] * 60_000).toISOString();
}

export function deliveryUpdate(result, attempts, now = new Date()) {
  if (result.outcome === "accepted") {
    return {
      status: "accepted",
      accepted_at: now.toISOString(),
      provider_message_sid: result.providerMessageSid,
      provider_status: result.providerStatus,
      last_error: null,
      lease_token: null,
      lease_expires_at: null,
    };
  }
  if (result.outcome === "mock") {
    return {
      status: "accepted",
      accepted_at: now.toISOString(),
      provider_status: "mock",
      last_error: null,
      lease_token: null,
      lease_expires_at: null,
    };
  }
  if (result.outcome === "retry" && attempts < 5) {
    return {
      status: "queued",
      available_at: retryAt(attempts, now),
      last_error: result.code,
      lease_token: null,
      lease_expires_at: null,
    };
  }
  return {
    status: result.outcome === "unknown" ? "unknown" : "failed",
    last_error: result.code,
    lease_token: null,
    lease_expires_at: null,
  };
}

export function safeLogSnapshot({ eventId, attempts, result }) {
  return {
    eventId: eventId || null,
    attempts: Number(attempts) || 0,
    outcome: result?.outcome || "failed",
    code: result?.code || null,
  };
}

export function buildDedupKey(task) {
  return task?.id ? `task:${task.id}` : "task:unknown";
}

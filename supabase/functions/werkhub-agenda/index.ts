// Supabase Edge Function: werkhub-agenda
// Leest je Google-agenda('s) via het geheime iCal-adres (server-side, nooit in de browser)
// en geeft de afspraken van de komende dagen terug aan WerkHub en de iPad Werkplek.
// Zo is er geen Google-login, cookie of iframe nodig in Safari.
//
// Secrets (Supabase > Edge Functions > Secrets):
//   AGENDA_ICS_URLS   een of meer agenda's, gescheiden door een nieuwe regel of ;
//                     vorm: Naam=https://calendar.google.com/calendar/ical/.../basic.ics
//   ALLOWED_USER_IDS  (bestaat al, gedeeld met werkplek-ai)
//   APP_ORIGIN        (bestaat al) bijv. https://remyster.github.io
import ICAL from "npm:ical.js@2.1.0";

const MAX_DAYS = 31;
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; text: string }>();

export function parseSources(raw: string) {
  return String(raw || "").split(/[\n;]+/).map((part) => part.trim()).filter(Boolean).map((part, index) => {
    const eq = part.indexOf("=");
    const hasName = eq > 0 && !part.slice(0, eq).includes("://");
    const name = hasName ? part.slice(0, eq).trim() : `Agenda ${index + 1}`;
    const url = (hasName ? part.slice(eq + 1) : part).trim();
    if (!/^https:\/\//.test(url)) throw new Error("AGENDA_ICS_URLS bevat geen https-adres");
    return { name, url };
  });
}

function toItem(name: string, event: any, start: any, end: any) {
  const allDay = !!start.isDate;
  const fmt = (time: any) => allDay
    ? `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`
    : time.toJSDate().toISOString();
  return {
    calendar: name,
    title: event.summary || "(zonder titel)",
    location: event.location || "",
    allDay,
    start: fmt(start),
    end: end ? fmt(end) : fmt(start),
  };
}

// Pure functie (ook getest in Node): ICS-tekst -> afspraken tussen from en to.
export function expand(text: string, name: string, from: Date, to: Date) {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const zone of root.getAllSubcomponents("vtimezone")) {
    try { ICAL.TimezoneService.register(zone); } catch (_) { /* dubbel geregistreerd */ }
  }
  const masters = new Map<string, any>();
  const exceptions: any[] = [];
  for (const component of root.getAllSubcomponents("vevent")) {
    const event = new ICAL.Event(component);
    if (component.getFirstPropertyValue("status") === "CANCELLED" && !event.isRecurrenceException()) continue;
    if (event.isRecurrenceException()) exceptions.push(event);
    else masters.set(event.uid, event);
  }
  for (const exception of exceptions) {
    const master = masters.get(exception.uid);
    if (master) master.relateException(exception);
  }
  const items: any[] = [];
  const fromTime = from.getTime(), toTime = to.getTime();
  const overlaps = (start: any, end: any) => {
    const s = start.toJSDate().getTime();
    const e = end ? end.toJSDate().getTime() : s;
    return s < toTime && (e > fromTime || s >= fromTime);
  };
  for (const event of masters.values()) {
    if (!event.isRecurring()) {
      if (overlaps(event.startDate, event.endDate)) items.push(toItem(name, event, event.startDate, event.endDate));
      continue;
    }
    const iterator = event.iterator();
    let next, guard = 0;
    while ((next = iterator.next()) && guard++ < 2000) {
      if (next.toJSDate().getTime() >= toTime) break;
      const details = event.getOccurrenceDetails(next);
      if (details.item.component.getFirstPropertyValue("status") === "CANCELLED") continue;
      if (overlaps(details.startDate, details.endDate)) items.push(toItem(name, details.item, details.startDate, details.endDate));
    }
  }
  return items;
}

function json(status: number, body: unknown, origin: string | null) {
  const headers: Record<string, string> = { "content-type": "application/json", "cache-control": "no-store" };
  if (origin) { headers["access-control-allow-origin"] = origin; headers["vary"] = "Origin"; }
  return new Response(JSON.stringify(body), { status, headers });
}

async function fetchIcs(url: string) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.text;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Google gaf HTTP ${response.status}`);
    const text = await response.text();
    if (!text.includes("BEGIN:VCALENDAR")) throw new Error("Geen iCal-agenda op dit adres");
    cache.set(url, { at: Date.now(), text });
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function handle(req: Request) {
  const appOrigin = Deno.env.get("APP_ORIGIN") || "";
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: {
      "access-control-allow-origin": appOrigin,
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "authorization, apikey, content-type",
      "vary": "Origin",
    } });
  }
  if (req.headers.get("origin") !== appOrigin) return json(403, { error: "Origin not allowed" }, null);
  if (req.method !== "GET") return json(405, { error: "Method not allowed" }, appOrigin);
  const auth = req.headers.get("authorization") || "";
  if (!/^bearer\s+\S+/i.test(auth)) return json(401, { error: "Missing bearer token" }, appOrigin);
  const user = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
    headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY") || "", Authorization: auth },
  });
  if (!user.ok) return json(401, { error: "Invalid or expired session" }, appOrigin);
  const { id } = await user.json();
  const allowed = (Deno.env.get("ALLOWED_USER_IDS") || "").split(",").map((v) => v.trim()).filter(Boolean);
  if (!allowed.includes(id)) return json(403, { error: "Account not authorized" }, appOrigin);

  let sources;
  try { sources = parseSources(Deno.env.get("AGENDA_ICS_URLS") || ""); }
  catch (error) { return json(503, { error: (error as Error).message, code: "NOT_CONFIGURED" }, appOrigin); }
  if (!sources.length) return json(503, { error: "AGENDA_ICS_URLS ontbreekt", code: "NOT_CONFIGURED" }, appOrigin);

  const days = Math.min(MAX_DAYS, Math.max(1, Number(new URL(req.url).searchParams.get("days")) || 14));
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + days * 86400000);
  const items: any[] = [];
  const errors: string[] = [];
  for (const source of sources) {
    try { items.push(...expand(await fetchIcs(source.url), source.name, from, to)); }
    catch (error) { errors.push(`${source.name}: ${(error as Error).message}`); }
  }
  items.sort((a, b) => a.start.localeCompare(b.start));
  return json(200, { items: items.slice(0, 300), errors, calendars: sources.map((s) => s.name) }, appOrigin);
}

if (typeof Deno !== "undefined") Deno.serve((req) => handle(req).catch((error) => {
  console.error("werkhub-agenda:", (error as Error).message);
  return json(500, { error: "Agenda laden mislukt" }, Deno.env.get("APP_ORIGIN") || null);
}));

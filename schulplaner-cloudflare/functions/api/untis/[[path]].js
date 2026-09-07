/**
 * Cloudflare Pages Function — WebUntis sync for the School Planner.
 *
 * Handles POST /api/untis/schools  and  POST /api/untis/sync  on the SAME origin
 * as the website, so no separate backend URL and no CORS are needed.
 *
 * Legally-tight design (same as the Python version):
 *   - the WebUntis password is used once and then dropped — never stored, never logged
 *     (this code never console.logs the request body);
 *   - only *.webuntis.com servers may be contacted (no SSRF);
 *   - request bodies are size-capped.
 *   (Rate-limiting: add a Cloudflare "Rate limiting rule" in the dashboard for
 *    /api/untis/sync — Workers isolates don't share memory, so it belongs there.)
 *
 * Returns exactly the JSON shape the app expects, so Fächer, Stundenplan,
 * Prüfungen and Hausübungen all fill in automatically.
 */

const MAX_BODY = 100000;

class UntisError extends Error {}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/* ---------- date helpers (all in UTC, kept internally consistent) ---------- */
function pad(n) { return String(n).padStart(2, "0"); }
function ymdToDate(n) {
  n = parseInt(n, 10);
  return new Date(Date.UTC(Math.floor(n / 10000), (Math.floor(n / 100) % 100) - 1, n % 100));
}
function dateToYmd(d) { return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(); }
function fmtISO(d) { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
function fmtDEshort(d) { return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.`; }
function fmtDEfull(d) { return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`; }
function addDays(d, n) { const r = new Date(d); r.setUTCDate(r.getUTCDate() + n); return r; }
function mondayBased(d) { return (d.getUTCDay() + 6) % 7; } // Mon=0 … Sun=6
function fmtHM(t) {
  const n = parseInt(t, 10);
  if (!Number.isFinite(n)) return "";
  return `${pad(Math.floor(n / 100))}:${pad(n % 100)}`;
}

function weekRange() {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const wd = mondayBased(today);
  const monday = addDays(today, -wd);
  if (wd >= 5) monday.setUTCDate(monday.getUTCDate() + 7); // weekend → next week
  return [monday, addDays(monday, 4)];
}

/* ---------- WebUntis JSON-RPC ---------- */
async function rpc(server, school, method, params, session) {
  const url = `https://${server}/WebUntis/jsonrpc.do?school=${encodeURIComponent(school)}`;
  const headers = { "Content-Type": "application/json", "User-Agent": "school-planner/1.0" };
  if (session) headers["Cookie"] = "JSESSIONID=" + session;
  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: "school-planner", method, params: params || {}, jsonrpc: "2.0" }),
    });
  } catch (e) {
    throw new UntisError(`Konnte ${server} nicht erreichen. Prüfe Serveradresse und Internetverbindung.`);
  }
  let out;
  try { out = await resp.json(); }
  catch (e) {
    throw new UntisError(`Die Serveradresse „${server}" antwortet nicht wie ein WebUntis-Server ` +
      `(HTTP ${resp.status}). Sie sollte wie „xyz.webuntis.com" aussehen.`);
  }
  if (out.error) {
    const friendly = {
      "-8500": "Schule nicht gefunden — prüfe den Schulnamen (aus der WebUntis-Login-Seite).",
      "-8504": "Falscher Benutzername oder falsches Passwort.",
      "-8509": "Dieses WebUntis-Konto darf die API nicht nutzen. " +
               "Manche Schulen erlauben nur den Login über Website/App.",
    };
    throw new UntisError(friendly[String(out.error.code)] ||
      `WebUntis-Fehler: ${out.error.message} (Code ${out.error.code})`);
  }
  return out.result;
}

async function schoolSearch(query) {
  query = (query || "").trim();
  if (query.length < 3) return [];
  let resp;
  try {
    resp = await fetch("https://schoolsearch.webuntis.com/schoolquery2", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "school-planner/1.0" },
      body: JSON.stringify({ id: "school-planner", method: "searchSchool", params: [{ search: query }], jsonrpc: "2.0" }),
    });
  } catch (e) {
    throw new UntisError("Konnte die WebUntis-Schulsuche nicht erreichen. Prüfe deine Internetverbindung.");
  }
  const out = await resp.json();
  if (out.error) {
    if (out.error.code === -6003) throw new UntisError("Zu viele Treffer — tippe mehr vom Schulnamen oder die Stadt dazu.");
    throw new UntisError("Fehler bei der Schulsuche: " + out.error.message);
  }
  const schools = (out.result && out.result.schools) || [];
  return schools.slice(0, 15).map((s) => ({
    name: s.displayName || s.loginName || "",
    address: s.address || "",
    school: s.loginName || "",
    server: s.server || "",
  }));
}

/* ---------- parsing helpers ---------- */
function validHex(color) {
  const c = String(color || "").replace(/^#/, "").trim();
  return (c.length === 3 || c.length === 6) && /^[0-9a-fA-F]+$/.test(c) ? c : "";
}
function subjectColor(master, el) { return validHex(master.backColor) || validHex(el.backColor); }

function nameOf(value) {
  if (Array.isArray(value)) return value.map(nameOf).filter(Boolean).join(", ");
  if (value && typeof value === "object") return value.longName || value.name || "";
  return value != null ? String(value) : "";
}
function parseExams(raw) {
  const out = [];
  for (const e of raw || []) {
    const d = e.examDate || e.date;
    if (!d) continue;
    let day; try { day = ymdToDate(d); } catch (x) { continue; }
    out.push({
      id: e.id != null ? e.id : null,
      date: fmtISO(day),
      start: e.startTime != null ? fmtHM(e.startTime) : "",
      end: e.endTime != null ? fmtHM(e.endTime) : "",
      type: e.examType || "Prüfung",
      subject: nameOf(e.subject),
      name: e.name || e.text || "",
    });
  }
  return out;
}
function parseHomework(out) {
  const data = (out && out.data) || out || {};
  const raw = data.homeworks || data.records || [];
  const lessons = {};
  for (const l of data.lessons || []) lessons[l.id] = l;
  const items = [];
  for (const hw of raw) {
    const due = hw.dueDate || hw.date;
    if (!due) continue;
    let day; try { day = ymdToDate(due); } catch (x) { continue; }
    const text = String(hw.text || hw.remark || "").trim();
    if (!text) continue;
    let subj = (lessons[hw.lessonId] || {}).subject || hw.subject || "";
    if (subj && typeof subj === "object") subj = subj.name || subj.longName || "";
    items.push({ id: hw.id != null ? hw.id : null, due: fmtISO(day), subject: String(subj || ""), text, done: !!hw.completed });
  }
  return items;
}

function clampToSchoolyear(monday, friday, years) {
  const ranges = [];
  for (const y of years || []) {
    try { ranges.push([ymdToDate(y.startDate), ymdToDate(y.endDate)]); } catch (e) {}
  }
  if (!ranges.length) return [monday, friday, null, null];
  const day = 86400000;
  const dist = (r) => (monday < r[0] ? (r[0] - monday) / day : monday > r[1] ? (monday - r[1]) / day : 0);
  let best = ranges[0];
  for (const r of ranges) if (dist(r) < dist(best)) best = r;
  const [start, end] = best;
  if (start <= monday && monday <= end && friday <= end) return [monday, friday, null, end];
  const anchor = new Date(Math.min(Math.max(monday.getTime(), start.getTime()), end.getTime()));
  let mon = addDays(anchor, -mondayBased(anchor));
  if (mon < start) mon = new Date(start);
  let fri = addDays(mon, 4);
  if (fri > end) fri = new Date(end);
  const note = `Du bist gerade außerhalb der Schulzeit, deshalb wird die nächstgelegene ` +
    `Schulwoche gezeigt, die WebUntis hat (${fmtDEshort(mon)}–${fmtDEfull(fri)}).`;
  return [mon, fri, note, end];
}

/* ---------- optional data (skip quietly if the school doesn't expose it) ---------- */
async function getExams(server, school, session, start, end) {
  try {
    return parseExams(await rpc(server, school, "getExams",
      { id: 0, startDate: dateToYmd(start), endDate: dateToYmd(end) }, session));
  } catch (e) { return []; }
}
function b64utf8(s) { return btoa(String.fromCharCode(...new TextEncoder().encode(s))); }
async function getHomework(server, school, session, start, end) {
  try {
    const url = `https://${server}/WebUntis/api/homeworks/lessons?startDate=${dateToYmd(start)}&endDate=${dateToYmd(end)}`;
    const resp = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "school-planner/1.0",
                 "Cookie": `JSESSIONID=${session}; schoolname=_${b64utf8(school)}` },
    });
    if (!resp.ok) return [];
    return parseHomework(await resp.json());
  } catch (e) { return []; }
}
/* Fehlzeiten. WebUntis gibt sie je nach Schule über die offizielle
   JSON-RPC-Methode oder nur über denselben Weg heraus, den die WebUntis-
   Website selbst benutzt. Beides wird versucht; klappt keins, bleibt die
   Liste leer und die App zeigt den Abschnitt einfach nicht an. */
function ymdOrNull(v) {
  try { return fmtISO(ymdToDate(v)); } catch (e) { return null; }
}
function minutesBetween(a, b) {
  const s = parseInt(a, 10), e = parseInt(b, 10);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 0;
  const m = (Math.floor(e / 100) * 60 + (e % 100)) - (Math.floor(s / 100) * 60 + (s % 100));
  return m > 0 && m < 24 * 60 ? m : 0;
}
function normAbsence(a) {
  const date = ymdOrNull(a.startDate || a.date);
  if (!date) return null;
  let subject = a.subject != null ? a.subject : (a.su || "");
  subject = nameOf(subject);
  const excused =
    typeof a.isExcused === "boolean" ? a.isExcused :
    a.excuseStatus ? true :
    (a.excuse && (a.excuse.excuseStatus || a.excuse.excuseDate)) ? true : false;
  return {
    id: a.id != null ? a.id : null,
    date,
    endDate: ymdOrNull(a.endDate) || date,
    start: a.startTime != null ? fmtHM(a.startTime) : "",
    end: a.endTime != null ? fmtHM(a.endTime) : "",
    minutes: minutesBetween(a.startTime, a.endTime),
    subject,
    reason: String(a.absenceReason || a.reason || a.text || "").trim(),
    excused: !!excused,
  };
}
async function getAbsences(server, school, session, personId, start, end) {
  // 1) offizielle JSON-RPC-Methode
  try {
    const raw = await rpc(server, school, "getStudentAbsences",
      { startDate: dateToYmd(start), endDate: dateToYmd(end),
        includeExcused: true, includeUnExcused: true }, session);
    const list = (Array.isArray(raw) ? raw : (raw && raw.absences) || [])
      .map(normAbsence).filter(Boolean);
    if (list.length) return list;
  } catch (e) { /* viele Schulen sperren die Methode — weiter unten probieren */ }

  // 2) derselbe Weg wie in der WebUntis-Website
  try {
    const url = `https://${server}/WebUntis/api/classreg/absences/students` +
      `?startDate=${dateToYmd(start)}&endDate=${dateToYmd(end)}` +
      `&studentId=${encodeURIComponent(personId)}&excuseStatusId=-1&includeTodaysAbsence=true`;
    const resp = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "school-planner/1.0",
                 "Cookie": `JSESSIONID=${session}; schoolname=_${b64utf8(school)}` },
    });
    if (!resp.ok) return [];
    const out = await resp.json();
    const data = (out && out.data) || out || {};
    const raw = data.absences || data.records || [];
    return raw.map(normAbsence).filter(Boolean);
  } catch (e) { return []; }
}

async function getSchoolyears(server, school, session) {
  try { const y = await rpc(server, school, "getSchoolyears", {}, session); if (y && y.length) return y; } catch (e) {}
  try { const c = await rpc(server, school, "getCurrentSchoolyear", {}, session); if (c) return [c]; } catch (e) {}
  return [];
}

/* ---------- SSRF guard ---------- */
function safeServer(server) {
  let s = String(server || "").trim().replace(/^https?:\/\//, "").split("/")[0].toLowerCase();
  if (s && !s.includes(".")) s += ".webuntis.com";
  if (!(s === "webuntis.com" || s.endsWith(".webuntis.com")))
    throw new UntisError("Ungültiger WebUntis-Server. Erlaubt sind nur *.webuntis.com-Adressen.");
  return s;
}

/* ---------- the full sync ---------- */
async function untisSync(body) {
  const server = safeServer(body.server || "");
  const school = String(body.school || "").trim();
  const auth = await rpc(server, school, "authenticate",
    { user: body.user || "", password: body.password || "", client: "school-planner" });
  const session = auth.sessionId;
  const personId = auth.personId, personType = auth.personType;
  if (!personId) {
    throw new UntisError("Angemeldet, aber dieses Konto hat keinen eigenen Stundenplan " +
      "(personId fehlt). Nutze bitte ein Schüler-Konto.");
  }

  let subjects = [], grid = [], timetable = [], exams = [], homework = [], absences = [];
  let note = null, yearEnd = null, yearStart = null;
  let [monday, friday] = weekRange();
  try {
    subjects = (await rpc(server, school, "getSubjects", {}, session)) || [];
    try { grid = (await rpc(server, school, "getTimegridUnits", {}, session)) || []; } catch (e) { grid = []; }
    const years = await getSchoolyears(server, school, session);
    [monday, friday, note, yearEnd] = clampToSchoolyear(monday, friday, years);
    for (const y of years || []) {
      try {
        const st = ymdToDate(y.startDate), en = ymdToDate(y.endDate);
        if (st <= monday && monday <= en) yearStart = st;
      } catch (e) {}
    }
    // Two weeks at once: the current week fills the grid, the following week
    // lets the app warn about cancellations/substitutions that are still ahead.
    const ttEnd = yearEnd && addDays(monday, 11) > yearEnd ? yearEnd : addDays(monday, 11);
    timetable = (await rpc(server, school, "getTimetable",
      { id: personId, type: personType, startDate: dateToYmd(monday), endDate: dateToYmd(ttEnd) }, session)) || [];
    const examEnd = yearEnd || addDays(monday, 180);
    exams = await getExams(server, school, session, monday, examEnd);          // → Prüfungen
    homework = await getHomework(server, school, session, monday, addDays(monday, 28)); // → Hausübungen
    absences = await getAbsences(server, school, session, personId,               // → Fehlstunden
      yearStart || addDays(monday, -200), addDays(monday, 4));
  } finally {
    try { await rpc(server, school, "logout", {}, session); } catch (e) {}
  }

  // Map lesson start times to period numbers via the school's time grid.
  // Untis grid day numbering: 1=Sunday … 7=Saturday, so Monday (Mon=0) is +2.
  const dayUnits = {}, allStarts = new Set();
  for (const d of grid) {
    const units = {};
    for (const u of d.timeUnits || []) { units[u.startTime] = Object.keys(units).length + 1; allStarts.add(u.startTime); }
    dayUnits[d.day] = units;
  }
  const globalUnits = {};
  [...allStarts].sort((a, b) => a - b).forEach((t, i) => { globalUnits[t] = i + 1; });

  const subjById = {};
  for (const s of subjects) subjById[s.id] = s;

  // A readable list of the school's periods ("1. Stunde 08:00–08:50").
  const periodTimes = {};
  for (const d of grid) {
    let i = 0;
    for (const u of d.timeUnits || []) {
      i++;
      if (!periodTimes[i]) periodTimes[i] = { start: fmtHM(u.startTime), end: fmtHM(u.endTime) };
    }
  }

  const names = (arr) => (arr || []).map((x) => x.name).filter(Boolean).join(", ");
  const orgNames = (arr) => (arr || []).map((x) => x.orgname).filter(Boolean).join(", ");

  const lessons = [];
  for (const les of timetable) {
    const su = les.su || [];
    const weekday = mondayBased(ymdToDate(les.date));
    if (weekday > 4) continue;
    const units = dayUnits[weekday + 2] || globalUnits;
    const period = units[les.startTime] || globalUnits[les.startTime];
    if (!period) continue;
    const su0 = su[0] || {};
    const subj = subjById[su0.id] || su0;                                     // → Fächer
    const orgTeacher = orgNames(les.te);
    const orgRoom = orgNames(les.ro);
    const orgSubject = orgNames(su);
    const code = String(les.code || "");
    let status = "normal";
    if (code === "cancelled") status = "cancelled";
    else if (code === "irregular" || orgTeacher || orgRoom || orgSubject) status = "substitution";
    const subject = subj.name || orgSubject || "";
    // A slot with no subject at all and no note carries no information.
    if (!subject && !les.substText && !les.lstext && status === "normal") continue;
    lessons.push({
      date: fmtISO(ymdToDate(les.date)),
      day: weekday,
      period,
      start: fmtHM(les.startTime),
      end: fmtHM(les.endTime),
      subject: subject || "?",
      subjectLong: subj.longName || "",
      color: subjectColor(subj, su0),
      teacher: names(les.te),
      room: names(les.ro),
      status,                                                                 // normal | substitution | cancelled
      orgTeacher,
      orgRoom,
      orgSubject,
      info: String(les.substText || les.info || les.lstext || "").trim(),
    });
  }

  return {
    week: `${fmtDEshort(monday)} – ${fmtDEfull(friday)}`,
    weekStart: fmtISO(monday),
    weekEnd: fmtISO(friday),
    periodTimes,
    lessons,
    exams,
    homework,
    absences,
    note,
  };
}

/* ---------- request entry point ---------- */
export async function onRequestPost(context) {
  const path = new URL(context.request.url).pathname;
  let body = {};
  try {
    const len = parseInt(context.request.headers.get("content-length") || "0", 10);
    if (len > MAX_BODY) return json({ ok: false, error: "payload too large" }, 413);
    body = await context.request.json();
  } catch (e) { body = {}; }

  try {
    if (path.endsWith("/schools")) return json({ ok: true, schools: await schoolSearch(body.query || "") });
    if (path.endsWith("/sync")) return json({ ok: true, ...(await untisSync(body)) });
    return json({ ok: false, error: "not found" }, 404);
  } catch (e) {
    // UntisError messages are user-friendly and contain no secrets; anything
    // else is masked so internals can never leak.
    return json({ ok: false, error: e instanceof UntisError ? e.message : "Unerwarteter Serverfehler." });
  }
}

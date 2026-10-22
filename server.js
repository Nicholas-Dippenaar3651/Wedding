// Troue Beplanning server: serves the planning page (public/) and keeps its data in MongoDB (Atlas),
// pushing every change to all open browsers. Every change is also written to data/data.json and
// data/rugsteun/ as an offline copy. Needs Node 18+ and the mongodb package (npm install).
//
// Anyone who opens the page can read it; changes need the edit password (sign in on the page).
// The budget (Begroting) is the exception: it is only ever sent to signed-in editors.
// The data is read from MongoDB once at startup, so stop the server before changing the
// document directly in Atlas or Compass, and start it again afterwards.
// If MongoDB can't be reached at startup, the server opens data.json read-only.
//
// Settings come from .env next to this file (real environment variables win). Start: node server.js
//   TROUE_WAGWOORD       edit password, at least 8 characters
//   TROUE_MONGO_URI      MongoDB connection string (mongodb+srv://...)
// Optional:
//   TROUE_MONGO_DB       database name
//   TROUE_LEES_WAGWOORD  also ask a password just to view the page
//   PORT                 port (default 3000)
//   HOST                 0.0.0.0 accepts connections from other devices on the network
//                        (default 127.0.0.1, enough for tunnels such as
//                        VS Code port forwarding, ngrok or cloudflared)

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
let MongoClient;
try {
  ({ MongoClient } = require("mongodb"));
} catch {
  console.error("Die mongodb-pakket ontbreek. Voer eers uit:\n  npm install");
  process.exit(1);
}

const DIR = __dirname;
const PUBLIC = path.join(DIR, "public"); // the page: index.html, css/, js/
const DATA_DIR = path.join(DIR, "data"); // written by the server: data.json, sessions.json, rugsteun/
const DATA = path.join(DATA_DIR, "data.json");
const BACKUPS = path.join(DATA_DIR, "rugsteun");
const PORT = Number(process.env.PORT);
const HOST = process.env.HOST;
const SESSIONS = path.join(DATA_DIR, "sessions.json");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

// these used to sit next to server.js: move them into data/ once
fs.mkdirSync(DATA_DIR, { recursive: true });
for (const name of ["data.json", "sessions.json", "rugsteun"]) {
  const from = path.join(DIR, name);
  const to = path.join(DATA_DIR, name);
  if (fs.existsSync(from) && !fs.existsSync(to)) fs.renameSync(from, to);
}
const PASSWORD = process.env.TROUE_WAGWOORD;
const VIEW_PASSWORD = process.env.TROUE_LEES_WAGWOORD;
const MONGO_URI = process.env.TROUE_MONGO_URI;
const MONGO_DB = process.env.TROUE_MONGO_DB;
const DOC_ID = "state";
const BACKUP_EVERY_MS = 10 * 60 * 1000;
const BACKUPS_KEPT = 50;
const MAX_BODY = 1024 * 1024;
const SESSION_DAYS = 30;

if (PASSWORD.length < 8) {
  console.error("Stel eers 'n wagwoord van minstens 8 karakters in .env:\n  TROUE_WAGWOORD=kies-n-sterk-wagwoord");
  process.exit(1);
}
if (VIEW_PASSWORD && VIEW_PASSWORD === PASSWORD) {
  console.error("Die lees-wagwoord moet anders wees as die wysig-wagwoord.");
  process.exit(1);
}
if (!MONGO_URI) {
  console.error("Stel eers die MongoDB-verbinding in .env:\n  TROUE_MONGO_URI=mongodb+srv://gebruiker:wagwoord@cluster.mongodb.net/");
  process.exit(1);
}

/* ---------------- data ---------------- */
const KEY = /^[A-Za-z0-9_-]{1,40}$/;
const str = (v, max = 1000) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v) => (Number.isFinite(v) ? v : 0);
const keys = (a) => (Array.isArray(a) ? [...new Set(a.filter((k) => typeof k === "string" && KEY.test(k)))].slice(0, 50) : []);

// everything a browser sends is cleaned to the expected shape before it is stored
const clean = {
  todos(t) {
    if (!t || !KEY.test(t.id) || !str(t.text).trim()) return null;
    return { id: t.id, section: str(t.section, 40), text: str(t.text), done: !!t.done, who: keys(t.who), seq: num(t.seq) };
  },
  events(e) {
    if (!e || !KEY.test(e.id) || !/^\d{2}:\d{2}$/.test(e.time) || !str(e.title).trim()) return null;
    const notes = {};
    if (e.notes && typeof e.notes === "object") for (const [k, v] of Object.entries(e.notes)) if (KEY.test(k) && str(v).trim()) notes[k] = str(v);
    return { id: e.id, time: e.time, title: str(e.title), who: keys(e.who), notes, seq: num(e.seq) };
  },
  group(g) {
    if (!g || !/^[a-z0-9]{1,40}$/.test(g.key) || !str(g.label, 60).trim()) return null;
    const hex = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : null);
    return { key: g.key, label: str(g.label, 60), color: hex(g.color) || "#6b6b6b", dark: hex(g.dark) };
  },
  settings(s) {
    const date = s && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : null;
    return { date };
  },
  // a budget card. kind "due": a reminder, amount = still outstanding, due = pay-by date.
  // kind "paid": payment history, amount = what was actually paid.
  // ref ties the parts of one expense together (a deposit and the balance still due).
  budgetItem(b) {
    if (!b || !KEY.test(b.id) || !str(b.title).trim()) return null;
    const kind = b.kind === "paid" ? "paid" : "due";
    // ref "undefined": written by the first version of the import (KEY.test(undefined) passes), means "no ref"
    const ref = typeof b.ref === "string" && b.ref !== "undefined" && KEY.test(b.ref) ? b.ref : b.id;
    return { id: b.id, kind, title: str(b.title, 200), budget: money(b.budget), amount: money(b.amount), due: kind === "due" && /^\d{4}-\d{2}-\d{2}$/.test(b.due) ? b.due : null, ref, seq: num(b.seq) };
  },
  budget(d) {
    return { total: money(d?.total), items: cleanList("budgetItem", d?.items) };
  },
};
const cleanList = (kind, list) => (Array.isArray(list) ? list.map(clean[kind]).filter(Boolean).slice(0, 2000) : []);
// rand amounts: never negative, at most two decimals
function money(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(Math.min(n, 1e9) * 100) / 100 : 0;
}

// budget: only ever sent to signed-in editors (see snapshot())
let state = { rev: 0, groups: [], todos: [], events: [], settings: { date: null }, budget: { total: 0, items: [] } };
let collection = null; // null: MongoDB was unreachable at startup, the server is read-only

function readLocal() {
  try {
    return JSON.parse(fs.readFileSync(DATA, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    console.error(`Kon nie ${DATA} lees nie: ${e.message}\nHerstel dit uit die rugsteun-lêergids of skuif dit weg om oor te begin.`);
    process.exit(1);
  }
}

// data loaded from MongoDB (possibly edited or imported there) is cleaned like anything a browser sends
function load(doc) {
  if (!doc) return false;
  state = {
    rev: num(doc.rev),
    groups: (Array.isArray(doc.groups) ? doc.groups : []).map(clean.group).filter(Boolean),
    todos: cleanList("todos", doc.todos),
    events: cleanList("events", doc.events),
    settings: clean.settings(doc.settings),
    budget: clean.budget(doc.budget),
  };
  return true;
}

// one-time import of the budget spreadsheet: data/begroting-invoer.json is read once an empty
// budget is loaded, then renamed to .klaar so it never runs again
const BUDGET_IMPORT = path.join(DATA_DIR, "begroting-invoer.json");
async function importBudget() {
  if (state.budget.items.length || !fs.existsSync(BUDGET_IMPORT)) return;
  state.budget = clean.budget(JSON.parse(fs.readFileSync(BUDGET_IMPORT, "utf8")));
  state.rev++;
  saveLocal();
  await saveRemote();
  fs.renameSync(BUDGET_IMPORT, BUDGET_IMPORT + ".klaar");
  console.log(`Begroting ingevoer: ${state.budget.items.length} items uit ${path.basename(BUDGET_IMPORT)}`);
}

// ONE-OFF (can be deleted after one start): the import put each deposit pair's whole budget on one card
// and R0 on the other(s). Spread it over the cards of the expense in proportion to their amounts, like
// paying part of a reminder now does. Only pairs still like that are touched (one card with a budget, the
// rest R0); a pair whose budgets were changed by hand is left alone and named in the log.
const IMPORTED_PAIRS = ["b07", "b08", "b09", "b21", "b22", "b25"];
async function splitImportedDeposits() {
  const done = [];
  const skipped = [];
  for (const ref of IMPORTED_PAIRS) {
    const cards = state.budget.items.filter((b) => b.ref === ref);
    const holders = cards.filter((b) => b.budget > 0);
    const total = cards.reduce((s, b) => s + b.amount, 0);
    if (cards.length < 2 || !total) continue;
    if (holders.length !== 1) {
      skipped.push(cards[0].title);
      continue;
    }
    const budget = holders[0].budget;
    let given = 0;
    cards.forEach((b, i) => {
      // the last card takes what's left, so rounding never changes the total
      b.budget = i === cards.length - 1 ? money(budget - given) : Math.round((budget * b.amount) / total); // whole rands
      given += b.budget;
    });
    done.push(cards[0].title);
  }
  if (done.length) {
    state.rev++;
    saveLocal();
    await saveRemote();
    console.log(`Begroting verdeel vir: ${done.join(", ")}`);
  }
  if (skipped.length) console.log(`Begroting nie verdeel nie (reeds met die hand verander): ${skipped.join(", ")}`);
}

async function connect() {
  const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    collection = client.db(MONGO_DB).collection("data");
    const doc = await collection.findOne({ _id: DOC_ID });
    // empty database: start from this computer's data.json if there is one, otherwise with empty lists
    if (!load(doc) && load(readLocal())) await saveRemote();
    console.log(`MongoDB: ${MONGO_DB}.data`);
    await importBudget();
    await splitImportedDeposits();
  } catch (e) {
    collection = null;
    await client.close().catch(() => {});
    load(readLocal());
    console.warn(`Kon nie MongoDB bereik nie (${e.message}).\nDie bladsy wys ${DATA} en kan nie gewysig word nie. Herbegin sodra daar 'n verbinding is.`);
  }
}

// one write at a time, so a slow write never lands after a newer one
let writing = Promise.resolve();
function saveRemote() {
  const doc = { ...JSON.parse(JSON.stringify(state)), _id: DOC_ID };
  const done = writing.then(() => collection.replaceOne({ _id: DOC_ID }, doc, { upsert: true }));
  writing = done.catch(() => {});
  return done;
}

let lastBackup = 0;
function saveLocal() {
  // write to a temp file first so a crash never leaves a half-written data.json
  const tmp = DATA + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DATA);
  if (Date.now() - lastBackup > BACKUP_EVERY_MS) {
    lastBackup = Date.now();
    fs.mkdirSync(BACKUPS, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    fs.copyFileSync(DATA, path.join(BACKUPS, `data-${stamp}.json`));
    const old = fs.readdirSync(BACKUPS).filter((f) => f.startsWith("data-")).sort().slice(0, -BACKUPS_KEPT);
    old.forEach((f) => fs.unlinkSync(path.join(BACKUPS, f)));
  }
}

// the lists that upsert/delete work on, with the cleaner for their items
const LISTS = {
  todos: { get: () => state.todos, set: (l) => (state.todos = l), clean: clean.todos },
  events: { get: () => state.events, set: (l) => (state.events = l), clean: clean.events },
  budget: { get: () => state.budget.items, set: (l) => (state.budget.items = l), clean: clean.budgetItem },
};
function upsertInto(list, item) {
  const i = list.get().findIndex((x) => x.id === item.id);
  i < 0 ? list.get().push(item) : (list.get()[i] = item);
}

function apply(op) {
  const kind = op.kind;
  const list = Object.hasOwn(LISTS, kind) ? LISTS[kind] : null;
  switch (op.op) {
    case "upsert": {
      const item = list?.clean(op.item);
      if (!item) return false;
      upsertInto(list, item);
      return true;
    }
    case "delete":
      if (!list) return false;
      list.set(list.get().filter((x) => x.id !== op.id));
      return true;
    case "reorder": {
      // drag and drop: new section and position for a batch of TODOs
      if (kind !== "todos" || !Array.isArray(op.items)) return false;
      op.items.slice(0, 2000).forEach((c) => {
        const t = state.todos.find((x) => x.id === c?.id);
        if (t) {
          t.section = str(c.section, 40);
          t.seq = num(c.seq);
        }
      });
      return true;
    }
    case "bulk": {
      if (kind === "budget") {
        // paying part of a reminder: the reminder shrinks and a payment card is added, in one change
        const items = cleanList("budgetItem", op.items);
        const gone = new Set(Array.isArray(op.deleted) ? op.deleted.slice(0, 2000) : []);
        if (!items.length && !gone.size) return false;
        items.forEach((item) => upsertInto(list, item));
        list.set(list.get().filter((x) => !gone.has(x.id)));
        return true;
      }
      // the list's "Kies take" mode: many TODOs changed and/or deleted in one go
      if (kind !== "todos") return false;
      const items = cleanList("todos", op.items);
      const gone = new Set(Array.isArray(op.deleted) ? op.deleted.slice(0, 2000) : []);
      if (!items.length && !gone.size) return false;
      items.forEach((item) => {
        // only existing TODOs: one deleted elsewhere in the meantime stays deleted
        const i = state.todos.findIndex((x) => x.id === item.id);
        if (i >= 0) state.todos[i] = item;
      });
      state.todos = state.todos.filter((t) => !gone.has(t.id));
      return true;
    }
    case "set":
      if (kind === "groups") state.groups = (Array.isArray(op.value) ? op.value : []).map(clean.group).filter(Boolean).slice(0, 100);
      else if (kind === "settings") state.settings = clean.settings(op.value);
      else if (kind === "budgetTotal") state.budget.total = money(op.value);
      else return false;
      return true;
    case "deleteGroup": {
      const key = op.key;
      state.groups = state.groups.filter((g) => g.key !== key);
      state.todos.forEach((t) => (t.who = t.who.filter((k) => k !== key)));
      state.events.forEach((e) => {
        e.who = e.who.filter((k) => k !== key);
        delete e.notes[key];
      });
      return true;
    }
  }
  return false;
}

/* ---------------- live updates (server-sent events) ---------------- */
const clients = new Map(); // open stream -> its request (to check, at every send, whether it is signed in)
// the budget only goes to editors; everyone else gets the state without it
const snapshot = (editor) => JSON.stringify(editor ? state : { ...state, budget: undefined });
function broadcast() {
  const full = `data: ${snapshot(true)}\n\n`;
  const open = `data: ${snapshot(false)}\n\n`;
  clients.forEach((req, res) => res.write(isEditor(req) ? full : open));
}
// keep idle connections open through tunnels and proxies
setInterval(() => clients.forEach((req, res) => res.write(": ping\n\n")), 25000);

/* ---------------- auth ---------------- */
const failures = new Map(); // ip -> { count, since } for wrong passwords
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

// optional view password: HTTP Basic auth, the browser asks once (username can be anything)
function canView(req) {
  if (!VIEW_PASSWORD) return true;
  const m = /^Basic (.+)$/.exec(req.headers.authorization || "");
  if (!m) return false;
  const pass = Buffer.from(m[1], "base64").toString().split(":").slice(1).join(":");
  return same(pass, VIEW_PASSWORD);
}

// edit sessions: signing in with the edit password sets an HttpOnly cookie.
// Only a hash of each token is kept, in sessions.json, so sign-ins survive a restart;
// changing TROUE_WAGWOORD signs everyone out.
const pwStamp = sha("troue:" + PASSWORD).toString("hex");
let sessions = {}; // sha256(token) -> expiry (ms)
try {
  const s = JSON.parse(fs.readFileSync(SESSIONS, "utf8"));
  if (s.pw === pwStamp) sessions = s.tokens || {};
} catch {}
function saveSessions() {
  const now = Date.now();
  for (const [h, exp] of Object.entries(sessions)) if (exp < now) delete sessions[h];
  fs.writeFileSync(SESSIONS, JSON.stringify({ pw: pwStamp, tokens: sessions }));
}
const tokenOf = (req) => /(?:^|;\s*)troue_sessie=([a-f0-9]{64})/.exec(req.headers.cookie || "")?.[1];
function isEditor(req) {
  const t = tokenOf(req);
  const exp = t && sessions[sha(t).toString("hex")];
  return !!exp && exp > Date.now();
}
function cookie(req, value, maxAge) {
  const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  return `troue_sessie=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}
function tooManyFailures(ip) {
  const f = failures.get(ip);
  if (!f) return false;
  if (Date.now() - f.since > 15 * 60 * 1000) {
    failures.delete(ip);
    return false;
  }
  return f.count >= 10;
}
function noteFailure(ip) {
  const f = failures.get(ip) || { count: 0, since: Date.now() };
  f.count++;
  failures.set(ip, f);
}

/* ---------------- http ---------------- */
function send(res, status, body, type = "application/json; charset=utf-8", extra = {}) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...extra });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress;
  if (tooManyFailures(ip)) return send(res, 429, "Te veel verkeerde wagwoorde. Probeer oor 15 minute weer.", "text/plain; charset=utf-8");
  if (!canView(req)) {
    if (req.headers.authorization) noteFailure(ip);
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Troue Beplanning", charset="UTF-8"', "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Wagwoord nodig.");
  }

  const url = new URL(req.url, "http://x");
  const json = () => (req.headers["content-type"] || "").startsWith("application/json");
  try {
    if (req.method === "GET" && url.pathname === "/api/session") return send(res, 200, { editor: isEditor(req) });
    if (req.method === "POST" && url.pathname === "/api/login") {
      if (!json()) return send(res, 415, { error: "JSON verwag" });
      const { password } = JSON.parse(await readBody(req));
      if (typeof password !== "string" || !same(password, PASSWORD)) {
        noteFailure(ip);
        return send(res, 401, { error: "verkeerde wagwoord" });
      }
      if (!collection) return send(res, 503, { error: "net-lees: geen verbinding met MongoDB nie" });
      failures.delete(ip);
      const token = crypto.randomBytes(32).toString("hex");
      sessions[sha(token).toString("hex")] = Date.now() + SESSION_DAYS * 864e5;
      saveSessions();
      return send(res, 200, { editor: true }, undefined, { "Set-Cookie": cookie(req, token, SESSION_DAYS * 86400) });
    }
    if (req.method === "POST" && url.pathname === "/api/logout") {
      const t = tokenOf(req);
      if (t) delete sessions[sha(t).toString("hex")];
      saveSessions();
      return send(res, 200, { editor: false }, undefined, { "Set-Cookie": cookie(req, "", 0) });
    }
    if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
      // the page and its css/js; nothing outside public/ and only known file types
      const file = path.join(PUBLIC, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname));
      const type = TYPES[path.extname(file)];
      if (type && file.startsWith(PUBLIC + path.sep) && fs.existsSync(file)) return send(res, 200, fs.readFileSync(file, "utf8"), type);
      return send(res, 404, "Nie gevind nie.", "text/plain; charset=utf-8");
    }
    if (req.method === "GET" && url.pathname === "/api/data") return send(res, 200, snapshot(isEditor(req)));
    if (req.method === "GET" && url.pathname === "/api/stream") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      res.write(`data: ${snapshot(isEditor(req))}\n\n`);
      clients.set(res, req);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/op") {
      if (!isEditor(req)) return send(res, 401, { error: "teken in om te wysig" });
      if (!collection) return send(res, 503, { error: "net-lees: geen verbinding met MongoDB nie" });
      if (!json()) return send(res, 415, { error: "JSON verwag" });
      const op = JSON.parse(await readBody(req));
      if (!apply(op)) return send(res, 400, { error: "ongeldige verandering" });
      state.rev++;
      saveLocal();
      broadcast();
      try {
        await saveRemote();
      } catch (e) {
        // kept in memory and in data.json; the next change that reaches MongoDB carries it along
        console.error(`Kon nie na MongoDB skryf nie: ${e.message}`);
        return send(res, 503, { error: "nie in MongoDB gestoor nie" });
      }
      return send(res, 200, { rev: state.rev });
    }
    send(res, 404, "Nie gevind nie.", "text/plain; charset=utf-8");
  } catch (e) {
    send(res, e.message === "too large" ? 413 : 400, { error: "kon nie verwerk nie" });
  }
});

connect().then(() => server.listen(PORT, HOST, () => {
  console.log(`Troue Beplanning loop op http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`Plaaslike kopie: ${DATA}`);
  console.log(VIEW_PASSWORD ? "Kyk: lees-wagwoord nodig. Wysig: teken in met die wysig-wagwoord." : "Kyk: enigeen met die skakel. Wysig: teken in met die wysig-wagwoord.");
  console.log("Druk Ctrl+C om te stop.");
}));

/* ---------------- helpers ---------------- */
const store = {
  get(k, fallback) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) k.startsWith("aria-") ? n.setAttribute(k, v) : (n[k] = v);
  kids.flat().forEach((k) => k != null && n.append(k));
  return n;
};
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const pad = (n) => String(n).padStart(2, "0");
const toMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const fmtGap = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? " " + (min % 60) + " min" : ""}`);

// line icons (Lucide, 24×24, drawn with the current text colour)
const ICONS = {
  pencil: '<path d="M21.17 6.81a1 1 0 0 0-3.98-3.98L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  grip: '<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
};
function icon(name) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("class", "icon");
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = ICONS[name];
  return s;
}
// an icon-only button; the label is read out and shown as a tooltip
const iconBtn = (name, label, onclick, extra = "") => el("button", { type: "button", className: "icon-btn " + extra, title: label, "aria-label": label, onclick }, icon(name));

// progress ring: the share done, with the percentage in the middle unless it's the small one
function ring(done, total, mini) {
  const p = total ? Math.round((done / total) * 100) : 0;
  const r = el("span", { className: "ring" + (mini ? " mini" : "") + (total && done === total ? " full" : "") }, mini ? null : el("b", { textContent: p + "%" }));
  r.style.setProperty("--p", p);
  return r;
}

// "Nic en Christy" -> "NC", "Bruidsmeisies" -> "B"
const initials = (label) =>
  label
    .split(/\s+/)
    .filter((w) => w && !/^(en|of|die|van|&)$/i.test(w))
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

function toast(msg) {
  document.querySelector(".toast")?.remove(); // one at a time
  const t = el("div", { className: "toast", role: "status", textContent: msg });
  document.body.append(t);
  setTimeout(() => t.classList.add("out"), 3200);
  setTimeout(() => t.remove(), 3500);
}

// in-page confirmation dialog
function ask(message, yesLabel = "Verwyder") {
  return new Promise((resolve) => {
    const close = (v) => {
      ov.remove();
      resolve(v);
    };
    const no = el("button", { className: "btn", textContent: "Kanselleer", onclick: () => close(false) });
    const yes = el("button", { className: "btn danger", textContent: yesLabel, onclick: () => close(true) });
    // braces matter: an onclick property that returns false cancels the click
    const ov = el("div", { className: "modal", onclick: (e) => { if (e.target === ov) close(false); } }, el("div", { className: "modal-box", role: "dialog", "aria-modal": "true" }, el("p", { textContent: message }), el("div", { className: "form-actions" }, no, yes)));
    ov.addEventListener("keydown", (e) => e.key === "Escape" && close(false));
    document.body.append(ov);
    yes.focus();
  });
}

function chipToggle(g, checked) {
  const cb = el("input", { type: "checkbox", checked });
  const lab = el("label", { className: "chip-toggle" }, cb, el("span", { textContent: g.label }));
  lab.style.setProperty("--c", `var(--g-${g.key})`);
  return { cb, lab };
}
function chipList(keys) {
  return keys.length
    ? el(
        "span",
        { className: "chips" },
        keys
          .filter((k) => G[k])
          .map((k) => {
            const c = el("span", { className: "chip", textContent: G[k].label });
            c.style.setProperty("--c", `var(--g-${k})`);
            return c;
          }),
      )
    : null;
}

/* ---------------- groups ---------------- */
// { key, label, color, dark }: color is used in light mode; dark mode uses `dark` when set, otherwise a lightened color
let GROUPS = [];
let G = {};
const NEW_GROUP_COLORS = ["#3f8f8a", "#b0567a", "#5b6fb5", "#8c7a2e", "#a3593f", "#4d8a6a"];
const groupStyle = document.createElement("style");
document.head.append(groupStyle);

// regenerate the --g-<key> colour tokens for both themes
function applyGroups() {
  G = Object.fromEntries(GROUPS.map((g) => [g.key, g]));
  const light = GROUPS.map((g) => `--g-${g.key}: ${g.color};`).join("");
  const dark = GROUPS.map((g) => `--g-${g.key}: ${g.dark || `color-mix(in srgb, ${g.color} 60%, #fff)`};`).join("");
  groupStyle.textContent = `:root{${light}} @media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${dark}}} :root[data-theme="dark"]{${dark}}`;
}
function saveGroups() {
  send({ op: "set", kind: "groups", value: GROUPS });
  applyGroups();
}

/* ---------------- list sections ---------------- */
// heading: a plain heading shown above this section and the ones after it
const SECTIONS = [
  { key: "algemeen", title: "Algemene voorbereiding", heading: "Voor Desember" },
  { key: "wo-do", title: "Voorbereiding voor die troue (Woensdag/Donderdag)", heading: "Desember" },
  { key: "vrydag", title: "Voorbereiding die aand voor die troue (Vrydag)" },
  { key: "dag", title: "Dag van Troue" },
];
// the sections grouped under their headings: [{ title, keys: [section keys] }]
const PERIODS = SECTIONS.reduce((list, s) => {
  if (s.heading || !list.length) list.push({ title: s.heading || "", keys: [] });
  list.at(-1).keys.push(s.key);
  return list;
}, []);

/* ---------------- state: filled from the server ---------------- */
let todos = [];
let events = [];
let settings = {};
let budget = null; // { total, items }: only sent by the server to signed-in editors, null otherwise

/* ---------------- server sync ----------------
   The data lives in MongoDB behind server.js and every change is pushed to all open browsers. */
const server = { rev: -1, editor: false };
const canEdit = () => server.editor;

async function send(op) {
  try {
    const r = await fetch("api/op", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(op) });
    if (r.status === 401) {
      // signed out elsewhere or the session expired: go read-only and show the server's copy again
      setEditor(false);
      toast("Jou aanmelding het verval. Teken weer in om te wysig.");
      server.rev = -1;
      applyRemote(await (await fetch("api/data")).json());
      return;
    }
    if (!r.ok) throw new Error(r.status);
  } catch {
    setSync("error");
    toast("Kon nie stoor nie. Kyk of die bediener nog loop en herlaai dan die bladsy.");
  }
}

/* ---------------- read-only until signed in ---------------- */
function setEditor(on) {
  server.editor = on;
  document.body.classList.toggle("readonly", !on);
  if (!on) {
    editing = editingEv = null;
    if (!adminEl.hidden) toggleGroupAdmin();
    if (picking) setPicking(false);
    budget = null; // forget the budget straight away; the server stops sending it too
    if (currentPage === "begroting") showPage("todo");
  } else if (location.hash === "#begroting") showPage("begroting");
  renderAuth();
  renderTodos();
  renderTimeline();
  renderSettings();
  renderBudget();
}

function renderAuth() {
  const a = document.getElementById("auth");
  a.hidden = false;
  a.replaceChildren(
    ...(server.editor
      ? ["Jy kan wysig ·", el("button", { className: "link-btn", textContent: "Teken uit", onclick: logout })]
      : ["Jy kyk net ·", el("button", { className: "link-btn", textContent: "Teken in om te wysig", onclick: loginDialog })]),
  );
}

function loginDialog() {
  const pw = el("input", { type: "password", autocomplete: "current-password", placeholder: "Wagwoord", "aria-label": "Wagwoord", id: "login-pw" });
  const err = el("div", { className: "err", role: "alert" });
  const close = () => ov.remove();
  const submit = async (e) => {
    e.preventDefault();
    if (!pw.value) return pw.focus();
    err.textContent = "";
    try {
      const r = await fetch("api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw.value }) });
      if (r.status === 429) return (err.textContent = "Te veel verkeerde pogings. Probeer oor 15 minute weer.");
      if (r.status === 503) return (err.textContent = "Die bediener kan nie die databasis bereik nie, so niks kan nou gewysig word nie.");
      if (!r.ok) {
        pw.select();
        return (err.textContent = "Verkeerde wagwoord.");
      }
    } catch {
      return (err.textContent = "Kon nie die bediener bereik nie.");
    }
    close();
    setEditor(true);
    openStream(); // a new connection, made with the sign-in cookie, so the budget comes along
    toast("Jy kan nou wysig.");
  };
  const ov = el(
    "div",
    // braces matter: an onclick property that returns false cancels the click (and with it the form submit)
    {
      className: "modal",
      onclick: (e) => {
        if (e.target === ov) close();
      },
    },
    el(
      "form",
      { className: "modal-box login-form", role: "dialog", "aria-modal": "true", "aria-label": "Teken in", onsubmit: submit },
      el("h2", { textContent: "Teken in om te wysig" }),
      pw,
      err,
      el("div", { className: "form-actions" }, el("button", { type: "button", className: "btn", textContent: "Kanselleer", onclick: close }), el("button", { type: "submit", className: "btn primary", textContent: "Teken in" })),
    ),
  );
  ov.addEventListener("keydown", (e) => e.key === "Escape" && close());
  document.body.append(ov);
  pw.focus();
}

async function logout() {
  try {
    await fetch("api/logout", { method: "POST" });
  } catch {}
  setEditor(false);
  toast("Jy is uitgeteken.");
}

// take the server's copy; our own changes come back this way too
function applyRemote(data) {
  // the same revision is still taken when it brings the budget we didn't have yet (just signed in)
  if (data.rev <= server.rev && !(data.budget && !budget && server.editor)) return;
  server.rev = Math.max(server.rev, data.rev);
  budget = server.editor && data.budget ? data.budget : null;
  todos = data.todos;
  events = data.events;
  settings = data.settings || {};
  GROUPS = data.groups;
  applyGroups();
  const saved = store.get("troue.group", "alles");
  activeGroup = G[saved] ? saved : "alles";
  scheduleRender();
}

// hold back a remote update while someone is typing or has a form open, so nothing they type is lost
let renderPending = false;
const busy = () => editing || editingEv || drag || document.body.classList.contains("bdragging") || (document.activeElement?.matches("input:not([type=checkbox]):not(#search)") && document.activeElement.closest("#sections, #timeline, #groupAdmin"));
function scheduleRender() {
  if (busy()) return (renderPending = true);
  renderPending = false;
  renderTabs();
  renderTodos();
  renderTimeline();
  renderSettings();
  renderGroupAdmin();
  renderBudget();
  if (query) runSearch();
}
const flushPending = () => renderPending && setTimeout(scheduleRender, 0);
document.addEventListener("focusout", flushPending);

function setSync(status) {
  const s = document.getElementById("sync");
  s.hidden = false;
  s.dataset.status = status;
  s.textContent = { ok: "Gesinchroniseer", offline: "Verbinding verloor…", error: "Nie gestoor nie" }[status];
  s.title = status === "ok" ? "Veranderinge word dadelik met almal gedeel" : "Herlaai die bladsy as dit nie vanself herstel nie";
}

async function connectServer() {
  let data;
  try {
    const r = await fetch("api/data", { headers: { Accept: "application/json" } });
    if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) throw new Error(r.status);
    data = await r.json();
  } catch {
    // opened from disk or without server.js: there is nothing to show
    document.getElementById("footer").textContent = "Kon nie die bediener bereik nie. Maak die bladsy oop deur server.js (node server.js).";
    return;
  }
  let editor = false;
  try {
    editor = (await (await fetch("api/session")).json()).editor;
  } catch {}
  setEditor(editor);
  applyRemote(data);
  openStream();
}

// live updates; opened again after signing in so the server knows this connection may get the budget
let stream = null;
function openStream() {
  stream?.close();
  stream = new EventSource("api/stream");
  stream.onmessage = (e) => {
    setSync("ok");
    applyRemote(JSON.parse(e.data));
  };
  stream.onerror = () => setSync("offline"); // EventSource reconnects by itself
}

const upsert = (list, obj) => {
  const i = list.findIndex((x) => x.id === obj.id);
  return i < 0 ? [...list, obj] : list.map((x) => (x.id === obj.id ? obj : x));
};
function saveTodo(t) {
  todos = upsert(todos, t);
  send({ op: "upsert", kind: "todos", item: t });
  renderTodos();
  renderTabs();
  flushPending();
}
function removeTodo(id) {
  todos = todos.filter((t) => t.id !== id);
  send({ op: "delete", kind: "todos", id });
  renderTodos();
  renderTabs();
}
function saveEvent(ev) {
  events = upsert(events, ev);
  send({ op: "upsert", kind: "events", item: ev });
  renderTimeline();
  renderTabs();
  flushPending();
}
function removeEvent(id) {
  events = events.filter((e) => e.id !== id);
  send({ op: "delete", kind: "events", id });
  renderTimeline();
  renderTabs();
}
function saveSettings(patch) {
  settings = { ...settings, ...patch };
  send({ op: "set", kind: "settings", value: settings });
  renderSettings();
  applyLive();
}


/* ---------------- theme ---------------- */
const themeBtns = document.querySelectorAll("[data-theme-choice]");
function setTheme(choice) {
  if (!["auto", "light", "dark"].includes(choice)) choice = "auto";
  if (choice === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  store.set("troue.theme", choice);
  themeBtns.forEach((b) => b.setAttribute("aria-pressed", b.dataset.themeChoice === choice));
}
themeBtns.forEach((b) => b.addEventListener("click", () => setTheme(b.dataset.themeChoice)));
setTheme(store.get("troue.theme", "auto"));

/* =================================================
   TIMELINE (from "Timeline.xlsx")
   ================================================= */
const timelineEl = document.getElementById("timeline");
let editingEv = null; // event id being edited, or "new"
const sortedEvents = () => [...events].sort((a, b) => a.time.localeCompare(b.time) || a.seq - b.seq);

function endEventEdit() {
  editingEv = null;
  renderTimeline();
}

function renderTimeline() {
  timelineEl.replaceChildren();
  if (editingEv === "new") {
    timelineEl.append(eventRow(null, eventForm({ id: uid(), time: "", title: "", who: activeGroup === "alles" ? [] : [activeGroup], notes: {}, seq: Date.now() }, true)));
  }
  clashes = findClashes();
  const shown = sortedEvents().filter((ev) => ev.id === editingEv || eventMatches(ev));
  let part = null;
  shown.forEach((ev) => {
    // a soft label where the morning, afternoon and evening start
    if (dayPart(ev.time) !== part) timelineEl.append(el("div", { className: "daypart", textContent: (part = dayPart(ev.time)) }));
    timelineEl.append(eventRow(ev, editingEv === ev.id ? eventForm(ev, false) : eventCard(ev)));
  });
  if (!events.length && editingEv !== "new") timelineEl.append(el("div", { className: "empty", textContent: "Nog geen items nie. Kies Nuwe item om te begin." }));
  else if (query && !shown.length) timelineEl.append(el("div", { className: "empty", textContent: `Geen tydlyn-items vir "${query}" nie.` }));
  applyFilter();
  applyLive();
  timelineEl.querySelector(".ev-form input")?.focus();
}

const dayPart = (time) => (time < "12:00" ? "Oggend" : time < "17:00" ? "Middag" : "Aand");

function eventRow(ev, card) {
  const row = el("div", { className: "ev" + (card.classList.contains("ev-form") ? " editing" : "") }, el("div", { className: "time", textContent: ev ? ev.time : "" }), el("div", { className: "node" }), card);
  row.dataset.groups = ev ? groupsOf(ev).join(" ") : "";
  row.dataset.time = ev ? ev.time : "";
  if (ev) row.dataset.id = ev.id;
  // the dot and the card's edge take the colour of the first group
  const first = ev?.who.find((k) => G[k]);
  if (first) row.style.setProperty("--g", `var(--g-${first})`);
  return row;
}

// double bookings: a group with more than one item at the same time
let clashes = {};
function findClashes() {
  const byKey = {};
  events.forEach((e) => groupsOf(e).forEach((g) => (byKey[e.time + "|" + g] ||= []).push(e)));
  return Object.fromEntries(Object.entries(byKey).filter(([k, list]) => list.length > 1 && G[k.split("|")[1]]));
}
function clashBadges(ev) {
  return groupsOf(ev)
    .filter((g) => clashes[ev.time + "|" + g])
    .map((g) => {
      const others = clashes[ev.time + "|" + g].filter((e) => e.id !== ev.id).map((e) => e.title);
      const b = el("span", { className: "clash", textContent: `Dubbel geboek: ${G[g].label}`, title: `${G[g].label} het ook om ${ev.time}: ${others.join(", ")}` });
      b.dataset.group = g;
      return b;
    });
}

function eventCard(ev) {
  const notes = Object.entries(ev.notes).filter(([k]) => G[k]);
  const badges = clashBadges(ev);
  // drag to another place, or use the arrow keys on it; hidden until signed in (body.readonly)
  const handle = el("button", { className: "drag-handle", type: "button", title: "Sleep om te skuif (of gebruik die pyltjie-sleutels)", "aria-label": `Skuif "${ev.title}"` }, icon("grip"));
  handle.addEventListener("pointerdown", (e) => startEvDrag(e, ev, handle.closest(".ev")));
  handle.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    keyMoveEvent(ev, e.key === "ArrowUp" ? -1 : 1);
  });
  return el(
    "div",
    { className: "card" },
    el(
      "div",
      { className: "card-top" },
      handle,
      el("div", { className: "title" }, highlight(ev.title)),
      el(
        "span",
        { className: "actions" },
        iconBtn("pencil", "Wysig", () => {
          editingEv = ev.id;
          renderTimeline();
        }),
        iconBtn("x", "Verwyder", async () => (await ask(`Verwyder "${ev.time} – ${ev.title}"?`)) && removeEvent(ev.id), "del"),
      ),
    ),
    ev.who.length || badges.length ? el("div", { className: "chips" }, chipList(ev.who), badges) : null,
    notes.length
      ? el(
          "ul",
          { className: "notes" },
          notes.map(([k, text]) => {
            const li = el("li", {}, el("b", { textContent: G[k].label + ": " }), highlight(text));
            li.dataset.group = k;
            li.style.setProperty("--c", `var(--g-${k})`);
            return li;
          }),
        )
      : null,
  );
}

function eventForm(ev, isNew) {
  const time = el("input", { type: "time", value: ev.time, required: true, "aria-label": "Tyd", id: "ev-time" });
  const title = el("input", { className: "edit", value: ev.title, placeholder: "Wat gebeur?", "aria-label": "Besonderhede", id: "ev-title" });

  // allocation: toggle chip per group, each with an optional note for that group
  const rows = GROUPS.map((g) => {
    const { cb, lab } = chipToggle(g, ev.who.includes(g.key));
    const note = el("input", { className: "note-input", value: ev.notes[g.key] || "", placeholder: `Nota vir ${g.label} (opsioneel)`, "aria-label": `Nota vir ${g.label}` });
    const row = el("div", { className: "alloc-row" }, lab, note);
    row.style.setProperty("--c", `var(--g-${g.key})`);
    return { key: g.key, cb, note, row };
  });

  const save = () => {
    if (!time.value) return time.focus();
    if (!title.value.trim()) return title.focus();
    editingEv = null;
    saveEvent({
      id: ev.id,
      time: time.value,
      title: title.value.trim(),
      who: rows.filter((r) => r.cb.checked).map((r) => r.key),
      notes: Object.fromEntries(rows.filter((r) => r.note.value.trim()).map((r) => [r.key, r.note.value.trim()])),
      seq: ev.seq,
    });
  };

  const form = el(
    "form",
    {
      className: "card ev-form",
      onsubmit: (e) => {
        e.preventDefault();
        save();
      },
    },
    el("div", { className: "form-line" }, time, title),
    el("div", { className: "alloc-head", textContent: "Van toepassing op · nota per groep" }),
    el(
      "div",
      { className: "alloc" },
      rows.map((r) => r.row),
    ),
    el("div", { className: "form-actions" }, el("button", { type: "button", className: "btn", textContent: "Kanselleer", onclick: endEventEdit }), el("button", { type: "submit", className: "btn primary", textContent: isNew ? "Voeg by" : "Stoor" })),
  );
  form.addEventListener("keydown", (e) => e.key === "Escape" && endEventEdit());
  return form;
}

function applyFilter() {
  const on = activeGroup !== "alles";
  timelineEl.classList.toggle("filtered", on);
  timelineEl.classList.toggle("hide-others", on && hideOthers.checked);
  timelineEl.querySelectorAll(".ev").forEach((row) => {
    const hit = on && row.dataset.groups.split(" ").includes(activeGroup);
    row.classList.toggle("hit", hit);
    row.style.setProperty("--c", on ? `var(--g-${activeGroup})` : "var(--line)");
    row.querySelectorAll(".notes li, .clash").forEach((n) => n.classList.toggle("mine", n.dataset.group === activeGroup));
  });
  renderTimelineOverview(on);
  // the time label is hidden on repeated times; show it again when the row above is hidden.
  // A morning/afternoon/evening label is hidden when nothing under it is showing.
  let prevTime = null;
  let part = null;
  let partShown = false;
  for (const n of timelineEl.children) {
    if (n.classList.contains("daypart")) {
      if (part) part.hidden = !partShown;
      part = n;
      partShown = false;
      prevTime = null;
    }
    if (!n.classList.contains("ev") || getComputedStyle(n).display === "none") continue;
    partShown = true;
    n.querySelector(".time").classList.toggle("same", !!n.dataset.time && n.dataset.time === prevTime);
    prevTime = n.dataset.time;
  }
  if (part) part.hidden = !partShown;
}

// top of the page: how many items, when the day starts and ends, double bookings
function renderTimelineOverview(on) {
  const list = sortedEvents().filter((e) => !on || groupsOf(e).includes(activeGroup));
  const nClash = Object.keys(clashes).filter((k) => !on || k.endsWith("|" + activeGroup)).length;
  const stat = (value, label, warn) => el("div", { className: "stat" + (warn ? " warn" : "") }, el("b", { textContent: value }), el("span", { textContent: label }));
  // filter(Boolean): replaceChildren() would print "null" when there are no double bookings
  const parts = [
    el("div", { className: "stat-for", textContent: on ? `Vir ${G[activeGroup].label}` : "Die hele dag" }),
    stat(list.length, list.length === 1 ? "item" : "items"),
    stat(list[0]?.time || "–", "begin"),
    stat(list.at(-1)?.time || "–", "einde"),
    nClash ? stat(nClash, "dubbel geboek", true) : null,
  ];
  document.getElementById("tlOverview").replaceChildren(...parts.filter(Boolean));
}

document.getElementById("addEventBtn").addEventListener("click", () => {
  editingEv = "new";
  renderTimeline();
});

/* =================================================
   DRAG AND DROP (signed in): the list is sorted by time, so an item dropped next to another
   takes that item's time, and lands just before or after it among the items at that time
   ================================================= */
let evDrag = null; // { id, row, ghost, line, x, y, anchor: { id, after }, raf } while dragging

// move item `id` just after (or before) `anchorId`, at the anchor's time; the items at that time are numbered 0, 1, 2…
function placeEvent(id, anchorId, after) {
  const item = events.find((e) => e.id === id);
  const anchor = events.find((e) => e.id === anchorId);
  if (!item || !anchor || item === anchor) return;
  const slot = sortedEvents().filter((e) => e.time === anchor.time && e.id !== id);
  slot.splice(slot.indexOf(anchor) + (after ? 1 : 0), 0, item);
  const changes = slot.map((e, k) => ({ id: e.id, time: anchor.time, seq: k })).filter((c, k) => slot[k].seq !== c.seq || slot[k].time !== c.time);
  if (!changes.length) return;
  const byId = Object.fromEntries(changes.map((c) => [c.id, c]));
  events = events.map((e) => (byId[e.id] ? { ...e, time: byId[e.id].time, seq: byId[e.id].seq } : e));
  send({ op: "reorder", kind: "events", items: changes });
  renderTimeline();
  if (item.time !== anchor.time) toast(`"${item.title}" is nou om ${anchor.time}. Wysig dit as dit 'n ander tyd moet wees.`);
}

// arrow keys on the handle: one place up or down among the items showing, taking the neighbour's time
function keyMoveEvent(ev, dir) {
  const rows = [...timelineEl.querySelectorAll(".ev[data-id]")].filter((r) => r.offsetParent);
  const i = rows.findIndex((r) => r.dataset.id === ev.id);
  const nb = rows[i + dir];
  if (i < 0 || !nb) return;
  placeEvent(ev.id, nb.dataset.id, dir > 0);
  timelineEl.querySelector(`.ev[data-id="${ev.id}"] .drag-handle`)?.focus();
}

function startEvDrag(e, ev, row) {
  if (e.button !== 0 || editingEv) return;
  e.preventDefault();
  const ghost = el("div", { className: "drag-ghost", textContent: `${ev.time} – ${ev.title}` });
  document.body.append(ghost);
  row.classList.add("dragging");
  document.body.classList.add("is-dragging");
  evDrag = { id: ev.id, row, ghost, line: el("div", { className: "ev-drop-line", "aria-hidden": "true" }), x: e.clientX, y: e.clientY, anchor: null };
  moveEvDrag(e);
  window.addEventListener("pointermove", moveEvDrag);
  window.addEventListener("pointerup", endEvDrag);
  window.addEventListener("pointercancel", cancelEvDrag);
  window.addEventListener("keydown", escEvDrag);
  evDrag.raf = requestAnimationFrame(autoScrollEv);
}

function moveEvDrag(e) {
  evDrag.x = e.clientX;
  evDrag.y = e.clientY;
  evDrag.ghost.style.transform = `translate(${evDrag.x + 14}px, ${evDrag.y - 16}px)`;
  locateEvDrop();
}

// the line goes above the card under the pointer (top half) or below it (bottom half); that card is the anchor
function locateEvDrop() {
  const under = document.elementFromPoint(evDrag.x, evDrag.y);
  if (!under || !timelineEl.contains(under)) {
    evDrag.line.remove();
    evDrag.anchor = null;
    return;
  }
  const row = under.closest(".ev[data-id]:not(.dragging)");
  if (!row) return;
  const r = row.getBoundingClientRect();
  const after = evDrag.y >= r.top + r.height / 2;
  after ? row.after(evDrag.line) : row.before(evDrag.line);
  evDrag.anchor = { id: row.dataset.id, after };
}

// scroll the page while dragging near the top (under the pinned bar) or bottom edge
function autoScrollEv() {
  if (!evDrag) return;
  const top = document.getElementById("pinned").getBoundingClientRect().bottom + 20;
  const bottom = innerHeight - 50;
  const speed = evDrag.y < top ? (evDrag.y - top) / 4 : evDrag.y > bottom ? (evDrag.y - bottom) / 4 : 0;
  if (speed) {
    scrollBy(0, Math.max(-20, Math.min(20, speed)));
    locateEvDrop();
  }
  evDrag.raf = requestAnimationFrame(autoScrollEv);
}

function stopEvDrag() {
  cancelAnimationFrame(evDrag.raf);
  evDrag.ghost.remove();
  evDrag.line.remove();
  evDrag.row.classList.remove("dragging");
  document.body.classList.remove("is-dragging");
  window.removeEventListener("pointermove", moveEvDrag);
  window.removeEventListener("pointerup", endEvDrag);
  window.removeEventListener("pointercancel", cancelEvDrag);
  window.removeEventListener("keydown", escEvDrag);
  evDrag = null;
}
function endEvDrag() {
  const { id, anchor, line } = evDrag;
  const dropped = line.isConnected && anchor;
  stopEvDrag();
  if (dropped) placeEvent(id, anchor.id, anchor.after);
  flushPending();
}
function cancelEvDrag() {
  stopEvDrag();
  flushPending();
}
const escEvDrag = (e) => e.key === "Escape" && cancelEvDrag();

/* =================================================
   EXPORT: the timeline as an Excel file (js/xlsx.js), for everyone or for one group
   ================================================= */
function exportDialog() {
  const choices = [{ key: "alles", label: "Alles" }, ...GROUPS].map((g) => {
    const n = g.key === "alles" ? events.length : events.filter((e) => groupsOf(e).includes(g.key)).length;
    const radio = el("input", { type: "radio", name: "export-group", value: g.key, checked: g.key === activeGroup, disabled: !n });
    const lab = el("label", { className: "opt export-choice" }, radio, el("span", { textContent: g.label }), el("span", { className: "n", textContent: n }));
    if (g.key !== "alles") lab.style.setProperty("--c", `var(--g-${g.key})`);
    return lab;
  });
  const close = () => ov.remove();
  const submit = (e) => {
    e.preventDefault();
    const key = ov.querySelector("input[name=export-group]:checked")?.value || "alles";
    downloadTimeline(key);
    close();
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
      { className: "modal-box login-form", role: "dialog", "aria-modal": "true", "aria-label": "Laai die tydlyn af", onsubmit: submit },
      el("h2", { textContent: "Laai die tydlyn af" }),
      el("p", { className: "export-hint", textContent: "Kies vir wie. 'n Groep kry net sy eie items en notas." }),
      el("div", { className: "export-choices", role: "radiogroup", "aria-label": "Groep" }, choices),
      el("div", { className: "form-actions" }, el("button", { type: "button", className: "btn", textContent: "Kanselleer", onclick: close }), el("button", { type: "submit", className: "btn primary", textContent: "Laai Excel af" })),
    ),
  );
  ov.addEventListener("keydown", (e) => e.key === "Escape" && close());
  document.body.append(ov);
  (ov.querySelector("input:checked") || ov.querySelector("input:not(:disabled)"))?.focus();
}

// one row per item: time, part of the day, what, groups, and the notes (only the chosen group's, for a group)
function downloadTimeline(key) {
  const g = key === "alles" ? null : G[key];
  const list = sortedEvents().filter((e) => !g || groupsOf(e).includes(key));
  const labels = (keys) => keys.filter((k) => G[k]).map((k) => G[k].label);
  const rows = list.map((e) => [
    e.time,
    dayPart(e.time),
    e.title,
    labels(groupsOf(e)).join(", "),
    g
      ? e.notes[key] || ""
      : Object.entries(e.notes)
          .filter(([k]) => G[k])
          .map(([k, text]) => `${G[k].label}: ${text}`)
          .join("\n"),
  ]);
  const name = g ? g.label : "Alles";
  const when = settings.date ? " · " + document.querySelector("#when span")?.textContent : "";
  const blob = makeXlsx({
    sheet: `Tydlyn ${name}`,
    title: `Tydlyn: ${name}${when}`,
    headers: ["Tyd", "Dagdeel", "Wat", "Groepe", g ? `Nota vir ${g.label}` : "Notas"],
    widths: [8, 10, 44, 28, 56],
    rows,
  });
  const a = el("a", { href: URL.createObjectURL(blob), download: `Tydlyn - ${name.replace(/[\\/:*?"<>|]/g, "")}.xlsx` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`${list.length} ${list.length === 1 ? "item" : "items"} afgelaai.`);
}
document.getElementById("exportBtn").addEventListener("click", exportDialog);

/* =================================================
   LIVE MODE: follows the clock on the wedding day
   ================================================= */
const liveEl = document.getElementById("live");
const liveToggle = document.getElementById("liveToggle");
const dateInput = document.getElementById("weddingDate");
let liveManual = store.get("troue.live", false);

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const isWeddingDay = () => !!settings.date && settings.date === todayISO();
const liveOn = () => isWeddingDay() || liveManual;

function renderSettings() {
  dateInput.value = settings.date || "";
  dateInput.disabled = !canEdit();
  liveToggle.checked = liveOn();
  liveToggle.disabled = isWeddingDay();
  liveToggle.parentElement.title = isWeddingDay() ? "Dis vandag die troudag, so lewendige modus is aan" : "Volg die horlosie op enige dag";
  renderWhen();
}

// under the names: the wedding date and a countdown
function renderWhen() {
  const when = document.getElementById("when");
  when.hidden = !settings.date;
  if (!settings.date) return;
  const [y, m, d] = settings.date.split("-").map(Number);
  const day = new Date(y, m - 1, d);
  const now = new Date();
  const days = Math.round((day - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
  const left = days > 1 ? `nog ${days} dae` : days === 1 ? "môre!" : days === 0 ? "vandag is die dag" : `${-days} dae getroud`;
  const date = day.toLocaleDateString("af-ZA", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  when.replaceChildren(el("span", { textContent: date }), el("span", { className: "left", textContent: left }));
}
dateInput.addEventListener("change", () => saveSettings({ date: dateInput.value || null }));
liveToggle.addEventListener("change", () => {
  liveManual = liveToggle.checked;
  store.set("troue.live", liveManual);
  applyLive();
});

function applyLive() {
  const on = liveOn();
  liveEl.hidden = !on;
  timelineEl.querySelector(".now-line")?.remove();
  timelineEl.querySelectorAll(".ev").forEach((r) => r.classList.remove("past", "current"));
  if (!on) return;

  const d = new Date();
  const now = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const nowMin = toMin(now);
  const list = sortedEvents().filter((e) => activeGroup === "alles" || groupsOf(e).includes(activeGroup));
  const current = [...list].reverse().find((e) => e.time <= now);
  const next = list.find((e) => e.time > now);

  // timeline: grey out what has passed, mark what is happening now, draw the "now" line
  const rows = [...timelineEl.querySelectorAll(".ev")].filter((r) => r.dataset.time);
  const curTime = sortedEvents().filter((e) => e.time <= now).pop()?.time;
  rows.forEach((r) => {
    r.classList.toggle("current", r.dataset.time === curTime);
    r.classList.toggle("past", r.dataset.time < now && r.dataset.time !== curTime);
  });
  const line = el("div", { className: "now-line", id: "nowLine" }, el("span", { className: "t", textContent: now }), el("span", { className: "dot" }), el("span", { className: "rule" }));
  const after = rows.find((r) => r.dataset.time > now);
  after ? after.before(line) : timelineEl.append(line);

  // banner
  document.getElementById("liveClock").textContent = now;
  const who = activeGroup === "alles" ? "" : ` vir ${G[activeGroup].label}`;
  const noteFor = (e) => (activeGroup !== "alles" && e.notes[activeGroup] ? el("div", { className: "note", textContent: e.notes[activeGroup] }) : null);
  const lines = [];
  if (current) lines.push(el("div", { className: "line" }, el("span", { className: "lbl", textContent: "Nou" }), el("b", { textContent: current.title }), ` · sedert ${current.time}`));
  if (next) {
    lines.push(el("div", { className: "line" }, el("span", { className: "lbl", textContent: "Volgende" + who }), el("b", { textContent: next.title }), ` om ${next.time} · `, el("span", { className: "soon", textContent: "oor " + fmtGap(toMin(next.time) - nowMin) })));
    lines.push(noteFor(next));
  } else if (list.length) lines.push(el("div", { className: "line", textContent: `Die program${who} is klaar vir vandag.` }));
  else lines.push(el("div", { className: "line", textContent: `Geen items${who} nie.` }));
  document.getElementById("liveLines").replaceChildren(...lines.filter(Boolean));
}
document.getElementById("jumpNow").addEventListener("click", () => {
  showPage("tydlyn");
  document.getElementById("nowLine")?.scrollIntoView({ behavior: "smooth", block: "center" });
});
setInterval(() => {
  applyLive();
  renderWhen(); // the countdown rolls over at midnight
}, 20000);

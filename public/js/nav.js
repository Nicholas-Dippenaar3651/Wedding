/* ---------------- search ---------------- */
let query = "";
// fold case and accents per character so positions line up with the original ("wereld" finds "wêreld")
const fold = (s) =>
  s
    .split("")
    .map((c) => c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()[0] || c)
    .join("");
const textMatches = (...texts) => !query || texts.some((t) => t && fold(t).includes(fold(query)));
const todoMatches = (t) => textMatches(t.text, ...t.who.map((k) => G[k]?.label));
const eventMatches = (e) => textMatches(e.title, e.time, ...Object.values(e.notes), ...groupsOf(e).map((k) => G[k]?.label));

// the text with each match wrapped in <mark>
function highlight(text) {
  if (!query) return text;
  const q = fold(query);
  const f = fold(text);
  const out = [];
  let i = 0,
    j;
  while ((j = f.indexOf(q, i)) !== -1) {
    if (j > i) out.push(text.slice(i, j));
    out.push(el("mark", { textContent: text.slice(j, j + q.length) }));
    i = j + q.length;
  }
  out.push(text.slice(i));
  return out;
}

const searchEl = document.getElementById("search");
function runSearch() {
  query = searchEl.value.trim();
  renderTodos();
  renderTimeline();
  renderBudget();
  document.getElementById("searchCount").textContent = query ? `${todos.filter(todoMatches).length} take · ${events.filter(eventMatches).length} tydlyn-items` : "";
}
searchEl.addEventListener("input", runSearch);
searchEl.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  searchEl.value = "";
  runSearch();
});
// "/" jumps to the search box when not typing somewhere else
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !e.target.closest("input, textarea, select, [contenteditable]")) {
    e.preventDefault();
    searchEl.focus();
  }
});

/* ---------------- page switching ---------------- */
let currentPage = "todo";
const pageBtns = document.querySelectorAll("nav.pages button");
function showPage(name) {
  if (!["todo", "tydlyn", "begroting"].includes(name)) name = "todo";
  // the budget is for signed-in editors only; the #begroting link is kept so signing in opens it (setEditor)
  const keepHash = name === "begroting" && !server.editor;
  if (keepHash) name = "todo";
  currentPage = name;
  document.body.dataset.page = name; // CSS shows .todo-only options on the list only
  pageBtns.forEach((b) => b.setAttribute("aria-selected", b.dataset.page === name));
  document.querySelectorAll(".page").forEach((p) => (p.hidden = p.id !== "page-" + name));
  // "Kies take" lives in the pinned bar but only belongs to the list
  pickBtn.hidden = name !== "todo";
  if (name !== "todo" && picking) setPicking(false);
  if (!keepHash && location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
  renderTabs();
}
pageBtns.forEach((b) => b.addEventListener("click", () => showPage(b.dataset.page)));
window.addEventListener("hashchange", () => showPage(location.hash.slice(1)));

/* ---------------- group bar (shared by both pages) ---------------- */
const tabsEl = document.getElementById("tabs");
const hideOthers = document.getElementById("hideOthers");
let activeGroup = "alles"; // the saved choice is restored once the groups arrive (applyRemote)
hideOthers.checked = store.get("troue.hideOthers", false);
const groupsOf = (ev) => [...new Set([...ev.who, ...Object.keys(ev.notes)])];

function renderTabs() {
  tabsEl.replaceChildren();
  const onTodo = currentPage === "todo";
  const count = (key) => (onTodo ? todos.filter((t) => t.who.includes(key)).length : events.filter((e) => groupsOf(e).includes(key)).length);
  // a group with nothing on this page is left out, unless it's the one selected
  const tabs = [{ key: "alles", label: "Alles", n: onTodo ? todos.length : events.length }, ...GROUPS.map((g) => ({ ...g, n: count(g.key) }))];
  tabs.filter((g) => g.key === "alles" || g.n || g.key === activeGroup).forEach((g) => {
    const av = el("span", { className: "av" }, g.key === "alles" ? icon("heart") : initials(g.label));
    const b = el("button", { className: "tab", role: "tab" }, av, el("span", { textContent: g.label }), el("span", { className: "n", textContent: g.n }));
    if (g.key !== "alles") b.style.setProperty("--c", `var(--g-${g.key})`);
    b.setAttribute("aria-selected", g.key === activeGroup);
    b.addEventListener("click", () => {
      activeGroup = g.key;
      store.set("troue.group", g.key);
      renderTabs();
      applyTodoFilter();
      applyFilter();
      applyLive();
    });
    tabsEl.append(b);
  });
  tabsEl.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

// a mouse wheel scrolls the group row sideways, until it reaches either end and the page takes over
tabsEl.addEventListener(
  "wheel",
  (e) => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? 0 : e.deltaY;
    const max = tabsEl.scrollWidth - tabsEl.clientWidth;
    if (!d || max <= 0 || (d < 0 && tabsEl.scrollLeft <= 0) || (d > 0 && tabsEl.scrollLeft >= max - 1)) return;
    e.preventDefault();
    tabsEl.scrollLeft += d;
  },
  { passive: false },
);

// the ⋯ menu closes when clicking anywhere else
const viewMenu = document.getElementById("viewMenu");
document.addEventListener("click", (e) => viewMenu.open && !viewMenu.contains(e.target) && (viewMenu.open = false));
viewMenu.addEventListener("keydown", (e) => e.key === "Escape" && (viewMenu.open = false));
hideOthers.addEventListener("change", () => {
  store.set("troue.hideOthers", hideOthers.checked);
  applyTodoFilter();
  applyFilter();
});

/* ---------------- manage groups (add / rename / recolour / reorder / delete) ---------------- */
const adminEl = document.getElementById("groupAdmin");
const manageBtn = document.getElementById("manageGroupsBtn");

function groupsChanged() {
  saveGroups();
  renderTabs();
  renderTodos();
  renderTimeline();
  renderGroupAdmin();
}

function renderGroupAdmin() {
  if (adminEl.hidden) return;
  adminEl.replaceChildren();
  GROUPS.forEach((g, i) => {
    const color = el("input", { type: "color", value: g.color, title: "Kleur", "aria-label": `Kleur vir ${g.label}` });
    color.addEventListener("input", () => {
      g.color = color.value;
      g.dark = null; // dark mode derives a lighter shade from the new colour
      applyGroups();
    });
    color.addEventListener("change", saveGroups);

    const name = el("input", { className: "name", value: g.label, "aria-label": "Groep naam", id: "gname-" + g.key });
    const rename = () => {
      const v = name.value.trim();
      if (!v) return (name.value = g.label);
      if (v === g.label) return;
      g.label = v;
      groupsChanged();
    };
    name.addEventListener("change", rename);
    name.addEventListener("keydown", (e) => e.key === "Enter" && name.blur());

    const nTodos = todos.filter((t) => t.who.includes(g.key)).length;
    const nEvents = events.filter((e) => groupsOf(e).includes(g.key)).length;
    const move = (d) => {
      [GROUPS[i], GROUPS[i + d]] = [GROUPS[i + d], GROUPS[i]];
      groupsChanged();
    };
    adminEl.append(
      el(
        "div",
        { className: "g-row" },
        color,
        name,
        el("span", { className: "uses", textContent: `${nTodos} take · ${nEvents} items` }),
        el(
          "span",
          { className: "move" },
          Object.assign(iconBtn("up", "Skuif op", () => move(-1)), { disabled: i === 0 }),
          Object.assign(iconBtn("down", "Skuif af", () => move(1)), { disabled: i === GROUPS.length - 1 }),
          iconBtn("x", "Verwyder", () => deleteGroup(g, nTodos, nEvents), "del"),
        ),
      ),
    );
  });

  // add a new group
  const newColor = el("input", { type: "color", value: NEW_GROUP_COLORS[GROUPS.length % NEW_GROUP_COLORS.length], "aria-label": "Kleur vir nuwe groep" });
  const newName = el("input", { className: "name", placeholder: "Nuwe groep, bv. Ouers", "aria-label": "Nuwe groep", id: "gname-new" });
  const add = () => {
    const label = newName.value.trim();
    if (!label) return newName.focus();
    GROUPS.push({ key: "g" + uid(), label, color: newColor.value, dark: null });
    groupsChanged();
    document.getElementById("gname-new")?.focus();
  };
  newName.addEventListener("keydown", (e) => e.key === "Enter" && add());
  adminEl.append(
    el("div", { className: "g-row new" }, newColor, newName, el("button", { className: "btn primary small", textContent: "Voeg by", onclick: add })),
    el("div", { className: "g-admin-foot" }, el("span", { textContent: "Veranderinge word dadelik gestoor." }), el("button", { className: "btn small", textContent: "Klaar", onclick: toggleGroupAdmin })),
  );
}

async function deleteGroup(g, nTodos, nEvents) {
  const uses = nTodos || nEvents ? ` Dit word ook van ${nTodos} take en ${nEvents} tydlyn-items afgehaal, en hul notas vir hierdie groep word verwyder.` : "";
  if (!(await ask(`Verwyder die groep "${g.label}"?${uses}`))) return;
  GROUPS = GROUPS.filter((x) => x.key !== g.key);
  todos = todos.map((t) => (t.who.includes(g.key) ? { ...t, who: t.who.filter((k) => k !== g.key) } : t));
  events = events.map((e) => {
    if (!groupsOf(e).includes(g.key)) return e;
    const { [g.key]: _, ...notes } = e.notes;
    return { ...e, who: e.who.filter((k) => k !== g.key), notes };
  });
  send({ op: "deleteGroup", key: g.key });
  if (activeGroup === g.key) {
    activeGroup = "alles";
    store.set("troue.group", "alles");
  }
  groupsChanged();
  applyLive();
}

function toggleGroupAdmin() {
  adminEl.hidden = !adminEl.hidden;
  manageBtn.setAttribute("aria-expanded", !adminEl.hidden);
  manageBtn.textContent = adminEl.hidden ? "Wysig groepe" : "Maak groepe toe";
  viewMenu.open = false;
  renderGroupAdmin();
  if (!adminEl.hidden) adminEl.scrollIntoView({ behavior: "smooth", block: "start" });
}
manageBtn.addEventListener("click", toggleGroupAdmin);

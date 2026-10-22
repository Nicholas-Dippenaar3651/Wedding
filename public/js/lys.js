/* =================================================
   TODO LIST (from "Wedding TODOs.docx")
   ================================================= */
let editing = null; // todo id being edited
let picking = false; // "Kies take" mode: rows are picked instead of edited
const picked = new Set(); // ids of the picked TODOs
const pickBtn = document.getElementById("pickBtn");
const bulkBar = document.getElementById("bulkBar");
const collapsed = store.get("troue.collapsed", {});
// per section: the groups picked for new tasks (once touched) and the text being typed, kept across re-renders
const addWho = {};
const addDraft = {};
const hideDone = document.getElementById("hideDone");
hideDone.checked = store.get("troue.hideDone", false);

function endTodoEdit() {
  editing = null;
  renderTodos();
}

function renderTodos() {
  const root = document.getElementById("sections");
  root.replaceChildren();
  let heading = null; // shown just before the first of its sections that is listed
  SECTIONS.forEach((sec) => {
    if (sec.heading) heading = sec.heading;
    const items = todos.filter((t) => t.section === sec.key).sort((a, b) => a.seq - b.seq);
    // open/close in place (no re-render) so the body can slide
    const toggle = () => {
      collapsed[sec.key] = !collapsed[sec.key];
      store.set("troue.collapsed", collapsed);
      secEl.classList.toggle("collapsed", collapsed[sec.key]);
      head.setAttribute("aria-expanded", !collapsed[sec.key]);
    };
    const head = el(
      "div",
      { className: "section-head", role: "button", tabIndex: 0, "aria-expanded": !(collapsed[sec.key] && !query), onclick: toggle },
      el("span", { className: "chev" }, icon("chevron")),
      el("h2", { textContent: sec.title }),
      el("span", { className: "count" }),
    );
    head.addEventListener("keydown", (e) => {
      if (e.target !== head || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      toggle();
    });
    head.querySelector(".count").dataset.section = sec.key;

    const list = el("ul", { className: "todos" });
    const visible = items.filter((i) => i.id === editing || (!(hideDone.checked && i.done) && todoMatches(i)));
    if (query && !visible.length) return; // searching: leave out sections with no matches
    visible.forEach((item) => list.append(renderItem(item)));

    const input = el("input", { placeholder: "Nuwe taak…", "aria-label": `Nuwe taak: ${sec.title}`, id: "add-" + sec.key, value: addDraft[sec.key] || "" });
    // who the new task is for: the selected group tab until these are changed, then whatever was picked
    const picks = GROUPS.map((g) => {
      const t = chipToggle(g, (addWho[sec.key] || (activeGroup === "alles" ? [] : [activeGroup])).includes(g.key));
      t.cb.value = g.key;
      t.cb.addEventListener("change", () => (addWho[sec.key] = picks.filter((p) => p.cb.checked).map((p) => p.cb.value)));
      return t;
    });
    const addBox = el("div", { className: "add" + (input.value ? " has-text" : "") });
    const add = () => {
      const text = input.value.trim();
      if (!text) return input.focus();
      addDraft[sec.key] = "";
      saveTodo({ id: uid(), section: sec.key, text, done: false, who: picks.filter((p) => p.cb.checked).map((p) => p.cb.value), seq: Math.max(-1, ...items.map((i) => i.seq)) + 1 });
      document.getElementById("add-" + sec.key)?.focus();
    };
    input.addEventListener("input", () => {
      addDraft[sec.key] = input.value;
      addBox.classList.toggle("has-text", !!input.value);
    });
    input.addEventListener("keydown", (e) => e.key === "Enter" && add());

    const emptyText = items.length ? "Alles klaar 🎉" : "Nog geen take nie. Voeg die eerste een hieronder by.";
    const addBtn = el("button", { className: "btn primary", "aria-label": `Voeg by: ${sec.title}`, onclick: add }, icon("plus"), el("span", { textContent: "Voeg by" }));
    // the extra inner wrapper lets the body slide open and closed (grid rows 0fr <-> 1fr)
    addBox.append(el("div", { className: "add-line" }, input, addBtn), picks.length ? el("div", { className: "add-groups", role: "group", "aria-label": "Vir wie is die nuwe taak?" }, el("span", { className: "add-label", textContent: "Vir" }), picks.map((p) => p.lab)) : null);
    addBox.dataset.section = sec.key;
    const inner = el("div", { className: "section-inner" }, visible.length ? list : el("div", { className: "empty", textContent: emptyText }), addBox);
    const secEl = el("div", { className: "section" + (collapsed[sec.key] && !query ? " collapsed" : "") }, head, el("div", { className: "section-body" }, inner));
    secEl.dataset.section = sec.key;
    if (heading) root.append(el("h2", { className: "period", id: "period-" + PERIODS.findIndex((p) => p.title === heading), textContent: heading }));
    heading = null;
    root.append(secEl);
  });
  if (query && !root.children.length) root.append(el("div", { className: "empty", textContent: `Geen take vir "${query}" nie.` }));
  document.getElementById("page-todo").classList.toggle("picking", picking);
  if (picking) {
    // drop picks that are no longer listed (deleted elsewhere, hidden as done, outside the search)
    const listed = new Set([...root.querySelectorAll("li[data-id]")].map((li) => li.dataset.id));
    picked.forEach((id) => listed.has(id) || picked.delete(id));
    renderBulkBar();
  }
  applyTodoFilter();
}

/* ---------------- bulk changes ("Kies take") ---------------- */
function setPicking(on) {
  picking = on;
  picked.clear();
  editing = null;
  pickBtn.setAttribute("aria-pressed", on);
  pickBtn.textContent = on ? "Klaar met kies" : "Kies take";
  bulkBar.hidden = !on;
  renderTodos();
}
pickBtn.addEventListener("click", () => setPicking(!picking));

function togglePick(id, on, li) {
  on ? picked.add(id) : picked.delete(id);
  li.classList.toggle("picked", on);
  renderBulkBar();
}

// everything on screen right now: not in a collapsed section or hidden by the group filter
function pickAllShown() {
  document.querySelectorAll("#sections li[data-id]").forEach((li) => li.offsetParent && !li.closest(".collapsed") && picked.add(li.dataset.id));
  renderTodos();
}

const nTake = (n) => (n === 1 ? "1 taak" : `${n} take`);

// store the changed TODOs and send them to the server as one change
function saveTodos(changed) {
  const before = Object.fromEntries(todos.map((t) => [t.id, JSON.stringify(t)]));
  const items = changed.filter((t) => JSON.stringify(t) !== before[t.id]);
  if (!items.length) return toast("Niks om te verander nie.");
  const byId = Object.fromEntries(items.map((t) => [t.id, t]));
  todos = todos.map((t) => byId[t.id] || t);
  send({ op: "bulk", kind: "todos", items });
  renderTodos();
  renderTabs();
  toast(`${nTake(items.length)} opgedateer.`);
}
const bulkEdit = (change) => saveTodos(todos.filter((t) => picked.has(t.id)).map(change));

// move to the end of a section, keeping their order
function bulkMove(sectionKey) {
  const order = (t) => SECTIONS.findIndex((s) => s.key === t.section);
  const moving = todos.filter((t) => picked.has(t.id)).sort((a, b) => order(a) - order(b) || a.seq - b.seq);
  let seq = Math.max(-1, ...todos.filter((t) => t.section === sectionKey && !picked.has(t.id)).map((t) => t.seq)) + 1;
  saveTodos(moving.map((t) => ({ ...t, section: sectionKey, seq: seq++ })));
}

async function bulkDelete() {
  if (!(await ask(`Verwyder ${nTake(picked.size)}?`))) return;
  const ids = [...picked];
  todos = todos.filter((t) => !picked.has(t.id));
  picked.clear();
  send({ op: "bulk", kind: "todos", deleted: ids });
  renderTodos();
  renderTabs();
  toast(`${nTake(ids.length)} verwyder.`);
}

function renderBulkBar() {
  if (bulkBar.hidden) return;
  const none = !picked.size;
  // a drop-down that runs `onpick` with the chosen value
  const menu = (label, options, onpick) => {
    const s = el("select", { disabled: none, "aria-label": label }, el("option", { value: "", textContent: label }), options.map(([value, text]) => el("option", { value, textContent: text })));
    s.addEventListener("change", () => s.value && onpick(s.value));
    return s;
  };
  const groups = GROUPS.map((g) => [g.key, g.label]);
  bulkBar.replaceChildren(
    el("span", { className: "n", textContent: `${nTake(picked.size)} gekies` }),
    el("button", { className: "btn small", textContent: "Kies alles", title: "Kies al die take wat nou wys", onclick: pickAllShown }),
    el("button", {
      className: "btn small",
      textContent: "Kies niks",
      disabled: none,
      onclick: () => {
        picked.clear();
        renderTodos();
      },
    }),
    el("span", { className: "sep" }),
    el("button", { className: "btn small", textContent: "Merk klaar", disabled: none, onclick: () => bulkEdit((t) => ({ ...t, done: true })) }),
    el("button", { className: "btn small", textContent: "Merk oop", disabled: none, onclick: () => bulkEdit((t) => ({ ...t, done: false })) }),
    menu("Voeg groep by…", groups, (k) => bulkEdit((t) => (t.who.includes(k) ? t : { ...t, who: [...t.who, k] }))),
    menu("Haal groep af…", groups, (k) => bulkEdit((t) => ({ ...t, who: t.who.filter((x) => x !== k) }))),
    menu("Skuif na…", SECTIONS.map((s) => [s.key, s.title]), bulkMove),
    el("button", { className: "btn small danger", textContent: "Verwyder", disabled: none, onclick: bulkDelete }),
  );
}

function renderItem(item) {
  const li = el("li", { className: item.done ? "done" : "" });
  li.dataset.who = item.who.join(" ");
  li.dataset.id = item.id;
  if (picking) {
    // the whole row picks; done is still shown by the strike-through
    const pick = el("input", { type: "checkbox", className: "pick", checked: picked.has(item.id), "aria-label": `Kies "${item.text}"` });
    pick.addEventListener("change", () => togglePick(item.id, pick.checked, li));
    li.addEventListener("click", (e) => {
      if (e.target === pick) return;
      pick.checked = !pick.checked;
      togglePick(item.id, pick.checked, li);
    });
    li.classList.toggle("picked", pick.checked);
    li.append(pick, el("span", { className: "body" }, el("span", { className: "text" }, highlight(item.text)), chipList(item.who)));
    return li;
  }
  const handle = el("button", { className: "drag-handle", type: "button", title: "Sleep om te skuif (of gebruik die pyltjie-sleutels)", "aria-label": `Skuif "${item.text}"` }, icon("grip"));
  handle.addEventListener("pointerdown", (e) => startDrag(e, item, li));
  handle.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    keyMove(item, e.key === "ArrowUp" ? -1 : 1);
  });
  const cb = el("input", { type: "checkbox", className: "tick", checked: item.done, disabled: !canEdit(), "aria-label": item.text });
  cb.addEventListener("change", () => saveTodo({ ...item, done: cb.checked }));
  li.append(handle, cb);

  if (editing === item.id) {
    li.classList.add("editing");
    li.replaceChildren(todoForm(item));
    return li;
  }
  const text = el("span", { className: "text", title: canEdit() ? "Dubbelklik om te wysig" : "" }, highlight(item.text));
  text.addEventListener("dblclick", () => {
    if (!canEdit()) return;
    editing = item.id;
    renderTodos();
  });
  li.append(
    el("span", { className: "body" }, text, chipList(item.who)),
    el(
      "span",
      { className: "actions" },
      iconBtn("pencil", "Wysig", () => {
        editing = item.id;
        renderTodos();
      }),
      iconBtn("x", "Verwyder", async () => (await ask(`Verwyder "${item.text}"?`)) && removeTodo(item.id), "del"),
    ),
  );
  return li;
}

function todoForm(item) {
  const input = el("input", { className: "edit", value: item.text, "aria-label": "Taak", id: "todo-edit" });
  const toggles = GROUPS.map((g) => ({ key: g.key, ...chipToggle(g, item.who.includes(g.key)) }));
  const save = () => {
    const text = input.value.trim();
    if (!text) return input.focus();
    editing = null;
    saveTodo({ ...item, text, who: toggles.filter((t) => t.cb.checked).map((t) => t.key) });
  };
  const form = el(
    "form",
    {
      className: "todo-form",
      onsubmit: (e) => {
        e.preventDefault();
        save();
      },
    },
    el("div", { className: "form-line" }, input),
    el("div", { className: "alloc-head u-mt-2", textContent: "Wie doen dit?" }),
    el(
      "div",
      { className: "chips" },
      toggles.map((t) => t.lab),
    ),
    el("div", { className: "form-actions" }, el("button", { type: "button", className: "btn", textContent: "Kanselleer", onclick: endTodoEdit }), el("button", { type: "submit", className: "btn primary", textContent: "Stoor" })),
  );
  form.addEventListener("keydown", (e) => e.key === "Escape" && endTodoEdit());
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
  return form;
}

function applyTodoFilter() {
  const page = document.getElementById("page-todo");
  const on = activeGroup !== "alles";
  page.classList.toggle("filtered", on);
  page.classList.toggle("hide-others", on && hideOthers.checked);
  page.querySelectorAll("ul.todos li").forEach((li) => {
    li.classList.toggle("hit", on && li.dataset.who.split(" ").includes(activeGroup));
    li.style.setProperty("--c", on ? `var(--g-${activeGroup})` : "var(--line)");
  });
  // counts follow the selected group
  const mine = (t) => !on || t.who.includes(activeGroup);
  document.querySelectorAll(".section-head .count").forEach((c) => {
    const items = todos.filter((t) => t.section === c.dataset.section && mine(t));
    const done = items.filter((t) => t.done).length;
    c.replaceChildren(ring(done, items.length, true), `${done}/${items.length}`);
  });
  renderTodoOverview(todos.filter(mine), on);
  // new-task chips that haven't been touched follow the selected group tab
  document.querySelectorAll(".add[data-section]").forEach((box) => {
    if (addWho[box.dataset.section]) return;
    box.querySelectorAll(".add-groups input").forEach((cb) => (cb.checked = cb.value === activeGroup));
  });
}

// top of the page: overall progress, then one ring per heading that jumps to it
function renderTodoOverview(rel, on) {
  const done = rel.filter((t) => t.done).length;
  const periods = PERIODS.filter((p) => p.title).map((p) => {
    const items = rel.filter((t) => p.keys.includes(t.section));
    const d = items.filter((t) => t.done).length;
    const go = () => document.getElementById("period-" + PERIODS.indexOf(p))?.scrollIntoView({ behavior: "smooth", block: "start" });
    return el("button", { type: "button", className: "ov-period", title: `Gaan na ${p.title}`, onclick: go }, ring(d, items.length, true), el("span", { className: "ov-name", textContent: p.title }), el("span", { className: "ov-n", textContent: `${d}/${items.length}` }));
  });
  // filter(Boolean): replaceChildren() would print "null" when there are no periods
  const parts = [
    el("div", { className: "ov-main" }, ring(done, rel.length), el("div", {}, el("div", { className: "ov-big", textContent: `${done} van ${rel.length}` }), el("div", { className: "ov-sub", textContent: on ? `take klaar vir ${G[activeGroup].label}` : "take klaar" }))),
    periods.length ? el("div", { className: "ov-periods" }, periods) : null,
  ];
  document.getElementById("todoOverview").replaceChildren(...parts.filter(Boolean));
}

hideDone.addEventListener("change", () => {
  store.set("troue.hideDone", hideDone.checked);
  renderTodos();
});

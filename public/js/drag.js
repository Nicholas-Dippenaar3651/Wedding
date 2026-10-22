/* ---------------- drag and drop: reorder TODOs and move them between sections ---------------- */
let drag = null; // { id, li, ghost, line, x, y, target, raf }
const bySeq = (a, b) => a.seq - b.seq;

// put `id` in section `sectionKey`, just before `beforeId` (or at the end), and renumber that section
function moveTodo(id, sectionKey, beforeId) {
  const item = todos.find((t) => t.id === id);
  if (!item) return;
  const list = todos.filter((t) => t.section === sectionKey && t.id !== id).sort(bySeq);
  const at = beforeId ? list.findIndex((t) => t.id === beforeId) : -1;
  list.splice(at < 0 ? list.length : at, 0, item);
  const changes = list.map((t, i) => ({ id: t.id, section: sectionKey, seq: i })).filter((c, i) => list[i].seq !== c.seq || list[i].section !== sectionKey);
  if (!changes.length) return;
  const byId = Object.fromEntries(changes.map((c) => [c.id, c]));
  todos = todos.map((t) => (byId[t.id] ? { ...t, section: sectionKey, seq: byId[t.id].seq } : t));
  send({ op: "reorder", kind: "todos", items: changes });
  renderTodos();
}

// keyboard: arrow keys on the handle move one place, crossing into the next or previous section
function keyMove(item, dir) {
  const s = SECTIONS.findIndex((x) => x.key === item.section);
  const list = todos.filter((t) => t.section === item.section).sort(bySeq);
  const i = list.findIndex((t) => t.id === item.id);
  if (dir < 0 && i > 0) moveTodo(item.id, item.section, list[i - 1].id);
  else if (dir > 0 && i < list.length - 1) moveTodo(item.id, item.section, list[i + 2]?.id || null);
  else if (dir < 0 && s > 0) moveTodo(item.id, SECTIONS[s - 1].key, null);
  else if (dir > 0 && s >= 0 && s < SECTIONS.length - 1) moveTodo(item.id, SECTIONS[s + 1].key, todos.filter((t) => t.section === SECTIONS[s + 1].key).sort(bySeq)[0]?.id || null);
  document.querySelector(`li[data-id="${item.id}"] .drag-handle`)?.focus();
}

function startDrag(e, item, li) {
  if (e.button !== 0 || editing) return;
  e.preventDefault();
  const ghost = el("div", { className: "drag-ghost", textContent: item.text });
  document.body.append(ghost);
  li.classList.add("dragging");
  document.body.classList.add("is-dragging");
  drag = { id: item.id, li, ghost, line: el("li", { className: "drop-line", "aria-hidden": "true" }), x: e.clientX, y: e.clientY, target: null };
  moveDrag(e);
  window.addEventListener("pointermove", moveDrag);
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", cancelDrag);
  window.addEventListener("keydown", escDrag);
  drag.raf = requestAnimationFrame(autoScroll);
}

function moveDrag(e) {
  drag.x = e.clientX;
  drag.y = e.clientY;
  drag.ghost.style.transform = `translate(${drag.x + 14}px, ${drag.y - 16}px)`;
  locateDrop();
}

// show where the item will land: a line between items, and the target section outlined
function locateDrop() {
  const under = document.elementFromPoint(drag.x, drag.y);
  const section = under?.closest(".section");
  document.querySelectorAll(".section.drop-target").forEach((s) => s !== section && s.classList.remove("drop-target"));
  if (!section) {
    drag.line.remove();
    drag.target = null;
    return;
  }
  section.classList.add("drop-target");
  drag.target = section.dataset.section;
  const li = under.closest("ul.todos > li:not(.dragging):not(.drop-line)");
  if (li) {
    const r = li.getBoundingClientRect();
    drag.y < r.top + r.height / 2 ? li.before(drag.line) : li.after(drag.line);
  } else if (drag.line.closest(".section") !== section) {
    let list = section.querySelector("ul.todos");
    if (!list) section.querySelector(".section-inner").prepend((list = el("ul", { className: "todos" })));
    list.append(drag.line);
  }
}

// scroll the page while dragging near the top (under the pinned bar) or bottom edge
function autoScroll() {
  if (!drag) return;
  const top = document.getElementById("pinned").getBoundingClientRect().bottom + 20;
  const bottom = innerHeight - 50;
  const speed = drag.y < top ? (drag.y - top) / 4 : drag.y > bottom ? (drag.y - bottom) / 4 : 0;
  if (speed) {
    scrollBy(0, Math.max(-20, Math.min(20, speed)));
    locateDrop();
  }
  drag.raf = requestAnimationFrame(autoScroll);
}

function stopDrag() {
  cancelAnimationFrame(drag.raf);
  drag.ghost.remove();
  drag.line.remove();
  drag.li.classList.remove("dragging");
  document.body.classList.remove("is-dragging");
  document.querySelectorAll(".section.drop-target").forEach((s) => s.classList.remove("drop-target"));
  window.removeEventListener("pointermove", moveDrag);
  window.removeEventListener("pointerup", endDrag);
  window.removeEventListener("pointercancel", cancelDrag);
  window.removeEventListener("keydown", escDrag);
  drag = null;
}
function endDrag() {
  const { id, target, line } = drag;
  let next = line.isConnected ? line.nextElementSibling : null;
  while (next && next.classList.contains("dragging")) next = next.nextElementSibling;
  const beforeId = next?.dataset.id || null;
  stopDrag();
  if (target) moveTodo(id, target, beforeId);
  flushPending();
}
function cancelDrag() {
  stopDrag();
  flushPending();
}
const escDrag = (e) => e.key === "Escape" && cancelDrag();

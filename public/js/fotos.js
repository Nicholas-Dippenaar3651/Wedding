/* =================================================
   FOTOS: the photos to take, in the order they are taken
   Everyone can see the list and tick photos off as taken; signing in is needed to add, change or reorder them.
   ================================================= */
const photoListEl = document.getElementById("photoList");
let editingPhoto = null; // photo id being edited, or "new"
let photoDrag = null; // { id, row, ghost, line, x, y, raf } while a photo is being dragged
const sortedPhotos = () => [...photos].sort((a, b) => a.seq - b.seq);
// each photo's moment as shown: one without its own moment falls under the heading above it
const shownMoments = (list) => {
  let w = "";
  return list.map((p) => (w = p.when || w));
};

function endPhotoEdit() {
  editingPhoto = null;
  renderPhotos();
  flushPending();
}

function renderPhotos() {
  photoListEl.replaceChildren();
  const list = sortedPhotos();
  const moments = shownMoments(list);
  list.forEach((p, i) => {
    // a soft label where a new moment starts, like "Na die seremonie"
    if (moments[i] && moments[i] !== moments[i - 1]) photoListEl.append(el("div", { className: "daypart photo-when", textContent: moments[i] }));
    const row = photoRow(i + 1, editingPhoto === p.id ? photoForm(p, false) : photoCard(p));
    row.dataset.id = p.id;
    row.dataset.when = moments[i];
    photoListEl.append(row);
  });
  if (editingPhoto === "new") {
    const seq = list.length ? list.at(-1).seq + 1 : 0;
    photoListEl.append(photoRow(list.length + 1, photoForm({ id: uid(), when: list.at(-1)?.when || "", title: "", people: "", note: "", done: false, seq }, true)));
  }
  if (!list.length && editingPhoto !== "new") photoListEl.append(el("div", { className: "empty", textContent: canEdit() ? "Nog geen foto's nie. Kies Nuwe foto om te begin." : "Nog geen foto's nie." }));
  renderPhotoOverview(list);
  const first = photoListEl.querySelector(".photo-form input");
  if (first) {
    first.focus();
    first.closest(".photo").scrollIntoView({ block: "nearest" });
  }
}

function photoRow(n, card) {
  return el("div", { className: "photo" + (card.classList.contains("photo-form") ? " editing" : "") }, el("div", { className: "num", textContent: n }), card);
}

function photoCard(p) {
  // anyone may tick a photo off as taken, signed in or not (the photographer on the day)
  const cb = el("input", { type: "checkbox", className: "tick", checked: p.done, "aria-label": `${p.title}: geneem` });
  cb.addEventListener("change", () => setPhotoDone(p.id, cb.checked));
  // drag to reorder, or use the arrow keys on it (hidden until signed in, like the list's handles)
  const handle = el("button", { className: "drag-handle", type: "button", title: "Sleep om te skuif (of gebruik die pyltjie-sleutels)", "aria-label": `Skuif "${p.title}"` }, icon("grip"));
  handle.addEventListener("pointerdown", (e) => startPhotoDrag(e, p, handle.closest(".photo")));
  handle.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    keyMovePhoto(p, e.key === "ArrowUp" ? -1 : 1);
  });
  return el(
    "div",
    { className: "card" + (p.done ? " done" : "") },
    el(
      "div",
      { className: "card-top" },
      handle,
      cb,
      el("div", { className: "title", textContent: p.title }),
      el(
        "span",
        { className: "photo-actions actions" },
        iconBtn("pencil", "Wysig", () => {
          editingPhoto = p.id;
          renderPhotos();
        }),
        iconBtn("x", "Verwyder", async () => (await ask(`Verwyder "${p.title}"?`)) && removePhoto(p.id), "del"),
      ),
    ),
    p.people ? el("div", { className: "people" }, el("b", { textContent: "Wie: " }), p.people) : null,
    p.note ? el("div", { className: "note", textContent: p.note }) : null,
  );
}

function photoForm(p, isNew) {
  // earlier moments are offered as suggestions, so the same moment is spelled the same way
  const moments = el("datalist", { id: "photoMoments" }, [...new Set(photos.map((x) => x.when).filter(Boolean))].map((w) => el("option", { value: w })));
  const when = el("input", { className: "edit when-input", value: p.when, placeholder: "Wanneer? bv. Na die seremonie", "aria-label": "Wanneer", id: "photo-when" });
  when.setAttribute("list", "photoMoments");
  const title = el("input", { className: "edit", value: p.title, placeholder: "Watter foto? bv. Bruidspaar met ouers", "aria-label": "Foto", id: "photo-title" });
  const people = el("input", { className: "edit", value: p.people, placeholder: "Wie moet op die foto wees? (opsioneel)", "aria-label": "Wie", id: "photo-people" });
  const note = el("input", { className: "edit", value: p.note, placeholder: "Nota, bv. plek of pose (opsioneel)", "aria-label": "Nota", id: "photo-note" });

  const save = () => {
    if (!title.value.trim()) return title.focus();
    editingPhoto = null;
    savePhoto({ ...p, when: when.value.trim(), title: title.value.trim(), people: people.value.trim(), note: note.value.trim() });
  };

  const form = el(
    "form",
    {
      className: "card photo-form",
      onsubmit: (e) => {
        e.preventDefault();
        save();
      },
    },
    el("div", { className: "form-line" }, when, title),
    el("div", { className: "form-line" }, people),
    el("div", { className: "form-line" }, note),
    moments,
    el("div", { className: "form-actions" }, el("button", { type: "button", className: "btn", textContent: "Kanselleer", onclick: endPhotoEdit }), el("button", { type: "submit", className: "btn primary", textContent: isNew ? "Voeg by" : "Stoor" })),
  );
  form.addEventListener("keydown", (e) => e.key === "Escape" && endPhotoEdit());
  return form;
}

/* ---------------- reordering: drag and drop, or arrow keys on the handle ---------------- */
// put photo `id` just before `beforeId` (or at the end) and, when `when` is given, into that moment;
// then number the whole list 0, 1, 2… so positions never tie
function placePhoto(id, beforeId, when) {
  const item = photos.find((p) => p.id === id);
  if (!item) return;
  const old = sortedPhotos();
  const list = old.filter((p) => p.id !== id);
  const at = beforeId ? list.findIndex((p) => p.id === beforeId) : -1;
  const moved = when && when !== item.when ? { ...item, when } : item;
  list.splice(at < 0 ? list.length : at, 0, moved);
  if (moved === item && list.every((p, k) => p === old[k])) return;
  photos = list.map((p, k) => (p.seq === k ? p : { ...p, seq: k }));
  // a new moment is a change to the photo itself; the order goes as one reorder for the whole list
  if (moved !== item) send({ op: "upsert", kind: "photos", item: photos.find((p) => p.id === id) });
  send({ op: "reorder", kind: "photos", items: photos.map((p) => ({ id: p.id, seq: p.seq })) });
  renderPhotos();
}

// arrow keys: one place up or down. Next to a moment heading, the first press only moves the photo
// across the heading into that moment; the next press moves it past the photo there
function keyMovePhoto(p, dir) {
  const list = sortedPhotos();
  const moments = shownMoments(list);
  const i = list.findIndex((x) => x.id === p.id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  if (moments[j] && moments[j] !== moments[i]) placePhoto(p.id, list[i + 1]?.id || null, moments[j]);
  else placePhoto(p.id, dir < 0 ? list[j].id : list[j + 1]?.id || null);
  photoListEl.querySelector(`.photo[data-id="${p.id}"] .drag-handle`)?.focus();
}

function startPhotoDrag(e, p, row) {
  if (e.button !== 0 || editingPhoto) return;
  e.preventDefault();
  const ghost = el("div", { className: "drag-ghost", textContent: p.title });
  document.body.append(ghost);
  row.classList.add("dragging");
  document.body.classList.add("is-dragging");
  photoDrag = { id: p.id, row, ghost, line: el("div", { className: "photo-drop-line", "aria-hidden": "true" }), x: e.clientX, y: e.clientY };
  movePhotoDrag(e);
  window.addEventListener("pointermove", movePhotoDrag);
  window.addEventListener("pointerup", endPhotoDrag);
  window.addEventListener("pointercancel", cancelPhotoDrag);
  window.addEventListener("keydown", escPhotoDrag);
  photoDrag.raf = requestAnimationFrame(autoScrollPhotos);
}

function movePhotoDrag(e) {
  photoDrag.x = e.clientX;
  photoDrag.y = e.clientY;
  photoDrag.ghost.style.transform = `translate(${photoDrag.x + 14}px, ${photoDrag.y - 16}px)`;
  locatePhotoDrop();
}

// show where the photo will land: a line between photos, or just under a moment heading
function locatePhotoDrop() {
  const under = document.elementFromPoint(photoDrag.x, photoDrag.y);
  if (!under || !photoListEl.contains(under)) return photoDrag.line.remove();
  const row = under.closest(".photo:not(.dragging)");
  const heading = under.closest(".photo-when");
  if (row) {
    const r = row.getBoundingClientRect();
    photoDrag.y < r.top + r.height / 2 ? row.before(photoDrag.line) : row.after(photoDrag.line);
  } else if (heading) heading.after(photoDrag.line);
}

// scroll the page while dragging near the top or bottom edge
function autoScrollPhotos() {
  if (!photoDrag) return;
  const top = 80;
  const bottom = innerHeight - 80;
  const speed = photoDrag.y < top ? (photoDrag.y - top) / 4 : photoDrag.y > bottom ? (photoDrag.y - bottom) / 4 : 0;
  if (speed) {
    scrollBy(0, Math.max(-20, Math.min(20, speed)));
    locatePhotoDrop();
  }
  photoDrag.raf = requestAnimationFrame(autoScrollPhotos);
}

function stopPhotoDrag() {
  cancelAnimationFrame(photoDrag.raf);
  photoDrag.ghost.remove();
  photoDrag.line.remove();
  photoDrag.row.classList.remove("dragging");
  document.body.classList.remove("is-dragging");
  window.removeEventListener("pointermove", movePhotoDrag);
  window.removeEventListener("pointerup", endPhotoDrag);
  window.removeEventListener("pointercancel", cancelPhotoDrag);
  window.removeEventListener("keydown", escPhotoDrag);
  photoDrag = null;
}
function endPhotoDrag() {
  const { id, line } = photoDrag;
  if (!line.isConnected) return cancelPhotoDrag();
  // the photo after the line keeps its place behind the dropped one
  let next = line.nextElementSibling;
  while (next && !(next.classList.contains("photo") && !next.classList.contains("dragging"))) next = next.nextElementSibling;
  // what is just above the line decides the moment: a heading, or the photo there
  let prev = line.previousElementSibling;
  while (prev?.classList.contains("dragging")) prev = prev.previousElementSibling;
  const when = prev?.classList.contains("photo-when") ? prev.textContent : prev?.dataset.when;
  stopPhotoDrag();
  placePhoto(id, next?.dataset.id || null, when);
  flushPending();
}
function cancelPhotoDrag() {
  stopPhotoDrag();
  flushPending();
}
const escPhotoDrag = (e) => e.key === "Escape" && cancelPhotoDrag();

// top of the page: how many photos have been taken
function renderPhotoOverview(list) {
  const done = list.filter((p) => p.done).length;
  const moments = new Set(list.map((p) => p.when).filter(Boolean)).size;
  document
    .getElementById("photoOverview")
    .replaceChildren(
      el("div", { className: "ov-main" }, ring(done, list.length), el("div", {}, el("div", { className: "ov-big", textContent: `${done} van ${list.length}` }), el("div", { className: "ov-sub", textContent: "foto's geneem" }))),
      el("div", { className: "stat" }, el("b", { textContent: moments }), el("span", { textContent: moments === 1 ? "oomblik" : "oomblikke" })),
    );
}

document.getElementById("addPhotoBtn").addEventListener("click", () => {
  editingPhoto = "new";
  renderPhotos();
});

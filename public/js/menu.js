// the MENU button and the panel on the right (styles in css/menu.css), on the landing page and the planner
(function () {
  const btn = document.getElementById("siteMenuBtn");
  const menu = document.getElementById("siteMenu");
  const close = document.getElementById("siteMenuClose");
  function setOpen(open) {
    document.body.classList.toggle("menu-open", open);
    btn.setAttribute("aria-expanded", open);
    if (open) close.focus();
    else if (menu.contains(document.activeElement)) btn.focus();
  }
  btn.addEventListener("click", () => setOpen(true));
  close.addEventListener("click", () => setOpen(false));
  document.getElementById("siteScrim").addEventListener("click", () => setOpen(false));
  // following a link closes the panel; the theme buttons don't
  menu.addEventListener("click", (e) => {
    if (e.target.closest("a")) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("menu-open")) setOpen(false);
  });
  // landing page: items marked data-editor-only (Begroting) start hidden and only show for signed-in
  // editors. The planner uses class="edit-only" instead, which follows signing in and out live.
  const editorOnly = document.querySelectorAll("[data-editor-only]");
  if (editorOnly.length) {
    fetch("/api/session")
      .then((r) => (r.ok ? r.json() : { editor: false }))
      .then((s) => editorOnly.forEach((li) => (li.hidden = !s.editor)))
      .catch(() => {});
  }
})();

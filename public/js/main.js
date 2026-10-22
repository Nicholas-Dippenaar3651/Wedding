/* ---------------- init ---------------- */
// shadow under the pinned bar once it sticks to the top
new IntersectionObserver(([e]) => document.getElementById("pinned").classList.toggle("stuck", !e.isIntersecting)).observe(document.getElementById("pinSentinel"));
showPage(location.hash.slice(1));
renderSettings();
renderTodos();
renderTimeline();
// the page starts read-only (body.readonly) until the server says who is signed in
connectServer();

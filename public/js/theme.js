// apply the saved theme before first paint so the page doesn't flash
try {
  const t = JSON.parse(localStorage.getItem("troue.theme"));
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch {}

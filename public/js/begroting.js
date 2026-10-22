/* =================================================
   BEGROTING (budget): reminders still to pay, and the payment history.
   Signed-in editors only: the server never sends `budget` to anyone else.
   Every card has its own budget and is compared on its own (budget vs. outstanding or paid).
   A card's ref ties the parts of one expense together (a deposit in the history and the
   balance still due); paying part of a reminder splits its budget between the two.
   ================================================= */
const dueCards = document.getElementById("dueCards");
const paidCards = document.getElementById("paidCards");
const paidZone = document.getElementById("paidZone");

const randFmt = new Intl.NumberFormat("af-ZA", { style: "currency", currency: "ZAR", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const R = (n) => randFmt.format(n || 0);
const cents = (n) => Math.round(n * 100) / 100;

// whole days from today to an ISO date (negative: in the past)
function daysUntil(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const now = new Date();
  return Math.round((new Date(y, m - 1, d) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
}

// how many cards each expense (ref) has: more than one means it is being paid in parts
function partCounts() {
  const by = {};
  budget.items.forEach((b) => (by[b.ref] = (by[b.ref] || 0) + 1));
  return by;
}

function renderBudget() {
  const overview = document.getElementById("budgetOverview");
  if (!budget) {
    dueCards.replaceChildren();
    paidCards.replaceChildren();
    overview.replaceChildren();
    return;
  }
  const parts = partCounts();
  // no search here (the search bar is hidden on this tab), so a search left over from another tab is ignored
  const shown = budget.items;
  // reminders: soonest due date first, the ones without a date last
  const due = shown.filter((b) => b.kind === "due").sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || a.seq - b.seq);
  // history: newest first
  const paid = shown.filter((b) => b.kind === "paid").sort((a, b) => b.seq - a.seq);
  const empty = (text) => el("div", { className: "empty", textContent: text });
  dueCards.replaceChildren(...(due.length ? due.map((b) => budgetCard(b, parts[b.ref] > 1)) : [empty("Alles is betaal 🎉")]));
  paidCards.replaceChildren(...(paid.length ? paid.map((b) => budgetCard(b, parts[b.ref] > 1)) : [empty("Nog niks betaal nie.")]));
  renderBudgetOverview(overview);
}

function renderBudgetOverview(box) {
  const sum = (kind, field = "amount") => cents(budget.items.filter((b) => !kind || b.kind === kind).reduce((s, b) => s + b[field], 0));
  const paid = sum("paid");
  const due = sum("due");
  const planned = sum(null, "budget");
  const total = budget.total;
  const left = cents(total - paid - due);
  const stat = (value, label, cls = "") => el("div", { className: "stat " + cls }, el("b", { textContent: value }), el("span", { textContent: label }));
  // the bar: paid and still due, as parts of the total budget (or of the cost, if that is more)
  const base = Math.max(total, paid + due) || 1;
  const bar = el("div", { className: "bbar", role: "img", "aria-label": `${Math.round((paid / base) * 100)}% betaal, ${Math.round((due / base) * 100)}% nog uitstaande` }, el("span", { className: "paid" }), el("span", { className: "due" }));
  bar.children[0].style.width = (paid / base) * 100 + "%";
  bar.children[1].style.width = (due / base) * 100 + "%";
  const totalBtn = el("button", { type: "button", className: "stat stat-btn", title: "Wysig die totale begroting", onclick: editTotal }, el("b", { textContent: R(total) }), el("span", {}, "totale begroting ", icon("pencil")));
  // filter(Boolean): replaceChildren() would print "null" for the note when it isn't needed
  const parts = [
    el("div", { className: "stat-for", textContent: "Begroting" }),
    totalBtn,
    stat(R(paid), "betaal", "k-paid"),
    stat(R(due), "nog uitstaande", "k-due"),
    stat(R(Math.abs(left)), left < 0 ? "oor die begroting" : "nog beskikbaar", left < 0 ? "warn" : "good"),
    bar,
    planned > total && total > 0 ? el("p", { className: "bnote", textContent: `Die items is saam vir ${R(planned)} begroot: ${R(cents(planned - total))} meer as die totale begroting.` }) : null,
  ];
  box.replaceChildren(...parts.filter(Boolean));
}

function budgetCard(b, inParts) {
  const isDue = b.kind === "due";
  const card = el("article", { className: "bcard " + b.kind });
  card.dataset.id = b.id;

  const meta = [];
  if (isDue && b.due) {
    const n = daysUntil(b.due);
    const when = n < 0 ? `${-n} dae agterstallig` : n === 0 ? "vandag" : n === 1 ? "môre" : `oor ${n} dae`;
    const date = new Date(b.due + "T00:00").toLocaleDateString("af-ZA", { weekday: "short", day: "numeric", month: "short" });
    meta.push(el("span", { className: "bdue" + (n < 0 ? " late" : n <= 14 ? " soon" : "") }, el("b", { textContent: date }), ` · ${when}`));
  } else if (isDue) meta.push(el("span", { className: "bdue none", textContent: "Geen betaaldatum nie" }));
  if (b.budget) meta.push(el("span", { textContent: `Begroting ${R(b.budget)}` }));
  if (inParts) meta.push(el("span", { className: "bpart", textContent: isDue ? "Res van 'n deel-betaling" : "Deel-betaling" }));

  // over/under for this card: its budget against what is outstanding (reminder) or was paid (history)
  let diff = null;
  if (b.budget > 0) {
    const d = cents(b.budget - b.amount);
    diff = el("span", { className: "bdiff " + (d < 0 ? "over" : d > 0 ? "under" : "even"), textContent: d < 0 ? `${R(-d)} oor` : d > 0 ? `${R(d)} onder` : "Op begroting" });
    diff.title = `Begroot ${R(b.budget)}, ${isDue ? "uitstaande" : "betaal"} ${R(b.amount)}`;
  }

  // only the parts that have something to show (append() would print "null" for the rest)
  const parts = [
    el(
      "div",
      { className: "bcard-top" },
      el("h3", { textContent: b.title }),
      el(
        "span",
        { className: "actions" },
        iconBtn("pencil", "Wysig", () => editBudgetItem(b)),
        iconBtn("x", "Verwyder", async () => (await ask(`Verwyder "${b.title}"?`)) && removeBudgetItem(b.id), "del"),
      ),
    ),
    el("div", { className: "bcard-amount" }, el("b", { textContent: R(b.amount) }), el("span", { textContent: isDue ? "uitstaande" : "betaal" }), diff),
    meta.length ? el("div", { className: "bmeta" }, meta) : null,
    isDue ? el("button", { type: "button", className: "btn small primary bpay", onclick: () => payDialog(b) }, icon("check"), el("span", { textContent: "Betaal" })) : null,
  ];
  card.append(...parts.filter(Boolean));

  // reminders can be dragged onto the payment history
  if (isDue && canEdit()) {
    card.draggable = true;
    card.title = "Sleep na Betalingsgeskiedenis sodra dit betaal is";
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", b.id);
      e.dataTransfer.effectAllowed = "move";
      card.classList.add("dragging");
      document.body.classList.add("bdragging");
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      document.body.classList.remove("bdragging");
      paidZone.classList.remove("over");
      flushPending();
    });
  }
  return card;
}

paidZone.addEventListener("dragover", (e) => {
  if (!document.body.classList.contains("bdragging")) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  paidZone.classList.add("over");
});
paidZone.addEventListener("dragleave", (e) => !paidZone.contains(e.relatedTarget) && paidZone.classList.remove("over"));
paidZone.addEventListener("drop", (e) => {
  e.preventDefault();
  paidZone.classList.remove("over");
  const item = budget?.items.find((b) => b.id === e.dataTransfer.getData("text/plain"));
  if (item?.kind === "due") payDialog(item);
});

/* ---------------- saving ---------------- */
// put changed/new cards (and drop deleted ones) locally, then send it as one change
function saveBudget(items, deleted = []) {
  const byId = Object.fromEntries(items.map((b) => [b.id, b]));
  budget.items = budget.items.filter((b) => !deleted.includes(b.id)).map((b) => byId[b.id] || b);
  items.forEach((b) => budget.items.some((x) => x.id === b.id) || budget.items.push(b));
  send(items.length === 1 && !deleted.length ? { op: "upsert", kind: "budget", item: items[0] } : { op: "bulk", kind: "budget", items, deleted });
  renderBudget();
}
function removeBudgetItem(id) {
  budget.items = budget.items.filter((b) => b.id !== id);
  send({ op: "delete", kind: "budget", id });
  renderBudget();
}

/* ---------------- dialogs ---------------- */
// a small form in a modal; resolves with { name: value } or null when cancelled
function formDialog({ title, fields, submitLabel = "Stoor", note }) {
  return new Promise((resolve) => {
    const inputs = {};
    const values = () => Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.type === "number" ? (i.value === "" ? 0 : cents(Number(i.value))) : i.value.trim()]));
    const close = (v) => {
      ov.remove();
      resolve(v);
    };
    const rows = fields.map((f) => {
      const input = el("input", { type: f.type === "money" ? "number" : f.type || "text", value: f.value ?? "", required: !!f.required, name: f.name, id: "f-" + f.name });
      if (f.type === "money") Object.assign(input, { min: 0, step: "0.01", inputMode: "decimal", placeholder: "0" });
      inputs[f.name] = input;
      return el("label", { className: "field" }, el("span", { className: "field-label", textContent: f.label }), f.type === "money" ? el("span", { className: "money" }, el("i", { textContent: "R" }), input) : input, f.hint ? el("small", { textContent: f.hint }) : null);
    });
    const live = el("p", { className: "form-note", "aria-live": "polite" });
    const form = el(
      "form",
      {
        className: "modal-box form-dialog",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": title,
        onsubmit: (e) => {
          e.preventDefault();
          close(values());
        },
      },
      el("h2", { textContent: title }),
      rows,
      note ? live : null,
      el("div", { className: "form-actions" }, el("button", { type: "button", className: "btn", textContent: "Kanselleer", onclick: () => close(null) }), el("button", { type: "submit", className: "btn primary", textContent: submitLabel })),
    );
    if (note) {
      const update = () => (live.textContent = note(values()) || "");
      form.addEventListener("input", update);
      update();
    }
    // braces matter: an onclick property that returns false cancels the click
    const ov = el(
      "div",
      {
        className: "modal",
        onclick: (e) => {
          if (e.target === ov) close(null);
        },
      },
      form,
    );
    ov.addEventListener("keydown", (e) => e.key === "Escape" && close(null));
    document.body.append(ov);
    form.querySelector("input")?.focus();
  });
}

const dueFields = (b = {}) => [
  { name: "title", label: "Wat moet betaal word?", value: b.title, required: true },
  { name: "budget", label: "Begroting", type: "money", value: b.budget ?? "" },
  { name: "amount", label: "Uitstaande bedrag", type: "money", value: b.amount ?? "", required: true },
  { name: "due", label: "Betaal teen", type: "date", value: b.due || "", hint: "Opsioneel" },
];
const paidFields = (b = {}) => [
  { name: "title", label: "Wat is betaal?", value: b.title, required: true },
  { name: "budget", label: "Begroting", type: "money", value: b.budget ?? "", hint: "Opsioneel. Leeg of 0: geen oor/onder nie." },
  { name: "amount", label: "Werklike bedrag", type: "money", value: b.amount ?? "", required: true },
];

async function newBudgetItem(kind) {
  const v = await formDialog({ title: kind === "due" ? "Nuwe herinnering" : "Nuwe betaling", fields: kind === "due" ? dueFields() : paidFields(), submitLabel: "Voeg by" });
  if (!v) return;
  const id = uid();
  saveBudget([{ id, kind, title: v.title, budget: v.budget, amount: v.amount, due: kind === "due" ? v.due || null : null, ref: id, seq: Date.now() }]);
}

async function editBudgetItem(b) {
  const isDue = b.kind === "due";
  const v = await formDialog({ title: isDue ? "Wysig herinnering" : "Wysig betaling", fields: isDue ? dueFields(b) : paidFields(b) });
  if (!v) return;
  saveBudget([{ ...b, title: v.title, budget: v.budget, amount: v.amount, due: isDue ? v.due || null : null }]);
}

// paying a reminder: all of it moves it to the history; part of it leaves the rest as a reminder
async function payDialog(b) {
  const v = await formDialog({
    title: `Betaal: ${b.title}`,
    fields: [{ name: "amount", label: "Bedrag betaal", type: "money", value: b.amount, required: true }],
    submitLabel: "Skuif na geskiedenis",
    note: ({ amount }) => {
      if (amount > b.amount) return `${R(cents(amount - b.amount))} meer as die uitstaande ${R(b.amount)}.`;
      if (amount === b.amount) return "Die hele bedrag word betaal.";
      if (amount <= 0) return "";
      const rest = `${R(cents(b.amount - amount))} bly as herinnering uitstaande.`;
      // show how the budget will be split (same sum as below)
      if (!b.budget) return rest;
      const partBudget = Math.round((b.budget * amount) / b.amount);
      return `${rest} Begroting: ${R(partBudget)} vir hierdie betaling, ${R(cents(b.budget - partBudget))} bly op die herinnering.`;
    },
  });
  if (!v) return;
  if (v.amount >= b.amount) {
    saveBudget([{ ...b, kind: "paid", amount: v.amount, due: null, seq: Date.now() }]);
    toast(`${b.title} is na die geskiedenis geskuif.`);
  } else if (v.amount > 0) {
    // the budget is split in the same proportion as the payment, so each card compares fairly
    // and the two still add up to the original budget
    const partBudget = Math.round((b.budget * v.amount) / b.amount);
    const part = { id: uid(), kind: "paid", title: b.title, budget: partBudget, amount: v.amount, due: null, ref: b.ref, seq: Date.now() };
    saveBudget([{ ...b, budget: cents(b.budget - partBudget), amount: cents(b.amount - v.amount) }, part]);
    toast(`${R(v.amount)} betaal, ${R(cents(b.amount - v.amount))} bly uitstaande.`);
  } else toast("Vul die bedrag in wat betaal is.");
}

async function editTotal() {
  const v = await formDialog({ title: "Totale begroting", fields: [{ name: "total", label: "Hoeveel mag die troue altesaam kos?", type: "money", value: budget.total, required: true }] });
  if (!v) return;
  budget.total = v.total;
  send({ op: "set", kind: "budgetTotal", value: v.total });
  renderBudget();
}

document.getElementById("addDueBtn").addEventListener("click", () => newBudgetItem("due"));
document.getElementById("addPaidBtn").addEventListener("click", () => newBudgetItem("paid"));

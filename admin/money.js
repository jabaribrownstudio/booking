/* Accounting for the desktop admin: invoices, estimates, products & services, taxes, payments, receipts,
 * reminders, and the confirm-booking and convert-estimate screens. Mirrors the Android app. */
(function () {
  "use strict";
  let A = null; // helpers from admin.js (api, S, toast, esc, ...)
  const M = { invoices: [], fees: [], taxes: [], finance: null, currency: "J$", year: 0, section: "Invoices", pay: "All", loaded: false, loading: false, clients: null, cq: "" };
  const r2 = (n) => Math.round(n * 100) / 100;
  const num = (v) => { const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; };
  const qtyText = (q) => String(q).replace(/\.0+$/, "");
  const cash = (n) => (n < 0 ? "-" : "") + M.currency + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cashShort = (n) => M.currency + Math.round(n).toLocaleString("en-US");
  const $ = (id) => document.getElementById(id);
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fdate = (s) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return s || ""; return MON[+s.slice(5, 7) - 1] + " " + +s.slice(8) + ", " + s.slice(0, 4); };
  const today = () => A.ymd(new Date());
  const addDays = (s, n) => { const d = A.parseYmd(s); d.setDate(d.getDate() + n); return A.ymd(d); };

  function totals(items, discount, taxes) {
    let sub = 0; items.forEach((i) => { sub += r2(i.qty * i.price); }); sub = r2(sub);
    let disc = 0;
    if (discount && discount.value > 0) disc = discount.type === "amount" ? discount.value : sub * discount.value / 100;
    disc = r2(Math.min(Math.max(disc, 0), Math.max(sub, 0)));
    const base = sub - disc; let tt = 0; const tl = [];
    (taxes || []).forEach((t) => { const a = Math.round(base * t.rate) / 100; tt += a; tl.push({ name: t.name, rate: t.rate, amount: a }); });
    return { subtotal: sub, discount: disc, taxes: tl, total: r2(base + tt) };
  }

  /* ---------- modal helper ---------- */
  function modal(html, wide) {
    const el = document.createElement("div"); el.className = "sheet"; el.style.zIndex = 40 + document.querySelectorAll(".sheet.dyn").length;
    el.classList.add("dyn");
    el.innerHTML = '<div class="sheet-bg"></div><div class="sheet-card' + (wide ? " wide" : "") + '">' + html + "</div>";
    document.body.appendChild(el);
    const close = () => el.remove();
    el.querySelector(".sheet-bg").addEventListener("click", close);
    el.addEventListener("click", (e) => { if (e.target.closest("[data-x]")) close(); });
    return { el, close, q: (s) => el.querySelector(s), qa: (s) => Array.from(el.querySelectorAll(s)) };
  }
  const head = (t) => '<div class="sheet-head"><h2>' + A.esc(t) + '</h2><button type="button" class="icon-btn" data-x aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>';
  const savedBusy = async (btn, label, fn) => { const t = btn.textContent; btn.disabled = true; if (label) btn.textContent = label; try { return await fn(); } catch (e) { A.fail(e); } finally { btn.disabled = false; btn.textContent = t; } };
  function download(j) {
    const bytes = Uint8Array.from(atob(j.pdf), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const a = document.createElement("a"); a.href = url; a.download = j.name || "document.pdf"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /* ---------- loading ---------- */
  async function load(quiet) {
    if (M.loading) return; M.loading = true;
    try {
      const j = await A.api("admin_money", M.year ? { year: M.year } : {});
      if (j && j.ok) { M.invoices = j.invoices || []; M.fees = j.fees || []; M.taxes = j.taxes || []; M.finance = j.finance; M.currency = j.currency || M.currency; M.year = j.finance.year; M.loaded = true; render(); if (!M.clients) loadClients(true); }
      else if (!quiet) A.toast("Couldn't load accounting.", true);
    } catch (e) { A.fail(e); }
    M.loading = false;
  }

  /* ---------- the Accounting tab ---------- */
  function render() {
    const root = $("money-root"); if (!root) return;
    if (!M.loaded) { root.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>'; return; }
    const f = M.finance, max = Math.max.apply(null, f.months.concat([1]));
    let h = '<div class="stats">' +
      stat("Collected " + f.year, cashShort(f.collected)) + stat("Invoiced " + f.year, cashShort(f.invoiced)) +
      stat("Outstanding", cashShort(f.outstanding)) + stat("Overdue", cashShort(f.overdue), f.overdue > 0 ? "bad" : "") + "</div>";
    h += '<div class="card"><div class="bars">' + f.months.map((v, i) => '<div class="bar" title="' + MON[i] + ": " + cashShort(v) + '"><i style="height:' + Math.round(v / max * 100) + '%"></i><span>' + MON[i][0] + "</span></div>").join("") + "</div>" +
      '<label class="yr">Year <select id="m-year">' + f.years.map((y) => "<option" + (y === f.year ? " selected" : "") + ">" + y + "</option>").join("") + "</select></label></div>";
    h += '<div class="seg" id="m-sections">' + ["Invoices", "Estimates", "Products & Services", "Clients"].map((s) => '<button type="button" data-s="' + A.esc(s) + '"' + (s === M.section ? ' class="on"' : "") + ">" + A.esc(s) + "</button>").join("") + "</div>";
    if (M.section === "Clients") h += clientsHtml();
    else if (M.section === "Products & Services") h += itemsHtml();
    else {
      h += '<div class="acts"><button type="button" class="btn primary" id="m-new">+ New ' + (M.section === "Invoices" ? "Invoice" : "Estimate") + "</button></div>";
      if (M.section === "Invoices") h += '<div class="seg sub" id="m-pay">' + ["All", "Unpaid", "Paid"].map((s) => '<button type="button" data-p="' + s + '"' + (s === M.pay ? ' class="on"' : "") + ">" + s + "</button>").join("") + "</div>";
      const list = M.invoices.filter((i) => (M.section === "Estimates" ? i.type === "Estimate" : i.type === "Invoice" && (M.pay === "All" || (M.pay === "Unpaid" ? ["Draft", "Sent", "Partial"].indexOf(i.status) > -1 : i.status === "Paid"))));
      h += list.length ? list.map(rowHtml).join("") : '<div class="empty">Nothing here yet.</div>';
    }
    root.innerHTML = h;
  }
  const stat = (l, v, c) => '<div class="stat ' + (c || "") + '"><small>' + A.esc(l) + "</small><b>" + A.esc(v) + "</b></div>";
  function rowHtml(i) {
    const made = i.type === "Estimate" ? M.invoices.find((x) => x.type === "Invoice" && x.from === i.number) : null;
    const overdue = i.type === "Invoice" && ["Sent", "Partial"].indexOf(i.status) > -1 && i.due && i.due < today();
    return '<button type="button" class="invrow" data-inv="' + i.row + '"><div><b>#' + i.number + " " + A.esc(i.client) + "</b><small>" + fdate(i.date) +
      (made ? " · invoice #" + made.number : "") + (overdue ? ' · <span class="bad-t">Overdue ' + cash(i.total - i.paid) + "</span>" : "") +
      '</small></div><div class="r"><b>' + cash(i.total) + '</b><span class="pill st-' + A.esc(i.status) + '">' + A.esc(i.status) + "</span></div></button>";
  }
  /* ---------- clients ---------- */
  async function loadClients(quiet) {
    try {
      const j = await A.api("admin_clients");
      if (j && j.ok) { M.clients = j.clients; render(); } else if (!quiet) A.toast("Couldn't load clients.", true);
    } catch (e) { A.fail(e); }
  }
  function clientsHtml() {
    let h = '<div class="acts"><button type="button" class="btn primary" id="m-client-new">+ New Client</button></div><label class="cq">Search clients<input id="m-cq" type="search" value="' + A.esc(M.cq) + '" placeholder="Name, email or phone"></label>';
    if (!M.clients) return h + '<div class="skeleton"></div>';
    const q = M.cq.trim().toLowerCase();
    const list = q ? M.clients.filter((c) => (c.name + " " + c.email + " " + c.phone).toLowerCase().indexOf(q) > -1) : M.clients;
    if (!list.length) return h + '<div class="empty">' + (M.clients.length ? "No clients match that." : "No clients yet. They're added automatically from bookings and invoices.") + "</div>";
    return h + '<div id="m-clist">' + list.map((c) => { const n = c.bookings.filter((b) => b.status !== "Cancelled").length;
      return '<button type="button" class="invrow" data-client="' + c.row + '"><div><b>' + A.esc(c.name) + "</b><small>" + A.esc([c.email, c.phone].filter(Boolean).join(" · ") || "No contact details") + (c.owing > 0.004 ? ' · <span class="bad-t">Owes ' + cash(c.owing) + "</span>" : "") + '</small></div><div class="r"><b>' + n + " booking" + (n === 1 ? "" : "s") + "</b>" + (c.billed ? "<small>" + cash(c.billed) + "</small>" : "") + "</div></button>"; }).join("") + "</div>";
  }
  function clientDialog(c) {
    const m = modal(head(c ? "Edit Client" : "New Client") + '<label>Name<input id="cl-name" type="text" maxlength="100"></label><div class="grid2"><label>Email <span class="muted">(optional)</span><input id="cl-email" type="email" autocapitalize="none"></label><label>Phone <span class="muted">(optional)</span><input id="cl-phone" type="tel"></label></div><label>Instagram <span class="muted">(optional)</span><input id="cl-ig" type="text"></label><label>Notes <span class="muted">(optional)</span><textarea id="cl-notes" rows="3"></textarea></label><p class="err" id="cl-err"></p><button class="btn primary block" id="cl-save" type="button">Save</button>');
    m.q("#cl-name").value = c ? c.name : ""; m.q("#cl-email").value = c ? c.email : ""; m.q("#cl-phone").value = c ? c.phone : ""; m.q("#cl-ig").value = c ? c.instagram : ""; m.q("#cl-notes").value = c ? c.notes : "";
    m.q("#cl-save").addEventListener("click", (e) => savedBusy(e.target, "Saving…", async () => {
      const name = m.q("#cl-name").value.trim(); if (!name) { m.q("#cl-err").textContent = "Enter the client's name."; return; }
      const d = { name, email: m.q("#cl-email").value.trim(), phone: m.q("#cl-phone").value.trim(), instagram: m.q("#cl-ig").value.trim(), notes: m.q("#cl-notes").value.trim() };
      if (c) d.row = c.row;
      const j = await A.api("admin_client_save", d);
      if (j.ok) { m.close(); A.toast("Client saved"); loadClients(true); }
      else m.q("#cl-err").textContent = j.error === "exists" ? "This client is already saved." : j.error === "invalid_input" ? "Check the details. The email may be wrong." : "Couldn't save. Try again.";
    }));
  }
  function clientDetail(c) {
    let h = head(c.name) + '<p class="muted">' + [c.email && '<a href="mailto:' + A.esc(c.email) + '">' + A.esc(c.email) + "</a>", c.phone && '<a href="tel:' + A.esc(c.phone.replace(/[^\d+]/g, "")) + '">' + A.esc(c.phone) + "</a>", c.instagram && "@" + A.esc(c.instagram.replace(/^@/, ""))].filter(Boolean).join(" · ") + "</p>" + (c.notes ? "<p>" + A.esc(c.notes) + "</p>" : "");
    h += '<div class="stats"><div class="stat"><small>Billed</small><b>' + cash(c.billed) + '</b></div><div class="stat"><small>Paid</small><b>' + cash(c.paid) + '</b></div><div class="stat' + (c.owing > 0.004 ? " bad" : "") + '"><small>Owing</small><b>' + cash(c.owing) + "</b></div></div>";
    h += '<b class="lbl">Bookings (' + c.bookings.length + ")</b>" + (c.bookings.length ? c.bookings.map((b) => '<div class="li"><span><b>' + A.esc(b.pkg || "Session") + "</b><small>" + fdate(b.date) + (b.start ? " · " + A.t12(b.start) : "") + '</small></span><span class="pill ' + A.esc(b.status) + '">' + A.esc(b.status) + "</span></div>").join("") : '<p class="muted">No bookings yet.</p>');
    h += '<b class="lbl">Invoices and estimates (' + c.invoices.length + ")</b>" + (c.invoices.length ? c.invoices.map((i) => '<button type="button" class="li linkrow" data-openinv="' + i.row + '"><span><b>' + (i.type === "Estimate" ? "Estimate #" : "Invoice #") + i.number + "</b><small>" + fdate(i.date) + " · " + cash(i.total) + '</small></span><span class="pill st-' + A.esc(i.status) + '">' + A.esc(i.status) + "</span></button>").join("") : '<p class="muted">None yet.</p>');
    h += '<div class="acts"><button type="button" class="btn primary" id="cd-inv">New Invoice</button><button type="button" class="btn" id="cd-edit">Edit</button><button type="button" class="btn bad" id="cd-del">Delete</button></div>';
    const m = modal(h, true);
    m.q("#cd-inv").addEventListener("click", () => { m.close(); editor(null, "Invoice", { client: c.name, email: c.email, phone: c.phone }); });
    m.q("#cd-edit").addEventListener("click", () => { m.close(); clientDialog(c); });
    m.q("#cd-del").addEventListener("click", () => { if (!confirm("Delete " + c.name + "? This removes the client record only. Their bookings and invoices stay.")) return; A.api("admin_client_delete", { row: c.row }).then((j) => { if (j.ok) { m.close(); A.toast("Client deleted"); loadClients(true); } else A.toast("Couldn't delete the client.", true); }).catch(A.fail); });
    m.el.addEventListener("click", (e) => { const o = e.target.closest("[data-openinv]"); if (o) { m.close(); M.section = "Invoices"; M.pay = "All"; render(); detail(+o.dataset.openinv); } });
  }
  function itemsHtml() {
    let h = '<div class="acts"><button type="button" class="btn primary" id="m-item-new">+ New Product or Service</button></div>';
    h += M.fees.length ? M.fees.map((f) => '<div class="invrow static"><div><b>' + A.esc(f.name) + "</b><small>" + A.esc((f.desc || "").split("\n")[0]) + "</small><small>Quantity " + qtyText(f.qty) + '</small></div><div class="r"><b>' + cash(f.price) + '</b><span><button type="button" class="btn sm" data-fe="' + f.row + '">Edit</button> <button type="button" class="btn sm bad" data-fd="' + f.row + '">Delete</button></span></div></div>').join("") : '<div class="empty">No products or services yet.</div>';
    h += "<h2>Taxes</h2>" + (M.taxes.length ? M.taxes.map((t) => '<div class="invrow static"><div><b>' + A.esc(t.name) + "</b><small>" + qtyText(t.rate) + '%</small></div><div class="r"><button type="button" class="btn sm bad" data-td="' + t.row + '">Delete</button></div></div>').join("") : '<p class="muted">No saved taxes.</p>') +
      '<div class="acts"><button type="button" class="btn" id="m-tax-new">+ Add tax</button></div>';
    return h;
  }

  /* ---------- products, services, taxes ---------- */
  function itemDialog(f) {
    const m = modal(head(f ? "Edit Item" : "New Product or Service") + '<label>Name<input id="f-name" type="text" maxlength="100"></label><label>Description <span class="muted">(optional)</span><textarea id="f-desc" rows="3"></textarea></label>' +
      '<div class="grid2"><label>Price<input id="f-price" type="number" min="0" step="0.01"></label><label>Quantity<input id="f-qty" type="number" min="0" step="any"></label></div><p class="err" id="f-err"></p><button class="btn primary block" id="f-save" type="button">Save</button>');
    m.q("#f-name").value = f ? f.name : ""; m.q("#f-desc").value = f ? f.desc : ""; m.q("#f-price").value = f ? f.price : ""; m.q("#f-qty").value = f ? f.qty : 1;
    m.q("#f-save").addEventListener("click", (e) => savedBusy(e.target, "Saving…", async () => {
      const name = m.q("#f-name").value.trim(), price = parseFloat(m.q("#f-price").value);
      if (!name || isNaN(price) || price < 0) { m.q("#f-err").textContent = "Enter a name and a price."; return; }
      const d = { name, desc: m.q("#f-desc").value.trim(), price, qty: parseFloat(m.q("#f-qty").value) || 1 };
      if (f) d.row = f.row;
      const j = await A.api(f ? "admin_fee_update" : "admin_fee_add", d);
      if (j.ok) { m.close(); A.toast("Saved"); load(true); } else m.q("#f-err").textContent = "Couldn't save it.";
    }));
  }
  function taxDialog() {
    const m = modal(head("New Tax") + '<label>Name<input id="t-n" type="text" maxlength="40" placeholder="GCT"></label><label>Rate (%)<input id="t-r" type="number" min="0" max="100" step="any"></label><p class="err" id="t-err"></p><button class="btn primary block" id="t-save" type="button">Save</button>');
    m.q("#t-save").addEventListener("click", (e) => savedBusy(e.target, "Saving…", async () => {
      const name = m.q("#t-n").value.trim(), rate = parseFloat(m.q("#t-r").value);
      if (!name || !(rate > 0 && rate <= 100)) { m.q("#t-err").textContent = "Enter a name and a rate between 0 and 100."; return; }
      const j = await A.api("admin_tax_add", { name, rate });
      if (j.ok) { m.close(); A.toast("Tax saved"); load(true); } else m.q("#t-err").textContent = "Couldn't save it.";
    }));
  }

  /* ---------- shared pieces: line items, discount, taxes ---------- */
  function adjustHtml(prefix, disc, selTaxes) {
    return '<div class="grid2"><label>Discount<select id="' + prefix + 'dt"><option value="percent">Percent (%)</option><option value="amount">Amount</option></select></label>' +
      '<label>Discount value<input id="' + prefix + 'dv" type="number" min="0" step="any"></label></div>' +
      '<div class="taxpick"><b class="lbl">Taxes</b>' + (M.taxes.length ? M.taxes.map((t) => '<label class="check"><input type="checkbox" data-tax="' + t.row + '"' + (selTaxes.some((s) => s.name === t.name && s.rate === t.rate) ? " checked" : "") + "> " + A.esc(t.name) + " (" + qtyText(t.rate) + "%)</label>").join("") : '<span class="muted small">No saved taxes. Add them under Products & Services.</span>') + "</div>";
  }
  function readAdjust(m, prefix) {
    const v = parseFloat(m.q("#" + prefix + "dv").value);
    const discount = v > 0 ? { type: m.q("#" + prefix + "dt").value, value: v } : null;
    const taxes = m.qa("[data-tax]").filter((c) => c.checked).map((c) => { const t = M.taxes.find((x) => String(x.row) === c.dataset.tax); return { name: t.name, rate: t.rate }; });
    return { discount, taxes };
  }
  // A list of editable lines (name, qty, price, optional description) inside element `box`
  function lineRow(l) {
    return '<div class="lrow"><input class="l-name" placeholder="Item" value="' + A.esc(l.name) + '"><input class="l-qty" type="number" min="0" step="any" value="' + A.esc(qtyText(l.qty)) + '" aria-label="Quantity"><input class="l-price" type="number" min="0" step="0.01" value="' + A.esc(l.price === "" ? "" : l.price) + '" aria-label="Price"><button type="button" class="x" data-rmline aria-label="Remove">×</button><input class="l-desc" placeholder="Description (optional)" value="' + A.esc(l.desc || "") + '"></div>';
  }
  function readLines(box) {
    return Array.from(box.querySelectorAll(".lrow")).map((r) => ({ name: r.querySelector(".l-name").value.trim(), desc: r.querySelector(".l-desc").value.trim(), qty: parseFloat(r.querySelector(".l-qty").value) > 0 ? parseFloat(r.querySelector(".l-qty").value) : 1, price: parseFloat(r.querySelector(".l-price").value) || 0 })).filter((l) => l.name);
  }
  function feePicker() {
    return '<div class="acts"><select id="pick-fee" aria-label="Add a product or service"><option value="">+ Add from Products &amp; Services…</option>' + M.fees.map((f) => '<option value="' + f.row + '">' + A.esc(f.name) + " · " + cash(f.price) + "</option>").join("") + '</select><button type="button" class="btn" id="add-custom">+ Custom item</button></div>';
  }

  /* ---------- invoice / estimate editor ---------- */
  function editor(existing, type, prefill) {
    type = existing ? existing.type : type; const est = type === "Estimate";
    const inv = existing || prefill || {};
    const bookings = A.S.bookings.filter((b) => b.status !== "Cancelled");
    const m = modal(head((existing ? "Edit " : "New ") + (est ? "Estimate" : "Invoice") + (existing ? " #" + existing.number : "")) +
      (M.clients && M.clients.length ? '<label>Saved client <span class="muted">(optional)</span><select id="e-pickclient"><option value="">Choose a saved client…</option>' + M.clients.map((c) => '<option value="' + c.row + '">' + A.esc(c.name + (c.email ? " · " + c.email : "")) + "</option>").join("") + "</select></label>" : "") +
      '<label>Client name<input id="e-client" type="text" maxlength="100"></label><div class="grid2"><label>Email<input id="e-email" type="email" autocapitalize="none"></label><label>Phone<input id="e-phone" type="tel"></label></div>' +
      '<label>Linked booking <span class="muted">(optional)</span><select id="e-book"><option value="0">None</option>' + bookings.map((b) => '<option value="' + b.row + '">' + A.esc(b.name + " · " + b.pkg + " · " + b.date) + "</option>").join("") + "</select></label>" +
      '<div class="grid2"><label>Date<input id="e-date" type="date"></label><label>' + (est ? "Valid until" : "Due") + '<input id="e-due" type="date"></label></div>' +
      '<b class="lbl">Items</b><div id="e-lines" class="lines"></div>' + feePicker() + adjustHtml("e-", inv.discount ? [] : [], inv.taxes || []) +
      '<label>Notes <span class="muted">(optional)</span><textarea id="e-notes" rows="2"></textarea></label><div class="totalbox" id="e-total"></div><p class="err" id="e-err"></p>' +
      '<div class="acts"><button class="btn primary" id="e-save" type="button">Save</button><button class="btn" id="e-send" type="button">Save and email</button></div>', true);
    const set = (id, v) => { m.q(id).value = v == null ? "" : v; };
    set("#e-client", inv.client); set("#e-email", inv.email); set("#e-phone", inv.phone); set("#e-book", inv.bookingRow || 0);
    set("#e-date", inv.date || today()); set("#e-due", inv.due || inv.date || today()); set("#e-notes", inv.notes);
    if (inv.discount) { set("#e-dt", inv.discount.type); set("#e-dv", inv.discount.value); }
    const box = m.q("#e-lines");
    (inv.items && inv.items.length ? inv.items : []).forEach((l) => box.insertAdjacentHTML("beforeend", lineRow(l)));
    const recalc = () => {
      const a = readAdjust(m, "e-"), t = totals(readLines(box), a.discount, a.taxes);
      m.q("#e-total").innerHTML = "Subtotal " + cash(t.subtotal) + (t.discount ? " · Discount −" + cash(t.discount) : "") + t.taxes.map((x) => " · " + A.esc(x.name) + " " + cash(x.amount)).join("") + "<br><b>Total " + cash(t.total) + "</b>";
    };
    m.el.addEventListener("input", recalc); m.el.addEventListener("change", recalc);
    m.el.addEventListener("click", (e) => { const b = e.target.closest("[data-rmline]"); if (b) { b.closest(".lrow").remove(); recalc(); } });
    m.q("#add-custom").addEventListener("click", () => { box.insertAdjacentHTML("beforeend", lineRow({ name: "", qty: 1, price: "" })); recalc(); });
    m.q("#pick-fee").addEventListener("change", (e) => { const f = M.fees.find((x) => String(x.row) === e.target.value); if (f) box.insertAdjacentHTML("beforeend", lineRow({ name: f.name, desc: f.desc, qty: f.qty, price: f.price })); e.target.value = ""; recalc(); });
    m.q("#e-book").addEventListener("change", (e) => {
      const b = A.S.bookings.find((x) => String(x.row) === e.target.value); if (!b) return;
      set("#e-client", b.name); set("#e-email", b.email); set("#e-phone", b.phone);
      if (!readLines(box).length) box.insertAdjacentHTML("beforeend", lineRow({ name: b.pkg || "Photography session", desc: b.duration ? "Duration: " + b.duration + " minutes" : "", qty: 1, price: num(b.price) }));
      recalc();
    });
    const pc = m.q("#e-pickclient");
    if (pc) pc.addEventListener("change", () => { const c = M.clients.find((x) => String(x.row) === pc.value); if (c) { set("#e-client", c.name); set("#e-email", c.email); set("#e-phone", c.phone); } });
    m.q("#e-date").addEventListener("change", () => { const d = m.q("#e-date").value, du = m.q("#e-due"); if (d && (!du.value || du.value < d)) du.value = d; });
    recalc();
    const save = (send) => (e) => savedBusy(e.target, "Saving…", async () => {
      const items = readLines(box), client = m.q("#e-client").value.trim(), a = readAdjust(m, "e-");
      if (!client) { m.q("#e-err").textContent = "Enter the client's name."; return; }
      if (!items.length) { m.q("#e-err").textContent = "Add at least one item."; return; }
      const d = { type, client, email: m.q("#e-email").value.trim(), phone: m.q("#e-phone").value.trim(), bookingRow: +m.q("#e-book").value || 0, items, date: m.q("#e-date").value, due: m.q("#e-due").value, notes: m.q("#e-notes").value.trim(), discount: a.discount, taxes: a.taxes, send };
      if (existing) d.row = existing.row;
      const j = await A.api("admin_inv_save", d);
      if (j.ok) { m.close(); A.toast((est ? "Estimate #" : "Invoice #") + j.number + (j.sent ? " saved and emailed" : " saved")); load(true); }
      else m.q("#e-err").textContent = j.error === "no_email" ? "Saved, but there's no valid email address to send it to." : j.error === "locked" ? "This invoice can't be changed any more." : j.error === "invalid_input" ? "Check the details. The email address may be wrong." : "Couldn't save. Try again.";
      if (j.error === "no_email") load(true);
    });
    m.q("#e-save").addEventListener("click", save(false)); m.q("#e-send").addEventListener("click", save(true));
  }

  /* ---------- invoice detail ---------- */
  function detail(row) {
    const i = M.invoices.find((x) => x.row === row); if (!i) return;
    const isInv = i.type === "Invoice", t = totals(i.items, i.discount, i.taxes), owing = isInv ? Math.max(0, i.total - i.paid) : 0;
    const made = !isInv ? M.invoices.find((x) => x.type === "Invoice" && x.from === i.number) : null;
    const overdue = isInv && ["Sent", "Partial"].indexOf(i.status) > -1 && i.due && i.due < today();
    let h = head((isInv ? "Invoice #" : "Estimate #") + i.number) + '<p class="muted">' + A.esc(i.client) + (i.email ? " · " + A.esc(i.email) : "") + (i.phone ? " · " + A.esc(i.phone) : "") + "<br>" + (isInv ? "Issued " : "Dated ") + fdate(i.date) + " · " + (isInv ? "due " : "valid until ") + fdate(i.due) +
      ' <span class="pill st-' + A.esc(i.status) + '">' + A.esc(i.status) + "</span>" + (overdue ? ' <span class="bad-t">Overdue ' + cash(owing) + "</span>" : "") + "</p>";
    h += '<div class="card">' + i.items.map((l) => '<div class="li"><div><b>' + A.esc(l.name) + "</b>" + (l.qty !== 1 ? "<small>" + qtyText(l.qty) + " × " + cash(l.price) + "</small>" : "") + "</div><span>" + cash(l.qty * l.price) + "</span></div>").join("") +
      '<div class="li sub"><span>Subtotal</span><span>' + cash(t.subtotal) + "</span></div>" + (t.discount ? '<div class="li sub"><span>Discount' + (i.discount && i.discount.type === "percent" ? " (" + qtyText(i.discount.value) + "%)" : "") + "</span><span>−" + cash(t.discount) + "</span></div>" : "") +
      t.taxes.map((x) => '<div class="li sub"><span>' + A.esc(x.name) + " (" + qtyText(x.rate) + "%)</span><span>" + cash(x.amount) + "</span></div>").join("") +
      '<div class="li"><b>Total</b><b>' + cash(i.total) + "</b></div>" + (isInv ? '<div class="li sub"><span>Paid</span><span>' + cash(i.paid) + '</span></div><div class="li"><b>Amount due</b><b>' + cash(owing) + "</b></div>" : "") + "</div>";
    if (isInv && i.payments.length) h += "<b class=\"lbl\">Payments</b>" + i.payments.map((p, k) => '<div class="li pay"><span>' + fdate(p.date) + " · " + A.esc(p.method) + " · <b>" + cash(p.amount) + '</b></span><span><button type="button" class="btn sm" data-rc="' + k + '">Receipt PDF</button> <button type="button" class="btn sm" data-re="' + k + '">Email receipt</button> <button type="button" class="btn sm bad" data-up="' + k + '">Remove</button></span></div>').join("");
    if (i.notes) h += '<p class="muted"><b>Notes:</b> ' + A.esc(i.notes) + "</p>";
    const canEdit = !isInv || (i.status !== "Paid" && i.status !== "Void");
    h += '<div class="acts">';
    if (isInv && i.status !== "Void" && i.status !== "Paid") h += '<button type="button" class="btn primary" id="d-pay">Record payment</button>';
    if (isInv && ["Sent", "Partial", "Draft"].indexOf(i.status) > -1 && owing > 0) h += '<button type="button" class="btn" id="d-remind">Send payment reminder</button>';
    if (!isInv && i.status !== "Declined" && !made) h += '<button type="button" class="btn primary" id="d-convert">Convert to invoice</button>';
    if (made) h += '<button type="button" class="btn" id="d-viewmade">View invoice #' + made.number + "</button>";
    h += '<button type="button" class="btn" id="d-send"' + (i.status === "Void" ? " disabled" : "") + ">" + (i.sent ? "Email again" : "Email it") + '</button><button type="button" class="btn" id="d-pdf">Download PDF</button>';
    if (i.sent || i.status === "Sent") h += '<button type="button" class="btn" id="d-unsent">Mark as Unsent</button>';
    if (canEdit) h += '<button type="button" class="btn" id="d-edit">Edit</button>';
    if (isInv && i.status !== "Void" && i.status !== "Paid") h += '<button type="button" class="btn bad" id="d-void">Void</button>';
    if (!isInv && i.status !== "Declined" && !made) h += '<button type="button" class="btn" id="d-decline">Mark declined</button>';
    if (!isInv || i.status === "Draft" || i.status === "Void") h += '<button type="button" class="btn bad" id="d-del">Delete</button>';
    h += "</div>";
    const m = modal(h, true), on = (id, fn) => { const b = m.q(id); if (b) b.addEventListener("click", (e) => savedBusy(e.target, null, () => fn(e))); };
    const done = (msg) => { A.toast(msg); load(true).then(() => { }); };
    on("#d-pay", () => paymentDialog(i, m));
    on("#d-remind", async () => { const j = await A.api("admin_inv_remind", { row: i.row }); A.toast(j.ok ? "Payment reminder sent" : j.error === "no_email" ? "Add the client's email address first." : "Couldn't send the reminder.", !j.ok); });
    on("#d-convert", () => { m.close(); convertDialog(i); });
    on("#d-viewmade", () => { m.close(); M.section = "Invoices"; M.pay = "All"; render(); detail(made.row); });
    on("#d-send", async () => { const j = await A.api("admin_inv_send", { row: i.row }); A.toast(j.ok ? "Emailed to the client" : j.error === "no_email" ? "Add the client's email address first." : "Couldn't send it.", !j.ok); if (j.ok) load(true); });
    on("#d-pdf", async () => { const j = await A.api("admin_inv_pdf", { row: i.row }); if (j.ok) download(j); else A.toast("Couldn't make the PDF.", true); });
    on("#d-edit", () => { m.close(); editor(i); });
    on("#d-unsent", async () => { const j = await A.api("admin_inv_status", { row: i.row, status: "Unsent" }); if (j.ok) { m.close(); done("Marked unsent"); } else A.toast("Couldn't update it.", true); });
    on("#d-void", async () => { if (!confirm("Void invoice #" + i.number + "? It stops counting as money owed.")) return; const j = await A.api("admin_inv_status", { row: i.row, status: "Void" }); if (j.ok) { m.close(); done("Marked void"); } else A.toast("Couldn't update it.", true); });
    on("#d-decline", async () => { const j = await A.api("admin_inv_status", { row: i.row, status: "Declined" }); if (j.ok) { m.close(); done("Marked declined"); } else A.toast("Couldn't update it.", true); });
    on("#d-del", async () => { if (!confirm("Delete #" + i.number + " for good?")) return; const j = await A.api("admin_inv_delete", { row: i.row }); if (j.ok) { m.close(); done("Deleted"); } else A.toast("Only drafts and voided invoices can be deleted.", true); });
    m.el.addEventListener("click", async (e) => {
      const rc = e.target.closest("[data-rc]"), re = e.target.closest("[data-re]"), up = e.target.closest("[data-up]");
      if (rc) savedBusy(rc, null, async () => { const j = await A.api("admin_inv_receipt", { row: i.row, index: +rc.dataset.rc }); if (j.ok) download(j); else A.toast("Couldn't make the receipt.", true); });
      if (re) savedBusy(re, null, async () => { const j = await A.api("admin_inv_receipt", { row: i.row, index: +re.dataset.re, mode: "email" }); A.toast(j.ok ? "Receipt emailed" : j.error === "no_email" ? "Add the client's email address first." : "Couldn't send it.", !j.ok); });
      if (up) { if (!confirm("Remove this payment?")) return; savedBusy(up, null, async () => { const j = await A.api("admin_inv_unpay", { row: i.row, index: +up.dataset.up }); if (j.ok) { m.close(); done("Payment removed"); } else A.toast("Couldn't remove it.", true); }); }
    });
  }

  function paymentDialog(i, parent) {
    const owing = Math.max(0, i.total - i.paid);
    const m = modal(head("Record a payment") + '<label>Amount<input id="p-amt" type="number" min="0" step="0.01"></label><div class="grid2"><label>Date<input id="p-date" type="date"></label><label>Method<input id="p-method" list="p-methods" value="bank payment"><datalist id="p-methods"><option>bank payment</option><option>cash</option><option>card</option><option>cheque</option></datalist></label></div>' +
      (i.email ? '<label class="check"><input type="checkbox" id="p-rec" checked> Email a receipt to the client</label>' : "") + '<p class="err" id="p-err"></p><button class="btn primary block" id="p-save" type="button">Save payment</button>');
    m.q("#p-amt").value = owing.toFixed(2); m.q("#p-date").value = today();
    m.q("#p-save").addEventListener("click", (e) => savedBusy(e.target, "Saving…", async () => {
      const amount = parseFloat(m.q("#p-amt").value);
      if (!(amount > 0)) { m.q("#p-err").textContent = "Enter the amount received."; return; }
      const j = await A.api("admin_inv_pay", { row: i.row, amount, date: m.q("#p-date").value, method: m.q("#p-method").value, receipt: !!(m.q("#p-rec") && m.q("#p-rec").checked) });
      if (j.ok) { m.close(); parent.close(); A.toast(j.receiptSent ? "Payment saved and receipt emailed" : "Payment saved"); load(true); } else m.q("#p-err").textContent = "Couldn't save the payment.";
    }));
  }

  /* ---------- convert estimate -> invoice (optionally with a booking) ---------- */
  function convertDialog(e) {
    const linked = e.bookingRow > 0;
    const m = modal(head("Convert estimate #" + e.number + " to an invoice") +
      (linked ? '<p class="muted">This estimate is already linked to a booking, so the invoice will be linked to it too.</p>' :
        '<label class="check"><input type="checkbox" id="c-make"> Also create a booking for ' + A.esc(e.client) + '</label><div id="c-box" hidden><div class="grid2"><label>Date<input id="c-date" type="date"></label><label>Start time<input id="c-time" type="time"></label><label>Minutes<input id="c-dur" type="number" min="5" value="60"></label><label>Location<input id="c-loc" type="text"></label></div><p class="muted small">The booking is created as confirmed and no email is sent for it.</p><label class="check" id="c-force-row" hidden><input type="checkbox" id="c-force"> Book it anyway (overlaps another booking)</label></div>') +
      '<p class="err" id="c-err"></p><button class="btn primary block" id="c-go" type="button">Convert</button>');
    if (!linked) { m.q("#c-date").value = today(); m.q("#c-make").addEventListener("change", (x) => { m.q("#c-box").hidden = !x.target.checked; }); }
    m.q("#c-go").addEventListener("click", (ev) => savedBusy(ev.target, "Converting…", async () => {
      const d = { row: e.row };
      if (!linked && m.q("#c-make").checked) {
        if (!m.q("#c-date").value || !m.q("#c-time").value) { m.q("#c-err").textContent = "Choose a date and time for the booking."; return; }
        d.booking = { date: m.q("#c-date").value, time: m.q("#c-time").value, duration: parseInt(m.q("#c-dur").value, 10) || 60, location: m.q("#c-loc").value.trim(), force: m.q("#c-force").checked };
      }
      const j = await A.api("admin_inv_convert", d);
      if (j.ok) { m.close(); A.toast("Invoice #" + j.number + " created" + (j.booking ? " and a booking was added" : "")); M.section = "Invoices"; M.pay = "All"; await load(true); if (j.booking) A.reload(); detail(j.row); }
      else if (j.error === "slot_taken") { m.q("#c-err").textContent = "That time overlaps another booking."; m.q("#c-force-row").hidden = false; }
      else m.q("#c-err").textContent = "Couldn't convert it. Try again.";
    }));
  }

  /* ---------- confirm a booking (extras, discount, taxes, dates, email-only option) ---------- */
  function confirmDialog(b) {
    const base = num(b.price);
    const m = modal(head("Confirm " + b.name + "'s booking") + '<div class="li"><span>' + A.esc(b.pkg || "Session") + "</span><span>" + cash(base) + "</span></div>" +
      '<b class="lbl">Add to the invoice</b><div id="k-lines" class="lines"></div>' + feePicker() + adjustHtml("k-", null, []) +
      '<div class="grid2"><label>Invoice date<input id="k-date" type="date"></label><label>Due<input id="k-due" type="date"></label></div><div class="totalbox" id="k-total"></div>' +
      (b.email ? '<label class="check"><input type="checkbox" id="k-send" checked> Email the confirmation and invoice</label>' : '<p class="muted small">No email on this booking, so the invoice is saved but not sent.</p>') +
      '<p class="err" id="k-err"></p><div class="stack"><button class="btn primary block" id="k-yes" type="button">Confirm and invoice</button><button class="btn block" id="k-only" type="button">' + (b.email ? "Confirm, email only (invoice later)" : "Confirm without invoice") + '</button><button class="btn block" data-x type="button">Cancel</button></div>', true);
    m.q("#k-date").value = today(); m.q("#k-due").value = today();
    const box = m.q("#k-lines");
    const recalc = () => { const a = readAdjust(m, "k-"), t = totals([{ qty: 1, price: base }].concat(readLines(box)), a.discount, a.taxes); m.q("#k-total").innerHTML = "<b>Invoice total " + cash(t.total) + "</b>"; };
    m.el.addEventListener("input", recalc); m.el.addEventListener("change", recalc);
    m.el.addEventListener("click", (e) => { const x = e.target.closest("[data-rmline]"); if (x) { x.closest(".lrow").remove(); recalc(); } });
    m.q("#add-custom").addEventListener("click", () => { box.insertAdjacentHTML("beforeend", lineRow({ name: "", qty: 1, price: "" })); recalc(); });
    m.q("#pick-fee").addEventListener("change", (e) => { const f = M.fees.find((x) => String(x.row) === e.target.value); if (f) box.insertAdjacentHTML("beforeend", lineRow({ name: f.name, desc: f.desc, qty: f.qty, price: f.price })); e.target.value = ""; recalc(); });
    m.q("#k-date").addEventListener("change", () => { const d = m.q("#k-date").value, du = m.q("#k-due"); if (d && (!du.value || du.value < d)) du.value = d; });
    recalc();
    const go = (invoice) => (e) => savedBusy(e.target, "Saving…", async () => {
      const j = await A.api("admin_status", { row: b.row, status: "Confirmed", invoice });
      if (j.ok) { m.close(); A.toast("Marked confirmed"); A.S.open = null; await A.reload(); load(true); } else A.toast("Couldn't update that booking.", true);
    });
    m.q("#k-yes").addEventListener("click", (e) => { const a = readAdjust(m, "k-"); go({ extras: readLines(box), send: !!(m.q("#k-send") && m.q("#k-send").checked), discount: a.discount, taxes: a.taxes, date: m.q("#k-date").value, due: m.q("#k-due").value })(e); });
    m.q("#k-only").addEventListener("click", go({ skip: true }));
  }

  /* ---------- wiring ---------- */
  function init(helpers) {
    A = helpers;
    document.addEventListener("click", (e) => {
      const root = $("money-root"); if (!root || !root.contains(e.target)) return;
      const sec = e.target.closest("[data-s]"), pay = e.target.closest("[data-p]"), inv = e.target.closest("[data-inv]");
      if (sec) { M.section = sec.dataset.s; render(); if (M.section === "Clients") loadClients(true); return; }
      if (pay) { M.pay = pay.dataset.p; render(); return; }
      if (inv) { detail(+inv.dataset.inv); return; }
      const cl = e.target.closest("[data-client]");
      if (cl) { clientDetail(M.clients.find((c) => String(c.row) === cl.dataset.client)); return; }
      if (e.target.closest("#m-client-new")) { clientDialog(null); return; }
      if (e.target.closest("#m-new")) { editor(null, M.section === "Estimates" ? "Estimate" : "Invoice"); return; }
      if (e.target.closest("#m-item-new")) { itemDialog(null); return; }
      if (e.target.closest("#m-tax-new")) { taxDialog(); return; }
      const fe = e.target.closest("[data-fe]"), fd = e.target.closest("[data-fd]"), td = e.target.closest("[data-td]");
      if (fe) { itemDialog(M.fees.find((f) => String(f.row) === fe.dataset.fe)); return; }
      if (fd) { const f = M.fees.find((x) => String(x.row) === fd.dataset.fd); if (confirm("Delete “" + f.name + "” from Products & Services?")) A.api("admin_fee_remove", { row: f.row }).then((j) => { A.toast(j.ok ? "Deleted" : "Couldn't delete it.", !j.ok); load(true); }).catch(A.fail); return; }
      if (td) { const t = M.taxes.find((x) => String(x.row) === td.dataset.td); if (confirm("Delete the tax “" + t.name + "”?")) A.api("admin_tax_remove", { row: t.row }).then((j) => { A.toast(j.ok ? "Deleted" : "Couldn't delete it.", !j.ok); load(true); }).catch(A.fail); }
    });
    document.addEventListener("input", (e) => { if (e.target.id === "m-cq") { M.cq = e.target.value; const pos = e.target.selectionStart; render(); const el = $("m-cq"); if (el) { el.focus(); el.setSelectionRange(pos, pos); } } });
    document.addEventListener("change", (e) => { if (e.target.id === "m-year") { M.year = +e.target.value; load(true); } });
  }

  window.StudioMoney = { init, load, loadClients, render, confirmDialog, state: M, modal, head, savedBusy };
})();

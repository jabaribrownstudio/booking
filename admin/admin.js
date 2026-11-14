(function () {
  "use strict";
  const C = window.BOOKING_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const KEY_STORE = "studio-admin-key";
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  let key = "";
  try { key = localStorage.getItem(KEY_STORE) || ""; } catch (e) { /* private mode */ }
  const S = { bookings: [], hours: null, off: [], settings: null, filter: "upcoming", open: null, hoursDirty: false, loaded: false };

  /* ---------- helpers ---------- */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const parseYmd = (s) => { const p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); };
  const toMin = (t) => { const p = String(t).split(":"); return +p[0] * 60 + +p[1]; };
  const fromMin = (m) => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
  const t12 = (t) => { if (!t) return ""; const m = toMin(t), h = Math.floor(m / 60); return (h % 12 || 12) + ":" + pad(m % 60) + " " + (h >= 12 && h < 24 ? "PM" : "AM"); };
  const dayLabel = (s) => { const d = parseYmd(s), t = ymd(new Date()); const tm = new Date(); tm.setDate(tm.getDate() + 1);
    const pre = s === t ? "Today · " : s === ymd(tm) ? "Tomorrow · " : ""; return pre + DAYS[d.getDay()].slice(0, 3) + ", " + MONTHS[d.getMonth()] + " " + d.getDate(); };
  const money = (p) => String(p || "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const waNumber = (ph) => { const d = String(ph).replace(/\D/g, ""); return d.length === 7 ? "1876" + d : d.length === 10 ? "1" + d : d; };

  let toastTimer;
  function toast(msg, bad) { const t = $("toast"); t.textContent = msg; t.className = "toast show" + (bad ? " bad" : ""); clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = "toast"; }, 3200); }

  /* ---------- API ---------- */
  async function api(action, data) {
    if (!C.endpoint) throw new Error("no_endpoint");
    let res;
    try {
      res = await fetch(C.endpoint, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(Object.assign({ action, key }, data || {})) });
    } catch (e) { throw new Error("network"); }
    let j; try { j = await res.json(); } catch (e) { throw new Error("bad_response"); }
    if (j && j.error === "unauthorized") { signOut(); throw new Error("unauthorized"); }
    return j;
  }
  const fail = (e) => { if (e.message === "unauthorized") return; toast(e.message === "network" ? "Can't reach the server. Check your connection." : e.message === "no_endpoint" ? "Set the Web app URL (endpoint) in js/config.js first." : "Something went wrong. Try again.", true); };

  async function load(quiet) {
    if (!quiet && !S.loaded) $("list").innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    try {
      const j = await api("admin_list");
      if (!j || !j.ok) { toast("Couldn't load your data.", true); return false; }
      S.bookings = j.bookings; S.off = j.off; S.settings = j.settings; S.loaded = true;
      if (!S.hoursDirty) S.hours = JSON.parse(JSON.stringify(j.hours));
      renderAll(); deepLink(); return true;
    } catch (e) { fail(e); if (!S.loaded) $("list").innerHTML = '<div class="empty">Couldn\'t load bookings.<br>Pull the refresh button to try again.</div>'; return false; }
  }

  /* ---------- login ---------- */
  function showLogin() { $("app").hidden = true; $("login").hidden = false; }
  function showApp() { $("login").hidden = true; $("app").hidden = false; load(); }
  function signOut() { key = ""; try { localStorage.removeItem(KEY_STORE); } catch (e) { /* ignore */ } S.loaded = false; showLogin(); }
  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const btn = $("login-btn"); $("login-err").textContent = "";
    key = $("key").value.trim(); if (!key) return;
    btn.disabled = true; btn.textContent = "Checking…";
    try {
      const j = await api("admin_list");
      if (j && j.ok) { try { localStorage.setItem(KEY_STORE, key); } catch (x) { /* ignore */ } $("key").value = ""; S.loaded = false; showApp(); }
      else $("login-err").textContent = "Something went wrong. Try again.";
    } catch (err) {
      if (err.message === "unauthorized") $("login-err").textContent = "That key isn't right.";
      else if (err.message === "no_endpoint") $("login-err").textContent = "Set the Web app URL (endpoint) in js/config.js first.";
      else $("login-err").textContent = "Can't reach the server. Check your connection.";
    }
    btn.disabled = false; btn.textContent = "Sign in";
  });
  $("signout").addEventListener("click", () => { if (confirm("Sign out of the admin app on this phone?")) signOut(); });
  $("refresh").addEventListener("click", async () => { if (await load(true)) toast("Up to date"); });

  /* ---------- tabs ---------- */
  function selectTab(name) {
    document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("on", x.dataset.t === name));
    ["bookings", "hours", "settings"].forEach((t) => { $("tab-" + t).hidden = t !== name; });
    $("fab").hidden = name !== "bookings"; window.scrollTo(0, 0);
  }
  $("tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-t]"); if (b) selectTab(b.dataset.t); });

  /* ---------- bookings ---------- */
  function visible() {
    const today = ymd(new Date()), f = S.filter, key2 = (b) => b.date + " " + b.start;
    let rows = S.bookings.filter((b) => {
      if (f === "cancelled") return b.status === "Cancelled";
      if (b.status === "Cancelled") return false;
      if (f === "pending") return b.status === "Pending";
      if (f === "past") return b.date < today;
      return b.date >= today;
    });
    rows.sort((a, b) => (f === "past" || f === "cancelled" ? (key2(b) > key2(a) ? 1 : -1) : (key2(a) > key2(b) ? 1 : -1)));
    return rows;
  }
  function renderBookings() {
    const pend = S.bookings.filter((b) => b.status === "Pending" && b.date >= ymd(new Date())).length;
    $("pend-count").hidden = !pend; $("pend-count").textContent = pend;
    document.querySelectorAll("#filters button").forEach((b) => b.classList.toggle("on", b.dataset.f === S.filter));
    const rows = visible();
    if (!rows.length) { $("list").innerHTML = '<div class="empty">' + ({ upcoming: "No upcoming bookings.", pending: "Nothing waiting for you to confirm.", past: "No past bookings.", cancelled: "No cancelled bookings." })[S.filter] + "</div>"; return; }
    let html = "", last = "";
    rows.forEach((b) => {
      if (b.date !== last) { last = b.date; html += '<div class="day-h">' + esc(dayLabel(b.date)) + "</div>"; }
      const open = S.open === b.row;
      html += '<article class="bk" data-row="' + b.row + '"><button type="button" class="bk-head" data-toggle aria-expanded="' + open + '">' +
        '<div class="bk-time">' + esc(t12(b.start)) + "<small>" + esc(b.duration) + " min</small></div>" +
        '<div><div class="bk-name">' + esc(b.name) + '</div><div class="bk-pkg">' + esc(b.pkg) + "</div></div>" +
        '<span class="pill ' + esc(b.status) + '">' + esc(b.status) + "</span></button>";
      if (open) html += details(b);
      html += "</article>";
    });
    $("list").innerHTML = html;
  }
  function details(b) {
    const rows = [["When", dayLabel(b.date) + ", " + t12(b.start) + " to " + t12(b.end)], ["Package", b.pkg + (b.price ? " · " + money(b.price) : "")]];
    const link = (href, text) => '<a href="' + esc(href) + '">' + esc(text) + "</a>";
    let dl = rows.map((r) => "<dt>" + r[0] + "</dt><dd>" + esc(r[1]) + "</dd>").join("");
    if (b.phone) dl += "<dt>Phone</dt><dd>" + link("tel:" + b.phone.replace(/[^\d+]/g, ""), b.phone) + "</dd>";
    if (b.email) dl += "<dt>Email</dt><dd>" + link("mailto:" + b.email, b.email) + "</dd>";
    if (b.instagram) dl += "<dt>Instagram</dt><dd>" + link("https://instagram.com/" + b.instagram.replace(/^@/, ""), b.instagram) + "</dd>";
    if (b.location) dl += "<dt>Location</dt><dd>" + esc(b.location) + "</dd>";
    if (b.notes) dl += "<dt>Notes</dt><dd>" + esc(b.notes) + "</dd>";
    if (b.source) dl += "<dt>Source</dt><dd>" + esc(b.source) + "</dd>";
    let acts = "";
    if (b.status !== "Confirmed") acts += '<button type="button" class="btn sm ok" data-set="Confirmed">Confirm</button>';
    if (b.status === "Confirmed") acts += '<button type="button" class="btn sm" data-set="Pending">Mark pending</button>';
    if (b.status !== "Cancelled") acts += '<button type="button" class="btn sm bad" data-set="Cancelled">Cancel booking</button>';
    else acts += '<button type="button" class="btn sm" data-set="Pending">Restore as pending</button>';
    let contact = "";
    if (b.phone) contact += '<a class="btn sm" href="tel:' + esc(b.phone.replace(/[^\d+]/g, "")) + '">Call</a><a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/' + waNumber(b.phone) + '">WhatsApp</a>';
    return '<div class="bk-body"><dl>' + dl + '</dl><div class="acts">' + acts + '</div><div class="acts">' + contact + "</div></div>";
  }
  $("filters").addEventListener("click", (e) => { const b = e.target.closest("button[data-f]"); if (!b) return; S.filter = b.dataset.f; S.open = null; renderBookings(); });
  $("list").addEventListener("click", async (e) => {
    const art = e.target.closest(".bk"); if (!art) return;
    const row = +art.dataset.row;
    if (e.target.closest("[data-toggle]")) { S.open = S.open === row ? null : row; renderBookings(); return; }
    const set = e.target.closest("[data-set]"); if (!set) return;
    const status = set.dataset.set, b = S.bookings.find((x) => x.row === row);
    if (status === "Cancelled" && !confirm("Cancel " + b.name + "'s booking? The time will open up again for other clients.")) return;
    set.disabled = true; set.textContent = "Saving…";
    try {
      const j = await api("admin_status", { row, status });
      if (j.ok) { b.status = status; toast(status === "Cancelled" ? "Booking cancelled" : "Marked " + status.toLowerCase()); }
      else toast("Couldn't update that booking.", true);
    } catch (err) { fail(err); }
    S.open = null; await load(true);
  });

  /* ---------- availability ---------- */
  function renderWeek() {
    if (!S.hours) return;
    let h = "";
    for (let n = 1; n <= 7; n++) {
      const d = n % 7, w = S.hours[d] || [];
      h += '<div class="arow"><label class="aday"><input type="checkbox" data-day="' + d + '"' + (w.length ? " checked" : "") + "> " + DAYS[d] + (w.length ? "" : ' <span class="muted">Closed</span>') + "</label>";
      w.forEach((x, k) => {
        h += '<div class="awin"><input type="time" data-d="' + d + '" data-k="' + k + '" data-e="0" value="' + x[0] + '" aria-label="' + DAYS[d] + ' opens"><span class="muted">to</span><input type="time" data-d="' + d + '" data-k="' + k + '" data-e="1" value="' + x[1] + '" aria-label="' + DAYS[d] + ' closes">' +
          (w.length > 1 ? '<button type="button" class="x" data-rm="' + d + ":" + k + '" aria-label="Remove this period">×</button>' : "") + "</div>";
      });
      if (w.length) h += '<button type="button" class="link-btn" data-add="' + d + '">+ Add another period</button>';
      h += "</div>";
    }
    $("week").innerHTML = h; $("save-hours").disabled = !S.hoursDirty;
  }
  const dirty = () => { S.hoursDirty = true; $("save-hours").disabled = false; };
  $("week").addEventListener("change", (e) => {
    const t = e.target;
    if (t.hasAttribute("data-day")) { S.hours[+t.dataset.day] = t.checked ? [["09:00", "17:00"]] : []; renderWeek(); dirty(); }
    else if (t.hasAttribute("data-d") && t.value) { S.hours[+t.dataset.d][+t.dataset.k][+t.dataset.e] = t.value; dirty(); }
  });
  $("week").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.add) { const d = +b.dataset.add, w = S.hours[d], s = Math.min(toMin(w[w.length - 1][1]) + 60, 22 * 60); w.push([fromMin(s), fromMin(Math.min(s + 180, 23 * 60 + 59))]); }
    else if (b.dataset.rm) { const p = b.dataset.rm.split(":"); S.hours[+p[0]].splice(+p[1], 1); }
    else return;
    renderWeek(); dirty();
  });
  $("save-hours").addEventListener("click", async () => {
    for (const d in S.hours) for (const w of S.hours[d]) if (!w[0] || !w[1] || toMin(w[1]) <= toMin(w[0])) { toast("Each period must close after it opens.", true); return; }
    const btn = $("save-hours"); btn.disabled = true; btn.textContent = "Saving…";
    try { const j = await api("admin_hours", { hours: S.hours }); if (j.ok) { S.hoursDirty = false; toast("Weekly hours saved"); } else { toast("Couldn't save your hours.", true); btn.disabled = false; } }
    catch (e) { fail(e); btn.disabled = false; }
    btn.textContent = "Save weekly hours"; renderWeek();
  });

  function renderOff() {
    const today = ymd(new Date());
    const rows = S.off.filter((o) => (o.through || o.date) >= today).sort((a, b) => (a.date > b.date ? 1 : -1));
    $("off-list").innerHTML = rows.length ? rows.map((o) => {
      const when = o.through && o.through !== o.date ? dayLabel(o.date).replace(/^(Today|Tomorrow) · /, "") + " to " + dayLabel(o.through).replace(/^(Today|Tomorrow) · /, "") : dayLabel(o.date);
      const part = o.from || o.to ? t12(o.from || "00:00") + " to " + t12(o.to || "24:00") : "Whole day";
      return "<li><div>" + esc(when) + "<small>" + esc(part) + (o.note ? " · " + esc(o.note) : "") + '</small></div><button type="button" class="x" data-rm-off="' + o.row + '" aria-label="Remove">×</button></li>';
    }).join("") : '<li class="muted">No days off coming up.</li>';
  }
  $("off-list").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-rm-off]"); if (!b) return;
    if (!confirm("Remove this time off? Clients will be able to book it again.")) return;
    b.disabled = true;
    try { const j = await api("admin_off_remove", { row: +b.dataset.rmOff }); toast(j.ok ? "Removed" : "Couldn't remove it.", !j.ok); } catch (err) { fail(err); }
    load(true);
  });
  $("off-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const date = $("off-date").value, thru = $("off-thru").value, from = $("off-from").value, to = $("off-to").value;
    if (!date) return;
    if (thru && thru < date) { toast("“Through” must be on or after the date.", true); return; }
    if (from && to && toMin(to) <= toMin(from)) { toast("“To” must be after “From”.", true); return; }
    const btn = $("off-add"); btn.disabled = true;
    try {
      const j = await api("admin_off_add", { date, through: thru, from, to, note: $("off-note").value });
      if (j.ok) { $("off-form").reset(); toast("Time blocked"); await load(true); } else toast("Couldn't save that.", true);
    } catch (err) { fail(err); }
    btn.disabled = false;
  });

  /* ---------- settings ---------- */
  function renderSettings() {
    const s = S.settings; if (!s || document.activeElement && $("set-form").contains(document.activeElement)) return;
    $("s-interval").value = s.slotInterval; $("s-buffer").value = s.bufferMinutes; $("s-notice").value = s.minNoticeHours; $("s-ahead").value = s.maxDaysAhead;
  }
  $("set-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const btn = $("save-set"); btn.disabled = true; btn.textContent = "Saving…";
    try {
      const j = await api("admin_settings", { settings: { slotInterval: $("s-interval").value, bufferMinutes: $("s-buffer").value, minNoticeHours: $("s-notice").value, maxDaysAhead: $("s-ahead").value } });
      if (j.ok) { toast("Settings saved"); await load(true); } else toast("Couldn't save your settings.", true);
    } catch (err) { fail(err); }
    btn.disabled = false; btn.textContent = "Save settings";
  });

  /* ---------- add a booking ---------- */
  const pkgs = C.packages || [];
  $("a-pkg").innerHTML = pkgs.map((p) => '<option value="' + esc(p.id) + '">' + esc(p.name) + "</option>").join("") + '<option value="custom">Custom session</option>';
  function fillPkg() {
    const p = pkgs.find((x) => x.id === $("a-pkg").value);
    if (p) { $("a-dur").value = p.duration; $("a-price").value = p.price; }
  }
  $("a-pkg").addEventListener("change", fillPkg);
  $("a-email").addEventListener("input", () => { $("a-notify-row").hidden = !$("a-email").value.trim(); });
  function openSheet() {
    $("add-form").reset(); $("add-err").textContent = ""; $("a-force-row").hidden = true; $("a-notify-row").hidden = true;
    $("a-date").value = ymd(new Date()); fillPkg(); $("sheet").hidden = false; setTimeout(() => $("a-name").focus(), 50);
  }
  const closeSheet = () => { $("sheet").hidden = true; };
  $("fab").addEventListener("click", openSheet);
  $("sheet").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeSheet(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("sheet").hidden) closeSheet(); });
  $("add-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const err = $("add-err"); err.textContent = "";
    const name = $("a-name").value.trim(), date = $("a-date").value, time = $("a-time").value, dur = parseInt($("a-dur").value, 10);
    if (!name) { err.textContent = "Enter the client's name."; $("a-name").focus(); return; }
    if (!date || !time) { err.textContent = "Choose a date and start time."; return; }
    if (!(dur >= 5)) { err.textContent = "Enter the session length in minutes."; return; }
    const p = pkgs.find((x) => x.id === $("a-pkg").value);
    const btn = $("add-btn"); btn.disabled = true; btn.textContent = "Adding…";
    try {
      const j = await api("admin_add", { name, phone: $("a-phone").value.trim(), email: $("a-email").value.trim(), location: $("a-loc").value.trim(), notes: $("a-notes").value.trim(),
        date, time, duration: dur, packageName: p ? p.name : "Custom session", price: $("a-price").value, currency: C.currency || "", status: $("a-status").value,
        notifyClient: $("a-notify").checked && !$("a-notify-row").hidden, force: $("a-force").checked });
      if (j.ok) { closeSheet(); toast("Booking added"); S.filter = "upcoming"; S.open = j.row; await load(true); }
      else if (j.error === "slot_taken") { err.textContent = "That time overlaps another booking (or its buffer)."; $("a-force-row").hidden = false; }
      else err.textContent = j.error === "invalid_input" ? "Check the details. The email address may be wrong." : "Couldn't add the booking. Try again.";
    } catch (x) { fail(x); }
    btn.disabled = false; btn.textContent = "Add booking";
  });

  /* ---------- start ---------- */
  // Home-screen shortcuts (long-press the app icon): ?view=pending, ?tab=hours, ?add=1
  let deepLinked = false;
  function deepLink() {
    if (deepLinked) return; deepLinked = true;
    const q = new URLSearchParams(location.search), view = q.get("view"), tab = q.get("tab");
    if (["upcoming", "pending", "past", "cancelled"].indexOf(view) > -1) { S.filter = view; renderBookings(); }
    if (tab === "hours" || tab === "settings") selectTab(tab);
    if (q.get("add") === "1") openSheet();
  }
  function renderAll() { renderBookings(); renderWeek(); renderOff(); renderSettings(); }
  if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) navigator.serviceWorker.register("sw.js").catch(() => {});
  document.addEventListener("visibilitychange", () => { if (!document.hidden && key && S.loaded) load(true); });
  // Keep a desktop tab fresh while it is open and visible
  setInterval(() => { if (!document.hidden && key && S.loaded && $("sheet").hidden) load(true); }, 60000);
  if (key) showApp(); else showLogin();
})();

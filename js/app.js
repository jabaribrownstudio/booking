(function () {
  "use strict";

  const C = window.BOOKING_CONFIG;
  const params = new URLSearchParams(location.search);
  const $ = (id) => document.getElementById(id);
  const reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const locale = C.locale || "en-US";
  const TZ = C.timezone || "America/Jamaica";

  /* ---------- helpers ---------- */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => (n < 10 ? "0" : "") + n;
  const ymd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const parseYmd = (s) => { const p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); };
  const toMin = (t) => { const p = t.split(":"); return +p[0] * 60 + +p[1]; };
  const fromMin = (m) => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
  const t12 = (t) => { const m = toMin(t), h = Math.floor(m / 60); return (h % 12 || 12) + ":" + pad(m % 60) + " " + (h >= 12 ? "PM" : "AM"); };
  const fmtTime = t12;
  const fmtRange = (t, mins) => t12(t) + " – " + t12(fromMin(toMin(t) + mins));
  const fmtDate = (s) => parseYmd(s).toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const fmtDay = (s) => parseYmd(s).toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" });
  const fmtDateShort = (s) => parseYmd(s).toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
  const fmtPrice = (n) => (C.currency || "$") + Number(n).toLocaleString(locale);
  const fmtDur = (min) => { const h = Math.floor(min / 60), m = min % 60; return (h ? h + " hr" + (h > 1 ? "s" : "") : "") + (h && m ? " " : "") + (m ? m + " min" : ""); };
  const validHex = (h) => /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(h || "");
  const normHex = (h) => { h = h.replace("#", ""); return h.length === 3 ? h.split("").map((c) => c + c).join("") : h; };
  const rgb = (h) => { h = normHex(h); return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)]; };
  const readableInk = (h) => { const c = rgb(h); return (c[0] * 299 + c[1] * 587 + c[2] * 114) / 1000 > 160 ? "#12161a" : "#ffffff"; };

  const ICONS = {
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    arrowL: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    arrowR: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    cal: '<rect x="4" y="5.5" width="16" height="14.5" rx="3"/><path d="M8 3.5v4M16 3.5v4M4 10h16"/>',
    ig: '<rect x="4" y="4" width="16" height="16" rx="5"/><circle cx="12" cy="12" r="3.6"/><circle cx="16.8" cy="7.2" r=".6"/>',
    mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="3"/><path d="M4 8l8 5.5L20 8"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
    download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>'
  };
  const ic = (n, cls) => '<svg class="ic ' + (cls || "") + '" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[n] + "</svg>";

  /* ---------- font, theme, accent ---------- */
  const fontName = (params.get("font") || C.fontFamily || "Raleway").trim();
  const fontLink = $("font-link");
  if (/^[A-Za-z0-9 ]{2,40}$/.test(fontName) && fontName !== "Raleway") {
    if (fontLink) fontLink.href = "https://fonts.googleapis.com/css2?family=" + fontName.replace(/ /g, "+") + ":wght@400;500;600;700;800&display=swap";
    document.documentElement.style.setProperty("--font", '"' + fontName + '", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif');
  }
  const themeParam = params.get("theme");
  if (themeParam === "dark" || themeParam === "light") document.documentElement.setAttribute("data-theme", themeParam);
  const darkMq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const isDark = () => {
    const t = document.documentElement.getAttribute("data-theme");
    if (t === "dark") return true;
    if (t === "light") return false;
    return !!(darkMq && darkMq.matches);
  };
  function applyAccent() {
    const q = params.get("accent");
    const dark = isDark();
    const accent = validHex(q) ? "#" + normHex(q) : (dark && C.accentDark ? C.accentDark : C.accent);
    if (!accent) return;
    const c = rgb(accent), root = document.documentElement.style;
    root.setProperty("--accent", accent);
    root.setProperty("--accent-ink", readableInk(accent));
    root.setProperty("--accent-soft", "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + (dark ? 0.16 : 0.1) + ")");
  }
  applyAccent();
  if (darkMq && darkMq.addEventListener) darkMq.addEventListener("change", applyAccent);
  if (window.MutationObserver) new MutationObserver(applyAccent).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  /* ---------- embed ---------- */
  const embedParam = params.get("embed");
  const isEmbed = embedParam === "1" || (embedParam !== "0" && window.self !== window.top);
  if (isEmbed) document.body.classList.add("embed");
  const refSource = params.get("ref") || (document.referrer.indexOf("instagram.com") > -1 ? "instagram" : "");
  let heightRaf = 0;
  function postHeight() {
    if (window.parent === window) return;
    cancelAnimationFrame(heightRaf);
    heightRaf = requestAnimationFrame(() => {
      window.parent.postMessage({ type: "booking-resize", height: Math.ceil(document.body.getBoundingClientRect().height) }, "*");
    });
  }
  if (window.ResizeObserver) new ResizeObserver(postHeight).observe(document.body);
  window.addEventListener("load", postHeight);

  /* ---------- state ---------- */
  const today = new Date(); today.setHours(0, 0, 0, 0);
  // Settings from the owner's Google Sheet win over the fallbacks in config.js
  const opt = (k) => (S.settings && S.settings[k] != null ? S.settings[k] : C[k]);
  const maxDate = () => { const d = new Date(today); d.setDate(d.getDate() + (opt("maxDaysAhead") || 90)); return d; };
  const pkgById = (id) => C.packages.filter((p) => p.id === id)[0];
  const S = { step: 1, pkg: null, date: null, time: null, month: null, monthTouched: false, booked: [], hours: null, blocked: [], settings: null, loaded: false, loading: false };
  let inflight = null, advTimer = 0;

  /* ---------- availability ---------- */
  // Opening windows for a weekday: [[open, close], ...]. Server hours (Sheet) else config.js.
  function windowsFor(dow) {
    const h = S.hours ? S.hours[dow] : C.workingHours[dow];
    if (!h || !h.length) return [];
    return typeof h[0] === "string" ? [h] : h;
  }
  function slotsFor(dateStr) {
    if (!S.pkg) return [];
    const d = parseYmd(dateStr), wins = windowsFor(d.getDay());
    if (!wins.length) return [];
    if (!S.hours && (C.blackoutDates || []).indexOf(dateStr) > -1) return [];
    const blocks = S.blocked.filter((b) => b.date === dateStr);
    if (blocks.some((b) => !b.start)) return [];
    const len = S.pkg.duration, step = opt("slotInterval") || 30, buf = opt("bufferMinutes") || 0;
    const earliest = Date.now() + (opt("minNoticeHours") || 0) * 3600000;
    const dayBooked = S.booked.filter((b) => b.date === dateStr);
    const out = [];
    wins.forEach((w) => {
      const open = toMin(w[0]), close = toMin(w[1]);
      for (let s = open; s + len <= close; s += step) {
        const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(s / 60), s % 60);
        if (start.getTime() < earliest) continue;
        const e = s + len;
        if (blocks.some((b) => s < toMin(b.end) && e > toMin(b.start))) continue;
        if (dayBooked.some((b) => s < toMin(b.end) + buf && e + buf > toMin(b.start))) continue;
        const t = fromMin(s);
        if (out.indexOf(t) < 0) out.push(t);
      }
    });
    return out.sort();
  }
  const dayOk = (d) => d >= today && d <= maxDate() && slotsFor(ymd(d)).length > 0;

  function fetchBooked() {
    if (!C.endpoint) return Promise.resolve();
    if (inflight) return inflight;
    S.loading = !S.loaded;
    if (S.step === 2) { renderCal(); renderSoonest(); renderSlots(); }
    const url = C.endpoint + (C.endpoint.indexOf("?") > -1 ? "&" : "?") + "action=booked&t=" + Date.now();
    inflight = fetch(url)
      .then((r) => r.json())
      .then((j) => {
        S.booked = (j && j.booked) || [];
        if (j && j.hours) { S.hours = j.hours; S.blocked = j.blocked || []; S.settings = j.settings || null; }
      })
      .catch(() => { /* keep what we have; the server checks again on submit */ })
      .then(() => {
        inflight = null; S.loaded = true; S.loading = false;
        if (S.step === 2) {
          if (S.date && S.time && slotsFor(S.date).indexOf(S.time) < 0) S.time = null;
          if (!S.monthTouched) ensureMonth();
          renderCal(); renderSoonest(); renderSlots();
        }
        updateChrome();
      });
    return inflight;
  }

  /* ---------- step 1: packages ---------- */
  const featureMins = (f) => {
    const m = /^(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?)$/i.exec(String(f).trim());
    return m ? parseFloat(m[1]) * (/^h/i.test(m[2]) ? 60 : 1) : null;
  };
  function renderPackages() {
    $("packages").innerHTML = C.packages.map((p) => {
      const sel = !!(S.pkg && S.pkg.id === p.id);
      const feats = (p.features || []).filter((f) => featureMins(f) !== p.duration);
      return '<button type="button" class="pkg" data-id="' + esc(p.id) + '" aria-pressed="' + sel + '">' +
        '<span class="ptop"><span class="pdur">' + ic("clock") + esc(fmtDur(p.duration)) + "</span>" +
        '<span class="tick">' + ic("check") + "</span></span>" +
        '<span class="pname">' + esc(p.name) + "</span>" +
        '<span class="pprice">' + esc(fmtPrice(p.price)) + "</span>" +
        '<span class="pfeat">' + feats.map((f) => '<span class="feat">' + ic("check") + "<span>" + esc(f) + "</span></span>").join("") + "</span>" +
        '<span class="pcta">' + (sel ? "Continue" : "Select") + ic("arrowR") + "</span></button>";
    }).join("");
  }
  function choosePackage(id) {
    const p = pkgById(id);
    if (!p) return;
    S.pkg = p;
    if (S.date && S.time && slotsFor(S.date).indexOf(S.time) < 0) S.time = null;
    renderPackages();
    updateChrome();
    fetchBooked();
    clearTimeout(advTimer);
    advTimer = setTimeout(() => go(2, true), reduceMotion ? 0 : 240);
  }

  /* ---------- step 2: date and time ---------- */
  function ensureMonth() {
    if (!S.month) S.month = new Date(today.getFullYear(), today.getMonth(), 1);
    if (S.date) { const d = parseYmd(S.date); S.month = new Date(d.getFullYear(), d.getMonth(), 1); return; }
    if (S.loading) return;
    const max = maxDate();
    for (let d = new Date(today); d <= max; d.setDate(d.getDate() + 1)) {
      if (dayOk(d)) { S.month = new Date(d.getFullYear(), d.getMonth(), 1); return; }
    }
  }
  function renderCal() {
    if (!S.month) S.month = new Date(today.getFullYear(), today.getMonth(), 1);
    const m = S.month;
    $("cal-title").textContent = m.toLocaleDateString(locale, { month: "long", year: "numeric" });
    let dow = "";
    for (let i = 0; i < 7; i++) dow += "<div>" + new Date(2024, 0, 7 + i).toLocaleDateString(locale, { weekday: "narrow" }) + "</div>";
    $("dow").innerHTML = dow;
    const lead = new Date(m.getFullYear(), m.getMonth(), 1).getDay();
    const n = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    let h = "";
    for (let i = 0; i < lead; i++) h += "<span></span>";
    for (let d = 1; d <= n; d++) {
      const dt = new Date(m.getFullYear(), m.getMonth(), d), s = ymd(dt);
      const ok = !S.loading && dayOk(dt);
      h += '<button type="button" class="day' + (ok ? " avail" : "") + (s === S.date ? " selected" : "") + (dt.getTime() === today.getTime() ? " today" : "") +
        '" data-date="' + s + '" aria-label="' + esc(fmtDate(s)) + '"' + (s === S.date ? ' aria-pressed="true"' : "") + (ok ? "" : " disabled") + ">" + d + "</button>";
    }
    $("days").innerHTML = h;
    $("datetime").classList.toggle("is-loading", S.loading);
    $("prev").disabled = m <= new Date(today.getFullYear(), today.getMonth(), 1);
    $("next").disabled = new Date(m.getFullYear(), m.getMonth() + 1, 1) > maxDate();
  }
  function renderSoonest() {
    const wrap = $("soonest-wrap");
    if (S.loading || !S.pkg) { wrap.hidden = true; return; }
    const out = [], max = maxDate();
    for (let d = new Date(today); d <= max && out.length < 3; d.setDate(d.getDate() + 1)) {
      const s = ymd(d), sl = slotsFor(s);
      if (sl.length) out.push({ date: s, time: sl[0] });
    }
    wrap.hidden = !out.length;
    $("soonest").innerHTML = out.map((o) =>
      '<button type="button" class="chip" data-date="' + o.date + '" data-time="' + o.time + '" aria-pressed="' + (S.date === o.date && S.time === o.time) + '">' +
      ic("cal") + "<span>" + esc(fmtDateShort(o.date)) + " · " + esc(fmtTime(o.time)) + "</span></button>").join("");
  }
  function renderSlots() {
    const box = $("slots"), note = $("slots-note"), title = $("slots-title");
    if (S.loading) {
      title.textContent = "Available times"; note.textContent = "Checking availability…";
      box.innerHTML = '<div class="slots">' + '<span class="slot skel" aria-hidden="true"></span>'.repeat(6) + "</div>";
      return;
    }
    if (!S.date) { title.textContent = "Available times"; note.textContent = "Choose a date to see open times."; box.innerHTML = ""; return; }
    title.textContent = fmtDay(S.date);
    const slots = slotsFor(S.date);
    if (!slots.length) { note.textContent = "No times left on this day. Try another date."; box.innerHTML = ""; return; }
    note.textContent = S.pkg.name + " · " + fmtDur(S.pkg.duration) + " · " + (C.timezoneLabel || "local time");
    const groups = [["Morning", (m) => m < 720], ["Afternoon", (m) => m >= 720 && m < 1020], ["Evening", (m) => m >= 1020]];
    box.innerHTML = groups.map((g) => {
      const list = slots.filter((t) => g[1](toMin(t)));
      if (!list.length) return "";
      return '<div class="slot-group"><h4>' + g[0] + '</h4><div class="slots">' + list.map((t) =>
        '<button type="button" class="slot" data-time="' + t + '" aria-pressed="' + (t === S.time) + '">' + esc(fmtTime(t)) + "</button>").join("") + "</div></div>";
    }).join("");
  }

  /* ---------- step 3: details ---------- */
  function renderReview() {
    const p = S.pkg;
    $("review").innerHTML =
      '<div class="r"><div class="rt"><span class="k">Package</span><span class="val"><b>' + esc(p.name) + "</b> · " + esc(fmtDur(p.duration)) + " · " + esc(fmtPrice(p.price)) + '</span></div><button type="button" class="link-btn" data-go="1">Change</button></div>' +
      '<div class="r"><div class="rt"><span class="k">When</span><span class="val"><b>' + esc(fmtDateShort(S.date)) + "</b> · " + esc(fmtRange(S.time, p.duration)) + '</span></div><button type="button" class="link-btn" data-go="2">Change</button></div>';
  }
  const MSG = { firstName: "Enter your first name.", lastName: "Enter your last name.", email: "Enter a valid email address.", phone: "Enter a phone number we can reach you on." };
  function check(k, v) {
    if (k === "firstName" || k === "lastName") return v.length >= 1 ? "" : MSG[k];
    if (k === "email") return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? "" : MSG.email;
    if (k === "phone") return v.replace(/\D/g, "").length >= 7 ? "" : MSG.phone;
    return "";
  }
  function setErr(input, msg) {
    const field = input.closest(".field");
    field.classList.toggle("invalid", !!msg);
    input.setAttribute("aria-invalid", msg ? "true" : "false");
    field.querySelector(".field-error").textContent = msg;
  }
  const form = $("form");
  form.addEventListener("focusout", (e) => {
    const t = e.target;
    if (MSG[t.name] && t.value.trim() !== "") setErr(t, check(t.name, t.value.trim()));
  });
  form.addEventListener("input", (e) => {
    const t = e.target;
    if (MSG[t.name] && t.closest(".field").classList.contains("invalid")) setErr(t, check(t.name, t.value.trim()));
  });
  function setBusy(b) {
    const btn = $("submit");
    btn.disabled = b; btn.classList.toggle("loading", b);
    btn.querySelector(".lbl").textContent = b ? "Sending…" : "Request booking";
  }
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    hideNotice();
    const v = {};
    ["firstName", "lastName", "email", "phone", "instagram", "location", "notes", "website"].forEach((k) => { v[k] = (form.elements[k].value || "").trim(); });
    let firstBad = null;
    ["firstName", "lastName", "email", "phone"].forEach((k) => {
      const msg = check(k, v[k]);
      setErr(form.elements[k], msg);
      if (msg && !firstBad) firstBad = form.elements[k];
    });
    if (firstBad) { firstBad.focus(); return; }
    if (v.website) return; // honeypot: bots fill this in
    const p = {
      firstName: v.firstName, lastName: v.lastName, name: v.firstName + " " + v.lastName, email: v.email, phone: v.phone, instagram: v.instagram, location: v.location, notes: v.notes,
      packageId: S.pkg.id, packageName: S.pkg.name, price: S.pkg.price, currency: C.currency, duration: S.pkg.duration,
      date: S.date, time: S.time, source: refSource, pageUrl: document.referrer || location.href
    };
    if (!C.endpoint) { finish(p, false); return; }
    setBusy(true);
    fetch(C.endpoint, { method: "POST", body: JSON.stringify(p) }) // plain text body avoids a CORS preflight
      .then((r) => r.json())
      .then((j) => {
        if (j && j.ok) { finish(p, true); return; }
        if (j && (j.error === "slot_taken" || j.error === "slot_unavailable")) {
          S.loaded = false; S.time = null;
          go(2, true);
          showNotice(j.error === "slot_unavailable" ? "That time is no longer available. Please choose another." : "That time was just taken. Please choose another.");
          return;
        }
        throw new Error((j && j.error) || "server_error");
      })
      .catch(() => {
        showNotice("We couldn't send your request. Check your connection and try again" + (handleName() ? ", or message us on Instagram" : "") + (C.ownerEmail ? " or email " + C.ownerEmail : "") + ".");
      })
      .then(() => setBusy(false));
  });

  /* ---------- notice ---------- */
  function showNotice(msg) {
    const n = $("notice");
    n.innerHTML = ic("info") + "<span>" + esc(msg) + "</span>";
    n.hidden = false;
    if (!isEmbed) n.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
    postHeight();
  }
  function hideNotice() { $("notice").hidden = true; }

  /* ---------- chrome: progress, summary, action bar ---------- */
  function setVal(id, text) {
    const el = $(id);
    el.textContent = text || "Not chosen yet";
    el.classList.toggle("empty", !text);
  }
  function updateChrome() {
    const p = S.pkg;
    const reach = (n) => n === 1 || (n === 2 && !!p) || (n === 3 && !!(p && S.date && S.time));
    document.querySelectorAll("#progress li").forEach((li) => {
      const n = +li.dataset.step, btn = li.querySelector("button");
      li.classList.toggle("active", n === S.step);
      li.classList.toggle("done", n < S.step);
      btn.disabled = !reach(n);
      if (n === S.step) btn.setAttribute("aria-current", "step"); else btn.removeAttribute("aria-current");
      li.querySelector(".pnum").innerHTML = n < S.step ? ic("check") : String(n);
    });
    setVal("sum-pkg", p ? p.name + " · " + fmtDur(p.duration) : "");
    setVal("sum-date", S.date ? fmtDay(S.date) : "");
    setVal("sum-time", S.date && S.time && p ? fmtRange(S.time, p.duration) : "");
    $("sum-total").textContent = p ? fmtPrice(p.price) : "—";
    $("actions").hidden = S.step < 2 || S.step > 3;
    $("to-3").hidden = S.step !== 2;
    $("submit").hidden = S.step !== 3;
    $("to-3").disabled = !(S.date && S.time);
    $("mini").innerHTML = S.date
      ? "<b>" + esc(fmtDateShort(S.date)) + "</b><span>" + (S.time ? esc(fmtTime(S.time)) : "Pick a time") + "</span>"
      : "<b>Pick a day</b><span>then a time</span>";
    $("actions").dataset.step = String(S.step);
    postHeight();
  }

  /* ---------- navigation ---------- */
  function enter(el) {
    if (reduceMotion) return;
    el.classList.remove("enter"); void el.offsetWidth; el.classList.add("enter");
  }
  function go(n, user) {
    if (n >= 2 && !S.pkg) n = 1;
    if (n === 3 && !(S.date && S.time)) n = 2;
    if (n < 1) n = 1;
    S.step = n;
    hideNotice();
    [1, 2, 3].forEach((i) => { $("step-" + i).hidden = i !== n; });
    $("done").hidden = true;
    $("progress-nav").hidden = false;
    $("layout").dataset.step = String(n);
    if (n === 1) renderPackages();
    if (n === 2) {
      $("s2-sub").textContent = S.pkg.name + " · " + fmtDur(S.pkg.duration) + " · " + fmtPrice(S.pkg.price);
      if (!S.monthTouched) ensureMonth();
      renderCal(); renderSoonest(); renderSlots();
      fetchBooked();
    }
    if (n === 3) renderReview();
    updateChrome();
    enter($("step-" + n));
    if (user) {
      const h = $("t" + n);
      if (h) h.focus({ preventScroll: true });
      if (isEmbed) { if (window.parent !== window) window.parent.postMessage({ type: "booking-step", step: n }, "*"); }
      else $("progress-nav").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }
    postHeight();
  }

  /* ---------- finish ---------- */
  const handleName = () => (C.instagramHandle || "").replace("@", "").trim();
  function summaryText(p) {
    return "Booking request – " + C.businessName + "\n" + p.packageName + " (" + fmtDur(p.duration) + ", " + fmtPrice(p.price) + ")\n" +
      fmtDate(p.date) + ", " + fmtRange(p.time, p.duration) + "\nName: " + p.name + "\nEmail: " + p.email + "\nPhone: " + p.phone +
      (p.instagram ? "\nInstagram: " + p.instagram : "") + (p.location ? "\nLocation: " + p.location : "") + (p.notes ? "\nNotes: " + p.notes : "");
  }
  function gcalUrl(p) {
    const st = (m) => p.date.replace(/-/g, "") + "T" + pad(Math.floor(m / 60)) + pad(m % 60) + "00";
    const sm = toMin(p.time);
    const q = new URLSearchParams({ action: "TEMPLATE", text: C.businessName + " – " + p.packageName, dates: st(sm) + "/" + st(sm + p.duration), details: "Photography session (pending confirmation)" + (p.notes ? "\n" + p.notes : ""), ctz: TZ });
    if (p.location) q.set("location", p.location);
    return "https://calendar.google.com/calendar/render?" + q.toString();
  }
  function downloadIcs(p) {
    const s = parseYmd(p.date), sm = toMin(p.time), em = sm + p.duration;
    const stamp = (m) => s.getFullYear() + pad(s.getMonth() + 1) + pad(s.getDate()) + "T" + pad(Math.floor(m / 60)) + pad(m % 60) + "00";
    const clean = (t) => String(t).replace(/[,;\n]/g, " ");
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Photo Booking//EN", "BEGIN:VEVENT", "UID:" + Date.now() + "@photo-booking",
      "DTSTAMP:" + new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z", "DTSTART:" + stamp(sm), "DTEND:" + stamp(em),
      "SUMMARY:" + clean(C.businessName + " – " + p.packageName), "DESCRIPTION:Photography session (pending confirmation)",
      p.location ? "LOCATION:" + clean(p.location) : "", "END:VEVENT", "END:VCALENDAR"].filter(Boolean).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    a.download = "photo-session.ics";
    document.body.appendChild(a); a.click(); a.remove();
  }
  function finish(p, saved) {
    S.step = 4;
    hideNotice();
    [1, 2, 3].forEach((i) => { $("step-" + i).hidden = true; });
    $("progress-nav").hidden = true;
    $("actions").hidden = true;
    $("layout").dataset.step = "done";
    const first = p.firstName || p.name.split(" ")[0];
    const ig = handleName();
    const mailHref = "mailto:" + encodeURIComponent(C.ownerEmail || "") + "?subject=" + encodeURIComponent("Booking request: " + p.packageName + " " + p.date) + "&body=" + encodeURIComponent(summaryText(p));
    const btnGcal = '<a class="btn ' + (saved ? "primary" : "ghost") + '" href="' + esc(gcalUrl(p)) + '" target="_blank" rel="noopener">' + ic("cal") + "Add to Google Calendar</a>";
    const btnIcs = '<button type="button" class="btn ghost" id="ics">' + ic("download") + "Apple / Outlook calendar</button>";
    const btnIg = ig ? '<a class="btn ghost" id="ig-dm" href="https://ig.me/m/' + encodeURIComponent(ig) + '" target="_blank" rel="noopener">' + ic("ig") + "Message us on Instagram</a>" : "";
    const btnMail = !saved ? '<a class="btn primary" href="' + esc(mailHref) + '">' + ic("mail") + "Send details by email</a>" : "";
    const btnAgain = '<button type="button" class="btn ghost" id="again">Book another session</button>';
    const el = $("done");
    el.hidden = false;
    el.innerHTML =
      '<div class="ticket"><div class="badge">' + ic(saved ? "check" : "mail") + "</div>" +
      '<h2 class="step-title" id="td" tabindex="-1">' + (saved ? "Request sent" : "One more step") + "</h2>" +
      '<p class="step-sub">' + (saved
        ? "Thanks, " + esc(first) + ". We've emailed a confirmation to " + esc(p.email) + " and will be in touch to confirm your session."
        : "Send us your details so we can lock in your session, " + esc(first) + ".") + "</p>" +
      '<div class="ticket-card"><div class="rows">' +
      '<div class="r"><span class="k">Package</span><b>' + esc(p.packageName) + "</b></div>" +
      '<div class="r"><span class="k">Date</span><b>' + esc(fmtDate(p.date)) + "</b></div>" +
      '<div class="r"><span class="k">Time</span><b>' + esc(fmtRange(p.time, p.duration)) + "</b></div>" +
      '<div class="r"><span class="k">Total</span><b>' + esc(fmtPrice(p.price)) + "</b></div></div>" +
      '<div class="ticket-actions">' + btnMail + btnGcal + btnIcs + btnIg + btnAgain + "</div></div></div>";
    enter(el);
    $("ics").addEventListener("click", () => downloadIcs(p));
    $("again").addEventListener("click", () => {
      S.pkg = null; S.date = null; S.time = null; S.monthTouched = false; S.month = null; S.loaded = false;
      form.reset();
      fetchBooked();
      go(1, true);
    });
    if (ig) $("ig-dm").addEventListener("click", () => { try { navigator.clipboard.writeText(summaryText(p)); } catch (e) { /* ignore */ } });
    if (window.parent !== window) window.parent.postMessage({ type: "booking-complete", booking: { date: p.date, time: p.time, packageId: p.packageId } }, "*");
    const h = $("td"); if (h) h.focus({ preventScroll: true });
    if (isEmbed) { if (window.parent !== window) window.parent.postMessage({ type: "booking-step", step: 4 }, "*"); }
    else $("app").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    postHeight();
  }

  /* ---------- instagram posts ---------- */
  function renderInstagram() {
    const posts = (C.instagramPosts || []).filter((u) => /^https:\/\/(www\.)?instagram\.com\/(p|reel)\//.test(u));
    if (!posts.length) return;
    $("insta").hidden = false;
    $("insta-grid").innerHTML = posts.map((u) => '<blockquote class="instagram-media" data-instgrm-permalink="' + esc(u) + '" data-instgrm-version="14"></blockquote>').join("");
    const s = document.createElement("script");
    s.async = true; s.src = "https://www.instagram.com/embed.js";
    s.onload = () => { if (window.instgrm) window.instgrm.Embeds.process(); setTimeout(postHeight, 1500); };
    document.body.appendChild(s);
  }

  /* ---------- wire up ---------- */
  document.querySelectorAll("[data-ic]").forEach((el) => { el.innerHTML = ic(el.dataset.ic); });
  document.title = "Book a session – " + C.businessName;
  if (C.logo) {
    const img = document.createElement("img");
    img.src = C.logo; img.alt = C.businessName; img.className = "logo";
    img.addEventListener("load", postHeight);
    $("biz-name").textContent = ""; $("biz-name").appendChild(img);
  } else $("biz-name").textContent = C.businessName;
  $("tagline").textContent = C.tagline || "";
  if (handleName()) {
    const a = $("ig-follow");
    a.hidden = false;
    a.href = "https://instagram.com/" + encodeURIComponent(handleName());
    a.innerHTML = ic("ig") + "<span>@" + esc(handleName()) + "</span>";
  }
  $("foot").innerHTML = (C.footerText ? esc(C.footerText) + "<br>" : "") + "Times shown in " + esc(C.timezoneLabel || "local time") + ".";

  $("packages").addEventListener("click", (e) => { const b = e.target.closest(".pkg"); if (b) choosePackage(b.dataset.id); });
  $("progress").addEventListener("click", (e) => {
    const b = e.target.closest("button"), li = e.target.closest("li");
    if (!b || !li || b.disabled) return;
    const n = +li.dataset.step;
    if (n !== S.step) go(n, true);
  });
  $("days").addEventListener("click", (e) => {
    const b = e.target.closest(".day");
    if (!b || b.disabled) return;
    S.date = b.dataset.date; S.time = null;
    renderCal(); renderSoonest(); renderSlots(); updateChrome();
    if (!isEmbed && window.matchMedia && window.matchMedia("(max-width: 700px)").matches) $("slots-card").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
  });
  $("slots").addEventListener("click", (e) => {
    const b = e.target.closest("button.slot");
    if (!b) return;
    S.time = b.dataset.time;
    renderSlots(); renderSoonest(); updateChrome();
  });
  $("soonest").addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    S.date = b.dataset.date; S.time = b.dataset.time;
    const d = parseYmd(S.date); S.month = new Date(d.getFullYear(), d.getMonth(), 1);
    renderCal(); renderSoonest(); renderSlots(); updateChrome();
  });
  $("prev").addEventListener("click", () => { S.monthTouched = true; S.month = new Date(S.month.getFullYear(), S.month.getMonth() - 1, 1); renderCal(); });
  $("next").addEventListener("click", () => { S.monthTouched = true; S.month = new Date(S.month.getFullYear(), S.month.getMonth() + 1, 1); renderCal(); });
  // Pick up changes to the owner's hours or new bookings when the visitor returns to the page
  const refresh = () => { if (S.step === 2 && C.endpoint && !document.hidden) fetchBooked(); };
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);
  $("back").addEventListener("click", () => go(S.step - 1, true));
  $("to-3").addEventListener("click", () => go(3, true));
  $("review").addEventListener("click", (e) => { const b = e.target.closest("[data-go]"); if (b) go(+b.dataset.go, true); });

  renderInstagram();
  const pre = params.get("package"), preP = pre && pkgById(pre);
  if (preP) { S.pkg = preP; go(2, false); } else { go(1, false); fetchBooked(); }
})();

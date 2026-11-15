(function () {
  "use strict";
  const C = window.BOOKING_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const KEY_STORE = "studio-admin-key";
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  let key = "";
  try { key = localStorage.getItem(KEY_STORE) || ""; } catch (e) { /* private mode */ }
  const S = { me: null, staff: [], bookings: [], hours: null, off: [], settings: null, filter: "upcoming", open: null, hoursDirty: false, loaded: false };

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

  /* ---------- Cloudflare Worker sign-in (username + password) ---------- */
  const W = (C.authWorker || "").replace(/\/+$/, "");
  const IDLE_MS = (C.sessionMinutes || 30) * 60000;
  let CRED = null; // { u, hash }: lives in memory only, never written to storage
  let lastActive = Date.now(), afterPw = null, afterSecret = null;
  const signedIn = () => (W ? !!CRED : !!key);
  const b64 = (buf) => { let s = ""; new Uint8Array(buf).forEach((x) => { s += String.fromCharCode(x); }); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function hashPw(pw, saltB64) { // PBKDF2, SHA-256, 150,000 rounds, 256 bits (the Worker expects exactly this)
    const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
    return b64(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64(saltB64), iterations: 150000 }, k, 256));
  }
  async function newPw(pw) { const salt = b64(crypto.getRandomValues(new Uint8Array(16))); return { salt, hash: await hashPw(pw, salt) }; }
  async function wpost(path, body) {
    let res; try { res = await fetch(W + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); } catch (e) { throw new Error("network"); }
    let j = null; try { j = await res.json(); } catch (e) { /* not JSON */ }
    return { status: res.status, j: j || {} };
  }
  const waitText = (j) => { const s = j.retryAfter || 60; return s >= 90 ? Math.ceil(s / 60) + " minutes" : s + " seconds"; };
  const genPw = () => { const A = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"; return Array.from(crypto.getRandomValues(new Uint8Array(12)), (x) => A[x % A.length]).join(""); };
  function pwProblem(pw, pw2, user) {
    if (pw.length < 10) return "Use at least 10 characters.";
    if (user && pw.toLowerCase().indexOf(String(user).toLowerCase()) > -1) return "The password can't contain the username.";
    if (pw !== pw2) return "The two passwords don't match.";
    return "";
  }
  async function wteam(op, extra) {
    if (!CRED) { signOut(); throw new Error("unauthorized"); }
    const r = await wpost("/team", Object.assign({}, extra || {}, { u: CRED.u, hash: CRED.hash, op }));
    if (r.status === 401) { signOut("Your sign-in is no longer valid. Please sign in again."); throw new Error("unauthorized"); }
    if (r.status === 429) { toast("Too many attempts. Try again in " + waitText(r.j) + ".", true); return { ok: false, error: "locked" }; }
    if (r.j.error === "forbidden") toast("You don't have permission to do that.", true);
    return r.j;
  }
  // Idle timeout: any tap or key press counts as activity (checked every 30 seconds)
  ["pointerdown", "keydown"].forEach((ev) => document.addEventListener(ev, () => { if (Date.now() - lastActive > 5000) lastActive = Date.now(); }, { passive: true }));
  setInterval(() => { if (W && CRED && Date.now() - lastActive > IDLE_MS) signOut("You were signed out after " + Math.round(IDLE_MS / 60000) + " minutes of inactivity."); }, 30000);

  /* ---------- API ---------- */
  async function api(action, data) {
    if (W) {
      if (!CRED) { signOut(); throw new Error("unauthorized"); }
      const r = await wpost("/api", Object.assign({}, data || {}, { u: CRED.u, hash: CRED.hash, action }));
      if (r.status === 401) { signOut("Your sign-in is no longer valid. Please sign in again."); throw new Error("unauthorized"); }
      if (r.status === 429) { toast("Too many attempts. Try again in " + waitText(r.j) + ".", true); return { ok: false, error: "locked" }; }
      if (r.j.error === "must_change") { openPw(true, () => load()); return { ok: false, error: "must_change" }; }
      if (r.status === 502) { toast("The booking sheet didn't respond. Try again.", true); return { ok: false, error: "backend" }; }
      if (r.j.error === "forbidden") toast("You don't have permission to do that.", true);
      return r.j;
    }
    if (!C.endpoint) throw new Error("no_endpoint");
    let res;
    try {
      res = await fetch(C.endpoint, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(Object.assign({ action, key }, data || {})) });
    } catch (e) { throw new Error("network"); }
    let j; try { j = await res.json(); } catch (e) { throw new Error("bad_response"); }
    if (j && j.error === "unauthorized") { signOut(); throw new Error("unauthorized"); }
    if (j && j.error === "forbidden") toast("You don't have permission to do that.", true);
    return j;
  }
  const fail = (e) => { if (e.message === "unauthorized") return; toast(e.message === "network" ? "Can't reach the server. Check your connection." : e.message === "no_endpoint" ? "Set the Web app URL (endpoint) in js/config.js first." : "Something went wrong. Try again.", true); };

  async function load(quiet) {
    if (!quiet && !S.loaded) $("list").innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    try {
      const j = await api("admin_list", S.all ? { all: true } : {});
      if (!j || !j.ok) { toast("Couldn't load your data.", true); return false; }
      S.bookings = j.bookings; S.off = j.off; S.settings = j.settings; S.me = j.me || { name: "", role: "Staff" }; S.loaded = true;
      applyRole();
      if (S.me.role === "Owner") loadTeam();
      if (!S.hoursDirty) S.hours = JSON.parse(JSON.stringify(j.hours));
      S.truncated = !!j.truncated; if (can.money() && window.StudioMoney && !window.StudioMoney.state.loaded) window.StudioMoney.load(true);
      notifyNew(); renderAll(); deepLink(); return true;
    } catch (e) { fail(e); if (!S.loaded) $("list").innerHTML = '<div class="empty">Couldn\'t load bookings.<br>Pull the refresh button to try again.</div>'; return false; }
  }

  /* ---------- login ---------- */
  const LEADS = { "login-form": "Enter your admin key to manage bookings and your availability.", "pw-form": "Sign in to manage bookings and your availability.",
    "setup-form": "First time here? Create the owner account. You'll need the setup code you saved in Cloudflare.", "recover-form": "Use the recovery code you saved when you created the owner account." };
  function loginMode(mode) {
    ["login-form", "pw-form", "setup-form", "recover-form"].forEach((id) => { $(id).hidden = id !== mode; });
    $("login-lead").textContent = LEADS[mode]; $("login-foot").hidden = mode !== "login-form";
    ["login-err", "pw-err", "setup-err", "recover-err"].forEach((id) => { $(id).textContent = ""; });
  }
  function showLogin(note) {
    $("app").hidden = true; $("login").hidden = false;
    $("login-note").hidden = !note; $("login-note").textContent = note || "";
    loginMode(W ? (S.empty ? "setup-form" : "pw-form") : "login-form");
  }
  function showApp() { $("login").hidden = true; $("app").hidden = false; $("chpw").hidden = !W; $("chun").hidden = !W; $("notif").hidden = !("Notification" in window); load(); }
  function signOut(note) {
    key = ""; CRED = null; S.me = null; S.staff = [];
    try { localStorage.removeItem(KEY_STORE); } catch (e) { /* ignore */ }
    S.loaded = false; S.hoursDirty = false; $("pwbox").hidden = true; $("keybox").hidden = true; showLogin(typeof note === "string" ? note : "");
  }
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

  /* ----- username + password (Cloudflare Worker) ----- */
  async function wSignIn(u, pw) {
    const s = await wpost("/salt", { u });
    const hash = await hashPw(pw, s.j.salt || "AAAAAAAAAAAAAAAAAAAAAA==");
    const r = await wpost("/login", { u, hash });
    if (r.status === 429) { const e = new Error("locked"); e.wait = waitText(r.j); throw e; }
    if (r.status !== 200 || !r.j.ok) throw new Error("bad");
    CRED = { u, hash }; lastActive = Date.now(); return r.j.user;
  }
  function enterApp(user) { $("login-note").hidden = true; if (user.mustChange) { $("login").hidden = true; openPw(true, showApp); } else showApp(); }
  const signInErr = (err) => err.message === "locked" ? "Too many attempts. Try again in " + err.wait + "." : err.message === "bad" ? "Username or password is incorrect." : "Can't reach the server. Check your connection.";
  $("pw-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const btn = $("pw-btn"); $("pw-err").textContent = "";
    btn.disabled = true; btn.textContent = "Signing in…";
    try { const user = await wSignIn($("u").value.trim(), $("p").value); $("p").value = ""; enterApp(user); }
    catch (err) { $("pw-err").textContent = signInErr(err); }
    btn.disabled = false; btn.textContent = "Sign in";
  });
  $("to-recover").addEventListener("click", () => loginMode("recover-form"));
  $("to-signin").addEventListener("click", () => loginMode("pw-form"));
  $("setup-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const err = $("setup-err"), btn = $("setup-btn"); err.textContent = "";
    const username = $("s-user").value.trim().toLowerCase(), pw = $("s-pw").value;
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) { err.textContent = "Username: 3 to 30 letters, numbers, dots, dashes or underscores."; return; }
    const prob = pwProblem(pw, $("s-pw2").value, username); if (prob) { err.textContent = prob; return; }
    btn.disabled = true; btn.textContent = "Creating…";
    try {
      const r = await wpost("/setup", { code: $("s-code").value.trim(), name: $("s-name").value.trim(), username, email: $("s-email").value.trim(), pw: await newPw(pw) });
      if (r.j.ok) {
        ["s-code", "s-pw", "s-pw2"].forEach((id) => { $(id).value = ""; });
        S.empty = false;
        afterSecret = async () => { try { enterApp(await wSignIn(username, pw)); } catch (x) { loginMode("pw-form"); } };
        showSecret({ title: "Save your recovery code", lead: "If you ever forget your password, <b>this code is the only way back in</b>. Write it down and keep it somewhere safe. It is shown only once.", value: r.j.recovery });
      } else if (r.status === 403) err.textContent = "That setup code isn't right.";
      else if (r.status === 409) { S.empty = false; loginMode("pw-form"); }
      else err.textContent = "Couldn't create the account. Check the details and try again.";
    } catch (x) { err.textContent = "Can't reach the server. Check your connection."; }
    btn.disabled = false; btn.textContent = "Create owner account";
  });
  $("recover-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const err = $("recover-err"), btn = $("recover-btn"); err.textContent = "";
    const username = $("r-user").value.trim(), pw = $("r-pw").value;
    const prob = pwProblem(pw, $("r-pw2").value, username); if (prob) { err.textContent = prob; return; }
    btn.disabled = true; btn.textContent = "Resetting…";
    try {
      const r = await wpost("/recover", { u: username, rec: $("r-code").value.trim(), pw: await newPw(pw) });
      if (r.j.ok) {
        ["r-code", "r-pw", "r-pw2"].forEach((id) => { $(id).value = ""; });
        afterSecret = async () => { try { enterApp(await wSignIn(username, pw)); } catch (x) { loginMode("pw-form"); } };
        showSecret({ title: "Password changed", lead: "Here is your <b>new recovery code</b>. The old one no longer works. Write it down and keep it somewhere safe. It is shown only once.", value: r.j.recovery });
      } else if (r.status === 429) err.textContent = "Too many attempts. Try again in " + waitText(r.j) + ".";
      else err.textContent = "That username or recovery code isn't right.";
    } catch (x) { err.textContent = "Can't reach the server. Check your connection."; }
    btn.disabled = false; btn.textContent = "Reset password";
  });

  /* ----- change password ----- */
  function openPw(forced, cb) {
    $("pw-box-form").reset(); $("pw-box-err").textContent = ""; afterPw = cb || null;
    $("pw-x").hidden = !!forced; $("pw-signout").hidden = !forced; $("pwbox").dataset.forced = forced ? "1" : "";
    $("pw-lead").textContent = forced ? "Choose your own password to continue. Use at least 10 characters. A few random words with a number works well." : "Use at least 10 characters. A few random words with a number works well.";
    $("pwbox").hidden = false; setTimeout(() => $("pw-cur").focus(), 50);
  }
  $("chpw").addEventListener("click", () => openPw(false));
  $("pw-signout").addEventListener("click", () => signOut());
  $("pwbox").addEventListener("click", (e) => { if (e.target.closest("[data-closepw]") && !$("pwbox").dataset.forced) $("pwbox").hidden = true; });
  $("pw-box-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const err = $("pw-box-err"), btn = $("pw-box-btn"); err.textContent = "";
    const cur = $("pw-cur").value, np = $("pw-new").value;
    const prob = pwProblem(np, $("pw-new2").value, CRED && CRED.u); if (prob) { err.textContent = prob; return; }
    if (np === cur) { err.textContent = "Choose a password you haven't used."; return; }
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      const s = await wpost("/salt", { u: CRED.u }), curHash = await hashPw(cur, s.j.salt), pw = await newPw(np);
      const r = await wpost("/pwset", { u: CRED.u, hash: CRED.hash, cur: curHash, pw });
      if (r.j.ok) { CRED.hash = pw.hash; $("pwbox").hidden = true; $("pwbox").dataset.forced = ""; toast("Password changed"); const cb = afterPw; afterPw = null; if (cb) cb(); }
      else if (r.status === 401) { signOut("Your sign-in is no longer valid. Please sign in again."); }
      else err.textContent = "Your current password isn't right.";
    } catch (x) { err.textContent = "Can't reach the server. Check your connection."; }
    btn.disabled = false; btn.textContent = "Save new password";
  });
  $("signout").addEventListener("click", () => { if (confirm("Sign out of the admin app on this phone?")) signOut(); });
  $("refresh").addEventListener("click", async () => { if (await load(true)) toast("Up to date"); });

  /* ---------- tabs ---------- */
  function selectTab(name) {
    if (can[name] && !can[name]()) name = "bookings";
    document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("on", x.dataset.t === name));
    ["bookings", "money", "hours", "settings", "team"].forEach((t) => { $("tab-" + t).hidden = t !== name; });
    if (name === "money" && window.StudioMoney) { window.StudioMoney.render(); window.StudioMoney.load(true); }
    $("fab").hidden = name !== "bookings"; window.scrollTo(0, 0);
  }
  $("tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-t]"); if (b) selectTab(b.dataset.t); });

  /* ---------- roles ---------- */
  const can = { money: () => S.me && S.me.role !== "Staff", hours: () => S.me && S.me.role !== "Staff", settings: () => S.me && S.me.role !== "Staff", team: () => S.me && S.me.role === "Owner", bookings: () => true };
  function applyRole() {
    $("who").textContent = S.me ? (S.me.role === "Owner" && !W ? "Owner" : S.me.name + " · " + S.me.role) : "";
    $("tab-money-btn").hidden = !can.money(); $("tab-hours-btn").hidden = !can.hours(); $("tab-settings-btn").hidden = !can.settings(); $("tab-team-btn").hidden = !can.team();
    const cur = document.querySelector("#tabs button.on");
    if (cur && cur.hidden) selectTab("bookings");
  }

  /* ---------- team (owner only) ---------- */
  async function loadTeam() {
    try {
      if (W) { const j = await wteam("list"); if (j && j.ok) { S.staff = j.users.map((x) => Object.assign({ row: x.id, added: x.created }, x)); renderTeam(); } return; }
      const j = await api("admin_staff_list"); if (j && j.ok) { S.staff = j.staff; renderTeam(); }
    } catch (e) { /* shown elsewhere */ }
  }
  function renderTeam() {
    $("team-list").innerHTML = S.staff.length ? S.staff.map((m) =>
      '<div class="member" data-row="' + m.row + '"><div class="member-top"><div><div class="member-name">' + esc(m.name) + "</div><small>" + (W ? "@" + esc(m.username) + " · " + (m.lastLogin ? "Last sign-in " + esc(m.lastLogin.slice(0, 10)) : "Never signed in") + (m.mustChange ? " · must choose a password" : "") : "Added " + esc(m.added || "")) + "</small></div>" +
      '<span class="pill ' + (m.active ? esc(m.role) : "Locked") + '">' + (m.active ? esc(m.role) : "Locked out") + "</span></div>" +
      (m.role === "Owner" ? "" : '<div class="acts"><button type="button" class="btn sm" data-m="role">Make ' + (m.role === "Staff" ? "Manager" : "Staff") + '</button>' +
      '<button type="button" class="btn sm" data-m="reset">' + (W ? "Reset password" : "New key") + '</button>' +
      '<button type="button" class="btn sm" data-m="active">' + (m.active ? "Lock out" : "Unlock") + '</button>' +
      '<button type="button" class="btn sm bad" data-m="remove">Remove</button></div>') + "</div>").join("")
      : '<div class="empty">No team members yet. Add your first one below.</div>';
  }
  let lastKey = null;
  function showSecret(o) {
    lastKey = o; $("key-title").textContent = o.title; $("key-lead").innerHTML = o.lead; $("key-val").textContent = o.value;
    $("copy-invite").hidden = !o.invite; $("keybox").hidden = false;
  }
  const showKey = (name, k) => showSecret({ title: "Sign-in key created", value: k,
    lead: "Send this key to <b>" + esc(name) + "</b> privately. <b>It is shown only once.</b> If it gets lost, just make a new key.",
    invite: "Hi " + name.split(" ")[0] + ", here is your sign-in for the " + (C.businessName || "studio") + " booking app.\nOpen: " + location.origin + location.pathname + "\nYour key: " + k + "\nKeep it private, and don't share it." });
  async function copy(text, ok) {
    try { await navigator.clipboard.writeText(text); toast(ok); }
    catch (e) { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); toast(ok); } catch (x) { toast("Couldn't copy. Select the text and copy it.", true); } ta.remove(); }
  }
  $("copy-key").addEventListener("click", () => lastKey && copy(lastKey.value, "Copied"));
  $("copy-invite").addEventListener("click", () => lastKey && lastKey.invite && copy(lastKey.invite, "Message copied"));
  $("keybox").addEventListener("click", (e) => {
    if (!e.target.closest("[data-closekey]")) return;
    $("keybox").hidden = true; lastKey = null; $("key-val").textContent = "";
    const cb = afterSecret; afterSecret = null; if (cb) cb();
  });
  $("team-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const name = $("t-name").value.trim(); $("team-err").textContent = ""; if (!name) return;
    const btn = $("team-add"); btn.disabled = true;
    try {
      if (W) {
        const username = $("t-user").value.trim().toLowerCase(), temp = $("t-pw").value || genPw();
        if (!/^[a-z0-9._-]{3,30}$/.test(username)) { $("team-err").textContent = "Username: 3 to 30 letters, numbers, dots, dashes or underscores."; btn.disabled = false; return; }
        if (temp.length < 10) { $("team-err").textContent = "The temporary password needs at least 10 characters."; btn.disabled = false; return; }
        const j = await wteam("add", { username, name, email: $("t-email").value.trim(), role: $("t-role").value, pw: await newPw(temp) });
        if (j.ok) {
          $("team-form").reset(); loadTeam();
          showSecret({ title: "Account created", value: "Username: " + username + "\nTemporary password: " + temp,
            lead: "Send these sign-in details to <b>" + esc(name) + "</b> privately. They'll choose their own password the first time they sign in. <b>This is shown only once.</b>",
            invite: "Hi " + name.split(" ")[0] + ", here is your sign-in for the " + (C.businessName || "studio") + " booking app.\nOpen: " + location.origin + location.pathname + "\nUsername: " + username + "\nTemporary password: " + temp + "\nYou'll choose your own password when you first sign in." });
        } else if (j.error === "exists") $("team-err").textContent = "That username or email is already used.";
        else if (j.error !== "forbidden" && j.error !== "locked") $("team-err").textContent = "Couldn't add that person. Check the details and try again.";
      } else {
        const j = await api("admin_staff_add", { name, role: $("t-role").value });
        if (j.ok) { $("team-form").reset(); showKey(j.name, j.key); loadTeam(); } else $("team-err").textContent = "Couldn't add that person. Try again.";
      }
    } catch (err) { fail(err); }
    btn.disabled = false;
  });
  $("team-list").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-m]"); if (!b) return;
    const row = b.closest(".member").dataset.row, m = S.staff.find((x) => String(x.row) === row), act = b.dataset.m;
    let call;
    if (act === "role") call = () => (W ? wteam("update", { id: m.id, role: m.role === "Staff" ? "Manager" : "Staff" }) : api("admin_staff_update", { row: +row, role: m.role === "Staff" ? "Manager" : "Staff" }));
    else if (act === "active") { if (m.active && !confirm("Lock " + m.name + " out? They'll be signed out straight away.")) return; call = () => (W ? wteam("update", { id: m.id, active: !m.active }) : api("admin_staff_update", { row: +row, active: !m.active })); }
    else if (act === "remove") { if (!confirm("Remove " + m.name + "? Their sign-in stops working. Bookings they handled keep their name.")) return; call = () => (W ? wteam("remove", { id: m.id }) : api("admin_staff_remove", { row: +row })); }
    else if (act === "reset") {
      if (!confirm(W ? "Reset " + m.name + "'s password? Their current password stops working." : "Make a new key for " + m.name + "? The old key stops working.")) return;
      call = async () => {
        if (W) { const temp = genPw(), j = await wteam("setpw", { id: m.id, pw: await newPw(temp) });
          if (j.ok) showSecret({ title: "Password reset", value: "Username: " + m.username + "\nTemporary password: " + temp, lead: "Send these details to <b>" + esc(m.name) + "</b> privately. They'll choose a new password when they sign in. <b>Shown only once.</b>",
            invite: "Hi " + m.name.split(" ")[0] + ", your password was reset.\nOpen: " + location.origin + location.pathname + "\nUsername: " + m.username + "\nTemporary password: " + temp + "\nYou'll choose a new password when you sign in." });
          return j; }
        const j = await api("admin_staff_reset", { row: +row }); if (j.ok) showKey(j.name, j.key); return j;
      };
    }
    b.disabled = true;
    try { const j = await call(); if (!j.ok && j.error !== "forbidden" && j.error !== "locked") toast("Couldn't do that. Try again.", true); } catch (err) { fail(err); }
    loadTeam();
  });

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
    const t0 = ymd(new Date()), t30 = new Date(); t30.setDate(t30.getDate() + 29); const t30s = ymd(t30);
    const live = S.bookings.filter((b) => b.status !== "Cancelled");
    $("bk-stats").innerHTML = [["Today", live.filter((b) => b.date === t0).length], ["Next 30 days", live.filter((b) => b.date >= t0 && b.date <= t30s).length], ["Pending", pend]].map((x) => '<div class="stat"><small>' + x[0] + "</small><b>" + x[1] + "</b></div>").join("");
    document.querySelectorAll("#filters button").forEach((b) => b.classList.toggle("on", b.dataset.f === S.filter));
    const rows = visible();
    if (!rows.length) { $("list").innerHTML = (S.truncated && !S.all && (S.filter === "past" || S.filter === "cancelled") ? '<button type="button" class="btn block older" data-older>Load older bookings</button>' : "") + '<div class="empty">' + ({ upcoming: "No upcoming bookings.", pending: "Nothing waiting for you to confirm.", past: "No past bookings.", cancelled: "No cancelled bookings." })[S.filter] + "</div>"; return; }
    let html = "", last = "";
    const older = S.truncated && !S.all && (S.filter === "past" || S.filter === "cancelled") ? '<button type="button" class="btn block older" data-older>Load older bookings</button>' : "";
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
    $("list").innerHTML = html + older;
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
    if (b.handledBy) dl += "<dt>Handled by</dt><dd>" + esc(b.handledBy) + "</dd>";
    let acts = "";
    if (b.status !== "Confirmed") acts += '<button type="button" class="btn sm ok" data-set="Confirmed">Confirm</button>';
    if (b.status === "Confirmed") acts += '<button type="button" class="btn sm" data-set="Pending">Mark pending</button>';
    if (b.status !== "Cancelled") acts += '<button type="button" class="btn sm bad" data-set="Cancelled">Cancel booking</button>';
    else acts += '<button type="button" class="btn sm" data-set="Pending">Restore as pending</button>';
    if (b.email && b.status !== "Cancelled") acts += '<button type="button" class="btn sm" data-remind>Send reminder to client</button>';
    let contact = "";
    if (b.phone) contact += '<a class="btn sm" href="tel:' + esc(b.phone.replace(/[^\d+]/g, "")) + '">Call</a><a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/' + waNumber(b.phone) + '">WhatsApp</a>';
    return '<div class="bk-body"><dl>' + dl + '</dl><div class="acts">' + acts + '</div>' + (b.email && b.status === "Confirmed" ? '<p class="muted small">The client is also reminded automatically the day before.</p>' : "") + '<div class="acts">' + contact + "</div></div>";
  }
  $("filters").addEventListener("click", (e) => { const b = e.target.closest("button[data-f]"); if (!b) return; S.filter = b.dataset.f; S.open = null; renderBookings(); });
  function cancelDialog(b) {
    const M = window.StudioMoney, m = M.modal(M.head("Cancel this booking?") + "<p>" + esc(b.name) + "'s time will open up again for other clients.</p>" +
      '<label>Comment <span class="muted">(optional)</span><textarea id="cx-note" rows="3"></textarea></label><p class="muted small">' + (b.email ? "Included in the cancellation email to the client." : "Saved in the booking's notes.") + '</p>' +
      '<div class="stack"><button class="btn bad block" id="cx-go" type="button">Cancel booking</button><button class="btn block" data-x type="button">Keep it</button></div>');
    m.q("#cx-go").addEventListener("click", (e) => M.savedBusy(e.target, "Cancelling…", async () => {
      const j = await api("admin_status", { row: b.row, status: "Cancelled", comment: m.q("#cx-note").value.trim() });
      if (j.ok) { m.close(); toast("Booking cancelled" + (j.voided ? " and its invoice was voided" : "") + (j.kept ? ". Its invoice has payments, so it was left as is." : "")); S.open = null; await load(true); if (window.StudioMoney) window.StudioMoney.load(true); }
      else toast("Couldn't update that booking.", true);
    }));
  }
  $("list").addEventListener("click", async (e) => {
    if (e.target.closest("[data-older]")) { S.all = true; await load(true); return; }
    const art = e.target.closest(".bk"); if (!art) return;
    const row = +art.dataset.row;
    if (e.target.closest("[data-toggle]")) { S.open = S.open === row ? null : row; renderBookings(); return; }
    const rem = e.target.closest("[data-remind]");
    if (rem) {
      rem.disabled = true;
      try { const j = await api("admin_remind_booking", { row }); toast(j.ok ? "Reminder sent to the client" : j.error === "no_email" ? "This booking has no email address." : "Couldn't send the reminder.", !j.ok); } catch (err) { fail(err); }
      rem.disabled = false; return;
    }
    const set = e.target.closest("[data-set]"); if (!set) return;
    const status = set.dataset.set, b = S.bookings.find((x) => x.row === row);
    if (status === "Confirmed" && isManager() && window.StudioMoney) { if (!window.StudioMoney.state.loaded) await window.StudioMoney.load(true); window.StudioMoney.confirmDialog(b); return; }
    if (status === "Cancelled") { cancelDialog(b); return; }
    set.disabled = true; set.textContent = "Saving…";
    try {
      const j = await api("admin_status", { row, status });
      if (j.ok) { b.status = status; toast("Marked " + status.toLowerCase()); }
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

  /* ---------- desktop notifications for new bookings (while this page is open) ---------- */
  let seen = null;
  function notifyNew() {
    const rows = new Set(S.bookings.map((b) => b.row));
    if (seen && "Notification" in window && Notification.permission === "granted") {
      S.bookings.filter((b) => !seen.has(b.row) && b.source !== "Admin app" && b.status !== "Cancelled").slice(0, 5).forEach((b) => {
        try { new Notification("New booking: " + b.name, { body: [b.pkg, dayLabel(b.date) + " " + t12(b.start)].filter(Boolean).join(" · "), tag: "bk" + b.row }); } catch (e) { /* ignore */ }
      });
    }
    seen = rows;
  }
  $("notif").addEventListener("click", async () => {
    if (!("Notification" in window)) return;
    const p = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (p === "granted") { try { new Notification("Notifications are working", { body: "You'll be alerted about new bookings while this page is open." }); } catch (e) { /* ignore */ } toast("Notifications are on while this page is open."); }
    else toast("Notifications are blocked. Allow them in your browser's site settings.", true);
  });

  /* ----- change username ----- */
  $("chun").addEventListener("click", () => {
    const M = window.StudioMoney, m = M.modal(M.head("Change username") + '<label>New username<input id="un-new" type="text" maxlength="30" autocapitalize="none" spellcheck="false"></label><p class="muted small">3 to 30 letters, numbers, dots, dashes or underscores. Your password stays the same.</p><p class="err" id="un-err"></p><button class="btn primary block" id="un-go" type="button">Save</button>');
    m.q("#un-new").value = CRED ? CRED.u : "";
    m.q("#un-go").addEventListener("click", (e) => M.savedBusy(e.target, "Saving…", async () => {
      const nu = m.q("#un-new").value.trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,30}$/.test(nu)) { m.q("#un-err").textContent = "Use 3 to 30 letters, numbers, dots, dashes or underscores."; return; }
      const r = await wpost("/unset", { u: CRED.u, hash: CRED.hash, username: nu });
      if (r.j.ok) { CRED.u = r.j.username || nu; m.close(); toast("Username changed to " + CRED.u); }
      else if (r.status === 409) m.q("#un-err").textContent = "That username is taken.";
      else if (r.status === 401) signOut("Your sign-in is no longer valid. Please sign in again.");
      else m.q("#un-err").textContent = "Couldn't change it. Try again.";
    }));
  });

  /* ---------- accounting + extras (money.js) ---------- */
  if (window.StudioMoney) window.StudioMoney.init({ api, S, toast, esc, ymd, parseYmd, t12, fail, reload: () => load(true) });
  const isManager = () => S.me && S.me.role !== "Staff";

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
  document.addEventListener("visibilitychange", () => { if (!document.hidden && signedIn() && S.loaded) load(true); });
  // Keep a desktop tab fresh while it is open and visible
  setInterval(() => { if (!document.hidden && signedIn() && S.loaded && $("sheet").hidden) load(true); }, 60000);
  if (W) {
    document.querySelectorAll(".w-only").forEach((el) => { el.hidden = false; });
    $("team-add").textContent = "Create account";
    wpost("/ping", {}).then((r) => { S.empty = !!r.j.empty; showLogin(); }).catch(() => showLogin());
  } else if (key) showApp(); else showLogin();
})();

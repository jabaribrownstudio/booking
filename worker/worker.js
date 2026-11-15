/**
 * Cloudflare Worker: login gatekeeper for the booking admin app.
 *
 *  - Passwords are hashed in the browser (PBKDF2, SHA-256, 150,000 rounds). The Worker never sees a password.
 *  - The user list lives in Cloudflare KV. The browser never receives anyone's hash or salt.
 *  - The Worker is the only thing that knows the secret for your Google Apps Script. It checks the person's
 *    role, then forwards only the actions that role may do. Hiding buttons in the page is cosmetic.
 *
 * Bindings / variables (see README): USERS (KV), APPS_SCRIPT_URL, APPS_SCRIPT_KEY (secret),
 * SETUP_CODE (secret), ALLOWED_ORIGIN.
 */
const REC_ITER = 100000; // Workers allow at most 100,000 PBKDF2 rounds
const RANK = { Staff: 1, Manager: 2, Owner: 3 };
// The lowest role allowed to run each Apps Script action. Anything not listed is refused.
const ACTION_MIN = {
  admin_list: "Staff", admin_status: "Staff", admin_add: "Staff", admin_remind_booking: "Staff", admin_push_register: "Staff", admin_push_unregister: "Staff",
  admin_hours: "Manager", admin_off_add: "Manager", admin_off_remove: "Manager", admin_settings: "Manager",
  // invoices, estimates and money
  admin_money: "Manager", admin_inv_save: "Manager", admin_inv_send: "Manager", admin_inv_pay: "Manager", admin_inv_unpay: "Manager",
  admin_inv_status: "Manager", admin_inv_convert: "Manager", admin_inv_remind: "Manager", admin_inv_pdf: "Manager", admin_inv_receipt: "Manager", admin_inv_delete: "Manager",
  admin_fee_add: "Manager", admin_fee_remove: "Manager", admin_fee_update: "Manager", admin_tax_add: "Manager", admin_tax_remove: "Manager",
  admin_clients: "Manager", admin_client_save: "Manager", admin_client_delete: "Manager"
};

const enc = new TextEncoder();
const b64 = (buf) => { const a = new Uint8Array(buf); let s = ""; for (const x of a) s += String.fromCharCode(x); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const same = (a, b) => { a = String(a || ""); b = String(b || ""); if (!a || a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; };
const json = (o, status = 200, h = {}) => new Response(JSON.stringify(o), { status, headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, h) });

async function pbkdf2(secret, saltB64, iter) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveBits"]);
  return b64(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64(saltB64), iterations: iter }, key, 256));
}
const randomB64 = (n) => b64(crypto.getRandomValues(new Uint8Array(n)));
const okPw = (pw) => { try { return pw && /^[A-Za-z0-9+/=]+$/.test(pw.salt) && /^[A-Za-z0-9+/=]+$/.test(pw.hash) && unb64(pw.salt).length === 16 && unb64(pw.hash).length === 32; } catch (e) { return false; } };
const cleanPw = (pw) => ({ salt: pw.salt, hash: pw.hash });

/** A stable but fake salt, so asking for the salt can't reveal which usernames exist. */
async function fakeSalt(env, username) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode("salt|" + username + "|" + env.APPS_SCRIPT_KEY));
  return b64(d.slice(0, 16));
}

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no look-alike characters
function recoveryCode() {
  const r = crypto.getRandomValues(new Uint8Array(12));
  const c = Array.from(r, (x) => ALPHABET[x % ALPHABET.length]).join("");
  return c.slice(0, 4) + "-" + c.slice(4, 8) + "-" + c.slice(8, 12);
}
const normRec = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/* ---------- storage ---------- */
const loadUsers = async (env) => JSON.parse((await env.USERS.get("users")) || "[]");
const saveUsers = (env, users) => env.USERS.put("users", JSON.stringify(users));
const findUser = (users, u) => { u = String(u || "").trim().toLowerCase(); return u && users.find((x) => x.username === u || (x.email && x.email.toLowerCase() === u)); };
const strip = (x, last) => ({ id: x.id, username: x.username, name: x.name, email: x.email || "", role: x.role, active: x.active !== false, mustChange: !!x.mustChange, created: x.created, lastLogin: last || "" });

/* ---------- brute-force protection ---------- */
const getLock = async (env, id) => JSON.parse((await env.USERS.get("lock:" + id)) || '{"fails":0,"until":0}');
async function ipBlocked(env, ip) { return +((await env.USERS.get("ip:" + ip)) || 0) >= 25; }
async function recordFail(env, ip, user) {
  const n = +((await env.USERS.get("ip:" + ip)) || 0) + 1;
  await env.USERS.put("ip:" + ip, String(n), { expirationTtl: 600 });
  if (user) {
    const lk = await getLock(env, user.id);
    lk.fails++;
    if (lk.fails % 5 === 0) lk.until = Date.now() + Math.min(3600, 60 * Math.pow(2, lk.fails / 5 - 1)) * 1000; // 1 min, 2, 4 ... up to 1 hour
    await env.USERS.put("lock:" + user.id, JSON.stringify(lk), { expirationTtl: 3600 });
  }
}
const lockedReply = (secs) => ({ status: 429, body: { ok: false, error: "locked", retryAfter: secs } });

/** Checks username + password hash. Returns { user, users } or { fail: { status, body } }. */
async function authenticate(env, ip, u, hash) {
  if (await ipBlocked(env, ip)) return { fail: lockedReply(600) };
  const users = await loadUsers(env), user = findUser(users, u);
  if (user) {
    const lk = await getLock(env, user.id);
    if (lk.until > Date.now()) return { fail: lockedReply(Math.ceil((lk.until - Date.now()) / 1000)) };
  }
  if (user && user.active !== false && user.pw && same(user.pw.hash, hash)) {
    if (user.id) await env.USERS.delete("lock:" + user.id);
    return { user, users };
  }
  await recordFail(env, ip, user && user.active !== false ? user : null);
  return { fail: { status: 401, body: { ok: false, error: "unauthorized" } } };
}

/* ---------- CORS ---------- */
function corsFor(env, req) {
  const origin = req.headers.get("Origin");
  const allowed = String(env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
  if (!origin) return { ok: true, headers: {} };
  if (allowed.indexOf(origin) < 0) return { ok: false, headers: {} };
  return { ok: true, headers: { "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" } };
}

export default {
  async fetch(req, env) {
    const cors = corsFor(env, req);
    if (!cors.ok) return json({ ok: false, error: "forbidden_origin" }, 403);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors.headers });
    try {
      const res = await route(req, env);
      Object.keys(cors.headers).forEach((k) => res.headers.set(k, cors.headers[k]));
      return res;
    } catch (e) {
      console.error(e);
      return json({ ok: false, error: "server_error" }, 500, cors.headers);
    }
  }
};

async function route(req, env) {
  const path = new URL(req.url).pathname.replace(/\/+$/, "") || "/";
  if (req.method !== "POST") return json({ ok: true, service: "booking-auth" });
  let b; try { b = await req.json(); } catch (e) { return json({ ok: false, error: "bad_request" }, 400); }
  const ip = req.headers.get("CF-Connecting-IP") || "unknown";

  if (path === "/ping") { const users = await loadUsers(env); return json({ ok: true, empty: users.length === 0 }); }

  if (path === "/salt") {
    const users = await loadUsers(env), user = findUser(users, b.u);
    const uname = String(b.u || "").trim().toLowerCase();
    return json({ ok: true, salt: user && user.pw ? user.pw.salt : await fakeSalt(env, uname) });
  }

  if (path === "/setup") return setup(env, b);
  if (path === "/recover") return recover(env, ip, b);

  // everything below needs a valid sign-in
  const a = await authenticate(env, ip, b.u, b.hash);
  if (a.fail) return json(a.fail.body, a.fail.status);
  const { user, users } = a;

  if (path === "/login") {
    await env.USERS.put("seen:" + user.id, new Date().toISOString());
    return json({ ok: true, user: strip(user) });
  }

  if (path === "/pwset") {
    if (!okPw(b.pw) || !same(user.pw.hash, b.cur)) return json({ ok: false, error: "bad_password" }, 400);
    user.pw = cleanPw(b.pw); user.mustChange = false;
    await saveUsers(env, users);
    return json({ ok: true });
  }

  if (path === "/unset") {
    const nu = String(b.username || "").trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(nu)) return json({ ok: false, error: "invalid_input" }, 400);
    const clash = findUser(users, nu);
    if (clash && clash.id !== user.id) return json({ ok: false, error: "exists" }, 409);
    user.username = nu;
    await saveUsers(env, users);
    return json({ ok: true, username: nu });
  }

  if (user.mustChange) return json({ ok: false, error: "must_change" }, 403);

  if (path === "/team") return team(env, user, users, b);

  if (path === "/api") {
    const min = ACTION_MIN[b.action];
    if (!min) return json({ ok: false, error: "unknown_action" }, 400);
    if (RANK[user.role] < RANK[min]) return json({ ok: false, error: "forbidden" }, 403);
    const { u, hash, key, as, ...rest } = b;
    const r = await fetch(env.APPS_SCRIPT_URL, {
      method: "POST", redirect: "follow", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign(rest, { key: env.APPS_SCRIPT_KEY, as: { name: user.name || user.username, role: user.role } }))
    });
    let out; try { out = JSON.parse(await r.text()); } catch (e) { return json({ ok: false, error: "backend_error" }, 502); }
    if (out && out.error === "unauthorized") return json({ ok: false, error: "backend_auth" }, 502); // secret mismatch: not the person's fault
    return json(out);
  }

  return json({ ok: false, error: "not_found" }, 404);
}

async function setup(env, b) {
  const users = await loadUsers(env);
  if (users.length) return json({ ok: false, error: "already_setup" }, 409);
  if (!env.SETUP_CODE || !same(env.SETUP_CODE, b.code)) return json({ ok: false, error: "bad_setup_code" }, 403);
  const username = String(b.username || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(username) || !okPw(b.pw)) return json({ ok: false, error: "invalid_input" }, 400);
  const code = recoveryCode(), salt = randomB64(16);
  const owner = { id: crypto.randomUUID().slice(0, 8), username, name: String(b.name || username).trim().slice(0, 60), email: String(b.email || "").trim().slice(0, 100),
    role: "Owner", active: true, pw: cleanPw(b.pw), rec: { salt, hash: await pbkdf2(normRec(code), salt, REC_ITER) }, mustChange: false, created: new Date().toISOString().slice(0, 10) };
  await saveUsers(env, [owner]);
  return json({ ok: true, recovery: code });
}

async function recover(env, ip, b) {
  if (await ipBlocked(env, ip)) return json(lockedReply(600).body, 429);
  const users = await loadUsers(env), user = findUser(users, b.u);
  if (user && user.role === "Owner" && user.rec) {
    const lk = await getLock(env, user.id);
    if (lk.until > Date.now()) return json(lockedReply(Math.ceil((lk.until - Date.now()) / 1000)).body, 429);
    if (okPw(b.pw) && same(user.rec.hash, await pbkdf2(normRec(b.rec), user.rec.salt, REC_ITER))) {
      const code = recoveryCode(), salt = randomB64(16);
      user.pw = cleanPw(b.pw); user.mustChange = false; user.rec = { salt, hash: await pbkdf2(normRec(code), salt, REC_ITER) };
      await saveUsers(env, users); await env.USERS.delete("lock:" + user.id);
      return json({ ok: true, recovery: code });
    }
  }
  await recordFail(env, ip, user && user.role === "Owner" ? user : null);
  return json({ ok: false, error: "bad_recovery" }, 401);
}

async function team(env, me, users, b) {
  if (me.role !== "Owner") return json({ ok: false, error: "forbidden" }, 403);
  const target = () => users.find((x) => x.id === b.id);
  if (b.op === "list") {
    const out = [];
    for (const x of users) out.push(strip(x, await env.USERS.get("seen:" + x.id)));
    return json({ ok: true, users: out });
  }
  if (b.op === "add") {
    const username = String(b.username || "").trim().toLowerCase(), email = String(b.email || "").trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(username) || !okPw(b.pw) || ["Staff", "Manager"].indexOf(b.role) < 0) return json({ ok: false, error: "invalid_input" }, 400);
    if (findUser(users, username) || (email && findUser(users, email))) return json({ ok: false, error: "exists" }, 409);
    users.push({ id: crypto.randomUUID().slice(0, 8), username, name: String(b.name || username).trim().slice(0, 60), email: email.slice(0, 100), role: b.role,
      active: true, pw: cleanPw(b.pw), mustChange: true, created: new Date().toISOString().slice(0, 10) });
    await saveUsers(env, users);
    return json({ ok: true });
  }
  const t = target();
  if (!t) return json({ ok: false, error: "invalid_input" }, 400);
  if (b.op === "update") {
    if (typeof b.name === "string" && b.name.trim()) t.name = b.name.trim().slice(0, 60);
    if (typeof b.email === "string") t.email = b.email.trim().toLowerCase().slice(0, 100);
    if (t.role !== "Owner") {
      if (["Staff", "Manager"].indexOf(b.role) > -1) t.role = b.role;
      if (typeof b.active === "boolean") t.active = b.active;
    }
    await saveUsers(env, users);
    return json({ ok: true });
  }
  if (b.op === "setpw") {
    if (t.role === "Owner" || !okPw(b.pw)) return json({ ok: false, error: "invalid_input" }, 400);
    t.pw = cleanPw(b.pw); t.mustChange = true;
    await saveUsers(env, users); await env.USERS.delete("lock:" + t.id);
    return json({ ok: true });
  }
  if (b.op === "remove") {
    if (t.role === "Owner") return json({ ok: false, error: "invalid_input" }, 400);
    await saveUsers(env, users.filter((x) => x.id !== t.id));
    return json({ ok: true });
  }
  return json({ ok: false, error: "unknown_op" }, 400);
}

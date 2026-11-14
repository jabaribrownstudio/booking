/**
 * Photography booking backend (Google Apps Script).
 * - Saves bookings to a Google Sheet and blocks double-bookings
 * - Your available times live in the Sheet: tabs "Availability", "Time off" and "Settings"
 * - Emails you and the client
 * - Adds each booking to your Google Calendar WITH reminders
 * - Keeps the calendar in sync when you change Status in the sheet
 * - Emails the client a reminder the day before a confirmed session
 *
 * Setup: see README.md. Run setup() once (it creates the tabs and installs the triggers), then deploy as a Web app.
 */

var CONFIG = {
  OWNER_EMAIL: "you@example.com",   // where booking alerts are sent
  BUSINESS_NAME: "Jabari Brown Studio",
  SHEET_NAME: "Bookings",
  SEND_CLIENT_EMAIL: true,

  // ---- Admin app (your phone) ----
  // A long secret only you know (20+ letters/numbers). You type it into the admin app once.
  // Leave as is to switch the admin app off.
  ADMIN_KEY: "change-this-to-a-long-secret",

  // ---- Google Calendar ----
  CALENDAR_ID: "primary",           // "primary" = your main calendar, or paste a calendar ID. "" turns calendar off
  POPUP_REMINDERS: [1440, 60],      // minutes before the session: 1 day and 1 hour
  EMAIL_REMINDERS: [1440],          // minutes before the session: email reminder 1 day before
  INVITE_CLIENT_ON_CONFIRM: false,  // true = when you set Status to Confirmed, the client is added as a guest (Google emails them an invite)

  // ---- Reminder email to the client ----
  CLIENT_REMINDER_EMAIL: true,      // email the client the day before a Confirmed session
  CLIENT_REMINDER_HOUR: 8,          // hour of day (0-23, script time zone) the reminders go out

  // ---- Starting values ----
  // Used only the first time setup() creates the Availability and Settings tabs.
  // After that, change your hours in the Sheet itself and ignore these.
  DEFAULT_HOURS: {
    1: ["09:00", "17:00"], 2: ["09:00", "17:00"], 3: ["09:00", "17:00"],
    4: ["09:00", "17:00"], 5: ["09:00", "17:00"], 6: ["08:00", "14:00"]
  },
  DEFAULT_SETTINGS: { slotInterval: 30, bufferMinutes: 30, minNoticeHours: 24, maxDaysAhead: 90 }
};

var TAB = { AVAIL: "Availability", OFF: "Time off", SETTINGS: "Settings", STAFF: "Staff" };
var DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

var HEADERS = ["Timestamp", "Status", "Name", "Email", "Phone", "Instagram", "Package", "Price",
               "Date", "Start", "End", "Duration (min)", "Location", "Notes", "Source", "Event ID", "Handled by"];
// Column numbers (1-based)
var COL = { STATUS: 2, NAME: 3, EMAIL: 4, PACKAGE: 7, DATE: 9, START: 10, END: 11, EVENT: 16, HANDLED: 17 };

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(CONFIG.SHEET_NAME) || ss.insertSheet(CONFIG.SHEET_NAME);
}

function getCalendar_() {
  if (!CONFIG.CALENDAR_ID) return null;
  return CONFIG.CALENDAR_ID === "primary" ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
}

/**
 * Run once from the editor. Safe to run again after updates:
 * it never overwrites hours, days off or settings you have already entered.
 */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // --- Bookings tab ---
  var sh = getSheet_();
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold");
  sh.setFrozenRows(1);
  [COL.DATE, COL.START, COL.END].forEach(function (c) { sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat("@"); });
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(["Pending", "Confirmed", "Cancelled"], true).build();
  sh.getRange(2, COL.STATUS, sh.getMaxRows() - 1, 1).setDataValidation(rule);

  // --- Availability tab: your weekly opening hours ---
  if (!ss.getSheetByName(TAB.AVAIL)) {
    var av = ss.insertSheet(TAB.AVAIL);
    av.getRange(1, 1, 1, 3).setValues([["Day", "Open", "Close"]]).setFontWeight("bold");
    av.getRange(2, 2, 200, 2).setNumberFormat("@"); // keep times exactly as you type them
    var rows = [];
    for (var d = 1; d <= 7; d++) {
      var dow = d % 7, w = CONFIG.DEFAULT_HOURS[dow];
      if (w) rows.push([DAY_NAMES[dow], w[0], w[1]]);
    }
    av.getRange(2, 1, rows.length, 3).setValues(rows);
    av.getRange(2, 1, 200, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(DAY_NAMES, true).build());
    av.setFrozenRows(1);
    av.setColumnWidth(1, 130);
    av.getRange("E1:E6").setValues([
      ["How to set your hours"],
      ["One row for each period you are open. Pick the day from the dropdown."],
      ["Open and Close: type a time such as 9:00 AM or 17:00. Close is when a session must be finished."],
      ["Closed for lunch? Add two rows for that day (for example 9:00 to 12:00, and 2:00 PM to 5:00 PM)."],
      ["A day with no rows is closed."],
      ["Changes are live straight away. Nothing to save or publish."]
    ]);
    av.getRange("E1").setFontWeight("bold");
    av.setColumnWidth(5, 520);
  }

  // --- Time off tab: days off and blocked time ---
  if (!ss.getSheetByName(TAB.OFF)) {
    var off = ss.insertSheet(TAB.OFF);
    off.getRange(1, 1, 1, 5).setValues([["Date", "Through (optional)", "From (optional)", "To (optional)", "Note"]]).setFontWeight("bold");
    off.getRange(2, 1, 500, 2).setNumberFormat("yyyy-mm-dd");
    off.getRange(2, 3, 500, 2).setNumberFormat("@");
    off.setFrozenRows(1);
    off.setColumnWidth(1, 120); off.setColumnWidth(2, 150); off.setColumnWidth(3, 130); off.setColumnWidth(4, 130); off.setColumnWidth(5, 220);
    off.getRange("G1:G6").setValues([
      ["How to block time off"],
      ["Date: the day you are unavailable, for example 2026-12-25."],
      ["Going away for several days? Put the last day in Through."],
      ["Leave From and To empty to block the whole day."],
      ["Only unavailable for part of a day? Fill in From and To, for example 12:00 PM to 3:00 PM."],
      ["Dates that have passed are ignored, so you can leave them here."]
    ]);
    off.getRange("G1").setFontWeight("bold");
    off.setColumnWidth(7, 520);
  }

  // --- Settings tab ---
  if (!ss.getSheetByName(TAB.SETTINGS)) {
    var st = ss.insertSheet(TAB.SETTINGS);
    var ds = CONFIG.DEFAULT_SETTINGS;
    st.getRange(1, 1, 5, 3).setValues([
      ["Setting", "Value", "What it does"],
      ["Slot interval (minutes)", ds.slotInterval, "How often a start time is offered. 30 gives 9:00, 9:30, 10:00."],
      ["Buffer between sessions (minutes)", ds.bufferMinutes, "Gap kept before and after every booking, for travel or setup."],
      ["Minimum notice (hours)", ds.minNoticeHours, "How far ahead clients must book. 24 means nothing sooner than a day from now."],
      ["Days clients can book ahead", ds.maxDaysAhead, "How far into the future the calendar opens."]
    ]);
    st.getRange(1, 1, 1, 3).setFontWeight("bold");
    st.setFrozenRows(1);
    st.setColumnWidth(1, 260); st.setColumnWidth(3, 520);
  }

  ensureStaffTab_(ss);

  // --- Triggers: replace ours, leave any others alone ---
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === "onStatusEdit" || fn === "sendClientReminders") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("onStatusEdit").forSpreadsheet(ss).onEdit().create();
  if (CONFIG.CLIENT_REMINDER_EMAIL) {
    ScriptApp.newTrigger("sendClientReminders").timeBased().everyDays(1).atHour(CONFIG.CLIENT_REMINDER_HOUR).create();
  }
  if (CONFIG.CALENDAR_ID) getCalendar_(); // forces the calendar permission prompt now
}

/** Creates the Staff tab if it doesn't exist yet (people who can sign in to the admin app). Keys are stored scrambled. */
function ensureStaffTab_(ss) {
  var sf = ss.getSheetByName(TAB.STAFF);
  if (sf) return sf;
  sf = ss.insertSheet(TAB.STAFF);
  sf.getRange(1, 1, 1, 5).setValues([["Name", "Role", "Key (scrambled)", "Active", "Added"]]).setFontWeight("bold");
  sf.setFrozenRows(1);
  sf.setColumnWidth(1, 160); sf.setColumnWidth(3, 260);
  sf.getRange("G1:G4").setValues([
    ["Managed from the admin app"],
    ["Add and remove staff in the admin app's Team tab (owner only). You normally never edit this tab."],
    ["Keys are saved scrambled, so nobody can read them here. Set Active to No to lock someone out."],
    ["Only share this Google Sheet with people you trust. Staff only need the admin app, not the Sheet."]
  ]);
  sf.getRange("G1").setFontWeight("bold");
  sf.setColumnWidth(7, 520);
  return sf;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * GET ?action=booked
 * Returns what the booking page needs to show free times: taken slots (no personal data),
 * your opening hours, your days off and your settings.
 */
function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action !== "booked") return json_({ ok: true, service: "booking" });
  return json_({ ok: true, booked: busySlots_(), hours: getHours_(), blocked: getBlocked_(), settings: getSettings_() });
}

function busySlots_() {
  var sh = getSheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var rows = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  var out = [];
  rows.forEach(function (r) {
    var status = String(r[COL.STATUS - 1]);
    var date = String(r[COL.DATE - 1]);
    if (status === "Cancelled" || !date || date < today) return;
    out.push({ date: date, start: String(r[COL.START - 1]), end: String(r[COL.END - 1]) });
  });
  return out;
}

/* ---------- reading your availability from the Sheet ---------- */

function pad_(n) { return ("0" + n).slice(-2); }
function toMin_(t) { var p = String(t).split(":"); return +p[0] * 60 + +p[1]; }
function fromMin_(m) { return pad_(Math.floor(m / 60)) + ":" + pad_(m % 60); }

/** "9:00 AM", "09:00", "5pm", "17:00:00" -> "HH:MM". Returns "" when it is not a time. */
function parseTime_(v) {
  var s = String(v == null ? "" : v).trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
  var m = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm)?$/.exec(s);
  if (!m) return "";
  var h = +m[1], mi = +(m[2] || 0);
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return "";
  return pad_(h) + ":" + pad_(mi);
}

/** A date cell (real date or text such as 2026-12-25) -> "YYYY-MM-DD". Returns "" when it is not a date. */
function cellDate_(v, display) {
  if (Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), "yyyy-MM-dd");
  }
  var s = String(display || v || "").trim();
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return m[1] + "-" + pad_(m[2]) + "-" + pad_(m[3]);
  var d = new Date(s);
  return isNaN(d.getTime()) ? "" : Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function addDay_(ymd) {
  var p = ymd.split("-");
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + 1));
  return d.getUTCFullYear() + "-" + pad_(d.getUTCMonth() + 1) + "-" + pad_(d.getUTCDate());
}

function dayIndex_(s) {
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(String(s || "").trim().toLowerCase().slice(0, 3));
}

/** Rows below the header of a tab, as { v: raw values, d: values as displayed }. */
function rows_(name, ncols) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var rng = sh.getRange(2, 1, sh.getLastRow() - 1, ncols);
  var v = rng.getValues(), d = rng.getDisplayValues();
  return v.map(function (r, i) { return { v: r, d: d[i] }; });
}

/** { 0: [["09:00","17:00"]], 1: [...], ... } with 0 = Sunday. A day with no windows is closed. */
function getHours_() {
  var out = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB.AVAIL)) {
    for (var k in CONFIG.DEFAULT_HOURS) out[k] = [CONFIG.DEFAULT_HOURS[k]];
    return out;
  }
  rows_(TAB.AVAIL, 3).forEach(function (r) {
    var di = dayIndex_(r.d[0]), a = parseTime_(r.d[1]), b = parseTime_(r.d[2]);
    if (di < 0 || !a || !b || toMin_(b) <= toMin_(a)) return;
    out[di].push([a, b]);
  });
  return out;
}

/** Days off and blocked time: [{ date, start, end }]. Empty start and end means the whole day. */
function getBlocked_() {
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  var out = [];
  rows_(TAB.OFF, 5).forEach(function (r) {
    var from = cellDate_(r.v[0], r.d[0]);
    if (!from) return;
    var to = cellDate_(r.v[1], r.d[1]) || from;
    if (to < from) to = from;
    var a = parseTime_(r.d[2]), b = parseTime_(r.d[3]);
    var s = (a || b) ? (a || "00:00") : "", e = (a || b) ? (b || "24:00") : "";
    var cur = from, guard = 0;
    while (cur <= to && guard++ < 400) {
      if (cur >= today) out.push({ date: cur, start: s, end: e });
      cur = addDay_(cur);
    }
  });
  return out;
}

/** { slotInterval, bufferMinutes, minNoticeHours, maxDaysAhead } from the Settings tab, with safe limits. */
function getSettings_() {
  var s = {}, k;
  for (k in CONFIG.DEFAULT_SETTINGS) s[k] = CONFIG.DEFAULT_SETTINGS[k];
  var bounds = BOUNDS;
  rows_(TAB.SETTINGS, 2).forEach(function (r) {
    var label = String(r.d[0]).toLowerCase();
    var key = label.indexOf("interval") > -1 ? "slotInterval" : label.indexOf("buffer") > -1 ? "bufferMinutes" :
              label.indexOf("notice") > -1 ? "minNoticeHours" : label.indexOf("ahead") > -1 ? "maxDaysAhead" : "";
    var n = parseFloat(String(r.d[1]).replace(/[^0-9.]/g, ""));
    if (key && !isNaN(n)) s[key] = Math.max(bounds[key][0], Math.min(bounds[key][1], n));
  });
  return s;
}

/* ---------- helpers for bookings ---------- */

function clean_(v, max) {
  v = String(v == null ? "" : v).trim().slice(0, max || 300);
  return /^[=+\-@]/.test(v) ? "'" + v : v; // block spreadsheet formula injection
}
function niceTime_(t) {
  var m = toMin_(t), h = Math.floor(m / 60);
  return (h % 12 || 12) + ":" + ("0" + (m % 60)).slice(-2) + " " + (h >= 12 ? "PM" : "AM");
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var d = JSON.parse(e.postData.contents);
    if (d.action && String(d.action).indexOf("admin_") === 0) return json_(adminApi_(d));
    return json_(createBooking_(d, false));
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: "server_error" });
  } finally {
    try { lock.releaseLock(); } catch (x) { /* ignore */ }
  }
}

/**
 * Saves a booking. Used for clients (admin = false) and for the admin app (admin = true).
 * Admin bookings can be Confirmed straight away, may skip email/phone, and may fall outside
 * your opening hours (you decide), but they still can't overlap another booking unless d.force is true.
 */
function createBooking_(d, admin, by) {
  var name = clean_(d.firstName && d.lastName ? d.firstName + " " + d.lastName : d.name, 100);
  var email = clean_(d.email, 150), phone = clean_(d.phone, 40);
  var emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  if (!name || (!admin && (!emailOk || !phone))) return { ok: false, error: "invalid_input" };
  if (admin && email && !emailOk) return { ok: false, error: "invalid_input" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !/^\d{2}:\d{2}$/.test(d.time)) return { ok: false, error: "invalid_input" };
  var duration = Math.max(5, Math.min(720, parseInt(d.duration, 10) || 60));

  var start = toMin_(d.time), end = start + duration;
  var buf = getSettings_().bufferMinutes;
  var dp = d.date.split("-");

  if (!admin) {
    // The time must be inside your opening hours and not blocked off in "Time off".
    var dow = new Date(+dp[0], +dp[1] - 1, +dp[2]).getDay();
    var inHours = (getHours_()[dow] || []).some(function (w) { return start >= toMin_(w[0]) && end <= toMin_(w[1]); });
    var blocked = getBlocked_().some(function (b) {
      return b.date === d.date && (!b.start || (start < toMin_(b.end) && end > toMin_(b.start)));
    });
    if (!inHours || blocked) return { ok: false, error: "slot_unavailable" };
  }

  // It must not overlap another booking (plus the buffer).
  if (!(admin && d.force)) {
    var clash = busySlots_().some(function (b) {
      return b.date === d.date && start < toMin_(b.end) + buf && end + buf > toMin_(b.start);
    });
    if (clash) return { ok: false, error: "slot_taken" };
  }

  var status = admin && ["Pending", "Confirmed", "Cancelled"].indexOf(d.status) > -1 ? d.status : "Pending";
  var sh = getSheet_();
  var row = [new Date(), status, name, email, phone, clean_(d.instagram, 60), clean_(d.packageName, 80),
             clean_(d.currency, 5) + clean_(d.price, 12), d.date, d.time, fromMin_(end), duration,
             clean_(d.location, 200), clean_(d.notes, 1000), admin ? "Admin app" : clean_(d.source, 40), "", admin ? clean_(by || "", 60) : ""];
  sh.appendRow(row);
  var r = sh.getLastRow();
  [COL.DATE, COL.START, COL.END].forEach(function (c) { sh.getRange(r, c).setNumberFormat("@").setValue(row[c - 1]); });

  // Google Calendar event with reminders
  try {
    var cal = getCalendar_();
    if (cal && status !== "Cancelled") {
      var s = new Date(+dp[0], +dp[1] - 1, +dp[2], Math.floor(start / 60), start % 60);
      var en = new Date(s.getTime() + duration * 60000);
      var ev = cal.createEvent("[" + status + "] " + row[6] + " – " + name, s, en, {
        description: "Package: " + row[6] + " (" + row[7] + ")\nPhone: " + phone + "\nEmail: " + email +
          "\nInstagram: " + row[5] + "\nNotes: " + row[13] + "\nSource: " + (row[14] || "website"),
        location: row[12]
      });
      ev.removeAllReminders();
      CONFIG.POPUP_REMINDERS.forEach(function (m) { ev.addPopupReminder(m); });
      CONFIG.EMAIL_REMINDERS.forEach(function (m) { ev.addEmailReminder(m); });
      sh.getRange(r, COL.EVENT).setValue(ev.getId());
    }
  } catch (err) { console.error("Calendar error: " + err); }

  // Emails: clients get the full set. Bookings you add yourself only email the client if you ask for it.
  var when = d.date + " at " + niceTime_(d.time) + " (" + duration + " min)";
  try {
    if (!admin) {
      MailApp.sendEmail({
        to: CONFIG.OWNER_EMAIL,
        replyTo: email,
        subject: "New booking request: " + row[6] + " – " + when,
        body: "New booking request\n\nPackage: " + row[6] + " (" + row[7] + ")\nWhen: " + when +
          "\nName: " + name + "\nEmail: " + email + "\nPhone: " + phone +
          "\nInstagram: " + row[5] + "\nLocation: " + row[12] + "\nNotes: " + row[13] +
          "\nSource: " + (row[14] || "website") + "\n\nOpen the sheet or the admin app to confirm or cancel."
      });
    }
    if (emailOk && ((!admin && CONFIG.SEND_CLIENT_EMAIL) || (admin && d.notifyClient))) {
      MailApp.sendEmail({
        to: email,
        replyTo: CONFIG.OWNER_EMAIL,
        name: CONFIG.BUSINESS_NAME,
        subject: (admin && status === "Confirmed" ? "Your session is booked – " : "We got your booking request – ") + CONFIG.BUSINESS_NAME,
        body: "Hi " + name.split(" ")[0] + ",\n\n" +
          (admin && status === "Confirmed" ? "Your session is booked:" : "Thanks for booking! Here's what we received:") + "\n\n" +
          row[6] + "\n" + when + "\n\n" +
          (admin && status === "Confirmed" ? "" : "We'll confirm your session shortly. ") +
          "Reply to this email if anything needs to change.\n\n– " + CONFIG.BUSINESS_NAME
      });
    }
  } catch (mailErr) { console.error("Mail error: " + mailErr); }

  return { ok: true, row: r };
}

/**
 * Installed trigger: runs when you edit the sheet.
 * Changing Status keeps the calendar in sync: Confirmed/Pending updates the title,
 * Cancelled removes the event.
 */
function onStatusEdit(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (sh.getName() !== CONFIG.SHEET_NAME || e.range.getColumn() !== COL.STATUS || e.range.getRow() < 2) return;
    syncCalendar_(sh, e.range.getRow());
  } catch (err) { console.error("onStatusEdit: " + err); }
}

/** Makes the calendar event for a Bookings row match its Status. */
function syncCalendar_(sh, row) {
  try {
    var cal = getCalendar_();
    if (!cal) return;
    var v = sh.getRange(row, 1, 1, HEADERS.length).getValues()[0];
    var status = String(v[COL.STATUS - 1]), id = String(v[COL.EVENT - 1] || "");
    if (!id) return;
    var ev = cal.getEventById(id);
    if (!ev) return;
    if (status === "Cancelled") {
      ev.deleteEvent();
      sh.getRange(row, COL.EVENT).clearContent();
    } else {
      ev.setTitle("[" + status + "] " + v[COL.PACKAGE - 1] + " – " + v[COL.NAME - 1]);
      if (status === "Confirmed" && CONFIG.INVITE_CLIENT_ON_CONFIRM && v[COL.EMAIL - 1]) ev.addGuest(String(v[COL.EMAIL - 1]));
    }
  } catch (err) { console.error("syncCalendar_: " + err); }
}

/* ---------- admin API (used by the Android / phone admin app) ---------- */

var BOUNDS = { slotInterval: [5, 240], bufferMinutes: [0, 480], minNoticeHours: [0, 720], maxDaysAhead: [1, 365] };
var SETTING_LABELS = { slotInterval: "Slot interval (minutes)", bufferMinutes: "Buffer between sessions (minutes)",
                       minNoticeHours: "Minimum notice (hours)", maxDaysAhead: "Days clients can book ahead" };

var OWNER_ONLY = { admin_staff_list: 1, admin_staff_add: 1, admin_staff_update: 1, admin_staff_reset: 1, admin_staff_remove: 1 };
var MANAGER_UP = { admin_hours: 1, admin_off_add: 1, admin_off_remove: 1, admin_settings: 1 };

function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ("0" + ((b + 256) % 256).toString(16)).slice(-2); }).join("");
}
function normKey_(k) { return String(k || "").replace(/[\s-]/g, "").toLowerCase(); }
function newKey_() {
  var raw = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "").slice(0, 24);
  return raw.match(/.{4}/g).join("-");
}

/** Rows of the Staff tab: { row, name, role, hash, active }. */
function staffRows_() {
  return rows_(TAB.STAFF, 5).map(function (r, i) {
    return { row: i + 2, name: String(r.d[0]), role: String(r.d[1]) === "Manager" ? "Manager" : "Staff",
             hash: String(r.d[2]), active: String(r.d[3]).toLowerCase() !== "no", added: String(r.d[4]) };
  }).filter(function (s) { return s.name; });
}

/** Who is this key? { name, role } or null. The owner key (ADMIN_KEY) is the Owner; everyone else is in the Staff tab. */
function authenticate_(key) {
  key = String(key || "");
  var owner = String(CONFIG.ADMIN_KEY || "");
  if (owner.length >= 8 && owner !== "change-this-to-a-long-secret" && key === owner) return { name: "Owner", role: "Owner" };
  var norm = normKey_(key);
  if (norm.length < 16) return null;
  var h = hash_(norm), found = null;
  staffRows_().forEach(function (s) { if (s.active && s.hash === h) found = { name: s.name, role: s.role }; });
  return found;
}

function adminApi_(d) {
  var me = authenticate_(d.key);
  if (!me) {
    Utilities.sleep(1500); // slows down anyone guessing a key
    return { ok: false, error: "unauthorized" };
  }
  if ((OWNER_ONLY[d.action] && me.role !== "Owner") || (MANAGER_UP[d.action] && me.role === "Staff")) return { ok: false, error: "forbidden" };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  switch (d.action) {
    case "admin_list": { var lst = adminList_(); lst.me = me; return lst; }

    case "admin_status": {
      var sh = getSheet_(), row = parseInt(d.row, 10);
      if (!(row >= 2 && row <= sh.getLastRow()) || ["Pending", "Confirmed", "Cancelled"].indexOf(d.status) < 0) return { ok: false, error: "invalid_input" };
      sh.getRange(row, COL.STATUS).setValue(d.status);
      sh.getRange(row, COL.HANDLED).setValue(me.name);
      syncCalendar_(sh, row);
      return { ok: true };
    }

    case "admin_add": return createBooking_(d, true, me.name);

    case "admin_hours": {
      var av = ss.getSheetByName(TAB.AVAIL);
      if (!av || !d.hours) return { ok: false, error: "invalid_input" };
      var out = [];
      [1, 2, 3, 4, 5, 6, 0].forEach(function (dow) {
        (d.hours[dow] || []).forEach(function (w) {
          var a = parseTime_(w[0]), b = parseTime_(w[1]);
          if (a && b && toMin_(b) > toMin_(a)) out.push([DAY_NAMES[dow], a, b]);
        });
      });
      if (out.length > 200) return { ok: false, error: "invalid_input" };
      av.getRange(2, 1, Math.max(av.getMaxRows() - 1, 1), 3).clearContent();
      av.getRange(2, 2, 200, 2).setNumberFormat("@");
      if (out.length) av.getRange(2, 1, out.length, 3).setValues(out);
      return { ok: true };
    }

    case "admin_off_add": {
      var off = ss.getSheetByName(TAB.OFF);
      var date = /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : "";
      if (!off || !date) return { ok: false, error: "invalid_input" };
      var thru = /^\d{4}-\d{2}-\d{2}$/.test(d.through || "") ? d.through : "";
      var a = parseTime_(d.from), z = parseTime_(d.to);
      var r = Math.max(off.getLastRow() + 1, 2);
      off.getRange(r, 1, 1, 2).setNumberFormat("@");
      off.getRange(r, 3, 1, 2).setNumberFormat("@");
      off.getRange(r, 1, 1, 5).setValues([[date, thru, a, z, clean_(d.note, 100)]]);
      return { ok: true };
    }

    case "admin_off_remove": {
      var off2 = ss.getSheetByName(TAB.OFF), rr = parseInt(d.row, 10);
      if (!off2 || !(rr >= 2 && rr <= off2.getLastRow())) return { ok: false, error: "invalid_input" };
      off2.deleteRow(rr);
      return { ok: true };
    }

    case "admin_staff_list": return { ok: true, staff: staffRows_().map(function (s) { return { row: s.row, name: s.name, role: s.role, active: s.active, added: s.added }; }) };

    case "admin_staff_add": {
      var nm = clean_(d.name, 60), role = d.role === "Manager" ? "Manager" : "Staff";
      var stf = ensureStaffTab_(ss);
      if (!nm) return { ok: false, error: "invalid_input" };
      var k1 = newKey_();
      stf.appendRow([nm, role, hash_(normKey_(k1)), "Yes", Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd")]);
      return { ok: true, key: k1, name: nm };
    }

    case "admin_staff_update": {
      var st2 = ss.getSheetByName(TAB.STAFF), r2 = parseInt(d.row, 10);
      if (!st2 || !(r2 >= 2 && r2 <= st2.getLastRow())) return { ok: false, error: "invalid_input" };
      if (d.role === "Manager" || d.role === "Staff") st2.getRange(r2, 2).setValue(d.role);
      if (d.active === true || d.active === false) st2.getRange(r2, 4).setValue(d.active ? "Yes" : "No");
      return { ok: true };
    }

    case "admin_staff_reset": {
      var st3 = ss.getSheetByName(TAB.STAFF), r3 = parseInt(d.row, 10);
      if (!st3 || !(r3 >= 2 && r3 <= st3.getLastRow())) return { ok: false, error: "invalid_input" };
      var k2 = newKey_();
      st3.getRange(r3, 3).setValue(hash_(normKey_(k2)));
      return { ok: true, key: k2, name: String(st3.getRange(r3, 1).getValue()) };
    }

    case "admin_staff_remove": {
      var st4 = ss.getSheetByName(TAB.STAFF), r4 = parseInt(d.row, 10);
      if (!st4 || !(r4 >= 2 && r4 <= st4.getLastRow())) return { ok: false, error: "invalid_input" };
      st4.deleteRow(r4);
      return { ok: true };
    }

    case "admin_settings": {
      var st = ss.getSheetByName(TAB.SETTINGS);
      if (!st || !d.settings) return { ok: false, error: "invalid_input" };
      Object.keys(SETTING_LABELS).forEach(function (k) {
        var n = parseFloat(d.settings[k]);
        if (isNaN(n)) return;
        n = Math.max(BOUNDS[k][0], Math.min(BOUNDS[k][1], n));
        var found = 0, word = k === "slotInterval" ? "interval" : k === "bufferMinutes" ? "buffer" : k === "minNoticeHours" ? "notice" : "ahead";
        rows_(TAB.SETTINGS, 2).forEach(function (r, i) {
          if (!found && String(r.d[0]).toLowerCase().indexOf(word) > -1) found = i + 2;
        });
        if (!found) { found = st.getLastRow() + 1; st.getRange(found, 1).setValue(SETTING_LABELS[k]); }
        st.getRange(found, 2).setValue(n);
      });
      return { ok: true };
    }
  }
  return { ok: false, error: "unknown_action" };
}

/** Everything the admin app shows: all bookings, hours, days off (with row numbers) and settings. */
function adminList_() {
  var sh = getSheet_(), last = sh.getLastRow(), tz = Session.getScriptTimeZone();
  var bookings = [];
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, HEADERS.length).getValues().forEach(function (r, i) {
      if (!r[COL.NAME - 1] && !r[COL.DATE - 1]) return;
      var ts = Object.prototype.toString.call(r[0]) === "[object Date]" ? Utilities.formatDate(r[0], tz, "yyyy-MM-dd HH:mm") : String(r[0]);
      bookings.push({ row: i + 2, created: ts, status: String(r[1]), name: String(r[2]), email: String(r[3]), phone: String(r[4]),
        instagram: String(r[5]), pkg: String(r[6]), price: String(r[7]), date: String(r[8]), start: String(r[9]), end: String(r[10]),
        duration: r[11], location: String(r[12]), notes: String(r[13]), source: String(r[14]), handledBy: String(r[16] || "") });
    });
  }
  var off = [];
  rows_(TAB.OFF, 5).forEach(function (r, i) {
    var date = cellDate_(r.v[0], r.d[0]);
    if (!date) return;
    off.push({ row: i + 2, date: date, through: cellDate_(r.v[1], r.d[1]), from: parseTime_(r.d[2]), to: parseTime_(r.d[3]), note: String(r.d[4] || "") });
  });
  return { ok: true, bookings: bookings, hours: getHours_(), off: off, settings: getSettings_() };
}

/** Daily trigger: emails clients whose Confirmed session is tomorrow. */
function sendClientReminders() {
  if (!CONFIG.CLIENT_REMINDER_EMAIL) return;
  var sh = getSheet_();
  var last = sh.getLastRow();
  if (last < 2) return;
  var tomorrow = Utilities.formatDate(new Date(Date.now() + 86400000), Session.getScriptTimeZone(), "yyyy-MM-dd");
  sh.getRange(2, 1, last - 1, HEADERS.length).getValues().forEach(function (r) {
    if (String(r[COL.STATUS - 1]) !== "Confirmed" || String(r[COL.DATE - 1]) !== tomorrow) return;
    try {
      MailApp.sendEmail({
        to: String(r[COL.EMAIL - 1]),
        replyTo: CONFIG.OWNER_EMAIL,
        name: CONFIG.BUSINESS_NAME,
        subject: "Reminder: your session is tomorrow – " + CONFIG.BUSINESS_NAME,
        body: "Hi " + String(r[COL.NAME - 1]).split(" ")[0] + ",\n\nA quick reminder about your " + r[COL.PACKAGE - 1] +
          " tomorrow at " + niceTime_(String(r[COL.START - 1])) + (r[12] ? " (" + r[12] + ")" : "") +
          ".\n\nReply to this email if you need to change anything.\n\nSee you then!\n– " + CONFIG.BUSINESS_NAME
      });
    } catch (err) { console.error("Reminder error: " + err); }
  });
}

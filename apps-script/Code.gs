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
  OWNER_EMAIL: "jabaribrownstudio@gmail.com",   // where booking alerts are sent
  BUSINESS_NAME: "Jabari Brown Studio",
  SHEET_NAME: "Bookings",
  SEND_CLIENT_EMAIL: true,
  SEND_STATUS_EMAIL: true,          // email the client when you Confirm or Cancel their booking

  // ---- Admin app (your phone) ----
  // A long secret only you know (20+ letters/numbers). You type it into the admin app once.
  // Leave as is to switch the admin app off.
  ADMIN_KEY: "!nz]]|=>D#Z|Y9-QIb4H=4VI9F4Z(@",

  // ---- Google Calendar ----
  CALENDAR_ID: "primary",           // "primary" = your main calendar, or paste a calendar ID. "" turns calendar off
  POPUP_REMINDERS: [1440, 60],      // minutes before the session: 1 day and 1 hour
  EMAIL_REMINDERS: [1440],          // minutes before the session: email reminder 1 day before
  INVITE_CLIENT_ON_CONFIRM: false,  // true = when you set Status to Confirmed, the client is added as a guest (Google emails them an invite)

  // ---- Reminder email to the client ----
  CLIENT_REMINDER_EMAIL: true,      // email the client the day before a Confirmed session
  CLIENT_REMINDER_HOUR: 8,          // hour of day (0-23, script time zone) the reminders go out

  // ---- Invoices and estimates ----
  AUTO_INVOICE_ON_CONFIRM: true,    // create (and email) an invoice when a booking is confirmed
  INVOICE_START_NUMBER: 41,         // your next invoice number (your last one was 40)
  ESTIMATE_START_NUMBER: 1,
  PAYMENT_DUE_DAYS: 0,              // days after the invoice date that payment is due (0 = same day)
  ESTIMATE_VALID_DAYS: 30,
  CURRENCY_SYMBOL: "J$",
  CURRENCY_CODE: "JMD",
  BUSINESS_LINES: ["Kingston", "Jamaica"],
  BUSINESS_PHONE: "8768531254",
  BUSINESS_EMAIL: "jabaribrownstudio@gmail.com",
  LOGO_URL: "https://jabaribrownstudio.github.io/booking/images/logo.png",
  INVOICE_TERMS: "Banking Information:\nJabari Brown\nBank: Nova Scotia\nAccount #: 000850945\nBranch: 90365 Liguanea Branch\nAccount type: Savings\nAccount currency: JMD",
  ESTIMATE_NOTE: "This is an estimate, not a bill. The final amount may change if the work changes.",
  INVOICE_FOOTER: "Thank you for your business, have a great day!",

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

var READ_ONLY = { admin_list: 1, admin_money: 1, admin_inv_pdf: 1, admin_inv_receipt: 1 };

function doPost(e) {
  var lock = LockService.getScriptLock(), locked = false;
  try {
    var d = JSON.parse(e.postData.contents);
    // Reading doesn't change anything, so it doesn't have to queue behind other requests.
    if (!READ_ONLY[d.action]) { lock.waitLock(20000); locked = true; }
    if (d.action && String(d.action).indexOf("admin_") === 0) return json_(adminApi_(d));
    return json_(createBooking_(d, false));
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: "server_error" });
  } finally {
    try { if (locked) lock.releaseLock(); } catch (x) { /* ignore */ }
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
  if (!admin) try {
      mail_({
        to: CONFIG.OWNER_EMAIL,
        replyTo: email,
        subject: "New booking request: " + row[6] + " – " + when,
        body: "New booking request\n\nPackage: " + row[6] + " (" + row[7] + ")\nWhen: " + when +
          "\nName: " + name + "\nEmail: " + email + "\nPhone: " + phone +
          "\nInstagram: " + row[5] + "\nLocation: " + row[12] + "\nNotes: " + row[13] +
          "\nSource: " + (row[14] || "website") + "\n\nOpen the Studio Admin app or the sheet to confirm or cancel."
      });
  } catch (mailErr) { console.error("Owner mail error: " + mailErr); }
  if (!admin) try { push_("New booking: " + name, row[6] + " · " + when, { type: "booking", row: String(r), name: name, pkg: String(row[6]), when: when }); } catch (pushErr) { console.error("Push error: " + pushErr); }
  try {
    if (emailOk && ((!admin && CONFIG.SEND_CLIENT_EMAIL) || (admin && d.notifyClient))) {
      mail_({
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

  try { ensureClient_({ name: name, email: email, phone: phone, instagram: String(d.instagram || "") }); } catch (ce) { console.error("client: " + ce); }
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
    var now = String(e.range.getValue());
    if (String(e.oldValue || "") !== now) {
      var inv = null;
      if (now === "Confirmed" && CONFIG.AUTO_INVOICE_ON_CONFIRM) {
        try { inv = createInvoiceForBooking_(e.range.getRow(), []); } catch (ie) { console.error("invoice: " + ie); }
      }
      if (now === "Cancelled") { try { voidInvoicesForBooking_(e.range.getRow()); } catch (ve) { console.error("void: " + ve); } }
      sendStatusEmail_(sh, e.range.getRow(), inv);
    }
    syncCalendar_(sh, e.range.getRow());
  } catch (err) { console.error("onStatusEdit: " + err); }
}

/** Sends an email with both a plain and an HTML body. Plain-text emails are broken into short lines by mail servers, which splits sentences. */
function mail_(o) {
  if (o.body && !o.htmlBody) {
    o.htmlBody = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222222;">' +
      esc_(o.body).replace(/\n/g, "<br>") + "</div>";
  }
  MailApp.sendEmail(o);
}

/** Emails the client when a booking is Confirmed or Cancelled. */
function sendStatusEmail_(sh, row, inv, comment) {
  try {
    if (!CONFIG.SEND_STATUS_EMAIL) return;
    var v = sh.getRange(row, 1, 1, HEADERS.length).getValues()[0];
    var status = String(v[COL.STATUS - 1]), email = String(v[COL.EMAIL - 1] || "");
    if ((status !== "Confirmed" && status !== "Cancelled") || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
    var name = String(v[COL.NAME - 1]), first = name.split(" ")[0];
    var when = niceDate_(String(v[COL.DATE - 1])) + " at " + niceTime_(String(v[COL.START - 1]));
    var body = status === "Confirmed"
      ? "Hi " + first + ",\n\nGood news: your session is confirmed.\n\n" + v[COL.PACKAGE - 1] + "\n" + when +
        (v[12] ? "\nLocation: " + v[12] : "") + "\n\nReply to this email if anything needs to change.\n\nSee you then!\n– " + CONFIG.BUSINESS_NAME
      : "Hi " + first + ",\n\nYour booking for " + v[COL.PACKAGE - 1] + " on " + when +
        " has been cancelled.\n\n" + (comment ? "A note from " + CONFIG.BUSINESS_NAME + ": " + comment + "\n\n" : "") + "If you'd like to rebook or have any questions, just reply to this email.\n\n– " + CONFIG.BUSINESS_NAME;
    var mail = {
      to: email, replyTo: CONFIG.OWNER_EMAIL, name: CONFIG.BUSINESS_NAME,
      subject: (status === "Confirmed" ? "Your session is confirmed – " : "Your booking was cancelled – ") + CONFIG.BUSINESS_NAME,
      body: body
    };
    if (inv && status === "Confirmed") {
      mail.body = body.replace("\n\nReply to this email", "\n\nYour invoice (#" + inv.number + ") is attached.\nTotal: " + money_(inv.total) +
        "\nAmount due: " + money_(Math.max(0, inv.total - inv.paid)) + "\nPayment due: " + fmtDate_(inv.due) + "\n\nReply to this email");
      mail.attachments = [invoicePdf_(inv)];
    }
    mail_(mail);
    if (inv && status === "Confirmed") markSent_(inv);
  } catch (err) { console.error("sendStatusEmail_: " + err); }
}

function niceDate_(d) {
  var p = d.split("-");
  if (p.length !== 3) return d;
  return Utilities.formatDate(new Date(+p[0], +p[1] - 1, +p[2]), Session.getScriptTimeZone(), "EEEE, d MMMM yyyy");
}

/** Run this once from the editor to check that emails work. It also triggers the permission prompt. */
function testEmail() {
  MailApp.sendEmail(CONFIG.OWNER_EMAIL, "Test from your booking app", "If you can read this, booking alerts are working.");
  console.log("Sent a test email to " + CONFIG.OWNER_EMAIL);
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
  // Behind the Cloudflare Worker: the Worker proves itself with the owner key and says who is acting
  // (the Worker has already checked that person's username and password).
  if (me && me.role === "Owner" && d.as && d.as.name && ["Owner", "Manager", "Staff"].indexOf(d.as.role) > -1) {
    me = { name: clean_(d.as.name, 60), role: d.as.role };
  }
  if (!me) {
    Utilities.sleep(1500); // slows down anyone guessing a key
    return { ok: false, error: "unauthorized" };
  }
  if ((OWNER_ONLY[d.action] && me.role !== "Owner") || ((MANAGER_UP[d.action] || MONEY_ACTIONS[d.action]) && me.role === "Staff")) return { ok: false, error: "forbidden" };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  switch (d.action) {
    case "admin_remind_booking": {
      var rr = remindBooking_(parseInt(d.row, 10));
      return rr === "ok" ? { ok: true } : { ok: false, error: rr === "no_email" ? "no_email" : "invalid_input" };
    }
    case "admin_push_register": return pushRegister_(d.token, me.name, true);
    case "admin_push_unregister": return pushRegister_(d.token, me.name, false);
    case "admin_list": { var lst = adminList_(d.all === true); lst.me = me; return lst; }

    case "admin_status": {
      var sh = getSheet_(), row = parseInt(d.row, 10);
      if (!(row >= 2 && row <= sh.getLastRow()) || ["Pending", "Confirmed", "Cancelled"].indexOf(d.status) < 0) return { ok: false, error: "invalid_input" };
      var before = String(sh.getRange(row, COL.STATUS).getValue());
      sh.getRange(row, COL.STATUS).setValue(d.status);
      sh.getRange(row, COL.HANDLED).setValue(me.name);
      if (before !== d.status) {
        var invOpt = d.invoice || null, inv = null;
        if (d.status === "Confirmed" && !(invOpt && invOpt.skip === true) && (invOpt || CONFIG.AUTO_INVOICE_ON_CONFIRM)) {
          try { inv = createInvoiceForBooking_(row, invOpt ? invOpt.extras : [], invOpt ? invOpt.discount : null, invOpt ? invOpt.taxes : [], invOpt ? invOpt.date : "", invOpt ? invOpt.due : ""); } catch (ie) { console.error("invoice: " + ie); }
        }
        var why = d.status === "Cancelled" ? cleanText_(d.comment, 500) : "";
        if (why) {
          var nc = sh.getRange(row, 14), oldNote = String(nc.getValue() || "");
          nc.setValue(clean_((oldNote ? oldNote + " | " : "") + "Cancelled: " + why, 1000));
        }
        var vr = d.status === "Cancelled" ? voidInvoicesForBooking_(row) : { voided: 0, kept: 0 };
        if (d.notifyClient !== false) sendStatusEmail_(sh, row, inv && !(invOpt && invOpt.send === false) ? inv : null, why);
        syncCalendar_(sh, row);
        return { ok: true, voided: vr.voided, kept: vr.kept, estimates: vr.estimates };
      }
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
  if (MONEY_ACTIONS[d.action]) return moneyApi_(d, me);
  return { ok: false, error: "unknown_action" };
}

/* ---------- invoices, estimates and money tracking ---------- */

var TAB_INV = "Invoices", TAB_FEES = "Products & Services", TAB_TAXES = "Taxes", TAB_CLIENTS = "Clients";
var INV_HEADERS = ["Number", "Type", "Status", "Date", "Due / valid until", "Client", "Email", "Phone", "Booking row",
                   "Items (JSON)", "Total", "Paid", "Payments (JSON)", "Notes", "Created", "Sent", "From estimate", "Discount (JSON)", "Taxes (JSON)"];

// What each package says on its invoice line. Keep in step with js/config.js.
var PACKAGE_DETAILS = {
  "bronze": { price: 15000, title: "BRONZE Package", lines: ["Duration: 30 minutes", "10 Retouched Images", "1 Outfit", "1 Location (within the corporate area)"] },
  "silver": { price: 22000, title: "SILVER Package", lines: ["Duration: 1 hour", "15 Retouched Images", "2 Outfits", "1 Location (within the corporate area)"] },
  "gold": { price: 37000, title: "GOLD Package", lines: ["Duration: 2 hours", "25 Retouched Images", "2 Outfits", "2 Locations (within the corporate area)"] },
  "professional headshot": { price: 7500, title: "Professional Headshot", lines: ["Duration: 20 minutes", "5 Retouched Images", "1 Outfit", "1 Studio Setup"] }
};

var MONEY_ACTIONS = { admin_fee_update: 1, admin_tax_add: 1, admin_tax_remove: 1, admin_inv_receipt: 1, admin_money: 1, admin_inv_save: 1, admin_inv_send: 1, admin_inv_pay: 1, admin_inv_unpay: 1, admin_inv_status: 1,
                      admin_inv_convert: 1, admin_inv_remind: 1, admin_inv_pdf: 1, admin_inv_delete: 1, admin_fee_add: 1, admin_fee_remove: 1, admin_clients: 1, admin_client_save: 1, admin_client_delete: 1 };

function safeJson_(v, fallback) { try { var x = JSON.parse(String(v)); return x == null ? fallback : x; } catch (e) { return fallback; } }
function tz_() { return Session.getScriptTimeZone(); }
function todayStr_() { return Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd"); }
function addDays_(ymd, n) {
  var p = ymd.split("-"), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + (n || 0)));
  return d.getUTCFullYear() + "-" + pad_(d.getUTCMonth() + 1) + "-" + pad_(d.getUTCDate());
}
function fmtDate_(ymd) {
  var p = String(ymd).split("-");
  if (p.length !== 3) return String(ymd);
  return Utilities.formatDate(new Date(+p[0], +p[1] - 1, +p[2]), tz_(), "MMMM d, yyyy");
}
function dateStr_(v) { return Object.prototype.toString.call(v) === "[object Date]" ? Utilities.formatDate(v, tz_(), "yyyy-MM-dd") : String(v || ""); }
function isYmd_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")); }
function validEmail_(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || "")); }
function money_(n) {
  n = Math.round((+n || 0) * 100) / 100;
  var s = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (n < 0 ? "-" : "") + CONFIG.CURRENCY_SYMBOL + s;
}
function esc_(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function cleanText_(v, max) { return String(v == null ? "" : v).replace(/\r/g, "").trim().slice(0, max || 300); }

function invSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(TAB_INV);
  if (sh) {
    if (sh.getLastColumn() < INV_HEADERS.length) sh.getRange(1, 1, 1, INV_HEADERS.length).setValues([INV_HEADERS]).setFontWeight("bold");
    return sh;
  }
  sh = ss.insertSheet(TAB_INV);
  sh.getRange(1, 1, 1, INV_HEADERS.length).setValues([INV_HEADERS]).setFontWeight("bold");
  sh.setFrozenRows(1);
  sh.getRange(2, 4, 3000, 2).setNumberFormat("@");
  sh.setColumnWidth(6, 180); sh.setColumnWidth(10, 260);
  return sh;
}

function taxesSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(TAB_TAXES);
  if (sh) return sh;
  sh = ss.insertSheet(TAB_TAXES);
  sh.getRange(1, 1, 1, 2).setValues([["Tax name", "Rate (%)"]]).setFontWeight("bold");
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 220);
  return sh;
}

function feesSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(TAB_FEES);
  if (!sh) { sh = ss.getSheetByName("Products & services") || ss.getSheetByName("Fees"); if (sh) sh.setName(TAB_FEES); } // older names of this tab
  if (sh) {
    if (String(sh.getRange(1, 4).getValue()) !== "Quantity") sh.getRange(1, 1, 1, 4).setValues([["Item", "Description (optional)", "Price", "Quantity"]]).setFontWeight("bold");
    return sh;
  }
  sh = ss.insertSheet(TAB_FEES);
  sh.getRange(1, 1, 1, 4).setValues([["Item", "Description (optional)", "Price", "Quantity"]]).setFontWeight("bold");
  sh.getRange(2, 1, 1, 4).setValues([["Permit fee", "", 0, 1]]);
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 220); sh.setColumnWidth(2, 320);
  return sh;
}

function invFromRow_(r, row) {
  var items = safeJson_(r[9], []), pays = safeJson_(r[12], []);
  return { row: row, number: +r[0] || 0, type: String(r[1]), status: String(r[2]), date: dateStr_(r[3]), due: dateStr_(r[4]),
    client: String(r[5]), email: String(r[6] || ""), phone: String(r[7] || ""), bookingRow: +r[8] || 0, items: items,
    total: +r[10] || 0, paid: +r[11] || 0, payments: pays, notes: String(r[13] || ""), created: String(r[14] || ""),
    sent: String(r[15] || ""), from: +r[16] || 0, discount: safeJson_(r[17], null), taxes: safeJson_(r[18], []) };
}

function readInv_() {
  var sh = invSheet_(), last = sh.getLastRow();
  if (last < 2) return [];
  var out = [];
  sh.getRange(2, 1, last - 1, INV_HEADERS.length).getValues().forEach(function (r, i) {
    if (!r[0] && !r[5]) return;
    out.push(invFromRow_(r, i + 2));
  });
  return out;
}

function getInv_(row) {
  var sh = invSheet_();
  row = parseInt(row, 10);
  if (!(row >= 2 && row <= sh.getLastRow())) return null;
  var r = sh.getRange(row, 1, 1, INV_HEADERS.length).getValues()[0];
  return r[0] || r[5] ? invFromRow_(r, row) : null;
}

function writeInv_(inv) {
  var sh = invSheet_();
  var r = inv.row || Math.max(sh.getLastRow() + 1, 2);
  sh.getRange(r, 4, 1, 2).setNumberFormat("@");
  sh.getRange(r, 1, 1, INV_HEADERS.length).setValues([[inv.number, inv.type, inv.status, inv.date, inv.due, inv.client, inv.email, inv.phone,
    inv.bookingRow || "", JSON.stringify(inv.items), inv.total, inv.paid, JSON.stringify(inv.payments), inv.notes, inv.created, inv.sent, inv.from || "",
    inv.discount ? JSON.stringify(inv.discount) : "", JSON.stringify(inv.taxes || [])]]);
  inv.row = r;
  return inv;
}

function nextNumber_(type) {
  var max = (type === "Estimate" ? CONFIG.ESTIMATE_START_NUMBER : CONFIG.INVOICE_START_NUMBER) - 1;
  readInv_().forEach(function (i) { if (i.type === type && i.number > max) max = i.number; });
  return max + 1;
}

function cleanItems_(arr) {
  var out = [];
  (arr || []).slice(0, 40).forEach(function (x) {
    var name = cleanText_(x && x.name, 100);
    if (!name) return;
    var qty = +x.qty; if (!(qty > 0)) qty = 1;
    var price = +x.price; if (isNaN(price)) price = 0;
    out.push({ name: name, desc: cleanText_(x.desc, 500), qty: Math.min(qty, 1000), price: Math.max(-1e8, Math.min(price, 1e8)) });
  });
  return out;
}

function cleanDiscount_(x) {
  if (!x) return null;
  var type = x.type === "amount" ? "amount" : "percent", v = +x.value;
  if (!(v > 0)) return null;
  return { type: type, value: Math.min(v, type === "percent" ? 100 : 1e8) };
}

function cleanTaxes_(arr) {
  var out = [];
  (arr || []).slice(0, 5).forEach(function (t) {
    var name = cleanText_(t && t.name, 40), rate = +(t && t.rate);
    if (name && rate > 0 && rate <= 100) out.push({ name: name, rate: rate });
  });
  return out;
}

/** Subtotal, discount, each tax and the total. Taxes are worked out after the discount. */
function totals_(items, discount, taxes) {
  var sub = calcTotal_(items), disc = 0;
  if (discount && discount.value > 0) disc = discount.type === "amount" ? discount.value : sub * discount.value / 100;
  disc = Math.round(Math.min(Math.max(disc, 0), Math.max(sub, 0)) * 100) / 100;
  var base = sub - disc, tl = [], tt = 0;
  (taxes || []).forEach(function (t) {
    var a = Math.round(base * t.rate) / 100;
    tt += a; tl.push({ name: t.name, rate: t.rate, amount: a });
  });
  return { subtotal: sub, discount: disc, taxes: tl, total: Math.round((base + tt) * 100) / 100 };
}

function recalc_(inv) { inv.total = totals_(inv.items, inv.discount, inv.taxes).total; return inv; }

function calcTotal_(items) {
  var t = 0;
  items.forEach(function (i) { t += Math.round(i.qty * i.price * 100) / 100; });
  return Math.round(t * 100) / 100;
}

/** The first invoice line for a booking: the package, priced from the booking. */
function bookingItem_(v) {
  var pkg = String(v[COL.PACKAGE - 1] || ""), det = PACKAGE_DETAILS[pkg.toLowerCase()];
  var price = parseFloat(String(v[7] || "").replace(/[^0-9.]/g, "")) || 0;
  var dur = v[11] ? "Duration: " + v[11] + " minutes" : "";
  return { name: det ? det.title : (pkg || "Photography session"), desc: det ? det.lines.join("\n") : dur, qty: 1, price: price };
}

function invoiceForBooking_(row) {
  var found = null;
  readInv_().forEach(function (i) { if (!found && i.type === "Invoice" && i.bookingRow === row && i.status !== "Void") found = i; });
  return found;
}

/** When a booking is cancelled, its invoices are voided and then deleted, and its estimates are deleted.
 *  Invoices that already have payments are left alone (returned as `kept`). */
function voidInvoicesForBooking_(row) {
  var res = { voided: 0, kept: 0, estimates: 0 };
  var todo = [];
  readInv_().forEach(function (i) {
    if (i.bookingRow !== row) return;
    if (i.type === "Invoice") {
      var paid = 0; (i.payments || []).forEach(function (p) { paid += +p.amount || 0; });
      if (paid > 0.004) { res.kept++; return; }
      if (i.status !== "Void") { i.status = "Void"; writeInv_(i); }
      res.voided++;
    } else res.estimates++;
    todo.push(i.row);
  });
  todo.sort(function (a, b) { return b - a; }).forEach(function (r) { invSheet_().deleteRow(r); });
  return res;
}

function createInvoiceForBooking_(row, extras, discount, taxes, dateIn, dueIn) {
  var existing = invoiceForBooking_(row);
  if (existing) return existing;
  var v = getSheet_().getRange(row, 1, 1, HEADERS.length).getValues()[0];
  var date = isYmd_(dateIn) ? dateIn : todayStr_(), items = [bookingItem_(v)].concat(cleanItems_(extras));
  var inv = ({ row: 0, number: nextNumber_("Invoice"), type: "Invoice", status: "Draft", date: date,
    due: isYmd_(dueIn) ? dueIn : addDays_(date, CONFIG.PAYMENT_DUE_DAYS), client: String(v[COL.NAME - 1]), email: String(v[COL.EMAIL - 1] || ""),
    phone: String(v[4] || ""), bookingRow: row, items: items, total: 0, paid: 0, payments: [], notes: "",
    created: new Date().toISOString(), sent: "", from: 0, discount: cleanDiscount_(discount), taxes: cleanTaxes_(taxes) });
  recalc_(inv); return writeInv_(inv);
}

function setPaidStatus_(inv) {
  if (inv.type !== "Invoice" || inv.status === "Void") return;
  var paid = 0;
  inv.payments.forEach(function (p) { paid += +p.amount || 0; });
  inv.paid = Math.round(paid * 100) / 100;
  if (inv.total > 0 && inv.paid >= inv.total - 0.005) inv.status = "Paid";
  else if (inv.paid > 0) inv.status = "Partial";
  else if (inv.status === "Paid" || inv.status === "Partial") inv.status = inv.sent ? "Sent" : "Draft";
}

function markSent_(inv) {
  inv.sent = new Date().toISOString();
  if (inv.status === "Draft") inv.status = "Sent";
  writeInv_(inv);
}

/* ---- the document ---- */

var LOGO_B64 = "iVBORw0KGgoAAAANSUhEUgAAAdIAAADmCAYAAABh/AQ5AAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAydpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDEwLjAtYzAwMCA3OS5kMjBlNDY2MzAsIDIwMjUvMTIvMDktMDI6MTE6MjMgICAgICAgICI+IDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+IDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiIHhtbG5zOnhtcE1NPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvbW0vIiB4bWxuczpzdFJlZj0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL3NUeXBlL1Jlc291cmNlUmVmIyIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bXBNTTpEb2N1bWVudElEPSJ4bXAuZGlkOjdDOEQ5RDU3RDVDNTExRjFCQkE0ODFEODAyNjlGRUU4IiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOjdDOEQ5RDU2RDVDNTExRjFCQkE0ODFEODAyNjlGRUU4IiB4bXA6Q3JlYXRvclRvb2w9IkFkb2JlIFBob3Rvc2hvcCAyNi44IChXaW5kb3dzKSI+IDx4bXBNTTpEZXJpdmVkRnJvbSBzdFJlZjppbnN0YW5jZUlEPSJ4bXAuaWlkOkUwRTA2ODAyNkU0NjExRjA4MTVGQUY4RDhFQzQ1NjI0IiBzdFJlZjpkb2N1bWVudElEPSJ4bXAuZGlkOkUwRTA2ODAzNkU0NjExRjA4MTVGQUY4RDhFQzQ1NjI0Ii8+IDwvcmRmOkRlc2NyaXB0aW9uPiA8L3JkZjpSREY+IDwveDp4bXBtZXRhPiA8P3hwYWNrZXQgZW5kPSJyIj8+pJtFEwAAj6BJREFUeNrsXQe4FFXSLYJgBkXFhBnFiBhWzIJZYRWziwHMaVXMWdYcETGvKMY157yi8gtiRAEzuoiIiKiACIiC9F/nvqrhTk93T/d0z5vAPd9X7/Wkzn3rVjrVxPM8cnBwcHBwcCgNTd0pcHBwcHBwcIrUwcHBwcGhImjuToGDg0ONYj+WrixfsgxgcXEqB6dIHRwcHGLiXyynsLSS1+uynMzypzs1Do2NJi7ZyMHBocZwJcs5WPjrr7+oWbNm+v4XLFuzTHGnyIFcjNTBoSR0YenDcjXLQSyd3CmpO6wBJTpjxgw68sgjabXVVqO99tqL/ve//+GzDizXulPkQM61W/PozNKNZW1qcDO9wzKE5RN3asqKh0R5+nGOKFaH+sD++PPSSy/R3Xffbd6YMGECzZs3j5577jkSF6+Dg1OkNXwu72X5h+/9nvL/TpZj3GkqC/6jSvTmm2+mMWPG0E477UR///vf8daRTpHWFebhz9y5c/Pe3G677XRxgjtFDuRipFSrLvK3Wf72xx9/0JNPPmlcTYsuuiitt956tOOOO9JCCy2E7z3Dsrc7XZniMExg/vzzT9p1111pyJAh5s2OHTvSyJEjsTgU46w7TXUDuG8/nzRpEm2zzTbmOVtllVXo888/N8+b3A/3u9Pk4CzS2sMhUKJTp06lv/3tb/T111/nfbjqqqsaV9S66667F798nBrS9h3SYxnxAtCFF16YU6LAEUccoYtfutNUV0BC0T3LL798ry+//JLeffdd2mCDDVSJfuCUqIOzSGsXr7Dscthhh9H99wc/xx06dDCzZsG2LMOq3MLGyLQIyxLUUGLQUpbx/mIsS8nn+GwFljYsi8tnLWQ9v7NMo4ZYMWQqy28s37K8Senjxih3uPG3336jVq1akX0vwxqFVco4Fd9xt2jd4WWWXa3XI1h2lnvMwcEp0hoDlMvEX375ZfFlllkm+sl/+WXjfhTFu1s5rqcoPMjC8n8hUXZLyr4uzdJaXi8ln6ksIcqwlaVIFynjuYOr+3CWX9MMpueddx5deeWVuTdXWGEFmjhxor5cn+Uzd5vWJfAMrcPyDcuz7nQ4OEVau1idZeyoUaNo4403jvzicsstRz/++CMW54qCi0JLUXhLifJrI6+XEdFlfb+VKM8WlhJtWcoBzZw5k37//XeaNWsWTZs2jWDxIfaL/3j/119/Ncv6+Q8//EA///yzeY2yBHwXgLutdevW1KJFC2rZsiUtscQS5vWaa65JvXr1oqWWwqHRKJaNS9jNTWCFYJuwRu3kk27dumkGJ3zs7d0t6uDgQC5GWtXAbHgiu25XhEUKhRKGyZMn01NPPUU9evTAeb+JGhJh2rEsLwpRlaRaja1LUYaYHE2fPt0oOwhby+Y1BMtQhJApU6bklCL+62+gDKEwIeUCLMj3338f8WP4X/cS6zQJzsef/v37F2Rwtm3bVheHuNvTwcHBWaS1gcswsCMut8MOOxilFIZddtmFXnnllaIrhHJQZQYLb/bs2cbig/KDMkRiE5Q2BO9BYB1C8JkqRdTXVSv2228/euyxx0jKV3om+CkmGD8zq00zWPk4dhsjRoygTTaBwUoHsjzqbk8HBwdnkVYecJW2laQaWJDLyv9VxILEa+Paveyyy+if//xn6IpeffVVevbZZ42iRAo/rFTITz/9lFOOUIYo54DyVEVajxOeb775RheXTvjTE1maPfTQQwVK9OCDD1YlOtXFzRwcHJwibTwsJEpxZfkPJbkmNbhcVxYFumycFbVp04aKuV1BaeZAdPrpp+vi/yX8aW/8GT58eMEHPXvmDNszWWa7s+zg4EDOtZsZFhelCK7OtVhWpYZEodVFYS5fbAVwlSIbFFYjaMm+//57kzwEixLLsCrHjx9fYCXVMxZZZBFacsklTSIRkn6QTITlxRZbzEwq8BmSivA9xF5x/mBxd+3alQ499FBdDa7L9zE3Cf7cD7GwzjrrGBYjBRKaYNXztv4UK3eme8QdHBycRRofi0qG5tqiHMG5uRw1ZLMuI8tLBf0Q8UQowG+//dYoRPyH2xGKU5N0NGkHSqDuZhiLL07LLrusESg9LnY3y0svvXTuvYUXXtgIMnHtZShMKE4osRIwV7hTv0/wG2POg3zBVqLAHnvsYRQ24y2nRB0cHJwiDcfyoijbWwpzHXHHhvpVYTnCGgLr0NixY42ihMIExRgsyqgEoVoFlBsUIeoqkckKWXnllc1rJOngvypMKUVJij9EYeHkTRfR5VksPwkBw1Rxs4KsYUWxFkHG8Dw1kDMkgSmVueeeewo+AL+u4Gv3aDs4OCzIinRRiUkuL3FKxCxXE6W5lnwWWIOJBB1VkGARgsWCZfyHxan1jfUCuFFVMbZr185wjupr0BJCWcK92rRp7G55M4WJ6GeRKaIMfxJl+Iss/yqvp4jCnNmIseyuWJA60TxsttlmujjGPdoODg71pEgXFpdqa8l8bSuuVliQK1lkAotbzDtLhylKxCbHjRtH4NmEZQkliZgkYmOIUcK6rHWA4H6llVYyyhACJbn22msbpYg4pAosSbhlIzBNFN8PIjg537FMFGX4myhCyAzLqvyrSk/NvrhHoET9cWicm06dcu1H33SPtoODQzUp0jWEZg3Kb45YIhh4PYuHtZXFtqMKU5c1ThlLaUMhIk6J0hC4YaE0YVWqOxbKsh4Ath/EIqEomczeWJNrrLEGtW/f3izDmqTi7aQmUUN8cYL8/0b+4/3xYlX+Vkf3KxSp1p7mAedQOuxMF95VBwcHh4oqUmRsXMKyuyjRTIBsVyhCzXpFzBKxS7hdQTOH1/gPirp6xzPPPEO77VaUbvcXUZKwIr+SZSjIcWJVTpaEnQUFXUhqcf1ArFcwsootagcHhwVEkR7Mcg01lCTQZ599RqNHjzbKDzN+uBOlZZHJZEUWK7JaQRwAAgEIyhx0GZmuSjKA/+WknWtM4BzAmkQ8ElYk/iNmCRcj4pT/+te/8tp6BVmkND+e9wI1xBunifL8WZJwJoj179DQU7TN//3f/xlvBQV01yHn1nVwcKiwIkVGymZC10b33XcfXX/99UaJLoho0qSJca9CKa6++uomTrnaaqsZwnWNX0Zluj799NORivSDDz4wtZTU0AnmNHcrUuyylyBsu+225Ph1HRwcKq1IwRZzPBaef/55Ovzww+v6wGFdI0YJRYn/UJRQjngNgdIECb1lOQYBceIfxd36lbTr2gBWfbGWatIFhiTpqt7QSnquNmN5nxrc0FlYpKExcjRUp4a48Qfusc4BGe5bUUPp0XDXq9PBofyKdA2lwbvxxtrtgwwFBsWoViOsSs1yBXEArMgVV1zR1FQirgbLMwQzJAYJ9+pYash6nSoyTRToWPnOHOt3O0CRYvtRQAIVze9nWi9Actn1LPtRQ79TknglCBJuZnkshULYFAtDhw4t+LBz585KzfhWit6m9QS4OvpQQ7/O5tb9jP6t17G8606Rg0N5FOkLYh0des4559DgwYOrbmdRD4kBE1mtUFSwHLEM6xHKE/+hIMG6EwPTRTl+J/8nWEk834qVWcqgbCh+iilSq0ynXhRpOxmgV9BkKpQrdenSpRlPbrYTi3Jj6T9aimJogqS0oFCD5dZ18dEGC/Q1LMyZM8dkOCOezw3lF2fWJ0xw9qGGTPpf3KlycMhekcL1A47SQ3fccUdDKI4YaWOgWbNmxlKEdYiHHsuwJFE7CUWptZRYhsUZg45OS0MmiOU4TpY1A/Z7sSRnlOFwcA4Nx2wUkIRF8+tsax24IO+xLI+Spf3335/QUo4kKWvAgAF05JFH4uXT1ECskRRrGHPzrbcCP+zYsaMujl7An+fVWIZh4b///a8558iOJ2kqj7g8P0fIhXhQrFUHBwcqD2k9YqV3Y2HUqFHGlYYGzJ988okpTdGWXuoShZVoC5Si8rEivgilCMXHvSMNDR/qRFEbit6axx9/PGbKtPnmm+e6phRRkrMtUoHxohh/EVerUtH9KEr0xwqVQWwOpYKaV9SFUoQLGoMcH+94US7zavg+gstwV7ir0UouiI8YVIxyPhB8vy/h+u9kOYpBd911V8GHX331Fa211lqqSL5dQJ/lFaV+dvlBgwbREUccUfCFTTfd1ChTQecqdfEuK6GBjkIpOV0mSC/I8+7gUH2AUgyQjiwfez5wD02Pazw9Lm8x/yFczuKxcvXYjWQ+50bSXjEwK43Hg5/91myW8SzfsnzO8hbLEyxXshzH0k32qU3I/laTrI8D4pIgj1mHPElIKhBOdvK4jANf/ZWlVZUeS7MY3+mtF5Fd7aHH27dvX/3ahyXsx0j8kLu9FKyXy450vd/UwL1RqrSM8Z3XcBI4ZBB6DSDMCqXn6+IqPM7TWX4LGTb+ZDmmjq+xkxqWMEIGxLE2ZOnGsjPL9iwd2NpsqTWkMTBHSM2ny3JToQFsxVZqU6t0BDWr/cSCrAfMUZcm3LuoqQ38EsevYJXLOVm0ipJkYBHAD7sjy3rUUMf6vlidfktyKfVeHHTQQTk3YqDJ+vLLdPHFF5Oss1WC44WPfH1QAvq7vZiVrbeeLtabJboFNcQztxWO6clyHQZKUhX5WsuZWqpddtklcqX/+c9/qFu3btWYLX4/yyFYADELrGrUCyOcc8ABByC8A9qqO6iBcOM9ZwI5UA1RBD4vQkIBuILE9Gx/sM5254krFUw7v4sb9neJQ/5lEdIvJW6o9lIy8n6dnVNDn8iTjibIEo4CSjm4RrWpdK35gSpfKnEqywmi3I0bX1ztawlRxwEsZ7B8Ib8xzPFPPPEEPfLII1QsDm5NNJokVCjN33nnHQrqnbvRRhvp4s91cv9gAnsSyzH6Bpi+uF3dssIy1ovlNpYLJayB5/EZfO+ss87KxaZjXAevipLU7mXpgslS//796dprrzVkLgokP+K90047TRXuOm7odqgF166T0mVJcdd6W2+9daSbjanu1G21TYX3Gf7RKbozbA143JLM4ziux5aAx0krtit+LktTlh31DfYuRB4nZM8999SvT4zpMla5ED86//zzA9d7//3363pvrIN7J+cm53wC75prrvG22GILj0u3PE6881iR2K7O7+Q3l+IFE1UUvQaQk08+WX9/XRUc79J633FOgcflaJH7znkauu/ruXHGSS24dh1Kx+8iS6LpdaTpOmtWNWTuotPOR/AUwDXbu3fvvNIn0DoiwQeuNpSerL/++s3EzWtM1RtuuMEkkBWDVZI0K2ES2PpKVRkE0DMK/lfj900ndZO/99571L1797xORkjU69evHw0bNoxgnXOyHyg872Hpjs/PPPPMWBux7sk0XJ1IGDtQPEtvs1xLDTXVSYEs7qXg+dhhhx0KyDaQrY8ER5RRqcuX7z+SphifuaHGwVmk9S3/w7R5n332iZxhP/zwwzrD3rtC+9ma5QvsAKxjjulG7i+sU1b+802i777zeECPZQkdc8wx+rOPEu7jGPyIa4QL1sluZ2O5CXas4ftlTfVi3HHHHUXPJZen5WXhcFlQrGsAgZUruKBEz8VLAYlAf7Hsl3Bd9+k9tOGGGxbs54knnmgSGHni4O2+++7GK8Lc3rq9Vm6McVJN4k5CecT4oA455JDIQQ0uVMEBFdrPVzXDmEIyi/3vcQwrN3rC7Rik3CD+90899VT92dCEA7fHZTWB+8fxUV0nUsVXrNF7BSVoJn2bLf/A42SSkYL3Xnppvj6DC97/OZMvBE5ybrrpJv3ZWQn3s7lk1XtcK2xc9dy6zvv3v/9tK9SVYq7rXnwZkzKuby3Yx9tvvz0q6f8Uaz2dWY5k2d6NOU4qKU2dTV4WzFQ+3yhY9ZaLUWUYcHbCQlA7t549e5p6X9QP25naPICb/+jC8u67hWWIRx99dODGrAbkSVyKa+PPF198EfihVac7KSM+30oAiTZtUWctpBV5QIIN6nOR9WzjxRdfJKXzhPvdBmqz0X2oyHWYk3A/sXOrYIFj//TCCy/Q559/TuxpMG0QBXvHWA/q1A8zCxxGsN3XAHtp6Nhjj9WX57MMkOuLSoKzccjy2R3iVh4ojQreVeIOB4fGhlOk5YGpeYnqDgNo7IcanyZwUc24RUbk8OHD8z7Eew888IDhJEZMCrG5nBaUNngXXXQRBZVWcJKSyfb1w8pgnpZgP9dVMocgIIZWw/HRtSRD+lC8QImHH/fcc49hF0PmNJTjKaeckvuMLU7ium06++yzC3734IMPmlhoUJazxbj1eym9YNmitRsuGDz55JN5E58IbCIKkK666qqCTG+s58ADD9SXPViuYDlFMns3llI54BaWY5DZ++abb6oiR9eCoRWalDo4RepAZaIJxGAXBSav0MVmjbx//2VZ+tFHH6Wrr74674PNNtuMrrzySn35b5bJtsWKLivg0cUAZuPvf/87HXzwwYFWKoCmATS/WXlcbGDMzYD+oyTsUIKvMjgnq0sCDU7IWSxbluncIzvqCdlnKAQ699xzbWVkcOutt2oHpkmSlGPOsQJczkgw8k9aLrzwQsMS5l8fFTZAT6pITXudINpQWKY0P3EtyrsA5qWFYC3jmG3gXuzRo4e+3FKPWTDX1wXoBCRfsWuZtt9+e2KiDq1hXlEsXgcHp0jrRZFaNXuBgEVRAUUKZbE1Fk466SQKIk4QoF4UPrY29mCNFnv77bdfgZJELSnAySOBG7UmFdMpGXesaSAfBMvKHZfifPxdesIi6/RhUaJXC/f0+xkSF6xJDfWfY4RowXAHcyKNsc5sgIQA9JkCfPcuretV3HzzzQVdmkBOcckll5CvTR+FZO3+mVD5rw4qRqtrEdnkIoImEePMECxgAsYsV3kfwj0MfmbL8n0nYl8OUdc2Qg8ALFO9/6SnsoMDVRMhg0NpMBqySC9Twz9cgQmNMSk4oaOg3ODxxx+325Gp6eEtvfR8QyMoXonymObNm/tLevJgcShPS0pW74+jKSzXeSmlF23EzbivKh4Q7qPEAspmgw02gELDoPwxNfAnl2r1gjwAWuJSezJy22235eKcfjz11FO6OIga4oAm8Kx81MovTL7yIsQtVeGibKTIOUtikZr2Oq+//joVibuGKWd4NlaAFfmPf/wj74NNNtmEOFPZVpJDiuzLNvjz2muv5Q9kzXND2R9u+HFwipTqhyawWLKRFcNq0kj71YtlJQyylsVjcMIJJ9C+++6rL/ewFPxX7EJdd6uttiqIpQKwqKzfEWcAFxtsf0hQ32qY6KHggoA2eoJvSlBu8E0vB9YgxBnvvPNOO2ZtGjDgPSZ/byWxt+UTbmMJSZTppW/ce++9hqHn008/Df0RXLpQLtRAhafM8/CXe0w63wRtAoOszbvvvtu0ESRxhVvdhfIseMu1+0tSRRrUCxZAZ6YIb8PJ1JCoZJpTfP/993n7g6Q1wQDpShOFlTRu/vbbb+d9gO42JUzUHBzIuXarF/PiuHaDkkHKjBvVlebHZZddpov9rQFxnnbcEJ7cAivAnzAS5oa1XLtTY+4rMkQXQhzZygrNAxPWk5W1GxebCAHFcuhu1KFDB7rlllvylKjGr60s2rZqucbEcdD/qkThzkRXnF69euWUKGLN6KFLPtesNcE5yPoI3U8m435C0lGQIkN8OjdTCbFG4YK3JjTTE54zu3NMgSuarGx1Cx31nkM4wG9FY/Im+/OnUB5SDBpLc61shezzeMxxw4+DU6QLkCKF1dOIvKeI/S05YsQI41q0AXebuPyg5PrYYy/LplhgwgYKyiqVOCU03U/KH0zZuHbbqVs3yLULxSzN06cnKH0Bjy20wSJoDQjLL4pon6QcQ7A/xeMF/khiocuhdAhk/kiIgdLWewLnDQldNp8sMHDgQF1EbPZLyi89MX7dIOJ+Kz4I5T07LDnLl0Ued0LTGjoe1+DLL78M/MKaa66pi/Z1aCZJbSaRyNpHUm8Neh5bxxdHsZuMNcRp4SYOmajNdMOPAzlmo7oQQwAL8oIoQga2ArXI/PQy788yuqHOnTvn7QNavfEMP4zz9wO8iaJ7/75zmYL+BlRHJ7JMRXs8jtUFHitbYvr9dWLu84lRrD3cf1TX93nM9W3L8gd+wBmtsRmZ2ALU7XwSse5NldwC4Diyx+UsBes644wzPFbc5jtsxeV9xmVGNunAyta6F9M3+/TpE8VUhHtuL3AhcxJSsWP5maVFzPNmSJJZEQauE2xYaKUo2NL63d14A8fLuQIFv+PG4/qbhxPcxyAu8Z5++umC9eE+0dPkxh8njmt3AYKVIFHuBuSm2BDdNcDTauPSSy/VWC5MzmE+C3ZTxOOCXMFWpunxYoW1hnXnt7LU8hZr6M8EsTlj6vpdeAFu3R9iZp0iGNcE1pFVq5gHNKtH7ay9Tcsd2Tpk3eiYc4O+QFmHPwsX8WWejChPLF1++eUF7mpwFgtu8jWwvs2YqGxBW98h7XxjceweL63UmoW5wi2LdGqCrF24Z+njjz+mMFIM4VH2rOzprlqGAle0320OK33nnXdW6/FwSsYLncvWpfDuQg4OzrW7oAADNxXWyVGZSl5MjaENZIEydV9OB/hKNUyB6WGHHVawMu4gooktPwkzz+ZR9Z7I+pXM318SuBSXjCqnsTKJiynmFpKF3AQJKmFKFAM7XJd2rJGELF4UQUtZlwIEAYNViSIRZ8stt8xTolAycNeizEWVqJIa2ED8VBQLNnSe9VFXJWywE7pyGva228hKRgIJyO5RMVIrJjuZEtbyhq2zdevc/GK2NakxacdsgRckViEUANe24MqEWbYrhN1n1rPkuZHFwWXt1omOpHzCBcqwtpJKYKRpB2sRGaEhVtDnUiyvMP0tuTUXsQsu7zdMMG7XL3aV/53xh1thUVh2rcRIv09gfS+p8bAgSHxU1xkFcBoui8zfrl27Bn4B1qJSG/qPASVKUqbUwrLiwLBzpu4fJhs2QQU8DbD0wRBF85muMPqvhe/5s27vuy/XL/00ZcWSmCjqW41y908ouCGCsXTFAtvJigGHxqmtpKAJCe6fjlHrtBSpmu6okVkSMfUg8gbUv8q9gDqqyxPey+aiB8W1rcQ9Zxw4OIu0ns5rMUVqudrKmSBxAYUw0lhMMjbP3C4krcusInkKoIO7neUTWW4Z5Ya1Si5+TLDfy0RZpFa5Q5R1hVTjriAM2GabbQLdznD12vzAfiUHSj2Z8GDg78DyhipRlJyg3tRWomAfgmVrKdEHxML/3ZcdbYBEJExOBHdSPgdvc9S1WglPucQtUDgKjrKUrznRM2bMKGaR/pBgMtM+yiK1soBhne+mVILcvaXgu1y+Y3s49inhXl5OW/tROLmJMw4cnEVaJ2jme7gDYdWZlsu1C8q0rrCorKJ3A+7eoYPgd8q7K3iIxH3rH7DAhMRJPvryUns8jVJ6iDtSYVZnMSxfrJRD8CuF1z72JSHlD6u9tCYLuAbN/RawNQloJ+QMzUF4gDgfJ73ka20uEbJYe2ZK+cvj1MDQtCEsKX/28wUXXGAroj8ty2tPCnGtY79FuaOw9z6r8YE50aiNLUKpOCEBH7ApQQqr5bWYklaTiQtxE/aCUhfj5njmGV28TLwgVEJtbuBEwWJXcmOaA7ms3fqQJ5A+yO69yIzQ5557rty9NG/FypkEoGDbXI6h297X+v5TeAP75f8+x7Y8HqD1N0f5tvMG3uzSpUvgcXJsVn93fpKerjwB8NgtHLjOhx56SNe5T8Bv27CYVFJ2Xwf+/qijjtLfow/otSyzmRy/4HvciSSvhxcrMW/11VfP+w5z4tpZyWjpdh7L8tb+vIkPmNyhoNWZhQ2t74/GG9ddd13B/nBXHvs3q1m/WddsfN48j+tKA4+ZCTX0dwfGvAb/wJdZKYbew2eddVbe+WFlGfg9ZmvSr7yf4n5+Dyvo1KlTwfqZ2rKUe8yJE9ePtIrlWTzRUCBRipQp1/Th36oM+7AQlANWzvWSYaUWP1nf30/fZCusYF+59lQ/fjVgW0aLoCQl6Dg54UZ/e0jMfV+SZSaz8wSWTkCYIi6sZAdyBz7geGfgb1F6YmFzlr9hAfvp/y4abSuYUKHgc0yWLKAUZ23fvqyivTc5eznvt0xSoL97z/r+xVH7PnXqVP1Nf992TG0LexFCzxnXtQaVqUQJmn97r7zySug9zAT0uYNHk3XOni34Tvfu3e1ztGnaPr/t27cv2AbTI+r6L3bjjxNX/lIfWChOjNTq8/lbGfYBZOwt4fKyunOQr2foIOvt/toKzZ9YgsQWuILF/bl/wLEuj/ZqYQkpVmwubowU/tRFQQLgL50IIKyfHkC6cIy/W4oNi6f1bmogP3jdF/8tOFd77bUXPfvss2SX39x///2044472us6PqCsxJR3IKbpvx+s66Dpt6uqO5qbwhcGu9kNLMk9P0rZDfkzWuHCDjtn1v32E8UnYwjNxiYf/+8VV1xh80fnubytuPqIFPf0wj43LgV0UnJjmoNz7daJvB5WQG8LXImMv1hWLMM+GHcrk9PnbZMTVTym8dPZ+0byXRBCeBwfLCAq4BZVHlysIS5diGFGYGUdepwjR47U368bc9+3w5cHDx4cuD7sI9dK4itzWNpav1uY5Qd8wL07i1myn8lv1lDiAP93OZHIuCSZRjDvfc6itc/heNnfsGMxDAzcni5vHVw+pL+fxtJMvvsx3njjjTcK9oX7vNqu47UDtnMJPmQi/MDjBvEG8yDjK1PlPMW5DsYcB3FI2LVVFzvXuQZ+zjFo3e9xGdzT3+Je5Iztgu2ApEFwuRt/nDiLtD6wqNYghgGdYSTZ5zcr6zLL7W+viSk2YFnJducIhytSh68j4UP18//CkhIqQ2StDkyaFIRCebFI/0xQv7hsVMkFMmmljnQq5delIr11eSTG+FuMqQVolcBoweixepx+IAvZymzOWV1WL82XZT3TInp4rgQLiicTeR8ceuihuvgYNZQE7UBSs+lv8o2kNKsjzHnSii0osSw0cxpZzmLF/yQ1n7GTe5A5HAYQ0UdZ/+AxpvmlPWkT+JojgS/I6rUs0iZu+HEgl7VbF1hMybXDAGUmA9uMMihSuAibQBG99957eR9YhAT3yP9nVZGAPcfGdtttZxp9qw4O2VbbKPcfSnykzOeXBDy7y0etE4pUskV/s1ypnXQf//nPfxbuJHdNGTBggL4EyesoWTbNVf3k+0ZLT83njuAkLOrWrZu+vFxLiyKwl7IS+TO4rXZi15KVLQ2mIv8EAl1jZPLzh9XejoLKhcImNFbGbhIyhpZRHX1IeHZBDBG03d69e2vWM9rcPUkZkZhY5AsODuTqSOsXC/sbMVMAM4+UMPyqJPcZwtDksNut4AOw7whATt+TpL+jXUupisdq8n1YiBVEWiQf1kgaxAnSlzUJGUPbqHVaNaQ/+uouqV+/fvZ+54B2XUJlh1hwP3kbVvsa6LH60Ucfhe4MakU//PBDVaIzpQbyghjHYZiGHnwwvzsYOr+g64xY02OkL+ry6E/Kmbp532VuZJttqUsEBd6iUb1bExBYFChS/4QitzNduhjKSXRxCZpAWQxON1A2jSD+gnfEavbg4OAsUqrfGtJFolqK+Sjufi/DPpheW/7G0WjTJRy1Q0QhGOXDpSAFZAWo+RNFjzrI+6kIA1FQ/0vKT0ZJ0v9y2bDCe19t5zSrbdmGcEFaHUXI5hPmWK8qkT6W1+DpqPZgJDWoaJgtgzf47rpTvP6nTbUx+UsvvZT3Adqp0fxkr26aHOWnJ6T8Jt99qaHJd+TkLUyRWtfh5wTXYUnlaA4CaorBVBQEhAnEazDDRzRRKhBzmINQQVCfX4tr11EEOjhFWgdooTP5KEIGixHmzzLsQ2fEjPzNjyWO5YkChbnQjBN66K677iJ/LHGLLbYgO4YYgaWirBbLpZhYkUbFSAUj7T6rVtwxb8JikR5cYX0EV2NrZBv72YbIYh2ylCBixBsl8B7ABGwFEgY/7eAOO+ygbtpPldMYMV2/CxVKSuLL6F/2rzhekGnTpqVhgqKgEEUYUxKUfNgEyposXJqQTzcKs33NHoJaEs5zQ5ADOdcu1UOi0eJRysVnVWVND4jsj6XhcvMPzEJ8/odYcCeBys6fJAI3rJUgcj4MEorRkSNsALdYjX6ghF0+wgZpuJ0F/2MBF10LWJVcl1vw3auvvloXYXbeasUjdwETE3qSBvXZBLMTuIZpfmnLZgkH6W2D+rhiAiX9O2dIucx6KMexmgeQJoVZNHt7UMp4ptUt58ekSXOYbAQBHoOg5vRw+QoP8ERNZMtSkVplPEGKdK4bghycRVr7WFytg6isXau2MmtFamKeNv+rKm5JHGopDaiJC+ULBkkQqIvr7G2fBRdpCQXx2FI+ld+UBMfQJsq1a1lX++nxgpbOD8Qh4bYW7Cn/EbA8CN4CWN1BSTLHH3+8nfV7tpDUl3Qdhg0blvdmx44dNWaMY2wDdzSXthT8+LHHHiOLf3ds3Gc5LC5v8Ton8QwsCs9GGOVgGBCnpvk8z1laiLN8tIRBLQldGzUHp0ipjsgYwpQL5bsns37wNwzqHwnCcLLKA0Bi7+dDhcvRyurdN+b2FokawK3Y3LQEXpKlUTISFpuz3OK7mdY1TDjh71IDWO26+olLE2QSJl2Waf1CM1wtV++9JSrR3HXwtxGDBWxj9913L/ghso5lMvObWK2UVpGWEKvGdWiOzPMgAoQwIG6KtnCSRHdfxvf2ZD8JRABvtXPtOpBz7dY+WmpcKapswHK1Tc14+xsFKVKt9zMmzp13ml6RfgvZIhU/LoEr1phXTIFHRdywvyWoXWyFcxd2/ixr3oA5bAu+A2YgifNOkXKXzmKNmmMHg1MQoOgkEQyzoKNT3AMbwtqPUqToEDN69Gjy9ya1ynR2SZDp3DTKDWspnykJJkiLQDFHZZ/7YfW8fbwMDes/1qS5CNammW4IcnAWaZ0oUmTsRmXtWrHDyRluG4NfBwx8zPxDfjcnAJq7Y445puCHaNUlVvJEKcdINBkLKpKnfNfuHwkyRZeANRpm0VvxZeM6RTzYP6haRBRq0b2thApBLeUUFtnCzSm8BQiCtoLF70/UUc/AlVdeacdvczWSVkwVyUXvUMIeuGHXweobOjVBfHRRTJDCJklBExyrW83zZXi2vgyy6uEqX3vttfXlGDcEOTiLtPaxiCYaBSViBHDFTstw28gUXQyxWf/gpy5b8Ob6Ab5YZKgKulHysoRQWAP470n4XcOSlyjftUsXXXRRwefgBRZX3ziWR1UhgV0oKJZKVuwVZRuCq1Nch5UpoK0cFCV6jzIFIJ133nkFP0Ldr2Q5/6Wcu5nMljl+KBOamQnuN9STNINrN0w5+2F5Bqb6WvNlBRM033rrrfPe5G48dgz4PTcEOThFWieKNEoR+BJmfshw26uQZG7acS1uRUZjxowxMVD/oIjZvVXicTLLR1Qi4wxlUy+7VLEaXC2pAUkClJIflrIE8zt82FsgcUmylkMBhh7BLQnrLf1YHX/8vU3BFPXuu+/aRPdkZ1Rb8em9KAXzT1CikUxofi0Di1au2Tj61dJ8+sW/yrCZj/V+xrkkq6mC4M0yhEocHJwipcrUkUYqUriirNjhj5Qxo5JfCSFDFZYQ2H3I5+4dMWKEWm/9pbY0KYzGFtagAkvIsryTuHZDM56RsamTEH/9Kwm5BDJjGSDP7aAUfGATGjs2PPkVv7EG5NNTXoeVgxQpNykwTEV+TwUSjh5//PGcYcfyApVGWKAZwQWJbfL+bwkUHMpI5uK6BhEg+HHaaafZZB+vlOnZmqQkGsgMxiQN1inc9YIz3PDjQC5GSnXDsxtWuuHjn6WE5QjFsKXPCqQozlqrndh0i/EnKf4IU6SIVVqlCn9moUgtjmI7OSoHxB7FmpwuliXtuuuuBaQIEdbo0AwIBFoFEUqAnMEPKFaLgWqAr7VdEvwVVmNpucKTtOuD5TqL17cwrm2xzF2rDvbcMj9fp7DsjVgzzqewb5HVEs/BwVmkdYBliylSKDqpe5srs+wsFOgdyv+K2FwUsTcyOOESlYQnJHBslWLbv4dZQojLWYp0ZhIyhrDaRU1e4rZZBZ1OMJhbMUbQHLWEYtXSGLgf/Rm/AOprfRzEaWE4B3feeefIL4HDd+jQobl5jSiJUvFn2HUoIdGIJGt5BhSzHZMOwh577KFeglEJE6RKwXjhMB7CSvQHSS66h+VIN/Q4OEVaZ4o0rEbRV1A+JUGTZQpxI6OOYzjLMXAno7QDrcLCEp1AXj5q1CilqRsp9Y6fptiHGb662DzLWxhnvATW0JJRnXNQp2jMklNOKbC6LMJ3+M2XgMVtJ/XAvd2uXTuKIBBI23ha8ZRy51rZ2QXNA0CULxMquCt3SrnNuWFkBZYinZ5wnb+BwxYTkCj861//stvKNQZeFgJ/XEyQKPd2w46DU6T1heWieGIp3/32UwpKs/1kNm6Yzp988klDPYfSjjA3XPv27c3gLZ1A5kj3k7SEEFN9ZS5BtG2UIDZnNEHYMaAeFgQM/vIeTAws4nJDiGEnF3EjbdO9xU9QD1ahbbfdljLqmWm7UO9Swnq/2xs8tMOHD1clinhoD8qIPi/IerRinHNKmSRZiXGB18Nqtfd0Iz9rf7nhxoFcjLQu0TaKJ9Y32E0qsUYRptfeeIF+o0i2CIoXwnoDZ6suo35UlNtnooCnZ3C808LYZnxWcZMk/K5hihSuy/79+1MQrZ8NNOTWOCuO+dFHHzWTDHuf8L7V0PvojDvxwGTuudFGGy2MNm0goAdZApS2lZ07hJKXG1GUi91KYgtqet20hLrNLW699VZbWeZNTiz2qIcawa3r4FCdwMDiJFMZzuLxAOqJS7NADjroIE9wV4L1Nme5Tn/IdaoeZ6iGbuOGG27wQtA34+M1B8McvQX7wJmwus15LKvEXN+9+AGXsAQeF9bJ7su893iQzztAJt3P+5zZhbzbb7+9YF3cvUR/MqJM90J7lrcCrsFkliMz3tbTWDHX1RYcJ2cj63YfSbjO5Vlm4odMfOFxTNfjuKTHdZseT948LqXS9b7mnnsnC7I4i7RMrt0oizSkMXUUNmB5RvtbDho0yMRCg7ho1113XWKlYdfZDRUZRw11dl9mfLy/BGUKB5RmeEks0jBaOsR3KZyWzrjUwVWrOPvssw2l3Prrr09+Kr69997bJqYvB0BmDPaAHaiB7q+FJOQ8WQYqu9lhsWrLCvdKKDeB+38ol5ksDNpJ3HO+a/2i1RDAwcG5dh0oixZqy0KJRilSiVGSNJqmIl1QjpeejoZkHu7JO+64IzAeCXo7i3D9f0LWfmuZj3leWLao1ZFjboL43MI+dyQVo6WzW8GBmUh/C9fjVVddpS29KCTB6GGWwWU+R0NEyok5YeUvVuz4rxIzkNelBsrETViJLiGTAEzMniCp03VwcIrUISsgi3BJ1LdFdX4BpZlgXMS6ulMDqYAxMU4//XR78Cc/JR7afkmfS5J6xFMa6ZjnBiQWkS+D9A9tgUXxSOsjz58NOysXZPx2+zgQMIBD2N/gHL9Bz0xq4BU+uE7uvT98iUUUEJMv1QoeJ7Hc5pIMNsu1K3NwcIq0XFimWMaur3vJjyFWbX/tPIIMVSTS+FmJFGD3sThOkUQEv+brjXjM08OyRS0X4LQE5S+LKhsTxaDDU5J0kMNbjbDp4osvNp+jBMXGKqusQpdffrm+3L+O7r0ZYddBKRVTllrppOlX95g7OJArfykjTNGgnyiAgl27XoBrF73OvlAles0115j4XpASBeUdMnYtJYp60vUbWYmSFMjPtazsoA43PyeIz7UqxrVrW+JadoNG2Jrpi+1CgUobtTygTEgwWOpv6wUTlYc2YuI2yT2iDg5OkVINuHYLun74rTQZ7CZZhPWrUkMRPzpXtEMrLZQbIFHGD9QkgtUH5OfSYxR9t9Cbq2eFjhnB4E+RQIU6VQogT6CGpJu49+PiamEWA4gnFJdeemlueY011jCcu5hokI/5SNqYQan3qrN7z/ivO3XqVBAn1RZ6jLHuEXVwcIq05i1SMOtIYo52WdmVGjJp91bGnl122cWQyfuB9z/77LNcbSg1JHogG/TDCh/3eOW0peDm5e8l6OW6UFQdaVCzcnDV2ly66FEKIR8pPZcE6cueMRK9ag2o4fwDcWm/VWo1df/BPaIODk6RVjtWDiMnD1AucHeeSQ10Zy0/+eQTY2ENGDAg8HdIJnrllVc0UWk0NZRUnFUlx/15EG0fKPkEb8Rcz0KqSEFeEAXE/bbZZhvyke8HAk2fLU7bO6mBPKDeMEf4eonrlMnmEbbKrb5xj6iDA7lkoyrHqibFcdy40C9YmbUgVW+C/qCHHHKIyS4NwgEHHGA6msBdKThTmI2qCbCMz2BXbtMXXnjBHMtuu+2mtZv/S2AxLxTXIrXp/5ZddtnQ7yGW/NZbb2kpDiYtx9Tx/Yc2YnuA+xbKE65tq/H5c65Xp4MDOWajGpBvmWzdY2splHGI6xpz9DYc5/Q4fhX63YEDB9psOMNY1q/iY98lhElp0wTrWI5lFn7E7cVCzwuEk4tyG+A+n4Hf4fpSb9asWfq1T1kWWQDuweMDrsGvLCu459OJk/KIOwnZSWuW3zk+6nFNZagC4HIWL4zKTYWtT2/w4MH2QHh3jZwDcALez4KD/C/L1gl/v4xS0nF3lEhFyt118LXZeoKuvfZaj7vNGAo7Znfy7r//fvv8YV9aLkD34sEsL7F8JvfOyu75dOLEKdJakI0xYnOsM3Twx0DPJOkedyqJtFiZmUcVwFBZ74JyDluxTMOBM7l76Dni5Bk9P+Dl3UtfTJ8+3Zs8ebKtQOeynOTuTSdOnDiuXaqd0hcezEO/ALYexEPDwK5cOvLIXH/iR1kOXMDO4Z/K0BPUV5OsXp40n2DgGelNecYSSyyxB0sTics+JwxPLsGGCggvVhXaP2SuIfsNhaZLUQMXcFPf9fhNCDWQQfetnFu075vsTqWDg0s2yhqGZWHmzHAWtrBMVCQSoc2X1DgCp7LcuACew9+VfJ1dtKFf4s46ZPdCpflctu2khOZrdzuSzbYF4vzOyL3C6VMGLkpHR/i5ZI+/Tw0kIJ+5U+3gFKlDWqxGRbq+BKFnz56G5q9ly5bzhAT84AW8YfHsMO5eKqyLHOL76Dt3GxqgtvgwuSc3wbxEP0CPVnAQo0cqsssnTpxovCiY5CGD3O7XCrJ71DxjUgN2JDQBWHXVVcG21ZLZuTbmr2ws2yEh3YByfZcasqM/dJfBwSlSh6RYvRirkR8oTUCpAs3nMQXbUR+WVSh+I+xS0UQ6t8wRMvNfZPsThQEnS8KCw4X+ULcZhL/Erdg2oCl4DmgTZjH1nCp8uc0yPCeeWMa/Sa3vd+LSHJeAL7gS2E7IPXA9L9Y3OWZMw4cPN4IyINQrR4Uf4gCTHNTmguQCnXXQAIBrhkFrBUErnsuldd/dLA/KPqEFD5hEWlODy7gx0UTGujHSxSZq+7DYD2BZtgL7SeJRAcHJwDJROu4vHoqW2nCijMcxTo6jscMAKHHrSFZ3qgzvo4VkfLyFhN+aXPlLpvJ/yG456aSTIrNNVZB0VMVAx+b/sTzHcg7LdiyLl3hebi5lB/bff//A87bJJptU6pxMYRnC0o9lXynVqYb7bn+Wwf6d/fLLL01zeSbuj3U/phVkSp911lneO++849+V7yST2+NGBBW9qSWJ74OIMqiVzc0/v2F5ZR6+hu3/KI3Vs7xXLrLOQ1nOb8C6v2jk5+Gxcl5D6xg/Yenqko2yBVgWNsPC+PHjI7/YunVrevzxx2nHHXc01iuaUCOxJiomSGWqH4brDtuFtGnTxrjvQKjPpBFNuUvKGjwIryHtswB0Ef+EGuJiz7O8EtPjYVqyvPHGG/Tcc8/RyJEjiROCCkgU0EMU+4R+qtiHoL6agDbohkvyggsuoGJu4FLOCa4HBKQGoHSEO5MZpTjpeqntpdF1H3FBf0oN8dgnJbnp90a6fG2kTR6S0dbGG3DVPvLII3TooYeamDv2HaQYo0ePbpQdQpciCBotoLk8GgYgsY7vc7B9mQy7H3/8kZ555hnT6g7PCZoLaNOBcgD3FKgjQZm4++67G3ITJuZAIkIHi6LTRid1f2M/cc+iBzDOpdVBpyzAWABvC8YFMFPxOAE6qt1Y7slwM+fizwcffGDulQ8//NAcW1DHoLjnl8vQiGu1Td4CVyPQ3nvvbZ6hY4891nSt2njjjdfhr57DclUj3IYYRPfDApjM0KAC4w3G3CjSlmKYNm2auXcx9uyxxx7UrVs3dJbCQPQP0iYhzpJMLeuy/KRWAEpcwmbtTOru8QCSm918/fXXRYkHKiWsQDzm9vUuueQSjyn4PO7G4p+cjWY5hWXJIufnRS1NYfeixxOHyO2y+9Gs/Jhjjgn8nIn8zefPPvtso54PVv6mtpVbtXn/+c9//GU2akFcnsJyjyunaYmQuQijR3vHHXdcbj9ZOeVZBbh+lbyP4EHAdVdwi0FT44t7qzG2z/FcjxP57Os1OeIaraFWB77PE16Pea0bZT9ZiXqcK+GhDt26fqtlfO/ch5WCpARkMEcffXQm+84NIjxWXJ59T+J9npDbz8cqjTAWN2UZhY1x0wuPJ2xm37I4RnjImKLVY6Wau5Wl9M7VkWYgf1NSALi0QAYQdTE++uijXMkjrrW+uO+++6pSmdrCXWs8tna8559/3mP6PvsB+YWlT8Q5wqDVn+V7/QHIFJi6L3A777//vvlO2EPOfUYbCkjvvbei5wPXmq0H7+abb/Y4U9uvUM8ow73WieVV+xziegTt284775yn4c8999yKnivu/+rp4Jbn8/viC2/77bcv23b3228//2TnPyyrFznPPYTMIndROYHQY0urbPuJybQPmHxuVYZ7qBnLpSxjdUNPPfVUyfsNV37eQMDnCYxjNlubRYzyViONycuy3AaWudzMiSdFmFCVcoxt27Y1BpIFKNAHZdLlCBkykD31zGKmUuyCsAvL9ttvJSw+MK8m4A0oWc6KzGyQZzeWxy4ir3v37t7WW2/tcXKI2Ycs1s+uMq9Pnz7ef//7X/sGAwXfmRHnqwXLP1ie0R+w+6dg3exSM59h/UHb7tevn/mc3boFJA0nn3yyd8IJJ3i9evXy2P3isXvRWNblVhTsNjKK/4knnrDPx+dyvGnvs8VkYDAYNWqUOU52PUfuEycAeeyOyu0MNz2omCK9/fbbcx4YWKI+1inz+UILLZTpNnHPW7iGpX3C844Y+D/xeOfYP3jyhoE1y/1kd6E9LuBEbdIIY1cTll6Yj2GjzOWdaJ+5EULesw8PDcYabvEYOAG3cEwjjs+wTg/XySeoWzEmJjlOTPLgQRG8LfSbizlmo+zkQD27GBTiXBSOFehPZgY8sDnXcFaKLghwS3B8xAwIGIzhekm7re222864iSy8GcONc41+2c9gpLNcbnkWuD2lTvS7BvH9sOQALvMwkx2wRnEzcI/jwWVTGlg/t8Czd+GxGO7vMNlZknUiz0nUfWC7eblna0UVKdz7ttUMjmTFSy+9lOk2P/74Y1312RkldBlMmjQp0/18/fXXddUDKjCOrQpaU2yc8yNi7S8m5ArOUyhK5Qk577zz9CezKjRe5wjOObs81nGCL93CPY4iMHs5Qs8u3HpJZjeCjwLW2V4/jCKxjyt4KMT9OldcqlPCstCGDBmSF2MrVU477TSPmZvsycI+cbKckb0clJX77bffBm5HZ++IWdrvn3/++brtbyQzc4LtnrMBFyM3R/e4g0zgLDoL0ViuAG6mNgnvs4v1x6Cd5JZxJe2H382LQa1SinTq1KkmFqjvw6p+6KGHcvvGnYMicwziijUIzsjwud9CwziIZWZxXrh23EwuBOtVaDx7FhvHsxBnn3Evqls+qjmHXziZSo/z/Aodp4mdIm4aZ39vvfVWO3TluHYzllP17MK6SfLQ/OMf/9CfDgpZ99X48Prrr89Ekf7xxx9YHbRpO+gdiQ1tKy6ds8WNNNEul0AsK40rlDN9TYKGhQsjziW6kcyeMmVKQWxZif1hndrv33bbbaGJRpYiPd2KB0F5bSBK/QSWy6SkZ6oda8SECPHOrBUINzr3uJWZbgqKffeYLsWc7xOu7LT7gUkcLCnFTTfdVDFF6p8AQTCIc3ZsLp4FN2Ga7VlW0yS5D7J6/jfQRC90Fkp7Xjib1GMiDN3XSnFqD4zKSbCFM7Jz4YVioQW/wBK0sGEFjjO3A/DUFNtfhCEEBztFmq3kTAwM2kkfGsQhBCeGrH8j44h/++0sFSmwVJG45YF2Egsy+tIqFcuV40kdadj238AXEM8KIaX3XnzxRZPpe8899+TeC1L2liK9MMa1XELiJ2/aOwq3camWX5Q8+OCD9mb2LpJQZAKbP//8s8eN3jPbB382bxYTtqwUqVqnXG7iRcXP4wpyAURBzQyLaaWQHqaomCeAac8LukRZltq2FRrXXsPGMekrlsWvoZK4bmC/ILQgGF+hYzUz9KimIRDE63F9GX/IGOkUaUaSG6VPPfXUyCSfsM9gRQm6hGxj7WLdY0pQpPPEIo3bemuc7mRad+9hhx1mK48rQrb5iNEsARmR1113XaAr+owzzgjcnqVI+ya8tptLNmcOffv2zVyZYIJkIShmupq44o0SheLLeh/8bl64n6tFkarccsstuf3jmuKStwmrqYwuU2OVZuHFsMaFAyowrmFC+SdCMly3HbmfeCZ0YpumxMdCn2qdNFihsdgK3ynJ4nJesUEcgx6acEclscjM80+WpUO2Y4qu4OKqkCJVC7VfGsvbltNPP91+cPYIU6Rh8RkMVFCocBcPGjQo0uWXQpGqgL3pITlnHhdyezvttFNmyoSJAGyL6x3JnNRtY3L1Mz5AzW4c11OpwgXlHhMOZKKsyqFINd6ugGItZZuwuMsYk3s8qxIs1Et7les5fIjJhuOSlWL7+emnn5qdxLVJc7xWycy0Chzvq3EUKRPCKAvXWKdIs5Eb9aojxhl00pnU26RIMxF46IVZZ511dDUjIrbVPqvM3RSKVKVPznzmMoo0+3LOOefoquYEuJkfxQf77LNP6mPOQJGqdBBas0wsc78wm4yu+hnZXrdSktfSCDM15dW+YrJSTYrUXwN65513lkQEYZUhUTncu8iCZxafVOcGyVXicp8V142Yobwc5hHy0z8qcO9k6J25sxIWaTEykBVWWEEt0nFOkaaXm4vxviIWo1lsUdYbFIXggRpRpJAbskr3f/nll3NhyBpQpFpnd7eu0F+zmkaYks220i/VjGrU5TVmAhDKjmxgwlNNilSt51xtyIABibdr1dG2y3hsWEz4qDPxHliKpWsjjm9Q2rORBV/smsATlJW3TCdyFUo8KpsizYaktP5wpXLEskVC7Poo+AJnqBKTKOS4X9FVIwxcwKyLH9TQOQCf7DtcgE5XX311qhWxoiQuOcHijtTQWaPagQfqCJYz8YKTJOwuPamAbizsdtSXIAteCpyg/HA36gGCixS8oeCVNTf8lVfSFVdcUVUXgeNx1KNHD7MMTmpmtUr0e/T4FWR9z81UrmlwCqeFtZ/7N+Lp3ZOlJdfvEtN/Rn4RXX6Ahx9+OJMNc2mbfa89URddyJzlWSC5AqIwlwdion6u1ShWIiURYGxZQxYpSfcJgyQ1Y1HUflKL17LKLVJbehdz75ciWu7R2JzBQSVLtpu3HNm8pVqkKqBCVCS5Vyyr+8MyjBOHxo0vxqGhk/roab7YeTnl0WLJkyooEcuqxt0Wi2r0WufarS/JpQyGkVVzFxBbiSKWNgGvo9pVSQ3fLMmSqyVFCvkyirIvrqC8wXpwetotj6pckUJyGRJrrbVWJoMIGKFMAI9rZivNo4ySn3KSNqRVpL5Yu2n+EJe60cKyZeB0NXHSjJmYtvIahyLw16hxTgX3u2aS+2O7aY/5iCNy3Da/O9du/QCtfk7AwimnnGLaKPmBZsZw50pLHvhjurMsilZCYY2o0YQa7lFqaAb7Ww2el6fxhzNr0/nCZs4kThrRl1vV2Dm4huU+dTdmAbQSY7IGc39wR5mKHtywYcOIqQ2J+UjNaybmME3nqwlMgELM6WqWmY3LtOIrBk4CNG3UNMKQ8S79xPI22sChsXlaoA2eYK9GOJ07syzJyoL+7//+r2hYBuBa6Lz3zzzzTGJFmGon7r77buJmH1hcmOV259qtfclxMSJbMGiWgibJVvcKTZrpXoy0/sgjj9TfvFpkH6rVIt04K/cu98nUVX0m676nRixSlRmlJr5QCPl3VsX9WQi4l203b1Iy83JapCqgjozbKAICBjJlwyzD/XC8oSrj0izKrgxmQiO4dw1FEZosFNsv5UPGvUo+lrEsrHHcDxa16J7OIq1dIIPhbLW60HQ7KNjO7b1Ms2fGqyw7yUemiSyTohcN1DMm1uj5QRbVDLupdqngEiFi6i0srsvSjOWXGjsXx+EPD3qZrAwNlrlejdhNRlttVXkjnQdN0wA756I55xwj1QQmlTD/kZzFdb5Fv88xaF1crwy78xL+IGkrtdvn6ad1caUy7auNNfEnyOtmA43X0SQeCWm4V22wK9o0ZUcj7zRAohOHEvTl/bWqRBZ0RQrfRF8sMMuL6ajuxwYbbGBccFwvarxKeIatj41mgbuXimfsjqjRczSXZQwW2CJNvTJu3K2Lm7L8WmPn4gGWT5lsnHr37p2ZixdIOyBlBewP88gS3H4k2bwXXnhh1VyAMWPGELfKM8vcS5MWX3zxyO9zaYlx8TIQj1k1493BDPonLmmyn3MqNZsb44ygQxlP4UIsO8CKKham0HuSiUQKPtMwAJNS6NhYMpggntiDhsWlWK4mp0hrChgJ78LC8ccfT0zIXPAFWGCwROVGeZnFDoYszdJJH9YgMCm1/YANreFzZUxuzEDTAjNZQSdxpdQajiaJ2WUB7n5CWVk1WeG5554jboRM7HIzry+55JLMjjcLsFvRxOygRLn+loqFrjS2yjiwDLtjtB9TYqafpT3wgC7uVMbT1w1j16uvvkqcQBT5Re7rS2GGAhNRmP9M+2db0yUB9xknPenLszB0OkVaG4D/6m4snHvuucQxnIIvcGagmSFymy1Vorv7vrIhzh+SaDjzMnAjXHhMTICMxenU4CKtVWD/CZZYWnAPQ11cjqVFDZ4LzJq+hhXC5RWZWehIOsri/GYFuOB322233Gt4bPCsVAuwPwD3w6QDDzyw6MRAjawy7MrLpihzzz1Tr8hyQ+9dZkVqbysQnGdB3DzCLHM8Onow5XAA03mm2ils4/nnn7c9P06RVjlgIhqfBvcVDJxpM1uJsUSZyBkv3wxQosAa+MNNnHNuDj8w2NJ8IoY5NXzOzL4zX2zqFQkxA7BYDRdi34Y/PXv2TL0iTi4zM3LM8DF4VROQ0dm9e/fc/Y0i+mrJ5v3++++JeXjNcjGyDByHkA50Zlkm410xGgmxxLShDxAVjB492ugxli2ofEQMRRVp586dzX9Yre+++27RlSIEkBaHH364ye6XfezmFGn1YllRjIal46ijjgpUfsyHqm5MuGO3D1nXiiSlA2HgHnxUB25dst1kaWEp47k16toFBuOP5Y4qGcyzmkvkEO9FVQFWAixl3UcoraAwSCVw0kknGQ8Hc1kTk2WEfg8JXY888ggWm7AcnPFujIfRS1YiFGXj3j2EylP20hblQ9xEI/KLyA0hiYEWwbUsr8N6TVvGxdnrhklOHQllmPSUDbVPzZQMw1kWAT3awQcXPk8YMODOlTpRJAdtR0Uy36ISjSz6sA9q/LwtrANSWiBuTPPdxYvV6PmYrO4vLhkx2a6U0o3KpAjE3YVMjWTa5I2sgUEXz4XG+1FDyKUPVUEpiMQjxOhuvPFGOxZaAGSoysT57yw3ZbwbP1JGOQSYuMhEBRbZPzPez7+rhV4MWjdezHJlfMpyMwxqbrpA999/P02fPj3VRILLy0wmuyjp3uQUaVUBWQlrwX3CjV0prDAdcU3GBHEDRWELde2GQWMMdaBIzV3NzZJTr4hrtOzBp12Nng/s+w84HCSkpVWkah1wM2sjVY5JmEOAtAEeiixcemkABfnZZ5+Z5Ci4BsMsKG6Lp4s7yARuZka70EzL4DAJSgvkW4BEghnUVqOGMrHPKWO3rkVSEQi4qDfeeGMzcY7yuAk2huFKDWWBO993332pM9APOeQQeuGFF7B4KMvJVANENguKa/cOXGS40TDzx/+gB1Jm3FNFSUaZXyuzrMd8qaE3JdxN/DBg8UMZfGoZxvqGFZIW3N5KF9+t4YmcpyVBTKGWemVMVFC2HcVgaN3vqO+6RZ6HJHKn/IeFhJv6HxoztQj4KwYtz7nppptC4/gTJkwwIvfcARlbea1xDTEeZAFL6R+W4X6iUHl13AvcjSnyi9ztxfyHdRk0VvrQ0q6xRriDSW0obbOCf//73zpJecVZpNUBpPQdozEMeZjyALcQaucEW1Jx8oS/4Y/QWwVi6623zhm6NX7+wMXWnvIzbkuGZLpCEX0hJUS1ip/VvZsWaumjy9C1116bSVIXCUUeJo4oF5Hs82N1v1PiIUmI6ceNns12KlkeA8WACQNoA2GVIokwCOh0cvTRR2tW7KCMNm98oCgnYeL5TFaI5B7peoM/52YYHzVZ4txeLvKLGm+2utJEQQ96rLh4T8IEK4jYJgngmYF7uU2bNltKvf/dTpFWDnA7PKxtmF5//fWCL5x++ul08skn60skFn0ZY72b6w0fOv2bz1TzTo2fQxAnNEdmaVSruLjWqGQyv2fV4tYqZmeVIKRZsfBuIFs8S6DeUpQozKVZGa76BvnfD+5dbtpQMTfvrFmzjAWDeCmsoTBFCgIHUaSdMtz85j5mIsqC5UgmJutQA4nEtxmsdjWSGGzkrJknIygpwsQkiIihCDCQ9uTSwaVwni1u7ZLAjTIIrmJqyJJ/rJpdvPXs2l1d3Id03XXXEQLhQS4MfCboRZLRG3d2F6SYFdJfErO112r8PB5qAsxc+J42RmpRgQ3zuYVqEc2zymS2i9uzAkILKBH529+M8wT34EYZK1JVpr3VzduvX7+KXYyzzjrLJLmgnjHMSwDL9ZdfDCtlO8omPo/cgTXxXEBJZwWURKFygOYTl2QBMyBFJWQBBxzQ4PV+7bXXlG2IEoY8zNiIiQ1KgtIArmUwWVFDvfmz5GKkFQGmMi2QCIIswwIty/FLq6PBlRIwjwOMdp3Q8SWMiAFkDu3amef0f5rhSbVNXpG6qe9KK61kd5B5w3rwahVLZhXfVCKGEgauQCBui3IVcKVSQ+nVTmpBlwH3SBN4Y0FUirQB9Yeg2YOHIGxCgkkP3LuC3Sgbd2kzKB1lgcoKFl3plhmsDutYEco5KLRFAbSAKbxPI8T1H9c1HEuxU0OSWHunSBsXKGjaxpz9gAxdDFzDhw+npk3N4cOZf15CV05TP4lz3l27Ze7e/6HGzyMyg1ZA7Ic7RaRakTXAYmLxQh3cY0ZLYUKVFuJ61WJ0yoJIQThofyoz3ZyiP8upaplanodGA7I8MYFAcoyUTlARlqPulFEWbDF3KZWYcENWyQplwGYkmbChWGSRRXKNAKK8bTFwKf5suummkfW9cTBq1CgaOHCgvryXnCJtNGBKdTNmn0j48c/AMFtFyYq4f+D63T/h+nfSTiahT9d8urCPavg8onjdaE8UWoexN8W1Ri3yiwPr4B6DllobCyi9SAswaWWhlFdbbTXDZSyW6DChsfyzkc7JjST9fFEaAyGf65rKWAKjXMWYHMNClFpwCqLhE3at3VPG6DH76YFYIpLEsgbq0yULuIO45dPg4Dhepe233z43qUuZD/G5KlNln0oDdFuSrlGwUM50irT8wIhkghXcn9JYnX4gEUHagf1ZIg1VFy2ipxDmHomPUq2kbodNijE244G+4447Uq0I8VVxX94nHXRqHWh1tQjceVYsq2RoLKlYfV8UEErAvggjDfiAt1WiAGpc6sRTSOLh6oUQer6yALWbmnGP5Bhki6LdYVgtI66ZlH80T0lDhwn1EuiWA0aecsByjaYp18FkanU0Di826Vt33XVzyxmQgoBLciwIWIpROFIMRjXLsr2mDF18nCIN4kCFtRiUQYjkIqvGqSslLwVoLVmsdjuwgkFR2Hs8GdCoRutud/PFKEoCsu5QLE8NtbS96uQ+W4WEjCOL2JgOYMXiV1Sk/Zm4NDGq71jBczNAlSncvFByxejoKAXhP6wokl6qXbt2zVlAUXR9lis2TcudPXyuYiqHu5os1yylcD8Xqx2l+aVpOcuesik9NPzM4iUpGchmt+p073GKlMoaF+2GJrRWDWcOeKC1ZRU1uH/fKmEboAxsjmzIMGpAUMYJXq/BfpvrStG+qbtFV40wy5ti9hk89NBD9eWuNZ5cZONYLS1JCyg/JXUoReHALYx7EW5daghVwAL5vcLnZ4C6eeF2BfVhloDXB+5bLTHDhKZjx45klyPtuuuuoVaV9oCV+ONiJY6bJiQ0ePDgsp1EtGeUe6KjhhJKwCFxXLWY/KNBQcb4QMukirW7iwNr/3ag8pH6L9CKtJMUA1O3bt1o0qRJBbEjqxv8ZXi+qfSSGvMQU3EihlpKqGkpDXXh++mByQhmp2my7m644QbT51WANimjqX4aH+wLd5PUuKWCdtlAxmlSFyHoFpH0Bjo3xihqYK+ZSNXjHTLZvGmtEfIlZsE6gfVJEqOGVaqJWkrZiVwIVa5+jBs3Ts/1IhTc2SnOhHoZZFlLeUbZYPXv3beEn0P5rl+suYYqqayIQHw4W3s7a+s7SlEWdMEFF+jLx8gp0sxhctoHDRoUeMNY/JsIQl1IKYuaw9y6JL35LIuUqiBhKGpg3UgmFmOloa5p44SuNTE4NkOtBWT4nnrqqWQ1wv5PHXk+TEoqjjGLLFvNKi8l1or4YNu2bUna3CF2P6/KzlV/IRU4P6sVQlHKxMFkdILW074OUJCffvppw+y6U6fQmJtF3F6K23QvZTZLk4QXB5Yl2a3EOK4JdUEJRaGMjeVxb5og6TnnnJN6ZUhiEyu9XYasT06Rysy3LejrUMfmR9++fWm77bbTGN22WaSRW6np5E/4EC7Z8WIhVBp/yex5c3n4jxCF2U+K9EfJILciYj3IjsMsvtSYFiYRcDPus88+ePmHzKIH1pESXVXYWzIZFAA5V3G6bMw3iTkjFV6Rtdc23r4vJG4/tUrP2RitK6SUXYNQkiHxdqPE0BQiiCREkwyt7ksFsMI8W5cy/6EMaqvjwCJQ2EpLrhJgA9+xhlr5WTQmj0BfzNFxDbNowWfluVyhx0jV0GOyhuVvnoATNjyJweWEY3z68TyW9im3tR5WxITSBdtRYRpC3d6AEtaP/fN45hi6/rjCLj/dj7+8CPBM1evfv7/HfKyptsfkFh4PKvaq32VZM8YxP4ovszJJfcycpa3b7lvG++1DbICt9dT7C1l66aVzJ4xjpbF+w0rU44mO/uy/NfKcbo+dZfIKjynoEp8nHDNnNOfOFcc4I7/PPK3me9z6LfQ7HEv1WAnrM7JUgmNZiOX3ONeMS748DjWlvk84yUYPffeE5/1z/IjdqpHr5wxnXf//WH7AAk/SYp1jxk0x92Ul/QEbG6nPCXsUdHVfJjgfr+EHXFVRdPycM2cOvjou7rpr3SJ9Vktd/CxD4HS1ZoznC9doGnQp1svPKnv5byVPCnhPbY8DXF/ICEVsCbRb4Bfu0qWLyTCGC7YUNy7KWUA/h+4fyJhEYhLNT3vfQlid6gnbKV2b5bamtO2iSMo24jIkwSrTulNq6I7RjOoYSB6CO1eSqcy5Eg9TKLSMKKyW1Pgb58xRLtmmksFPCViCFsazVOyawWthNcOgDLJ316dkYagOyBdRVzcVr3uHJ+2XMl3K76mhv6g2WU+Fww47zI4Db+Ys0tLlIUwZ2I1TbMYynKVJBtt7GStjLs/A7XFyg8elEPjKrywtK2mRYrbN9YRmJsoDkMcdFDxWrplYUSocp/KYxizI0IWVeS7LnnVkkW7I8hNWznSTmZw/nogYCw1gF2Us65U7jOROMqwpZvHB4iX1apHCMuDM1dwxv/LKK7F+x1nQ5vtMZu9x5m7o97hTjK76sQTHcht+wF1vIveBa1nNijkZKvW9wi5q3c+RCfbzbPyAO1tFrptzGryff/5Z138ZyxdlskghOCl/4EdcY5z6vPCEVvfhG/EUVMwirVUl+nc9g0zOHeVinRHzBBeTxeECYsLr0JPPZR66zbdL3EZmirQxhOvMcgMGbkyOfZhBw4e35FrVsiJdRx9+JvPI7PxxEwWzs1COxb4LFyJnmuZOKrdas5XADfWoSFdddVWP233ljpnzEmKf20UXXTT3O0xAwr7HNIoe01/ia38mmPwarcNsXZH7sP/++zfElHiyg/1Je7+MHz9eDyluiApK1yjhqPXutttuuUgPy0Ys08qoSCGH6XnJYnIPQ0ow0Ll2S0jeIukw4M9GW2WVVWjAgAFkZdfNyWB7SC5oGsSUFJCt+yUtANCGv3Abo0YM3TeQCII0eqsTxlZSajRYm4PXGFpLLVwLuMaPPPLITFaKhgmgXQTQz5Ni1BOyYiENLaAJA1qHCWbU272FVl7IYpaWeyYRK0lWKc6NdHkxLEdhAFXg0KFDjQdZQzdUnHu6DUpuUEseBZThaZhFr10asDWe10SiCJDK3RHnIKrVo69cD8mHqLVpReVvJjIS5wWN2NOid+/eunhkBlSKtCBl7f4TmVrILEXzVxsowLZYS+7PsIXZXlG0gMh6sx70Ryt9glBDhwbRqOVEujgK4qEEeJZsSKmRWRwVP0oDnH9kokKpglpQBjQw7XwixOYtauQ+20YIDhbHZE3rFrOAcrNikLPqBAPjg+gCgpZoJDWFIBog6fBilTjVDRD/ReySLUnSZtx77bVX4vWgLlezfaNg5VHEofA6IG62rk0KY+VOUAZ0gXG4wXvEJdO3aAEfpcYjTEHa7TxMJqXNH6WpLbXq+h8iFyONJWtGuXQvueSSXAipxDhlkDSFVwor5bTrQFcA17Lpdn9OsZ3MXLs8GHnFgPgRsh+vvvpqj63psrmAW7VqZVyRdrIwSwc55ier1LXbT1eGOHCW8eWTTjop5/KLyvqEy5xrCHMnjZVL3uecMGbHterCtbvRRht53FM0d8xc+lHyeeZkILMOHqgjvwcXphUGalbkOEy6NHc1iVwnchIkfm3A1nUm9w4nDukq2xXZzzfxJYS4iuVSMPmKVjVoDNMrs2tX5TS9J7ipQarzgmeFyTF0f/Z2rt3ieEDrovwuXViFlpvsUKljzALIQG2NkxXGV6kF4koMUWmgI4UUis+lhi4MkDslyxkm0Ay0TAJ7EVyyqItF5u1VV12ldbCZASxJcEWi9ktq/lYXDuJlxEqtJmwqvVL7qOUB6zqL5t0kXKbqzoJ3ICrrE6Qf0lzBuHaRZV3PALUmMmHh1lWO5jQtuDT0UAzwbCGDV6gCo2pK15GmGEWbC4BkQzLncS99CGKIZZZZhrJo+B3Dvdtaj4NL9aJdLttso71b35G3lmvES36zegzSktojvHTCCSfoy0HOIo2W7lHWKLsx9OOHM97uicWSHTjOotvepRosUm4RpzO0v0K2hbq5zVlg1jzI8o5tMjKHrMdp+5EZj6UIMojZVaebGS8Z1dVgkXZluVdXwOUCHj+YmR47l2x4PMEx6+eGCqHfg/ULS8zeF03sqleLtEOHDt63336bO2Yuj0h9vtltHssiheDZFtwacQy4rzymZCy6PqumehMWk1oKCy7tMSEDVxOYI/bTZD3Ceg26b2y57bbbdH2nym/XbkSLFNLbuAJmzPDYEEp9fpjpq1jikcvalcJbM2D6D5wZefQEfleG7ZrM0oMPPjjwpHMtpm77h5TbKYcinRfDDaSyKUt/ll9ymo4zBTn2m7m7l8ns89zMUNoVUKStWE5h+SjH2sHuOLbKMz9ey/UfmaWLkhiumcx9F+5JuN+CvlsvipStdM2cNcDgnsU5BxlDXEXKlm+c4n7jK2b2tMh1QSHIszdHfodMWDPZTntMOBYLy4bsZ3+j3W66qej6tPyK0dYegxpRkUKew0qYCz1TghNGN6dIC8VQFKHeyX/QeDDloIHjMt4uYiazsGLE+oJOOuqhBLfUuCJVWRJGE8tsPbB77rnH1MlmqVyYkjB3x7MrLEtF+s+IY1ue5QAckqb5K1COwu7FzJVojx49cttAbXOcwR9gqsVIi6JWFal9HzEdZd6ECixbWZ13nZBgElPsu4hpauoAS/OospdiCgYTT8Hr8rtFWOZiklYKq5NffvrpJ13/NlFWFyelxVXKI/xjUCMr0ta6Ik7oS31+rNr2CU6R5ksLvYlR8+Q/aM5M1RP3bYYJRnkKHG5jKk7ftUmdKFIVZCxdLzNrj7mMPe7xmKmSUTcvs/VkqUgflDDAIfCoiYX6sFieuYwEuFmxXbhZiw0aVCLhArM+5ZQEN06I/D4mKwruKFK09rAWFSkSW5AYgv1Hwo6lFLx+/fplev7xHAGcPZ6Ucm7XgP3vhA+4OXbR9VjX0Z7Uj8EbPXv2TH1cXPKn6z8lYD9hpc6ZNm1aqCdDxUoAvKzCijSXeAR3NGp705wfjrl63Ehe9+1Ap0jnyx1hMUpwcFrYoAzbNjG8MPcm4l6CcRlsq9oUqZ0p/UbO3CuSCZhUmNrRrPeBBx5ItR5kHxcDOGo5Uc3j9m6m4L9cmcrcDN0uoPeYKi4yJmoVlXvcfcfjRLCi26hFRYqMXOw79xHNuy6XXnpppucf5xRxNwDPQpzfcHmY7s4DAft/bVhYyRZkn+p2fVzT8FaZiWPaY+OWcbr+d8LyOe6+++6i68HEOEDZVEqRQqbE3fdiggm/hdZOkTZYRQ0O7wDyZ/jVI27+tGK0NGZ3oNEKOuGcWajbf7qOFWle7CUrei8VUC4qirGwFHuwkZiDZBCUinCbM+/22283+4pkJtAlFku+SCtwVYLGzrYsizUEQAmSgutEYydd1Jgi3UXpPO3rbQLafftmfh3sWFlYSCai0cMvAftvaPNwfaPWgRCFVX7Xwvr9rmqRpy31wO+tEqFlfPv5QlSZngpI4y20qxJF2l09RXEmkglCR89a23h9QVWkd+Jo4D6lcP7JGRLXy3rbZ2HlGJCDTjbiHdI9wty7C4AizauvhNWV1cCnWZNJaOCqRTBQow7X7n6DwQCTrGKDppWFaejwksTQakyRmoeV2aE8LlXIHTPCMuW4JnDnqgUcNgkOEsSlBVv7a9eZyajo72+55Rb9/cu+428p45TplJT2+Kys7iOtbSAW+zue+2L3ETfYDoqPVlqR5iYCjz/+eOpzxM3k7cnCjrL+IQuiIm2pMS1/2x1YFj/88IOepAvKsO2mSlION2DQyebOHbr97zPaZi0oUkifXLZDyvZrKiiz0YLqOFmWlRaUa4Awm+uK8wgENCuXm20XXcfgwYNzv0HsDQkvSfahxhQp5Eb7PHH9ctmujyZ4JX2WTj755FzysLXfFxUrWVKBB0JwSMDxm/Kqo48+OvXxcbcWf0JTruwlTukQd4AKi7NWWpE213GXu7tkWS6kXobHy6VIm1dxjTYaULdg15fh3SRf+ylWFvryjjJse1shDAilA7NaOd1NCxZuoIbu9H1AUMEKgFgJplohyCM4TmbkuuuuK9omKwtwMo/Zd9DwQbgEwxwH/qOYHu+Bp5UtTuIHi9q3b0+cIGMan2PZh2FCLnEcKBHZuozcNriJ2cVplnnwNQ2qOUGi5FLwGrlvcm31QJwC+spyQRqeE8cBE/0OY40Avc+Ol+W99ZpFAfSk4PkWvBjwFXBOH8ZKnu68885Ux8eTMENCwPfn9vxyceFb7o7PRo0aFYsYhKw2lFWEuTLu3z1w4EBib6A5zlJxyimnEDd3wDMMvsldpMl8WVCtinQRlnOwwLPEgg+t99D78qcybH8H/MGFDGKfwUNz0EEH6ct/04IHUEjtzA/yBuAALYUL1Q8oUHY5mYccAyEUTBJwLbEZoIXRKf8mb97cKDcwBIE9h7NFiUupDB8rlOmGG25ouIch3NXD8L1C0ANTmF+C8IcMjreyaJPa3qwgW0IRh7EhcZcc4mQIs4x7a8stt0yjRM1qauB+OVUmYHTZZZeVVYkCuJ4AUywm+h0Yi3Dd+PqtKBPpn0l60LLXoCibEXr0MsCCPyVo/oQ5I5d4tMAELY2CwIQPx8bhrabCYvSKKAoCoX4UMBkUEn00cP6mCu8VcKRfzxPZpbgcitiCT7UysGNJP9eB1NATtTyoUjfQFWGZnDD5BV+XcfuTsQEmdC7mVnssw23WimtXpYOeBGQSZuGSQxG5oSUZODDxb9HGLS5Y2Xo8czfczOB39ZetgAMX5xDxLBwbCD9QduBrEweaIqQcvyolNquirhwfMCVcMQYdjykZY2eUFrkHR4t7beUqfZav0h3FeWwM17tmpKKVWdLfMgG67u5hElszSWzFfoexSnBUxLkwrkW0XKSM2vDJ+V1fEyOLlb2gzEhwftgYVEHXrkquyLVdu3aZE8AsSDHS6WEDNFsRej52L9O299WC+LATjaQJTTRdgBUpCRWX9/TTT2cyACrDzJQpU9LUkQ5gWU3oztaW8wr6qa2kXu1Vu54UAJ1c3MGN3breUUcd5XFrLzvZzI6Xm88pnMLS9BaNIqxPqEgViC2tUmXP8XU5rZRBzCuOWExjhpIy6e+tXsaYFD2BBZRWFfsd7lnBCsXo+7KgQLSIH94WZeaxd6jo76y69w2qWJFCBpmGxm+9lfpc2f1pFyRFepBaDf7iXKuZ8egybv+DqKxUK33/y4y3W4uKdCk9Geg4k3a/7brgzp07l6pIT4ux38tLxuNr9gPGrr2iFHC2cL9MU3/ILuOCelXbGmJ3Zl5GbxpL1K9IMYBbNas/yaShGp7j0+PU0WYtWkMYJ8uWQvigBbOl4XfRe5Hd8/qbkUXOyQpqOabtKATPCTo4iWdkepzJCrfey93qUWNQlSjSFnpcHEZLfV9YGdULjCJ9IYguDJmdnMih5+KIMm17x7ByGxW4BLWO3CnS+cXqpbhjgwQ1oAAURSOR1q8ik7cccT+u/4UXXpho+xik4LqEMlbATchNzvMULDJ+szhPqkjB4gLrFo0GrBrGtaslQxeT38bMqOYEkwa+Th44KSVPr3oPin3fIn8/Oca5Ma3YOK8g9bFadezmeS/GCsRdVvTr19WAIoXsrxzYWbh4EU6JQ0VYL4rU+G79vKdwvek9I33zyrFtQ0yNtGkqThrd3ilSI23N6M1uzrTF5pCLL77YnFzEPCvQj7SbuMoMMGlK+gDD0kDnGKs8q4GG5p13MlUYtmtXC9jBiiSYGFCs31gyKMtmBEll2LBhsayOmHWW3oABA5L0CY3Drva48lenPda99947t59xWJOs++PoGlGkJF2iTLkYZdQ8oli3qXroR4q87GX5gpv+mDaYZ1cXb2eZWYZtr8eyGUkvxCBw/ZYuDmH5ihwA1Hp8gH6wyFxMC2b3Mf8ls7Cx8TzLlpINPosTkUwPSPRSTZK8x8kNphSC6c5y73Pts+m5WQ4wAYH5zxM94tg+Fldg+Uj+NyYuY+mFheOOO444jtyoG0cv06233tpfypIY9n4zQ07kd9GLmOuG9eX4OKvHHyaVN/dE2jIY9B7273MQeEKYy2ZmvFdD48vB+INyMRxDGjDrmTln3Iaz7rN2HwzK7uOmuN7s2bO1v+ZSZdq2caKje0BYTMJKKFivDNuvVYsUcnuUJZ9EMBMGxo4dWwmL1JblhLTfAEXspRwPMr+RXKIAbWHWFikPkHmfgSZR8GsjZvPm2NphKVWCKEPPCbI0KaMuK8W+hxBUADlClCyqHaWS5gEECQhAgGKEHlwalmOiLDYGVZlFCrlaKTSzoI8sRvVY6xYp9sX0kENtog3OgtQarYfLVDe3GEoRtVg8CCeddBJxLEqt0c+cIUoFxfbMQJV6RewSNf+59ESveaUwmeV0lvNJSEBQJJ4UTMpPBx54ILGL0LzmAYhYmZZ1x7t06UJff/01FlEE+6b8LydQT3u41lNyFndFLhieUYAnLqnXxdmiBM9YnHMteCzmqmexvI4Fjpen3k/URqMmGkQgUbC29XQNji9ns3y/wQYb0BlnnJFqRWwMxSKtKEV5VQs2xwPPxNbEWW15HxxxxBG6eGuZtt2XpTnX+REnFwR+gcnPdfF8pzcL8JUqP5ARpAF3z8gVq8vEpdK4guVALHCGLnFiCZXKssJ0kzllart9swYIHlB4z1a9uSzwapVRmd4qTEBmssHtyCpykcA4BQINQN27aQCXbpyJk26TgtmMwvAS/nAXnEwUfhymJGuS+3yNjjFmosbt34ityurbuypy614a1IHeSvAZWabtrqZZb8xqE2jqX3DBBbmSwzIefy27dk07CabXM26Rxu4lWSbXrl92yqU8XnddycfGFkzOJZuGnDvKtauCLE7w+Fqt/tpkfE6O16QsjjtVlP8YvMe5xsTffpt6feibWqwLidVG8YMSOkv9hUbnxQgUKAZPdTG3roZLYrgqq9W1q2K6tQ8dOrSs91Ktc+1uH0TrBYonwVNl2q6ZdnLBPHHtWcGHsIrAASu4jRwCDUlNqEHCh7pnSwVnAJPy4VYRBrMcxnIfKzHjPgTdYFJweQ91797dWDz77ruvsVJLtXLjWPegIIQrixM1VhU3b0dq4DQFWqbg6/2LZX8sgH4RLk7OVibO3G7Ui8IDnqFxRPKOYB4nejWFRT5ixIiS1xuHwo9rhXXx4YSrB63pUG5CvT2XYhC33qM0PNXF3LpcE6+Lj9f4OIOsv7HcLMMkeY0cObJqdqxaFOlCLBthwe/WtTJBJ5Rhu2AfN+zhGsPyA4OdesyogQfSIXhQzQxcN2b+p3UTU3l4QDdmOQ38nUzIUNJKMGkDhyhccsjwRYYp09CVZYfB5wu3HpQKKxik974hbrJ/saj2mVfiNW+FBXAHK39whXGNZJFfz8w/qRRpHHCP5DTuUhDAbo91pFGkcWBVG7xY4+MMuIGvYzmDk//sLGSnSAVQoq04M1eTJAzQdQOxD8HwMmz3ajNNe/zx0NiOFRvtlbXCqCMsbFsIqWdVCy1k/mtqf5UBCUjrMwvTrkyCQD179izNDcLxN3QwgrcD9x46ygQ1SMgCSEbBc4QuShzH3oYaumA0Q2kPu3+jiPmrGrDGmN1HyyLeoYakFJQvmetieZIyBzr2SHwULrQvSlgFMqKuZmuxCZpwhDU5SAs0X+DsYCxOooZEyVrHmSy7cOLRRri+TJziFKkFM7XAg20PJlxAq4sTpVtBlsDK0bjQtNoJU6LM3UlSk/ek05ehaI0/GNSQFZcWOrCn7IpSThwJDwnCDsygQ0iQKwXohAJ3KCaM9957LzGBQdl2GJ4eJOHAHcaWdDMNo6BGFtnRqAOuNfz666/EPLjEvU3xcqRV12xqBVFfW6wbSqmw3KUPl7gK1JyO4muxMa4LE0mUZT8tj9rTJXoeqhFovfUZ564QNzk3mfFOkTbATO04SSDvTavvYzn6yD2gyhIKIMgqwkAnOMrpyki001gZBrc0QJwViiXIzV9F+F4soM7MxGTH5xKjV69exrWHuCkmENwovGw7jdg1JqeImSL2j0EWIQ1YRGl7ylYCcP1jIkL57QzHioXYAW7TcilSuI4FadKUsa8bw/VaLkVquZ/H1NF4A80J5pYNQZ4D7wBVQe1mNWAl/GEu0rw3UU5BvqbAGQElLOtge5jRBgEzHWEegTvkQ6crI7F+Kf0fg6DNtpFwVC5XZ0YwkyvuUGTco6UCDaO17pJbXJV9p3HPc5s34g5G5jV3OyFuyVWTNx0St+TcDxavEVluUzM5KQfU2hWkuenfVOu2HPkATGRj17m+V2djzn7qtcyijKheFGlruxhfYVFvfZfhtjoIlVlocS9mOBYt3OlOT1KcpK1UtGwKpQaEUuZymmo+ZmQHvQC3KJqKpwHzSJPWqYJasNyA5wfuRPXEnHjiiXTXXXfV1A230047mUmM4AQK8DZhwlAOBcVdVnQRadtp3CYP4Q/CR+VInOnRo4dmUcOD8ladjTmwsP+JhWeeecYpUrJczEg2smEx28zIcFt34A9iRX4GJYUVwH7aWaOxsCn+MF1Z6hVxFxXzn+sfa+G4b8Cf3r17U9oyFWQhAnCzNga49ZqZMOozB9ITbl5eMzcc01Hq4rVUyHuNjMVvuRaUmKIx821vu+22ZBMrUDr2rJE+71t2s9v5obGX63TcgSvlS1jeV155pVOkuh/+OI1VkzY7o+1cwLIdshit2EEeuL2RuoSmK5uGQyTgV1kLTQayoN6SDMOCeHmV4jWWCaAuS0v3piEGWLdcZN8oO4/4IeotEdsGUJLDZBNVf9Kh8MW1ivqWs0K+9qiv1jMzrL/++nkWZUr8hyREkDVQQ0zpEqJqAeYCc89b07RhQVekTez6QTuZgEqvcyvQkSyX6owyiHwB8RaLJ/RAUaYO0bjcmGY33JDJyjRxxx8vr2Lcm8WAjTpSZDyD0CJsklcuZcoMPbmyJZBN3HTTTVV7spFcBIUvY0KXYgrq4IMPpqzLXoSi7tMSy14ooAym5DKqMCBhD8QFjCkSQ65XfKyegccee4wWdEU6z64f9BfmM9JO0ZdgeQIL3Nw21G2IukDBiDp2h2QJ+GF3QCyT+yumXhnqAdWyAxl3jWCYb/ZPaZJnKD8jtFEwZswYM5vXmDTI37mrSdWdaORMoNyI5rdsi6qPgsv0RyQGpW2/RcHZulmRG6AM5iuQe6BtX1awMsn/uwCMQya2gvwCTAoXZEVqnmDmtiR/nZhgxQzcJ82QwGKVtJCf/cOq4zvW6chYMDMPDLpxKNWKYffddzf/QcqhfUlrABOUgDytS5Zb+Jn/oI1rbCBnAG5erQMGyX6l407kK0ezeoOCFejiGD972Eczmhro5FMGd6lxER900EGZrdCyxOvZrUtW7bDJ+Hv44YcrUhPdtJq4WpktpmCmTFZ5RYnow9JN6QaD2HLgqrFaL50lFqlDNI5jMUGJrOJqqkhLaVdWQSDV/K9WrVoRYqVpoMlaSDypBNsQYtx2c3bEndBtg6qk1EXqBT/W5zkGnshSQSEuK8lL32SchJipGxo1wrvssouOq88tIOMRWuAMhkt70KBBC6wi/VbTwG28++67urhtie5d0HqY4jxuNhxK7gyKNmT4SSzhWnKIAxNvvuqqq2jSpEmpV4b4NBK9ABRZ1xB+UatUM45LBTeTzpWAWaVfjQp4Auy6PJSIhdVaNxZA4Smt0TxtbhETJoYDgnP/JJ3ScdZmXW/xJcZAUA5ambYlQ5SomZtR/bAZxcExOnHSpMUFTZEajYk4jd09AgoOpQHU0EtxtxKUqOl2cMUVV4TWGj377LNqSUwsYRsLIppI/HgZxDEtLuJUAMMOksvgGUjbPaYCGBs0EaQSGzUD5SjbSLIPSFQBl61x0TAFX9qGyqUCOQ0WzR14+aYm7LJiyFysunDKgBbwxTIlzdjHSmnqR2l+neuChG+0gYCWky1oihRZFn+uuOKKNmOIqXGzkh5OTkgs/rimynOvSgpLo7fYT7o4UnqKU++Lh3NXNI3OilEE7CSoxYTbPS25QYUw3iaTSGsRAmndxJRBw2irXtK4eEGH2JhAd5yLLrpIX+5WYhuwx7Jw78LdbnF/f1SO+QtlEM+FZ22fffbRlx8sgGMUDn4WvENZZ2zXgiKdpRfdz+xyzTXX6CLanR1dZD2riNvlOn34uQFt4Bcxw5Y0en1Ix5BDMbyk5Avqhs0CoGMEQNxeTq7ZMsJYSdxfMvWK1E2ufMOVxHvvvZeX+NS3b18677zzGmXbSBo56qgcxTVmu6X2GjMWSto6X6skCRbuz2U4ZFN3B4ajNFnGaGcn1Q+/KwXhAoY50lTCTMSE5nWBUaShGXboAGK5VEC9cq7VkBhYhhriJjA7wVD9dwzG4BCVrhCF5irXyllJFIemeEgXFGwk7tydkEkN91MWvLpAnz59TFwIXXgQb61R/GR3raGUxPIUkHhHFUzyQcxNS9Euv/zy0MlpFkAzdwyAVnbsCSX2+8wZ1yyTUV4ibc/SKtInynTon6kbOg1doEXgjszmPxbQ8Qq65FVY543m4sUAViXSkuUvFo8HVk8SC3Jy/PHHexa+YXmKZQTLTPsDfgg9fmgKfq/CPezsrx9TRcffHjvEreRC9z2ucJ9Lj1misLp5LO1S7lfuhLHy9NhSSr1/Klw3l7sQHNdJtS523+uq+lbg2p2CDXPWbepzsuOOO5qDYNdq5Pd4Mpg7dzzwZnZNiu2XgstjMt8Gc+N633zzjW5iCkvnjK7PDVjh2WefXfK+cSKY7tdGZbyPLsEGLrnkkpL388UXX9T93LvUMQhYe+21I7fDkyn96k1VNIbasqTuIJOlJDqHGOOYoAQ/HRd3e9V28Fdh70ePHh14gDghTB3n+cGdLDwmBPA22WSTyBPEpOD2z/5VZce+Jnbqq6++qhZFugPLED1ZQ4YM8dhayGzQZH5Mj7Oozbo5Vp16fdybUHf1ogpcuxOw4ddeey31cXC3jtwNyuQDVaNIIZz5nvfcMXFDudY9iWWlDK/PTnEmJ2HCSWS6XxPLfB9tjo1wGVJJ+8n1kx53TcIqoAUWK2H7a+mBMpFF5LaOO+44/eqAKlWkkIfMRZs4MdF55Fwdj/M18NOxtapIIb/iCJiUOvAg2f/vMbG3x/Eaj4m2PU4A8Jo3b1705GAGXcVKNHcTM+tSJRXpQix/Y3lGTxTzEnscT850QOaaS4+5eXMXg9lIslSkF1Tg2h2rk420x8F1nHnKasSIER4nulSFIoVw9mve/nGSWKr1cWMKjzO/7VUOz8CL4pcWLL+xe9rjNn2J9/HUU0/VfbutEe6lH7AhdkOnmYy8nGYMiqNImapRv3pDFSvSJVjMQMiJc4ksUlGk42pZkeam5HAfZDFow+Vm4egqveid0syaIxTpyjG2vRUMQ32IAY6Felx64HF9Z6YDMQYIy31nwKUWqddrPdiVcDUZLf7888+nPg5OitHj+AK3g7mIrAC4V6nHzEm575155pkVUaQQjpHnXb9Sn1NOWPOY89peVa8yXqO7sAFuGZd4Pz/66CPdvy0b4V7qhw1xUlfi/eRuVrqfh5W47c3wY4wdHO+P3Bbnrei27qtiRUpyT5kxJ+55xHMm3jKY94vUqiKFnKFXiZMOSn7gOQ3c4yxIXRXir4dU8QU/Mys3p6VI5wZsZzmWLeQGGwhvsj2SwQKFdcdsT5kPwJyw4XFdsG4KbpMZ2M8slLVlKY2twLX7ABtm4oLUx8FZhh7T9JmIBUsTlpzpOW7cOGOx4nuclFcxRQphkvU8ZcoZ8LF/C6vw9ttvt38+vhGUVHdsiBupJ46XWTHbRjMkuJY38X3DiZm6r0uXuO0e+DE3UIg1Ibbc8FTlgvvLjD9xzyeeNcHOtaxIIVfokSCRxJ6NFxNmhTHxJQtvs3So4mNtxWKmQDpQplWkXEyvsZKHWZ5gGYZcJpll5YHbaHnMY+r16tUrcwsUAtc7cxzbm7yZ5XqW2a+88kom21h55ZUr5XXYJGuFxt1XdJW3yjYOZfku57vmiQ5CGwomb2h0RQrhBtd59xGUe9T3OYvSKFyZKNjHuFgjXCdzg+C5SHKPW0k1gxrpfmqO+Sw2yJnbsfeTG53n0hlSbPv1JElZH374oW7znCpXpCY55oMPPoh9Ppn3Wo/tg1pXpHmWKRKKOPXeY+qn0IeUKbyMe4OJHPRnUBonVvkxLq+DJJO1l0Op5IHbk3lvvvmmsQgOP/xw40pEkkK5BlvEs7mJtJ2ssS0LMhVm4Q3uw5jZtk477TT7UPdthGu3k8b0mW84s+PgelT7OJ70ualm+69pVJZ6uYUbPeTtC5Sr/ztQCHBNW5mvwNMVmNxOSBrXHTZsmO7vro24ny8nzYxGsqXgwhK210bDCMxvnsjDZOGMKh5jW+hOMolM7IQjC/fUuiIluYE/tY8Kmbsvv/yy98ADD3jMw2ncIJoBauGJjDP/yiE9xTXicfeUwLKfUgSTCi5mN3LIIYd4u+22m8f1ZR4z7xgXUGMlpSD70HKrP8CCGorzbE9D1ttlUgf7HkBySNsyWQ3X6EZQcpD1cViWEDDYp3T6oxpJP2QqTY9rPSumTJH0ZwPXHu/jfuYOMt60adPsj3FT7Fmh5+1O7MBTTz0V67gQ3rDQrhH3s1/SLHBrknJQwm0dyGJ+jAQbJoNIdO25wYTfu7BKlY61r2EHMT7EPTYYZhbeY+lay4pUBTWfbyCu5oXjR5ZH4A6v4uNYSuKhuYGQaeEyU6KVFDyEyMBE5rGFcXLd4M7N1S4hOahc+8G8vfb2p4sbuWsG166zlGjlAigvvfRS2Y6DKc7smLJmY27vr19VwNXGJCTGtd/Y1577seZNZq16RsWXVeAd6qYT8YRxYCiapo24n13VDY1kyWL7CSvLQtuYoaQ+LENzgU7OJYlrrfkFnkILcyWxa6cqG3eRH2MmdUnChNzXVfNNFM8EJXPVkiK1FVEnsVT3kocDNQMbCKlDNe/7WpK0YJJ6uKN7JhmrlRDEoVGkj3gKE/8bsgZkl9rjurhX74f7E4MCU85lWnsYJXAnIpYIVxU3rNZ9OjPFtdtBM2hRl8bUlcbCbyyLb+jQod6sWbP0OB6x9msdKb/5WD/Eg494ELeTMgl3WZJoBJWvIK6P2CfOiw9TJBt8uyp5/pphn3ANsd8JyA1ursC+Gjc0d64pup9WKdRLMUtCzEQQyUnw6JWqQG3hXtLmecM4IKUj1VZm2ELHXoxdSY8PSa+DBw+2n8EP7USkJkabOjQWTmS5efLkycRuaeLBkUD+vtJKK1Wk/2Qcxis0WwdtG3hkwQEKAYE3M58ENbL+UbiOH7R4PsF92Ry9NtEOi+siTeNdNCgoFw8mKxLiWDBxkhNxjaqhnUQrLcZ7LFuUuFrwF57NzFPmODhJynQm4ni0OT/luga4V0DLyKw/xAklpouJcKkuQdLH1wL6Zx0kxN2t9E1maTG9RjneZxp4f/7558R1vKFtBcOAewHXH40lOnbsaBqBo2OTr+XbJGkwMZtlCFg+q+wZfJRlf84RMP1f5VzmgSdexIrWcD9LN6rtK8BbCzrUo7EP6FAVtJ+4P7CvoNmUNnPHyu+isA3L0KlTpxLnkxBnMROTwJhriL7M6MCUFNgHPG/YH/ZM2G3MZsh9Wi0YzrIl2gKCRzronAadY9B2gnYW9z0aAkBk7LqF5SQsOEXauOjIMlKbi2Ogr3FMoYZOGG/IQIN2eH9Sfss18BjvDOWGwakSsLaNZgZnlrgakK0+h9ZiuG6NRYZtA92QMHnhbY+QpuphvSZbSSOGXXHuWVb2f4EZcIhrOA1JPmdtG6WK84R7E2MCFAgGGjQsB+8vSPQx4cNgG4DpMkn5f/auBciK6toeGCKogIBREVQen0T5RREGJSg85BEzYxABjUQpIcKMBERCgKAVEeuVEvBDIuATRC2jj29EQAmmJCMQAsFSFFFAgxBNBEqiwRgJOD7pt9a5+4x9u/veuZ+Zoc/NWVWbGW5/5p7dp89377UoL/aUaLTGFSVZyqCRoL7lCVCG+k95r7JBK5UQmk+H0znYwXNuwGfNQW0tvm9U2L45Rs/+TiU6yvm8gywbBhyfyMBluetITwyonnKdVPpMX87j0jj9XYioi+QztuaUHGHr1kg6Lj7Q/bBPRMf1nDzECerJd/xU7rdfXtTD0sB8IMo96cDp2ghYD5Fh8zf+HFEcgh2RMtUGikQJY4PRvc0DfG6UQ2ks370mUSmzucoUz8tMFXYoUQrJAhx6t4Z1ksEcxU47SN04TepJJuDs8j2VIFjfLt9lv+hA2iTb0w12jdRN1o9TxUf1fL72RBj8qQw6p9pCf1ldaJqmvhXJM/hf2M4M79tC3smWvveRP0+SY/XzfN+OiSzcr2IoLN5ZBplnyWy5UZbtoRKlMLLh/7XqgOtIrUI7UWI5XTrUd2FbVbSqz7dFmu6YBeU6qxaVKupJI8RG4mTp/FWM9V5bBGb1KkImqqXUASXl4iBrd4rzW0sdOCI/2dA1l06Ux84UO13u9TWpP+9I/WoogyYu2x+ISYfZUOrMcenwssGXMmApZLSQTiJV57u/wMvfRCYsF6uEOpgZGByVwcabUr9rrpFxHamyQcJsrOx9nWak5bjE51sqfVVEj7mUQkXo3/lGT4NzmMHUFe7LY6k1VyyB3RBDX/DZjczj+oWw8kC94bLT+SnO/z9ZTTgmgxjTKdUT2we7NobLtKwvk3wdaa7wxAefyMxzm0iurcyhc44TZsAmyGz7eDXlP+5rJ4rEF7Nh91ha9lKVWG7ta9pKBAfpPVzd2WH/F2Qc/hUgPvMn5d37wnWkhTuq5Gb2MERgqieeeEIHiyBVpuoE7l9ReJkBNUiMV1CpYMPQAKwcWtsTSfAKUcHv4bO2MSwfZ8ybH3zwQQV+YRPU8VUrj/0bbvBzT5L7OCxrukAIBv7QuK/XpEmTUCAUX6YOHToYofibZGkmLhiBPcsnqbsL1p+qvcmIYC7l34diEBL9xGCnZcuWcf9yiHQEevkJfv0GIin1ni61GenHdD7kPelDBidRDxQKH3vw8Tdj5CduD7wybdo0HTzFfWo2jOn8ZOoRf5qys83jtQzwgwqRDrRhMBeij+mjv8pAdIVoetqE/hhk/668vFwhL12/Uyxj8N1KWt7As2Y9ok9AVK9ALMKPr1LZ7SOfaEyE/QBWvGTJEh1IBG5dBeIZxaCqIPic2RZAxlEhIp7vBldafg27PecVPAvTX/4djKk8B1EJNPuQPwybSin8jJJywdxTJuWXlJRU/X/ePEbte/vjTCadi8pFPhZT9Z+JDKsno5HKMfWA6VTAzX4VpXyIIkiaLvmTcfLT92pK5CDKyBDFcpP9ywJlkyi7mfSL6Djz1QceZ1GZF+vkztWrtRJYsEylpaVay5piBUxhad68eeiZkzREsEdSK7P+Hq7Tip+1JQ0cO1GT70Q2oogE9wRD+759mhov6sWAOrypHHEs5/dTcQtT8oj5bewcmANKhZB0Ysc8HykdOseTqjUkSeALpFITbU/x4se1/J5JwqemJJ93Kq5VvvzkKGa+qAgQa3Y32ClBaTeThE4FE6r5BBsS0xFjludt3bpVn+vLB54aQz+9yy9Gogq+I/RDly5dIv3EDmXRokX6PPqKfqXxd+ZQ0iekLgwSWJAbmr4yfCmwdpa0HU2MghPLh9Qpzf6WitSBnMN8z+hLH+H9++JnG8q6nV+Y7G0qQnvax6jFxNZK8x/SeQbziJHa4s+DHug6UvvtA3LummT/9u3bG9kxkiePFnYddrYdYaWGToxkB8HKYVtHygbMxxm6BnYbbIRIo2kCiCjVCzYYwtIyQkS29SiVRBF+/ckYd6S0xrAfkApWOsGPSL8W1QA+8sgjun+U834o150Scc/ewsLyI5mF7+eMhYw95l6dO3c2SheHpC6NldWCq2Jab04RGrwyqR87yR0d5afBgwcbZqufyGy9XGy0zyc7uBpANqwg4w3rm0iokbO7uyXtx1nyzEdLuQ8vWLAg0j/333+/GYCNE38Olw4q7mUkRec+0iJiays0q6YusOBeYQI7W1SvOOUeTyIn8n8HV/vYVqxYscJc2891pPYaK38SYw5nV0L2Xt1S8EdBLVPbOlLOOlMsLTXWrNgRAuM+PtRJgWuG8EOOuC3pSIP2WiplHDJiCeVetvektuI6P9E9mZ+A34uPbXxnfkZqxCg/3XXXXYaBprp7TNMkwOCGjroPO2oRC2hpoX82vPzyy5HlEp3mBy0s0wucRVOcw18exBYY1at/iMZyOnY8zb0bJYIinSmXZc7I9DvVVw5xwjSMHhW4QKs+YBAE8NtqrnsL9h1QfSks81pVYBMAQtYciFUrIU14WIUTzZUhsvCDgTkMklHhXMhnYeMgQq3JBPx/yxI0ZHR2qsAqlUhVyRZHJeJVM1MR2GdXEqn5maXvTEMGzKSK/8gwApdJ+t9j8AmD+oJgMB+WhBtKLrJt8FL5Rz4/2bLy/Bj2XcSDKCiCJR3gs0N7cEzyhLekucdhydHdBAGD0EG2GXjehkwmI7iOND5gztN5jGL1QzrVzhlc/xpsFa8PULbZEXYHmjNETL6fIh1G11Ps3YUO8DP5PKou/w9sB6M8fQ3rvzsaRPiykcXlqZ/quaapF1FghO53IbFmBnRJID2jSqQSPW2bf6LeGxPJblkfwA7yF9j+UVu2JPeTWMZX2CtVwuS1L8P7XYH98U+xwhM6wPvJ3/u560jtwgBsjmvuXT8kHL2nMNJUB3KcKoa/2wJSbhHYtzOzyJrGQqZyEEyDcNBkBsGOtIFziwZnIKuZIoVtgKQDbLghps5f2Vqf61x1QrCQqzQc7ARBTmJh2vpDFvfjEtd95K8mR3BSRQCX9uLFi5WkxDRzHak9aMOcJ5M8bMDREvMsgTUqQU2XDsyBe69r1676P4h6VUJ/Fkdopndoyer/kBBa1Q7jyl8MPyxzNAWnuurmkAKj+A/260MHEMmrcy5VQnzCoW7Btq/7PfeEuSI4UGbuOHBXDvedBaucPn16eFZy223m14GuI7UHR7nfF7WPByV6qoCcI/ymV1Rzn32IxNRLUZdcooVOjsS0vHt1izRunH9fd1Mt/B2S6quHHnpImZmpSnDDOjhEgUxOjw4aNCjyIPR2zcpPY+eqOsUNnI3yPQ5i/Pjx5p1encN9OSt9CLqjmpwjqSJAyEH2zCe7jtQevMq9TRlZJYFLvpStAqtRe/y3QiUoA1Php5jdfUaJKCxXkAZrTEzLy07zUZBGKNkXnqMSCiI1Dc7Sp3B0uXTpUiUv29OuujmkwXQyAjHIKAikHpF27mRh0nGoO4xhpyaBhVUgY5dIts3P497z+A/b2CCECe1bQr3qOlILsJ4zUonSDYFyV4wqRG6hkqhWypZdHnHqNlH2uFolSO4rYlzmW4T27ULhB60tcKP5AlgvUf047qqbQxqQ1P41kHpEHiT9HNDPuanOQJGFbmAvCh1gRL5QIOazmvUX2LtmS8wP6g8jX1VVtxLoOtJ4vby/QZJ02pPKysq0bdy48XLpTB8VsmYVENh+Xtmh8rBNggRqG++kUMpxcIjC82DMijxA7muV0Astcm6qE/Rn6pufZ9ygY8eOSsQX3szzb2wtLi6OPLB3717zvF1HagnG8WEyqCEdOCsl8TKJ6hHlWyah+5slhcbBwSF/vMlYA64SBUHxCE6GRNfVofbRk4GT3LMMQoIU362BPOi3TW51EJJJ0c11pPaAeZTLwciiBg4cWP2Q+fnndUI99/+QnPxtmd39Un0ljeTg4JAbDlGBp3Xr1qEDoFQ0v37TualOcB7jRKLyhUHrp59VDfyND+VeIUDEQIkG8GmuI7UH1B3dBJ5YLZFWHZgPOHfuXN2hzp8/n5vxEyRS9RznSgeHnHFUb841bx5ucT/8sKodd26qEzSXtKMQGGykEku7+eII5QgpOZjieTcSkXDXkVoCDrsYLvh4RUWF7hz5gFUGxAaQC9LUb+AevVDEit3Sk4NDbtABaRCCUFG6rcp+RiibUD+KHlQfqK+7sC9r4G98yXtFdaS+593AdaT2YTRs9i233KJALK5zSTMBVA10ODiEfU+VYCTHWuPgkCOiGnBpvGuqAXfIoJNLJd4uz6cmgr4akAwnipeYPOCCSteR2gkSjPfHPs067ocyN5QBRtWBlYHLwthT4FLECudGBweVE5ViFK2kby/tsHNTneDDqCV29ZWAw2k18Dea8VkHmeUIqMzwxz8lG8J1pJbiJdh3YH3BVvRb5lJt375dXXfddWkvgj6pZg1SiXzSrs6NDg5Z4Swy6UigSRJEMYf4k3NTneAtiNxT1CJ0QEQ92tTA32gbVJMx6NChg4kM/pfrSOOPqSpBuLxQCQ9tAFymLYGVgoFj7/Lly9WmTZtC5NoqwMIiycT9nXsdHLJCO0bnQk4rdOCiiy5S0qi+5dxUJ3iNEdRRUbVvv81QEC0i8PU8/0Z7yRcNQSK3d7j0l/jjViwpzER+Wm/kS3FvdFGac1/goJjXXHbZZX/etWtX2uVekQj6L+di61CvGg1XpwlXu+iHoL3IAz16kIxLvQz73LmpTkAilc/F7yqCZaooQ3WsdLj0lVdeiZ6qtm2rqlOVcR1pPHDtjh07FJlUFi5cqHnqlezRqNSRvaQJbI+N8KVc7h02bFjkiZI83sMFHdnXkUbt19QA9E2FVs21A9E4g++gcDOHQKpO4DnnpjoDhTeek62qJHA5VlSdhuVxf67Ynb1t27bQAebzN2umVdRWuI7UgopiQqxF+oytXFOVWaoMybN3zp49O/IECZYgE/5Jzs1WoTIq9YIAaboS9ZGTckyvCkYnunYgGWWVlZVakzKIkpISIyyxzLmpTvHkgAEDFPdKg+Lk3OLKU0RgDKN/d+/eHTogylRrVTWBZe4Fige+NFRkr7/+ulnWuyiL6yeTvPncc8N6w1SUAf5mEswdrMH7qSjLmOIks6Yzcrjv+UrIuFlnBH937k7CROrkRjHpiG4ltYEPOjfVKSqMJmwQc+bMMRrDt+Zw31awaykMHtwP79Kli6ZiVYnVP+U6Uouwfv16Ix6cTaXY7IsuC42gVUIZwe2pWdZwkJA7Kphs7dq15td2Odz3v/fs2aPrGHOUVYJ4YJNzdxUWwL7uE3WuQnl5udH4nercVOfgkt1cks5cfHEypfhLL72kDZiRw33nkx1u0qRJoQNkl5NJyFrXkVoIjo5UYp80U+hEJ4nQrULjxo3VNddQNUytc161Dr/RrByjR4cOcD9dIgxHqewjw9uOGpW4bOzYsWYQVpD5kEKc4GU5OylnnAJ97MeZZ56pFixYYNSKdrnqeUIwBfavJUuWhA7Ie8I194lZ3I/6zgOnTJmighSEXHmQIKMfZlTX3LOJH2bMmGGeTaYjrOkcVUkoeBUefvhhQ3lVoQqAri0QIFPVWEqDWWgao8xb+0NUgAVxxx138McIWHGG96OowcxVq1bpPaUhQ4aY/abZttcNiWIOQYK1Mm3j2Aivo9IHZ55BrFy50vw62Db/+JiYogYaxy2blV7LLY+RI0eqYPTu3XffberzVRnci+ky6xmpG4wvadGihbnXMjOgrRbcB3B2wu05aBx6MnrWNmjQIE+wBtY7zbXzeRKWPJKuh4KMuX5yAfinKQsyYcKEpDLSUOk9BIYUSjmD1gpWOW/evFC5aeBiZrk/h41Jc49i2FKeCHEDfV3Tpk09qGnwo2UF4KOpIB+J9M/48eNZxt0Z3GMU7IMDBw54YNAJ3Qd81+ZdusxC/1Qgcj/SP9giYJnut7BMt/GLY/k9VCZEWptnNQ9WlOL6W2EfIdbAQ35q0vUXXHCBBxIOXl+RzXdynVhMO1La8OHDvcOHD5uKsQr2E9gw2AjYLNguHmCn6b8OozVzzVMW++RrsH6wgbDZLExpaWnIRxhVe2Cg4eGNsBLYlbBvFFDd0COqe++9N1R2RPWazpR4ATZcGvsB0rmu5AFE+XoTJ07U12BW7yE6kR/vt3yA0V3K+cc33ngjsqO4/vrrWc5/Sh36llxD6wbrJR2odiBm6V7Lli1D/sU+mfHvUIv8c76U82rYoTVr1kT6Z9GiRSzX67A+sIste29W88tPmzYtVC6s6Jlntk/aTE5EekrbuZ4HOIgIdqK9e/f2wFHOw8dgJ7uOtEA6UmOTJ0/2ECDi+QGOSe/FF1/0kKScNDsDm5E55XGL/dEGttdfXjZoWKaO9A/2RzykD3kB3FxA9eNXLBD2zj0sY4bKj71ODyw8wfLrz6ZOnVp1Xs+ePT3k3ZnDPSz1BQeQX/jLiaXYyHqBfU0P6WReOvC9KisrC10LUW//O2fTasfj/vJxIN6rV69I/3Tv3t1DelzQJTa1G3r6OWvWLA9ZD0llg3CHt3Xr1tDz5iz0pptuCvkClKvmlD/DOmX7XVwnFg9bxxExHyjoqDzsY+lOkkt63bp1C42Sg5UA+VXeY489ZpbrDsiM1WZ/rADJhIfUHQ/7eJFljjKey2u4BCw4vYDqyA2wv0EJyLvzzju9Vq1aRXYciNwOHQOlnX/JiysbHS31wSUsAKKNPfDdem3atAk1oFHG87hkZwzR0Pp6JNqHzgWxiQeBCOOrZ2EXWuSfq9kGFBcX6/KBbD2j94Z1BvuOHgITTblHWlRmrhQc4XIsYkJ0WfxlAz+vblPpC25p+I9xRnr77bd72Cc15Z4OOymX71EvKlfKoc7x7MGDBwcPHTpUzZw5U/Xp08dQAfaCNdu5c6ciy8qWLVvUoUOHtD5pp06dVN++fdWVV15p8gGpTvBL2H2wzyz3xyoo3Qy68cYbtc4qZYxSkVYbcXNGLGNZRjGRfsyYMeqBBx7QcQMFFpHK8jwOu4aECs8884yiZi1pImkm8pD+6tq1q+rXr5+iD/m7+OGnsMcsLj+V7isYKGWCfyivxVzpVAE1H3/8sVEICYG520wZo+wg01qY8N+unc4oel+CVuZY5p/hmIE+zWAcIXbRkftRHLUGfG+E4EOnlQi7D1kIfmFRuZm1wARTRiDV37Bhg2Z027x5s34v2CaYYEXm2mMJV1v//v0VOlcTjPnzfIIyXUcaDzDycr1KJBUTN8IWsxNVCeorRqFdrsJyQXslB7BCossKpdPoJNyWzfO4x89yzCuzAZeqBJMLc5vOUz5xdzYWhtxDBlQbpW6Qv/lTy8vdSN6TS2vh3gdUgj+XfnpW2Zl33UjSczpxcJlqcJFqMCrnvwNjsuw/LCz/f6hEStgVQmhzSppz35Y25kklefj5wHWk8cEwefj7YXMjZiJ9pNFkZ/uFdJq75OU/XoD+GKoSHMFFOTRqh8SHlQVeZ/rCusDOlkFWA/HVEfHBPulIPyqgMpPo9vsyyMy33h8XXx2QhvVVSzsQP9hODOTCRJb+KRJFm+cKgKCjnbQdbYRq1Z8fdVR0RbfLoKNGOkDXkTo4ODg4OOQBR8jg4ODg4ODgOlIHBwcHB4cTg/8XYACU/v8XBqVqhwAAAABJRU5ErkJggg==";

function logoTag_() {
  if (LOGO_B64) return '<img src="data:image/png;base64,' + LOGO_B64 + '" height="86" style="height:86px;">';
  try {
    var cache = CacheService.getScriptCache(), b64 = cache.get("logo64");
    if (!b64) {
      var r = UrlFetchApp.fetch(CONFIG.LOGO_URL, { muteHttpExceptions: true });
      if (r.getResponseCode() !== 200) return "";
      b64 = Utilities.base64Encode(r.getContent());
      if (b64.length < 90000) cache.put("logo64", b64, 21600);
    }
    return '<img src="data:image/png;base64,' + b64 + '" height="86" style="height:86px;">';
  } catch (e) { return ""; }
}

function invoiceHtml_(inv) {
  var isInv = inv.type === "Invoice", C = "#444444";
  var due = Math.max(0, Math.round((inv.total - inv.paid) * 100) / 100);
  var logo = logoTag_() || '<span style="font-size:20px;font-weight:bold;">' + esc_(CONFIG.BUSINESS_NAME) + '</span>';
  var h = '<html><body style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#222222;margin:0;padding:0;">';

  h += '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td valign="top" width="50%">' + logo + '</td>' +
    '<td valign="top" align="right"><div style="font-size:34px;letter-spacing:1px;color:#111111;">' + (isInv ? "INVOICE" : "ESTIMATE") + '</div>' +
    '<div style="margin-top:14px;line-height:1.5;"><b>' + esc_(CONFIG.BUSINESS_NAME) + '</b><br>' +
    CONFIG.BUSINESS_LINES.map(esc_).join("<br>") + '<br><br>' + esc_(CONFIG.BUSINESS_PHONE) + '<br>' + esc_(CONFIG.BUSINESS_EMAIL) + '</div></td></tr></table>';

  h += '<div style="border-top:1px solid #dddddd;margin:14px 0 12px 0;"></div>';

  var meta = function (k, v, shade) {
    return '<tr><td align="right" style="padding:3px 8px;' + (shade ? 'background-color:#f1f3f4;' : '') + '"><b>' + k + '</b></td>' +
      '<td align="left" style="padding:3px 8px;' + (shade ? 'background-color:#f1f3f4;font-weight:bold;' : '') + '">' + v + '</td></tr>';
  };
  h += '<table width="100%" cellpadding="0" cellspacing="0"><tr><td valign="top" width="50%"><span style="color:#888888;">BILL TO</span><br>' +
    '<b>' + esc_(inv.client) + '</b>' + (inv.email ? '<br><span style="color:#555555;">' + esc_(inv.email) + '</span>' : '') + '</td>' +
    '<td valign="top" align="right"><table cellpadding="0" cellspacing="0" align="right">' +
    meta((isInv ? "Invoice" : "Estimate") + " Number:", inv.number) +
    meta((isInv ? "Invoice" : "Estimate") + " Date:", fmtDate_(inv.date)) +
    meta(isInv ? "Payment Due:" : "Valid Until:", fmtDate_(inv.due)) +
    meta((isInv ? "Amount Due" : "Total") + " (" + CONFIG.CURRENCY_CODE + "):", money_(isInv ? due : inv.total), true) +
    '</table></td></tr></table>';

  h += '<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;border-collapse:collapse;">' +
    '<tr>' +
    '<td bgcolor="' + C + '" style="background-color:' + C + ';padding:9px 10px;color:#ffffff;font-weight:bold;">Items</td>' +
    '<td bgcolor="' + C + '" align="center" style="background-color:' + C + ';padding:9px 10px;color:#ffffff;font-weight:bold;">Quantity</td>' +
    '<td bgcolor="' + C + '" align="right" style="background-color:' + C + ';padding:9px 10px;color:#ffffff;font-weight:bold;">Price</td>' +
    '<td bgcolor="' + C + '" align="right" style="background-color:' + C + ';padding:9px 10px;color:#ffffff;font-weight:bold;">Amount</td></tr>';
  inv.items.forEach(function (it) {
    var lines = String(it.desc || "").split("\n").filter(function (l) { return l.trim(); })
      .map(function (l) { return "<br>- " + esc_(l.replace(/^-\s*/, "")); }).join("");
    h += '<tr><td valign="top" style="padding:10px;border-bottom:2px solid #e4e4e4;"><b>' + esc_(it.name) + '</b>' + lines + '</td>' +
      '<td valign="top" align="center" style="padding:10px;border-bottom:2px solid #e4e4e4;">' + (+it.qty) + '</td>' +
      '<td valign="top" align="right" style="padding:10px;border-bottom:2px solid #e4e4e4;">' + money_(it.price) + '</td>' +
      '<td valign="top" align="right" style="padding:10px;border-bottom:2px solid #e4e4e4;">' + money_(Math.round(it.qty * it.price * 100) / 100) + '</td></tr>';
  });
  h += '</table>';

  var tr = function (k, v, bold) {
    return '<tr><td align="right" style="padding:6px 10px;' + (bold ? 'font-weight:bold;' : '') + '">' + k + '</td>' +
      '<td align="right" width="120" style="padding:6px 10px;' + (bold ? 'font-weight:bold;' : '') + '">' + v + '</td></tr>';
  };
  var tt = totals_(inv.items, inv.discount, inv.taxes);
  h += '<table width="62%" align="right" cellpadding="0" cellspacing="0" style="margin-top:16px;">';
  if (tt.discount > 0 || tt.taxes.length) {
    h += tr("Subtotal:", money_(tt.subtotal));
    if (tt.discount > 0) h += tr("Discount" + (inv.discount && inv.discount.type === "percent" ? " (" + inv.discount.value + "%)" : "") + ":", "-" + money_(tt.discount));
    tt.taxes.forEach(function (t) { h += tr(esc_(t.name) + " (" + t.rate + "%):", money_(t.amount)); });
  }
  h += tr("<b>Total:</b>", money_(inv.total));
  if (isInv) {
    inv.payments.forEach(function (p) {
      h += tr("Payment on " + fmtDate_(p.date) + (p.method ? " using a " + esc_(p.method) : "") + ":", money_(p.amount));
    });
    h += '<tr><td colspan="2" style="border-top:2px solid #e4e4e4;font-size:2px;">&nbsp;</td></tr>' + tr("Amount Due (" + CONFIG.CURRENCY_CODE + "):", money_(due), true);
  }
  h += '</table><div style="clear:both;"></div>';

  var terms = [];
  if (inv.notes) terms.push(inv.notes);
  if (CONFIG.INVOICE_TERMS) terms.push(CONFIG.INVOICE_TERMS);
  if (!isInv && CONFIG.ESTIMATE_NOTE) terms.push(CONFIG.ESTIMATE_NOTE);
  if (terms.length) {
    h += '<div style="margin-top:46px;color:#666666;line-height:1.7;"><b style="color:#555555;">All payments should be made to:</b><br>' +
      terms.map(function (t) { return esc_(t).replace(/\n/g, "<br>"); }).join("<br><br>") + '</div>';
  }
  h += '<div style="margin-top:50px;text-align:center;color:#888888;">' + esc_(CONFIG.INVOICE_FOOTER) + '</div></body></html>';
  return h;
}

function invoicePdf_(inv) {
  var label = (inv.type === "Invoice" ? "Invoice " : "Estimate ") + inv.number + " - " + inv.client.replace(/[^\w .-]/g, "");
  return Utilities.newBlob(invoiceHtml_(inv), "text/html", label + ".html").getAs("application/pdf").setName(label + ".pdf");
}

/** Emails the document to the client as a PDF. Returns true if it was sent. */
function emailInvoice_(inv) {
  if (!validEmail_(inv.email)) return false;
  var isInv = inv.type === "Invoice", first = inv.client.split(" ")[0], due = Math.max(0, inv.total - inv.paid);
  var body = "Hi " + first + ",\n\n" +
    (isInv ? "Your invoice (#" + inv.number + ") is attached.\n\nTotal: " + money_(inv.total) + "\nAmount due: " + money_(due) + "\nPayment due: " + fmtDate_(inv.due)
           : "Your estimate (#" + inv.number + ") is attached.\n\nEstimated total: " + money_(inv.total) + "\nValid until: " + fmtDate_(inv.due)) +
    "\n\nReply to this email if you have any questions.\n\n– " + CONFIG.BUSINESS_NAME;
  mail_({ to: inv.email, replyTo: CONFIG.OWNER_EMAIL, name: CONFIG.BUSINESS_NAME,
    subject: (isInv ? "Invoice #" : "Estimate #") + inv.number + " from " + CONFIG.BUSINESS_NAME, body: body, attachments: [invoicePdf_(inv)] });
  markSent_(inv);
  return true;
}

/** Run once from the editor: builds a sample invoice and emails the PDF to OWNER_EMAIL, so you can check how it looks. */
function testInvoice() {
  var item = bookingItem_(["", "", "", "", "", "", "Silver", "J$22,000", "", "", "", 60]);
  var inv = { row: 0, number: 0, type: "Invoice", status: "Sent", date: todayStr_(), due: todayStr_(), client: "Sample Client", email: CONFIG.OWNER_EMAIL,
    items: [item, { name: "Permit fee", desc: "", qty: 1, price: 5000 }], total: 27000, paid: 10000, payments: [{ date: todayStr_(), amount: 10000, method: "bank payment" }], notes: "" };
  mail_({ to: CONFIG.OWNER_EMAIL, subject: "Sample invoice from your booking app", body: "Here is a sample invoice.", attachments: [invoicePdf_(inv)] });
}


/* ---- receipts ---- */
var STAMP_B64 = "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";

function receiptHtml_(inv, pay) {
  var logo = logoTag_() || '<span style="font-size:20px;font-weight:bold;">' + esc_(CONFIG.BUSINESS_NAME) + '</span>';
  var due = Math.max(0, Math.round((inv.total - inv.paid) * 100) / 100), full = inv.status === "Paid";
  var h = '<html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222222;margin:0;padding:0;">' +
    '<div align="center">' + logo +
    '<div style="font-size:34px;font-weight:bold;color:#14202b;margin-top:34px;">Payment Receipt</div>' +
    '<div style="font-size:24px;font-weight:bold;margin-top:10px;">Invoice #' + inv.number + '</div>' +
    '<div style="font-size:18px;color:#555555;margin-top:10px;">for ' + esc_(inv.client) + '</div>' +
    '<div style="font-size:18px;color:#555555;margin-top:6px;">paid on ' + esc_(fmtDate_(pay.date)) + '</div>' +
    '<div style="margin-top:34px;line-height:1.7;color:#455560;font-size:15px;"><b>' + esc_(CONFIG.BUSINESS_NAME) + '</b><br>' +
    CONFIG.BUSINESS_LINES.map(esc_).join("<br>") + '<br>' + esc_(CONFIG.BUSINESS_PHONE) + '<br>' + esc_(CONFIG.BUSINESS_EMAIL) + '</div>' +
    '<div style="border-top:1px solid #d5dde3;margin:30px 0 26px 0;"></div>' +
    '<table width="88%" cellpadding="0" cellspacing="0" style="border-top:1px solid #d5dde3;border-bottom:1px solid #d5dde3;"><tr><td align="center" style="padding:22px 0;font-size:22px;">' +
    'Payment Amount: <b>' + money_(pay.amount) + ' ' + CONFIG.CURRENCY_CODE + '</b></td></tr></table>';
  if (pay.method) h += '<div style="color:#667780;margin-top:12px;">Paid by ' + esc_(pay.method) + '</div>';
  if (full) {
    h += '<div style="margin-top:34px;"><img src="data:image/png;base64,' + STAMP_B64 + '" width="260" style="width:260px;"></div>';
  } else {
    h += '<div style="margin-top:30px;font-size:16px;color:#555555;">Invoice total ' + money_(inv.total) + ' &nbsp;·&nbsp; Balance remaining <b>' + money_(due) + '</b></div>';
  }
  h += '<div style="margin-top:40px;color:#888888;">' + esc_(CONFIG.INVOICE_FOOTER) + '</div></div></body></html>';
  return h;
}

function receiptPdf_(inv, pay) {
  var label = "Receipt - Invoice " + inv.number + " - " + inv.client.replace(/[^\w .-]/g, "");
  return Utilities.newBlob(receiptHtml_(inv, pay), "text/html", label + ".html").getAs("application/pdf").setName(label + ".pdf");
}

function emailReceipt_(inv, pay) {
  if (!validEmail_(inv.email)) return false;
  var due = Math.max(0, Math.round((inv.total - inv.paid) * 100) / 100), first = inv.client.split(" ")[0];
  mail_({ to: inv.email, replyTo: CONFIG.OWNER_EMAIL, name: CONFIG.BUSINESS_NAME,
    subject: "Receipt for Invoice #" + inv.number + " from " + CONFIG.BUSINESS_NAME,
    body: "Hi " + first + ",\n\nThank you! We received your payment of " + money_(pay.amount) + " on " + fmtDate_(pay.date) + ".\n\n" +
      (due > 0 ? "Remaining balance on invoice #" + inv.number + ": " + money_(due) + "." : "Invoice #" + inv.number + " is now paid in full.") +
      "\n\nYour receipt is attached.\n\n– " + CONFIG.BUSINESS_NAME,
    attachments: [receiptPdf_(inv, pay)] });
  return true;
}

/* ---- money summary ---- */

function finance_(year, all) {
  all = all || readInv_();
  var months = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], collected = 0, invoiced = 0, outstanding = 0, overdue = 0, estOpen = 0, estCount = 0, years = {};
  var today = todayStr_();
  years[+today.slice(0, 4)] = 1;
  all.forEach(function (i) {
    if (i.type === "Invoice") {
      if (i.status === "Void") return;
      i.payments.forEach(function (p) {
        var y = +String(p.date).slice(0, 4); years[y] = 1;
        if (y === year) { months[+String(p.date).slice(5, 7) - 1] += +p.amount || 0; collected += +p.amount || 0; }
      });
      var iy = +String(i.date).slice(0, 4); years[iy] = 1;
      if (iy === year && i.status !== "Draft") invoiced += i.total;
      if (i.status === "Sent" || i.status === "Partial") {
        var owe = i.total - i.paid; outstanding += owe;
        if (i.due && i.due < today) overdue += owe;
      }
    } else if (i.status === "Draft" || i.status === "Sent") { estCount++; estOpen += i.total; }
  });
  var r2 = function (n) { return Math.round(n * 100) / 100; };
  return { year: year, collected: r2(collected), invoiced: r2(invoiced), outstanding: r2(outstanding), overdue: r2(overdue),
    estimatesOpen: estCount, estimatesValue: r2(estOpen), months: months.map(r2),
    years: Object.keys(years).map(Number).sort(function (a, b) { return b - a; }) };
}

/** Once: puts your booking packages into Products & Services so they can be dropped into invoices. Skips any that are already there. */
function seedPackages_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty("packagesSeeded")) return;
  var sh = feesSheet_(), have = {};
  feesList_().forEach(function (f) { have[f.name.toLowerCase()] = 1; });
  ["bronze", "silver", "gold", "professional headshot"].forEach(function (k) {
    var p = PACKAGE_DETAILS[k];
    if (have[p.title.toLowerCase()]) return;
    sh.getRange(Math.max(sh.getLastRow() + 1, 2), 1, 1, 4).setValues([[p.title, p.lines.join("\n"), p.price, 1]]);
  });
  props.setProperty("packagesSeeded", "1");
}

function taxesList_() {
  return rows_(TAB_TAXES, 2).map(function (r, i) { return { row: i + 2, name: String(r.d[0]), rate: +r.v[1] || 0 }; }).filter(function (t) { return t.name; });
}

function feesList_() {
  feesSheet_();
  return rows_(TAB_FEES, 4).map(function (r, i) { return { row: i + 2, name: String(r.d[0]), desc: String(r.d[1]), price: +r.v[2] || 0, qty: +r.v[3] > 0 ? +r.v[3] : 1 }; })
    .filter(function (f) { return f.name; });
}

function moneyApi_(d, me) {
  switch (d.action) {
    case "admin_money": {
      try { seedPackages_(); } catch (se) { console.error("seed: " + se); }
      var year = parseInt(d.year, 10) || +todayStr_().slice(0, 4);
      var all = readInv_().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.number - a.number; });
      var fin = finance_(year, all);
      var today0 = todayStr_();
      var shown = all.filter(function (i) {
        return +String(i.date).slice(0, 4) === year || i.status === "Draft" || i.status === "Sent" || i.status === "Partial";
      });
      return { ok: true, invoices: shown, fees: feesList_(), taxes: taxesList_(), finance: fin, currency: CONFIG.CURRENCY_SYMBOL };
    }

    case "admin_inv_save": {
      var type = d.type === "Estimate" ? "Estimate" : "Invoice";
      var items = cleanItems_(d.items), client = cleanText_(d.client, 100), email = clean_(d.email, 150);
      if (!items.length || !client || (email && !validEmail_(email))) return { ok: false, error: "invalid_input" };
      var inv;
      if (d.row) {
        inv = getInv_(d.row);
        if (!inv) return { ok: false, error: "invalid_input" };
        if (inv.type === "Invoice" && (inv.status === "Paid" || inv.status === "Void")) return { ok: false, error: "locked" };
      } else {
        inv = { row: 0, number: nextNumber_(type), type: type, status: "Draft", date: todayStr_(), due: "", client: "", email: "", phone: "", bookingRow: 0,
          items: [], total: 0, paid: 0, payments: [], notes: "", created: new Date().toISOString(), sent: "", from: 0, discount: null, taxes: [] };
      }
      inv.client = client; inv.email = email; inv.phone = clean_(d.phone, 40);
      inv.bookingRow = parseInt(d.bookingRow, 10) || inv.bookingRow || 0;
      inv.items = items; inv.discount = cleanDiscount_(d.discount); inv.taxes = cleanTaxes_(d.taxes); recalc_(inv); inv.notes = cleanText_(d.notes, 1000);
      if (isYmd_(d.date)) inv.date = d.date;
      inv.due = isYmd_(d.due) ? d.due : addDays_(inv.date, type === "Estimate" ? CONFIG.ESTIMATE_VALID_DAYS : CONFIG.PAYMENT_DUE_DAYS);
      setPaidStatus_(inv);
      writeInv_(inv);
      try { ensureClient_({ name: inv.client, email: inv.email, phone: inv.phone }); } catch (ce) { console.error("client: " + ce); }
      var sent = false;
      if (d.send) {
        if (!validEmail_(inv.email)) return { ok: false, error: "no_email", row: inv.row, number: inv.number };
        sent = emailInvoice_(inv);
      }
      return { ok: true, row: inv.row, number: inv.number, sent: sent };
    }

    case "admin_inv_remind": {
      var ri = getInv_(d.row);
      if (!ri) return { ok: false, error: "invalid_input" };
      var rres = remindInvoice_(ri);
      return rres === "ok" ? { ok: true } : { ok: false, error: rres === "no_email" ? "no_email" : "invalid_input" };
    }

    case "admin_inv_send": {
      var s = getInv_(d.row);
      if (!s || s.status === "Void") return { ok: false, error: "invalid_input" };
      if (!validEmail_(s.email)) return { ok: false, error: "no_email" };
      emailInvoice_(s);
      return { ok: true };
    }

    case "admin_inv_pay": {
      var p = getInv_(d.row), amt = Math.round((+d.amount) * 100) / 100;
      if (!p || p.type !== "Invoice" || p.status === "Void" || !(amt > 0) || amt > 1e8) return { ok: false, error: "invalid_input" };
      p.payments.push({ date: isYmd_(d.date) ? d.date : todayStr_(), amount: amt, method: cleanText_(d.method, 40) || "bank payment" });
      setPaidStatus_(p);
      writeInv_(p);
      var rsent = false;
      if (d.receipt !== false && validEmail_(p.email)) {
        try { rsent = emailReceipt_(p, p.payments[p.payments.length - 1]); } catch (re) { console.error("receipt: " + re); }
      }
      return { ok: true, receiptSent: rsent };
    }

    case "admin_inv_receipt": {
      var ri = getInv_(d.row), rx = parseInt(d.index, 10);
      if (!ri || ri.type !== "Invoice" || !(rx >= 0 && rx < ri.payments.length)) return { ok: false, error: "invalid_input" };
      // Show the balance as it stood at the end of this payment.
      var upto = 0, k; for (k = 0; k <= rx; k++) upto += +ri.payments[k].amount || 0;
      var snap = JSON.parse(JSON.stringify(ri)); snap.paid = Math.round(upto * 100) / 100;
      snap.status = snap.paid >= snap.total - 0.005 && snap.total > 0 ? "Paid" : "Partial";
      if (d.mode === "email") {
        if (!validEmail_(ri.email)) return { ok: false, error: "no_email" };
        emailReceipt_(snap, ri.payments[rx]);
        return { ok: true };
      }
      var rb = receiptPdf_(snap, ri.payments[rx]);
      return { ok: true, name: rb.getName(), pdf: Utilities.base64Encode(rb.getBytes()) };
    }

    case "admin_inv_unpay": {
      var u = getInv_(d.row), idx = parseInt(d.index, 10);
      if (!u || u.type !== "Invoice" || !(idx >= 0 && idx < u.payments.length)) return { ok: false, error: "invalid_input" };
      u.payments.splice(idx, 1);
      setPaidStatus_(u);
      writeInv_(u);
      return { ok: true };
    }

    case "admin_inv_status": {
      var t = getInv_(d.row);
      var allowed = t && (t.type === "Invoice" ? ["Draft", "Sent", "Void"] : ["Draft", "Sent", "Accepted", "Declined"]);
      if (!t || allowed.indexOf(d.status) < 0) return { ok: false, error: "invalid_input" };
      t.status = d.status;
      if (t.type === "Invoice" && d.status !== "Void") setPaidStatus_(t);
      writeInv_(t);
      return { ok: true };
    }

    case "admin_inv_convert": {
      var e = getInv_(d.row);
      if (!e || e.type !== "Estimate") return { ok: false, error: "invalid_input" };
      var today = todayStr_(), linkRow = e.bookingRow, madeBooking = 0;
      // Optionally create a booking from this estimate, so the invoice (and the estimate) are linked to it.
      if (!linkRow && d.booking && d.booking.date) {
        var bk = createBooking_({ name: e.client, email: e.email, phone: e.phone, date: d.booking.date, time: d.booking.time,
          duration: d.booking.duration, location: d.booking.location || "", notes: "Created from estimate #" + e.number,
          packageName: d.booking.pkg || (e.items[0] && e.items[0].name) || "Session", price: String(e.total), currency: CONFIG.CURRENCY_SYMBOL,
          status: "Confirmed", notifyClient: false, force: d.booking.force === true }, true, me.name);
        if (!bk || !bk.ok) return { ok: false, error: (bk && bk.error) || "booking_failed" };
        linkRow = bk.row; madeBooking = bk.row;
      }
      var ni = writeInv_({ row: 0, number: nextNumber_("Invoice"), type: "Invoice", status: "Draft", date: today, due: addDays_(today, CONFIG.PAYMENT_DUE_DAYS),
        client: e.client, email: e.email, phone: e.phone, bookingRow: linkRow, items: e.items, total: e.total, paid: 0, payments: [], notes: e.notes,
        created: new Date().toISOString(), sent: "", from: e.number, discount: e.discount, taxes: e.taxes });
      e.status = "Accepted"; e.bookingRow = linkRow; writeInv_(e);
      return { ok: true, row: ni.row, number: ni.number, booking: madeBooking };
    }

    case "admin_inv_pdf": {
      var g = getInv_(d.row);
      if (!g) return { ok: false, error: "invalid_input" };
      var blob = invoicePdf_(g);
      return { ok: true, name: blob.getName(), pdf: Utilities.base64Encode(blob.getBytes()) };
    }

    case "admin_inv_delete": {
      var x = getInv_(d.row);
      if (!x || (x.type === "Invoice" && x.status !== "Draft" && x.status !== "Void")) return { ok: false, error: "invalid_input" };
      invSheet_().deleteRow(x.row);
      return { ok: true };
    }

    case "admin_clients": return { ok: true, clients: clientsWithHistory_() };

    case "admin_client_save": {
      var cn = cleanText_(d.name, 100), ce = clean_(d.email, 150);
      if (!cn || (ce && !validEmail_(ce))) return { ok: false, error: "invalid_input" };
      var cs = clientsSheet_(), cr = parseInt(d.row, 10) || 0;
      var rec = { name: cn, email: ce, phone: clean_(d.phone, 40), instagram: clean_(d.instagram, 60), notes: cleanText_(d.notes, 1000) };
      if (cr) {
        if (!(cr >= 2 && cr <= cs.getLastRow())) return { ok: false, error: "invalid_input" };
        var keepCreated = cs.getRange(cr, 6).getValue();
        cs.getRange(cr, 1, 1, 6).setValues([[rec.name, rec.email, rec.phone, rec.instagram, rec.notes, keepCreated || todayStr_()]]);
        return { ok: true, row: cr };
      }
      var dup = readClients_().filter(function (c) { return clientMatch_(c, rec); })[0];
      if (dup) return { ok: false, error: "exists", row: dup.row };
      var nr = Math.max(cs.getLastRow() + 1, 2);
      cs.getRange(nr, 1, 1, 6).setValues([[rec.name, rec.email, rec.phone, rec.instagram, rec.notes, todayStr_()]]);
      return { ok: true, row: nr };
    }

    case "admin_client_delete": {
      var ds = clientsSheet_(), dr = parseInt(d.row, 10);
      if (!(dr >= 2 && dr <= ds.getLastRow())) return { ok: false, error: "invalid_input" };
      ds.deleteRow(dr); // only the client record; their bookings and invoices stay
      return { ok: true };
    }

    case "admin_fee_add": {
      var name = cleanText_(d.name, 100), price = +d.price;
      if (!name || isNaN(price) || price < 0 || price > 1e8) return { ok: false, error: "invalid_input" };
      var fs = feesSheet_(), r = Math.max(fs.getLastRow() + 1, 2);
      fs.getRange(r, 1, 1, 4).setValues([[clean_(name, 100), clean_(d.desc, 200), price, +d.qty > 0 ? Math.min(+d.qty, 1000) : 1]]);
      return { ok: true };
    }

    case "admin_fee_update": {
      var fu = feesSheet_(), ur = parseInt(d.row, 10), un = cleanText_(d.name, 100), up = +d.price;
      if (!(ur >= 2 && ur <= fu.getLastRow()) || !un || isNaN(up) || up < 0 || up > 1e8) return { ok: false, error: "invalid_input" };
      fu.getRange(ur, 1, 1, 4).setValues([[clean_(un, 100), clean_(d.desc, 200), up, +d.qty > 0 ? Math.min(+d.qty, 1000) : 1]]);
      return { ok: true };
    }

    case "admin_tax_add": {
      var tn = cleanText_(d.name, 40), tr_ = +d.rate;
      if (!tn || !(tr_ > 0 && tr_ <= 100)) return { ok: false, error: "invalid_input" };
      var ts = taxesSheet_();
      ts.getRange(Math.max(ts.getLastRow() + 1, 2), 1, 1, 2).setValues([[clean_(tn, 40), tr_]]);
      return { ok: true };
    }

    case "admin_tax_remove": {
      var ts2 = taxesSheet_(), tx = parseInt(d.row, 10);
      if (!(tx >= 2 && tx <= ts2.getLastRow())) return { ok: false, error: "invalid_input" };
      ts2.deleteRow(tx);
      return { ok: true };
    }

    case "admin_fee_remove": {
      var fs2 = feesSheet_(), fr = parseInt(d.row, 10);
      if (!(fr >= 2 && fr <= fs2.getLastRow())) return { ok: false, error: "invalid_input" };
      fs2.deleteRow(fr);
      return { ok: true };
    }
  }
  return { ok: false, error: "unknown_action" };
}

/** Everything the admin app shows: all bookings, hours, days off (with row numbers) and settings. */
/** Sends everything from the last 60 days onwards by default, so the app stays quick as years of bookings pile up. all=true sends the lot. */
function adminList_(all) {
  var sh = getSheet_(), last = sh.getLastRow(), tz = Session.getScriptTimeZone();
  var cutoff = addDays_(todayStr_(), -60), bookings = [];
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, HEADERS.length).getValues().forEach(function (r, i) {
      if (!r[COL.NAME - 1] && !r[COL.DATE - 1]) return;
      var bd = String(r[8]);
      if (!all && /^\d{4}-\d{2}-\d{2}$/.test(bd) && bd < cutoff) return;
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
  return { ok: true, bookings: bookings, truncated: !all, hours: getHours_(), off: off, settings: getSettings_() };
}

/** Emails one client a reminder about their booking. Used by the "Send reminder" button. Returns "ok", "no_email" or "invalid". */
function remindBooking_(row) {
  var sh = getSheet_();
  if (!(row >= 2 && row <= sh.getLastRow())) return "invalid";
  var r = sh.getRange(row, 1, 1, HEADERS.length).getValues()[0];
  var status = String(r[COL.STATUS - 1]), email = String(r[COL.EMAIL - 1] || "");
  if (status === "Cancelled") return "invalid";
  if (!validEmail_(email)) return "no_email";
  var date = String(r[COL.DATE - 1]), today = todayStr_();
  var tomorrow = Utilities.formatDate(new Date(Date.now() + 86400000), Session.getScriptTimeZone(), "yyyy-MM-dd");
  var day = date === today ? "today" : date === tomorrow ? "tomorrow" : "on " + niceDate_(date);
  mail_({
    to: email, replyTo: CONFIG.OWNER_EMAIL, name: CONFIG.BUSINESS_NAME,
    subject: "Reminder: your session " + (day.indexOf("on ") === 0 ? "on " + niceDate_(date) : day) + " – " + CONFIG.BUSINESS_NAME,
    body: "Hi " + String(r[COL.NAME - 1]).split(" ")[0] + ",\n\nA quick reminder about your " + r[COL.PACKAGE - 1] + " " + day + " at " +
      niceTime_(String(r[COL.START - 1])) + (r[12] ? " (" + r[12] + ")" : "") +
      (status === "Pending" ? "\n\nYour booking is still waiting for confirmation." : "") +
      "\n\nReply to this email if you need to change anything.\n\nSee you then!\n– " + CONFIG.BUSINESS_NAME
  });
  return "ok";
}

/** Emails the client a reminder that an invoice is still unpaid (with the invoice attached). */
function remindInvoice_(inv) {
  if (inv.type !== "Invoice" || inv.status === "Paid" || inv.status === "Void") return "invalid";
  var due = Math.max(0, inv.total - inv.paid);
  if (due <= 0.004) return "invalid";
  if (!validEmail_(inv.email)) return "no_email";
  var overdue = inv.due && inv.due < todayStr_();
  mail_({
    to: inv.email, replyTo: CONFIG.OWNER_EMAIL, name: CONFIG.BUSINESS_NAME,
    subject: "Payment reminder: invoice #" + inv.number + " – " + CONFIG.BUSINESS_NAME,
    body: "Hi " + inv.client.split(" ")[0] + ",\n\nA friendly reminder that invoice #" + inv.number + " is still unpaid.\n\nAmount due: " + money_(due) +
      "\nPayment " + (overdue ? "was due: " : "due: ") + fmtDate_(inv.due) + "\n\nThe invoice is attached again for your convenience. If you've already paid, please ignore this message and reply with the details so I can update my records.\n\n– " + CONFIG.BUSINESS_NAME,
    attachments: [invoicePdf_(inv)]
  });
  return "ok";
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
      mail_({
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


/* ================= Instant phone alerts (Firebase Cloud Messaging) =================
 * Setup: see README, "Instant alerts". Needs the script property FCM_SERVICE_ACCOUNT
 * (the whole service-account JSON file from Firebase). Until it is set, nothing is sent and the app falls back
 * to checking every 15 minutes. */
function pushTokens_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty("FCM_TOKENS") || "{}"); } catch (e) { return {}; } }

function pushRegister_(token, who, add) {
  token = String(token || "");
  if (token.length < 20) return { ok: false, error: "bad_token" };
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var t = pushTokens_();
    if (add) t[token] = { who: String(who || ""), at: todayStr_() }; else delete t[token];
    PropertiesService.getScriptProperties().setProperty("FCM_TOKENS", JSON.stringify(t));
  } finally { lock.releaseLock(); }
  return { ok: true, configured: !!PropertiesService.getScriptProperties().getProperty("FCM_SERVICE_ACCOUNT") };
}

function fcmAccessToken_(sa) {
  var cache = CacheService.getScriptCache(), cached = cache.get("fcm_at");
  if (cached) return cached;
  var now = Math.floor(Date.now() / 1000);
  var b64 = function (x) { return Utilities.base64EncodeWebSafe(x).replace(/=+$/, ""); };
  var head = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  var claim = b64(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  var sig = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(head + "." + claim, sa.private_key)).replace(/=+$/, "");
  var r = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", { method: "post", muteHttpExceptions: true,
    payload: { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: head + "." + claim + "." + sig } });
  var j = JSON.parse(r.getContentText());
  if (!j.access_token) throw new Error("FCM auth failed: " + r.getContentText());
  cache.put("fcm_at", j.access_token, 3000);
  return j.access_token;
}

/** Sends a data message to every registered phone. Never throws into the booking flow's caller (callers wrap it). */
function push_(title, body, data) {
  var raw = PropertiesService.getScriptProperties().getProperty("FCM_SERVICE_ACCOUNT");
  if (!raw) return 0;
  var sa = JSON.parse(raw), tokens = pushTokens_(), keys = Object.keys(tokens);
  if (!keys.length) return 0;
  var at = fcmAccessToken_(sa), sent = 0, dead = [];
  var payload = {}; for (var k in (data || {})) payload[k] = String(data[k]);
  payload.title = title; payload.body = body;
  keys.forEach(function (tok) {
    var r = UrlFetchApp.fetch("https://fcm.googleapis.com/v1/projects/" + sa.project_id + "/messages:send", {
      method: "post", contentType: "application/json", muteHttpExceptions: true, headers: { Authorization: "Bearer " + at },
      payload: JSON.stringify({ message: { token: tok, data: payload, android: { priority: "HIGH", ttl: "3600s" } } })
    });
    var code = r.getResponseCode();
    if (code === 200) sent++;
    else if (code === 404 || code === 400) dead.push(tok); // phone uninstalled the app, or token is no longer valid
    else console.error("FCM " + code + ": " + r.getContentText());
  });
  if (dead.length) {
    var t = pushTokens_(); dead.forEach(function (x) { delete t[x]; });
    PropertiesService.getScriptProperties().setProperty("FCM_TOKENS", JSON.stringify(t));
  }
  return sent;
}

/** Run once from the editor (after setup): sends a test alert to every phone that has signed in to the app. */
function testPush() {
  var n = push_("Test alert", "Instant alerts are working.", { type: "test" });
  console.log("Sent to " + n + " phone(s). Registered phones: " + Object.keys(pushTokens_()).length);
}


/* ================= Clients ================= */
var CLIENT_HEADERS = ["Name", "Email", "Phone", "Instagram", "Notes", "Added"];

function clientsSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(TAB_CLIENTS);
  if (sh) return sh;
  sh = ss.insertSheet(TAB_CLIENTS);
  sh.getRange(1, 1, 1, CLIENT_HEADERS.length).setValues([CLIENT_HEADERS]).setFontWeight("bold");
  sh.setFrozenRows(1); sh.setColumnWidth(1, 200); sh.setColumnWidth(2, 220); sh.setColumnWidth(3, 140); sh.setColumnWidth(5, 320);
  return sh;
}

function emailKey_(e) { e = String(e || "").trim().toLowerCase(); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : ""; }
function phoneKey_(p) { var x = String(p || "").replace(/\D/g, ""); return x.length >= 7 ? x.slice(-7) : ""; }
function nameKey_(n) { return String(n || "").trim().toLowerCase().replace(/\s+/g, " "); }

/** Same person? Same email, or same phone number, or (when neither has either) the same name. */
function clientMatch_(c, p) {
  var ce = emailKey_(c.email), pe = emailKey_(p.email);
  if (ce && pe && ce === pe) return true;
  var cp = phoneKey_(c.phone), pp = phoneKey_(p.phone);
  if (cp && pp && cp === pp) return true;
  if (!ce && !pe && !cp && !pp) return nameKey_(p.name) !== "" && nameKey_(c.name) === nameKey_(p.name);
  return false;
}

function readClients_() {
  clientsSheet_();
  return rows_(TAB_CLIENTS, 6).map(function (r, i) {
    return { row: i + 2, name: String(r.d[0]), email: String(r.d[1]), phone: String(r.d[2]), instagram: String(r.d[3]), notes: String(r.d[4]), created: String(r.d[5]) };
  }).filter(function (c) { return c.name; });
}

/** Adds the person to Clients unless they are already there. Returns the client's row. */
function ensureClient_(p) {
  var name = String(p.name || "").trim(); if (!name) return 0;
  var list = readClients_(), hit = list.filter(function (c) { return clientMatch_(c, p); })[0];
  if (hit) {
    // Fill in details we didn't have yet.
    var sh0 = clientsSheet_();
    if (!hit.email && emailKey_(p.email)) sh0.getRange(hit.row, 2).setValue(String(p.email).trim());
    if (!hit.phone && phoneKey_(p.phone)) sh0.getRange(hit.row, 3).setValue(String(p.phone).trim());
    if (!hit.instagram && p.instagram) sh0.getRange(hit.row, 4).setValue(String(p.instagram).trim());
    return hit.row;
  }
  var sh = clientsSheet_(), r = Math.max(sh.getLastRow() + 1, 2);
  sh.getRange(r, 1, 1, 6).setValues([[clean_(name, 100), emailKey_(p.email) ? String(p.email).trim() : "", clean_(p.phone, 40), clean_(p.instagram || "", 60), "", todayStr_()]]);
  return r;
}

/** Every client with their bookings and invoices. Also adds anyone from past bookings or invoices who isn't saved yet. */
function clientsWithHistory_() {
  var bookings = adminList_(true).bookings, invoices = readInv_();
  var clients = readClients_(), added = [];
  function known(p) { return clients.some(function (c) { return clientMatch_(c, p); }) || added.some(function (c) { return clientMatch_(c, p); }); }
  bookings.forEach(function (b) {
    var p = { name: b.name, email: b.email, phone: b.phone, instagram: b.instagram };
    if (p.name && !known(p)) added.push({ name: p.name, email: emailKey_(p.email) ? p.email : "", phone: p.phone || "", instagram: p.instagram || "", notes: "", created: todayStr_() });
  });
  invoices.forEach(function (i) {
    var p = { name: i.client, email: i.email, phone: i.phone };
    if (p.name && !known(p)) added.push({ name: p.name, email: emailKey_(p.email) ? p.email : "", phone: p.phone || "", instagram: "", notes: "", created: todayStr_() });
  });
  if (added.length) {
    var sh = clientsSheet_(), start = Math.max(sh.getLastRow() + 1, 2);
    sh.getRange(start, 1, added.length, 6).setValues(added.map(function (c) { return [clean_(c.name, 100), c.email, clean_(c.phone, 40), clean_(c.instagram, 60), "", c.created]; }));
    added.forEach(function (c, k) { c.row = start + k; });
    clients = clients.concat(added);
  }
  return clients.map(function (c) {
    var bk = bookings.filter(function (b) { return clientMatch_(c, { name: b.name, email: b.email, phone: b.phone }); })
      .map(function (b) { return { row: b.row, date: b.date, start: b.start, pkg: b.pkg, status: b.status, price: b.price }; })
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    var iv = invoices.filter(function (i) { return clientMatch_(c, { name: i.client, email: i.email, phone: i.phone }); })
      .map(function (i) { return { row: i.row, number: i.number, type: i.type, status: i.status, date: i.date, total: i.total, paid: i.paid }; })
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.number - a.number; });
    var billed = 0, paid = 0;
    iv.forEach(function (i) { if (i.type === "Invoice" && i.status !== "Void") { billed += i.total; paid += i.paid; } });
    c.bookings = bk; c.invoices = iv;
    c.billed = Math.round(billed * 100) / 100; c.paid = Math.round(paid * 100) / 100; c.owing = Math.round((billed - paid) * 100) / 100;
    return c;
  }).sort(function (a, b) { return nameKey_(a.name) < nameKey_(b.name) ? -1 : 1; });
}

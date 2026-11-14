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

var TAB = { AVAIL: "Availability", OFF: "Time off", SETTINGS: "Settings" };
var DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

var HEADERS = ["Timestamp", "Status", "Name", "Email", "Phone", "Instagram", "Package", "Price",
               "Date", "Start", "End", "Duration (min)", "Location", "Notes", "Source", "Event ID"];
// Column numbers (1-based)
var COL = { STATUS: 2, NAME: 3, EMAIL: 4, PACKAGE: 7, DATE: 9, START: 10, END: 11, EVENT: 16 };

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
  var bounds = { slotInterval: [5, 240], bufferMinutes: [0, 480], minNoticeHours: [0, 720], maxDaysAhead: [1, 365] };
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

    var name = clean_(d.firstName && d.lastName ? d.firstName + " " + d.lastName : d.name, 100), email = clean_(d.email, 150), phone = clean_(d.phone, 40);
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !phone) return json_({ ok: false, error: "invalid_input" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !/^\d{2}:\d{2}$/.test(d.time)) return json_({ ok: false, error: "invalid_input" });
    var duration = Math.max(15, Math.min(720, parseInt(d.duration, 10) || 60));

    var start = toMin_(d.time), end = start + duration;
    var buf = getSettings_().bufferMinutes;

    // The time must be inside your opening hours and not blocked off in "Time off".
    var dp = d.date.split("-");
    var dow = new Date(+dp[0], +dp[1] - 1, +dp[2]).getDay();
    var inHours = (getHours_()[dow] || []).some(function (w) { return start >= toMin_(w[0]) && end <= toMin_(w[1]); });
    var blocked = getBlocked_().some(function (b) {
      return b.date === d.date && (!b.start || (start < toMin_(b.end) && end > toMin_(b.start)));
    });
    if (!inHours || blocked) return json_({ ok: false, error: "slot_unavailable" });

    // And it must not overlap another booking (plus the buffer).
    var clash = busySlots_().some(function (b) {
      return b.date === d.date && start < toMin_(b.end) + buf && end + buf > toMin_(b.start);
    });
    if (clash) return json_({ ok: false, error: "slot_taken" });

    var sh = getSheet_();
    var row = [new Date(), "Pending", name, email, phone, clean_(d.instagram, 60), clean_(d.packageName, 80),
               clean_(d.currency, 5) + clean_(d.price, 12), d.date, d.time, fromMin_(end), duration,
               clean_(d.location, 200), clean_(d.notes, 1000), clean_(d.source, 40), ""];
    sh.appendRow(row);
    var r = sh.getLastRow();
    [COL.DATE, COL.START, COL.END].forEach(function (c) { sh.getRange(r, c).setNumberFormat("@").setValue(row[c - 1]); });

    // Google Calendar event with reminders
    try {
      var cal = getCalendar_();
      if (cal) {
        var s = new Date(+dp[0], +dp[1] - 1, +dp[2], Math.floor(start / 60), start % 60);
        var en = new Date(s.getTime() + duration * 60000);
        var ev = cal.createEvent("[Pending] " + row[6] + " – " + name, s, en, {
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

    var when = d.date + " at " + niceTime_(d.time) + " (" + duration + " min)";
    try {
      MailApp.sendEmail({
        to: CONFIG.OWNER_EMAIL,
        replyTo: email,
        subject: "New booking request: " + row[6] + " – " + when,
        body: "New booking request\n\nPackage: " + row[6] + " (" + row[7] + ")\nWhen: " + when +
          "\nName: " + name + "\nEmail: " + email + "\nPhone: " + phone +
          "\nInstagram: " + row[5] + "\nLocation: " + row[12] + "\nNotes: " + row[13] +
          "\nSource: " + (row[14] || "website") + "\n\nOpen the sheet to confirm or cancel."
      });
      if (CONFIG.SEND_CLIENT_EMAIL) {
        MailApp.sendEmail({
          to: email,
          replyTo: CONFIG.OWNER_EMAIL,
          name: CONFIG.BUSINESS_NAME,
          subject: "We got your booking request – " + CONFIG.BUSINESS_NAME,
          body: "Hi " + name.split(" ")[0] + ",\n\nThanks for booking! Here's what we received:\n\n" +
            row[6] + "\n" + when + "\n\nWe'll confirm your session shortly. Reply to this email if anything needs to change.\n\n– " + CONFIG.BUSINESS_NAME
        });
      }
    } catch (mailErr) { console.error("Mail error: " + mailErr); }

    return json_({ ok: true });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: "server_error" });
  } finally {
    try { lock.releaseLock(); } catch (x) { /* ignore */ }
  }
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
    var cal = getCalendar_();
    if (!cal) return;
    var row = e.range.getRow();
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
  } catch (err) { console.error("onStatusEdit: " + err); }
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

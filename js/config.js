/*
 * EDIT THIS FILE to customise your booking app. No other file needs changing.
 */
window.BOOKING_CONFIG = {
  businessName: "Your Studio Name",
  tagline: "Portraits, weddings, events & brand photography",
  fontFamily: "Raleway",           // any Google Font name; can be overridden with ?font=Name in the URL
  accent: "#3a4046",              // main brand colour (dark grey). Can be overridden with ?accent=hex in the URL
  accentDark: "#c5ccd1",          // accent used when the visitor's device is in dark mode (a dark accent would be invisible on a dark background)

  // Instagram (no @). Leave "" to hide Instagram features.
  instagramHandle: "yourhandle",
  // Optional: public post URLs to show in a "Recent work" section.
  // e.g. "https://www.instagram.com/p/ABC123/"
  instagramPosts: [],

  // Where bookings go. Paste your Google Apps Script web-app URL here (see README).
  // While empty, the app runs in "no backend" mode: it opens an email / Instagram DM with the details instead.
  endpoint: "",
  ownerEmail: "you@example.com",  // used by the no-backend fallback

  currency: "J$",
  timezoneLabel: "Jamaica time (EST)",
  timezone: "America/Jamaica",     // used for the "Add to Google Calendar" button
  locale: "en-US",

  // Packages clients can choose from. duration is in minutes.
  packages: [
    {
      id: "bronze",
      name: "Bronze",
      price: 15000,
      duration: 30,
      features: ["30 minutes", "10 retouched images", "1 outfit", "1 location (within the corporate area)"]
    },
    {
      id: "silver",
      name: "Silver",
      price: 22000,
      duration: 60,
      features: ["1 hour", "15 retouched images", "2 outfits", "1 location (within the corporate area)"]
    },
    {
      id: "gold",
      name: "Gold",
      price: 37000,
      duration: 120,
      features: ["2 hours", "25 retouched images", "2 outfits", "2 locations (within the corporate area)"]
    },
    {
      id: "headshot",
      name: "Professional Headshot",
      price: 7500,
      duration: 20,
      features: ["20 minutes", "5 retouched images", "1 outfit", "1 studio setup"]
    }
  ],

  // AVAILABILITY: once the Google Sheet is connected (endpoint above), your hours, days off, slot
  // interval, buffer, minimum notice and booking window come from the Sheet's "Availability",
  // "Time off" and "Settings" tabs. The values below are only fallbacks, used when no backend
  // is connected or the Sheet can't be reached.
  // Weekly availability. 0 = Sunday ... 6 = Saturday. null = closed.
  workingHours: {
    0: null,
    1: ["09:00", "17:00"],
    2: ["09:00", "17:00"],
    3: ["09:00", "17:00"],
    4: ["09:00", "17:00"],
    5: ["09:00", "17:00"],
    6: ["08:00", "14:00"]
  },
  slotInterval: 30,        // minutes between possible start times
  bufferMinutes: 30,       // gap kept between bookings (travel / reset)
  minNoticeHours: 24,      // earliest a client can book from now
  maxDaysAhead: 90,
  blackoutDates: [],       // e.g. ["2026-12-25", "2026-12-26"]

  footerText: ""           // optional small print under the form
};

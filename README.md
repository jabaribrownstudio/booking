# Photography Booking App

A static booking page you can host free on **GitHub Pages**, embed in **WordPress**, and share on **Instagram**.
Bookings are saved to a **Google Sheet** (free) and you get an email for each one. Double-bookings are blocked.

```
index.html          the app
css/styles.css      look and feel
js/config.js        YOUR SETTINGS (name, packages, Instagram, backend URL)
js/app.js           app logic
apps-script/Code.gs backend (paste into Google Apps Script)
```

## What clients see

- A three-step progress bar they can click back through, and package cards with the price, duration and what is included.
- "Soonest available" shortcuts, a month calendar that only enables days with free times, and times grouped into morning, afternoon and evening. Only the times you set as available are offered, and a time someone has already booked (plus your buffer) disappears for the next client.
- A live summary of their booking (beside the form on desktop, in a floating bar on phones).
- Checks on the form as they type, a loading state while the booking is sent, and a confirmation screen with an **Add to Google Calendar** button.
- Light and dark mode, following the visitor's device.

---

## Step 1 – Backend (Google Sheet + email), ~5 minutes

1. Create a new Google Sheet (name it "Bookings").
2. **Extensions → Apps Script**. Delete the sample code and paste in everything from `apps-script/Code.gs`.
3. Edit the `CONFIG` block at the top: your email and studio name. (Your opening hours are not here. You set them in the Sheet, see "Setting your available times" below.) Google Calendar is on by default (`CALENDAR_ID: "primary"`). See "Google Calendar reminders" below to change reminders.
4. In Apps Script **Project Settings**, set the time zone to yours (e.g. America/Jamaica).
5. Choose the function `setup` and click **Run**. Approve the permissions. This creates four tabs in your Sheet: **Bookings**, **Availability**, **Time off** and **Settings**.
6. **Deploy → New deployment → Web app**. Execute as: **Me**. Who has access: **Anyone**. Click Deploy and copy the **Web app URL**.
7. Open `js/config.js` and paste that URL into `endpoint`.

> **Updating an older install?** Paste the new `Code.gs`, run `setup` once (it adds the new tabs and never overwrites your data), then create a new version of the deployment.
>
> If you change `Code.gs` later, use **Deploy → Manage deployments → Edit → New version**, otherwise the live URL keeps the old code.

## Setting your available times

Open your Google Sheet. Changes are live straight away, with nothing to publish.

- **Availability tab** – your weekly hours. One row per period you are open: pick the day, type Open and Close (for example `9:00 AM` and `5:00 PM`). Closed for lunch? Add two rows for that day. A day with no rows is closed.
- **Time off tab** – days off and blocked time. Put the date in **Date**; for several days, add the last day in **Through**. Leave **From** and **To** empty to block the whole day, or fill them in to block part of a day (for example 12:00 PM to 3:00 PM).
- **Settings tab** – slot interval (how often start times are offered), buffer between sessions, minimum notice, and how many days ahead clients can book.

Booked times are removed automatically: a Pending or Confirmed booking, plus your buffer, can't be picked by another client. Set a booking to **Cancelled** to free the time again. If a time becomes unavailable while a client is filling in the form, the server refuses it and asks them to choose another.

The hours in `js/config.js` are only a fallback for when no backend is connected.

## Google Calendar reminders

Every booking creates an event in your Google Calendar (titled `[Pending] Package – Name`) with reminders you set in `CONFIG`:

- `POPUP_REMINDERS: [1440, 60]` = notification 1 day and 1 hour before.
- `EMAIL_REMINDERS: [1440]` = email reminder 1 day before.
- `CALENDAR_ID`: `"primary"` for your main calendar, a calendar ID for a separate one, or `""` to turn it off.
- Change a row's Status in the sheet and the event follows: Confirmed updates the title, Cancelled deletes the event.
- `INVITE_CLIENT_ON_CONFIRM: true` adds the client as a guest when you confirm (Google emails them an invite).
- `CLIENT_REMINDER_EMAIL: true` emails the client the day before a Confirmed session.

Run `setup` again after any change to install the triggers. When you update `Code.gs`, also redeploy: **Deploy → Manage deployments → Edit → New version**.

In the sheet, change a row's **Status** to `Confirmed` or `Cancelled`. Cancelled rows free the time slot again.

## Step 2 – Customise

Edit `js/config.js`: business name, accent colour, packages and prices, Instagram handle. (Hours, days off and buffer live in your Sheet.)

## Step 3 – Host on GitHub

1. Create a new GitHub repository (e.g. `booking`) and upload all these files (keep the folders).
2. **Settings → Pages → Build and deployment → Deploy from a branch → `main` / root → Save.**
3. After a minute your app is live at `https://YOUR-USERNAME.github.io/booking/`.

## Step 4 – Add it to WordPress

**Easiest:** create a page called "Book Now", add a **Custom HTML** block and paste:

```html
<iframe id="booking-frame" style="display:block;width:100%;max-width:100%;border:0;min-height:600px" title="Book a session"></iframe>
<script>
  var f = document.getElementById("booking-frame");
  var extra = location.search.replace(/^\?/, "");
  f.src = "https://YOUR-USERNAME.github.io/booking/?embed=1" + (extra ? "&" + extra : "");
  window.addEventListener("message", function (e) {
    if (e.origin !== "https://YOUR-USERNAME.github.io") return;
    if (e.data && e.data.type === "booking-resize") f.style.height = e.data.height + "px";
    if (e.data && e.data.type === "booking-step") f.scrollIntoView({ behavior: "smooth", block: "start" });
  });
</script>
```

The frame grows and shrinks automatically, so there are no inner scrollbars, and on phones it scrolls back to the top of the booking form each time the client moves to the next step.

**Mobile:** the layout adapts to the width of the frame, so it works on phones inside WordPress. Packages go 4 across, then 2, then 1. On phones the date and time step has a floating bar at the bottom with your choice and the Continue button, so it is always in reach. Tap targets are at least 44px, and form fields are 16px so iPhones don't zoom in. Make sure the WordPress page itself isn't set to a narrow fixed-width container (use full width or a normal content width).


### Book buttons on your services page

The code above passes anything after the `?` on your Book Now page address into the booking app. So a button on your services page can link to the Book Now page with a package name, and the visitor lands on the date and time step with that package already selected:

| Package | Button link (replace `yoursite.com` and the page name) |
|---|---|
| Bronze | `https://yoursite.com/book-now/?package=bronze&ref=services` |
| Silver | `https://yoursite.com/book-now/?package=silver&ref=services` |
| Gold | `https://yoursite.com/book-now/?package=gold&ref=services` |
| Professional Headshot | `https://yoursite.com/book-now/?package=headshot&ref=services` |

In WordPress, click the button on your services page, choose the link icon, and paste the address for that package. `ref=services` is optional. It fills the Source column in your sheet so you can see which bookings came from the services page. The package names (`bronze`, `silver`, `gold`, `headshot`) are the `id` values in `js/config.js`. If you rename or add a package, use its `id`.

**URL options** (add to the `src`):

| Option | Example | Effect |
|---|---|---|
| `embed=1` | `?embed=1` | Hides the big header and uses a transparent background |
| `accent=hex` | `&accent=2a7de1` | Match your WordPress theme colour |
| `theme=dark` / `light` | `&theme=dark` | Force a theme |
| `font=Name` | `&font=Poppins` | Use another Google Font (default is Raleway, set in `config.js`) |
| `package=id` | `&package=silver` | Jump straight to date picking for that package |
| `ref=name` | `&ref=instagram` | Tags the booking's Source column |

If your WordPress theme blocks iframes, use the "Custom HTML" block (not the classic editor) or a plugin such as "Iframe". Some themes/security plugins need `github.io` allowed in their frame settings.

## Step 5 – Instagram

- **Link in bio:** use `https://YOUR-USERNAME.github.io/booking/?ref=instagram`. Bookings from it are tagged "instagram" in your sheet.
- **Per-package links** for stories/posts: `.../booking/?package=silver&ref=instagram`.
- **Follow button + DM:** set `instagramHandle` in `config.js`. The header shows a follow link, and the confirmation screen offers "Message me on Instagram" (opens `ig.me/m/yourhandle`, with the booking details copied to the clipboard to paste).
- **Show your work:** paste public post/reel URLs into `instagramPosts` in `config.js`; they show up in a "Recent work" section using Instagram's official embed. (Instagram's automatic feed needs an approved Meta app and access token, which can't be kept secret on a static site, so this app uses the URL list instead.)

## Notes

- **No backend yet?** Leave `endpoint` empty and the app still works in fallback mode: it hands the details over by email or Instagram DM instead of saving them.
- **Spam:** includes a hidden honeypot field. For more, add Cloudflare Turnstile or reCAPTCHA later.
- **Payments/deposits:** not included. Easiest add-on: put a PayPal.me or Stripe Payment Link in the confirmation email in `Code.gs`.
- The Apps Script web app URL is public by design (anyone can send a booking). The `booked` endpoint only exposes dates and times, never client details.
- Gmail's free sending quota is about 100 emails/day via Apps Script, which is plenty for bookings.

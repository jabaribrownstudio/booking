# Cloudflare sign-in for the admin app

This Worker adds real **username + password** accounts to the admin app, with roles, instead of the single typed key.

```
Phone / computer  ->  Cloudflare Worker (checks the password and role)  ->  your Google Apps Script  ->  your Sheet
```

- Passwords are scrambled in the browser (PBKDF2, SHA-256, 150,000 rounds). The password itself is never sent anywhere.
- The Worker is the only thing that knows the secret for your Apps Script, and it only forwards what that person's role allows. Hiding buttons in the page is cosmetic.
- Roles: **Owner** (everything, plus the Team tab), **Manager** (bookings, availability, settings), **Staff** (bookings only).
- Wrong passwords: 5 wrong tries lock that account for 1 minute, then 2, 4, 8 minutes and so on up to 1 hour. Too many failures from one network are blocked for 10 minutes.
- Users are kept in Cloudflare KV. The browser never receives anyone's hash or salt.
- The admin app signs out after 30 idle minutes (`sessionMinutes` in `js/config.js`). The password hash is kept in memory only, so closing and reopening the app means signing in again.

Everything here fits in Cloudflare's free plan.

## Set it up (about 15 minutes, in the Cloudflare dashboard)

Menu names move around a little over time, but the steps stay the same.

**1. Make an account.** Go to dash.cloudflare.com and sign up (free).

**2. Make a KV store.** Storage & Databases, then **KV**, then **Create**. Name it `booking-users`.

**3. Make the Worker.** Workers & Pages, then **Create**, then **Create Worker**. Name it `booking-auth` and click **Deploy**. Then click **Edit code**, delete everything in the editor, paste in all of `worker/worker.js` from this repo, and click **Deploy**.

**4. Connect the KV store.** Open the Worker, go to **Settings**, then **Bindings**, then **Add**, then **KV namespace**. Variable name: `USERS` (exactly, capital letters). Namespace: `booking-users`. Save.

**5. Add the settings.** In the Worker's **Settings**, **Variables and secrets**, add:

| Name | Type | Value |
|---|---|---|
| `APPS_SCRIPT_URL` | Text | Your Apps Script Web app URL (the one ending in `/exec`) |
| `ALLOWED_ORIGIN` | Text | `https://jabaribrownstudio.github.io` (no slash and no path at the end) |
| `APPS_SCRIPT_KEY` | **Secret** | A long random secret you make up, 30+ letters and numbers |
| `SETUP_CODE` | **Secret** | Another secret phrase. You type it once, when you create the owner account |

Click **Deploy** after saving.

**6. Tell Apps Script the same secret.** In Apps Script, open `Code.gs`, paste in the newest version, and set `ADMIN_KEY` to **exactly the same value** as `APPS_SCRIPT_KEY` above. Then Deploy, Manage deployments, the pencil icon, Version: New version, Deploy.

**7. Point the admin app at the Worker.** Your Worker address is shown on its page, like `https://booking-auth.YOURNAME.workers.dev`. In `js/config.js` on GitHub, set:

```js
authWorker: "https://booking-auth.YOURNAME.workers.dev",
```

Commit the change.

**8. Create the owner account.** Open `https://jabaribrownstudio.github.io/booking/admin/`. Because nobody exists yet, you'll see **Create owner account**. Enter the `SETUP_CODE`, your name, a username and a password (10+ characters). You'll then be shown a **recovery code**. Write it down and keep it safe. It is the only way back in if you forget your password, and it is shown once.

**9. Add your team.** Open the **Team** tab, enter a name, username and role, and tap **Create account**. You'll see a username and a temporary password once. Tap **Copy invitation message** and send it privately. They'll choose their own password the first time they sign in.

## Day to day

- **Forgot password (staff):** Team tab, **Reset password**. They get a new temporary password.
- **Forgot password (owner):** on the sign-in page tap **Forgot your password?** and use the recovery code. You'll get a new recovery code.
- **Someone leaves:** Team tab, **Lock out** (reversible) or **Remove**.
- **Change your own password:** the key icon at the top of the app.

## Good to know

- Cloudflare KV can take up to about a minute to show a change in every location. For one studio, changes such as a lock-out are normally instant.
- Once the Worker is working, nobody needs `ADMIN_KEY` except the Worker. Keep it long and secret. The old typed-key sign-in is not offered while `authWorker` is set.
- The public booking page doesn't use the Worker. Clients keep booking as before.
- To go back to the simple key sign-in, set `authWorker: ""`.

# Chitkara Memories 🌌

A private 3D "memory galaxy" for our **BBA · Digital Science & Business Management** class at Chitkara University.
Every photo floats as a polaroid. Only approved classmates can get in.

## What's inside

**The galaxy**
- 3D shard-logo intro, plus a live 3D metallic logo in the top-left corner
- 6 layouts: Galaxy, Helix, Sphere, **Albums** (each trip/event is its own cluster), Wall, Timeline (keys `1`–`6`)
- Year filters, search (`/`), gallery view grouped by year or album
- **Story mode** (space bar) and the **Farewell film**: fullscreen, a title card per year, built-in soundtrack or your own song

**Memories**
- Upload up to 10 photos at once with caption, year, moment, **album**, and **friend tags linked to real accounts**
- Hearts, **emoji reactions** (😂 🔥 💀 🥹 😍 👏) and **comments**
- **Memory of the day / On this day** card when you open the site
- A nudge for people who haven't added a memory yet

**Our batch** (book icon, top right)
- **Yearbook**: a page for everyone with nickname, quote, "most likely to…", Instagram, and every memory they're tagged in
- **Leaderboard**: memory makers, crowd favourites, always in the frame, reaction magnets, most loved photos
- **Time capsule**: letters to future you (private) or to the batch, sealed until unlock day (default 1 May 2029)

**Safety**
- Only `@chitkara.edu.in` Google accounts can sign in. Other emails are removed instantly.
- **On top of that, everyone must be approved.** New people send a request with a note; an admin approves or denies it.
  Approved people get an email and then log in normally.
- Admins can **pre-approve** a list of classmate emails, so they never have to wait.
- Downloads carry a small **"saved by [name]" watermark** and are logged. Right-click / long-press saving is blocked.
- **Report** button on every photo. **Ban** and **remove access** from the admin panel.
- All of this is enforced by `firestore.rules` on Google's servers, not just hidden in the page.

**Admin panel** (shield button, admins only)
Overview · **Access** (requests, pre-approve, decided) · Users · Activity (every sign-in, upload, download, like,
comment, report, delete, with device; export CSV) · Photos · Reports · **Share** (site link, WhatsApp message, QR poster)

**Install as app**: on Android/desktop Chrome an install button appears in the top bar. On iPhone: Share → Add to Home Screen.

---

## Files

```
index.html             page layout
css/style.css          all styling
js/config.js           ← settings you edit
js/app.js              main UI
js/scene.js            the 3D galaxy + intro
js/logo3d.js           top-left metallic logo
js/store.js            Firebase login, database, approvals
js/admin.js            admin panel
js/batch.js            yearbook, leaderboard, time capsule
js/film.js             farewell film music
js/share.js            QR poster + WhatsApp message
firestore.rules        security rules to paste into Firebase
manifest.webmanifest, sw.js, icons/   install-as-app
```

## Updating your live site

1. Upload **all** files to the GitHub repo (replace the old ones; keep the folders).
2. Firebase → Firestore Database → **Rules** → paste all of `firestore.rules` → **Publish**.
3. Hard refresh the site (Ctrl + Shift + R).

## Who gets in

Set in **two places that must match**:

| Want | `js/config.js` | `firestore.rules` |
|---|---|---|
| Everyone requests access (default, safest) | `AUTO_APPROVE_SUFFIX = ""` | `autoApproveRegex()` returns `''` |
| Whole `bbadsbm26` batch gets in automatically | `AUTO_APPROVE_SUFFIX = ".bbadsbm26@chitkara.edu.in"` | `autoApproveRegex()` returns `'.*[.]bbadsbm26@chitkara[.]edu[.]in$'` |

Admins are listed in `ADMIN_EMAILS` (config.js) and `isAdmin()` (rules). Admins can also sign in with a non-Chitkara
email using the small **Admin sign-in** link.

## Approval emails (optional, free, ~5 minutes)

Without this, clicking **Approve** opens your own email app with the message already written; just press send.
To send automatically:

1. Sign up at <https://www.emailjs.com> (free plan).
2. **Email Services → Add service → Gmail** → connect the Gmail you want to send from.
3. **Email Templates → Create template**:
   - To email: `{{to_email}}`
   - Subject: `You're in! {{site_name}} access approved`
   - Body: `Hi {{to_name}}, your request was approved 🎉 Open {{site_url}} and sign in with your Chitkara email.`
4. **Account → General**: copy your **Public key**. Copy the **Service ID** and **Template ID** too.
5. Put the three values in `EMAILJS` in `js/config.js`.

## First-time Firebase setup (already done)

Authentication → Google enabled · Firestore created · rules published · `kiratveersinghralhan-hue.github.io` added to
Authentication → Settings → Authorized domains.

## Limits and good to know

- Free Firestore plan: 50,000 reads and 20,000 writes per day. Each visit reads the newest 250 memories
  (`MAX_PHOTOS`) plus profiles, so roughly 150–200 visits a day. Lower `MAX_PHOTOS` if the whole batch is on at once.
- Download tracking covers the Download button. It can't see screenshots.
- iPhone HEIC photos: iPhone Settings → Camera → Formats → **Most Compatible**.
- The time capsule unlock date is in `CAPSULE_UNLOCK` (config.js) **and** `timestamp.date(2029, 5, 1)` in the rules.
- Run locally: `python -m http.server 8000`, then open <http://localhost:8000>.

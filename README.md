# Chitkara Memories 🌌

A 3D "memory galaxy" for the **BBA · Digital Science & Business Management** batch at Chitkara University.
Every photo becomes a floating polaroid. Students sign in with their college Google account, upload photos
with friends, tag people, heart memories, and explore everything in 3D.

- **5 interactive 3D layouts** — Galaxy, Helix, Sphere, Wall, Timeline (keys `1`–`5`)
- **Year filters** — 1st Year, 2nd Year, 3rd Year, Farewell (rename them in `js/config.js`)
- **Click a polaroid** → camera flies to it → full-size view with caption, tagged friends, hearts, download, share link
- **Tag friends** — click a tag to see every memory with that person
- **Search** (press `/`) by name, caption, moment
- **Gallery view** — a normal photo grid, for phones and quick browsing
- **College-only uploads** — only `@chitkara.edu.in` Google accounts can add photos (enforced by security rules, not just the UI)
- **Demo mode** — works with sample photos until you add Firebase keys
- Runs 100% free: GitHub Pages + Firebase Spark (free) plan, optional free Cloudinary

---

## Project structure

```
index.html          page layout
css/style.css       all styling
js/config.js        ← the only file you need to edit
js/app.js           buttons, filters, upload, lightbox, gallery
js/scene.js         the Three.js 3D world
js/store.js         Firebase login + database (and demo mode)
firestore.rules     security rules to paste into Firebase
```

---

## Step 1 — Firebase (free Spark plan, ~10 min)

1. Go to <https://console.firebase.google.com> → **Add project** → name it `chitkara-memories` → you can turn off Google Analytics.
2. **Build → Authentication → Get started → Sign-in method → Google → Enable** → pick a support email → Save.
3. **Build → Firestore Database → Create database** → choose a location (`asia-south1` Mumbai is closest) → start in **production mode**.
4. Open the **Rules** tab, delete what's there, paste everything from `firestore.rules`, click **Publish**.
   - Add your own email inside `isAdmin()` if you want to be able to delete anyone's photo.
5. **Project settings (⚙️) → General → Your apps → Web `</>`** → register app → copy the `firebaseConfig` values into `FIREBASE_CONFIG` in `js/config.js`.
   (These keys are safe to be public — the security rules are what protect your data.)
6. Also add your email to `ADMIN_EMAILS` in `js/config.js` so the Delete button shows for you.

> **Why no Firebase Storage?** Firebase Storage now requires the paid Blaze plan, so this project doesn't use it.
> Photos are saved either inside Firestore (compressed, free) or on Cloudinary (full quality, free) — see Step 2.

## Step 2 — Photo storage (pick one)

**Option A — do nothing (simplest).** Photos are compressed (~1400px) and saved inside Firestore: a tiny
thumbnail for the 3D galaxy plus the full photo, which only downloads when someone opens it.
The free plan gives 1 GB, roughly 2,000–4,000 photos. Fine for one batch.

**Option B — Cloudinary (recommended for full quality).** Free tier = 25 GB.
1. Sign up at <https://cloudinary.com> (free).
2. **Settings → Upload → Upload presets → Add upload preset** → Signing mode: **Unsigned** → (optional) folder `chitkara-memories` → Save.
3. Put your **cloud name** and the **preset name** into `CLOUDINARY` in `js/config.js`.

## Step 3 — Host on GitHub Pages

1. Create a new **public** repository on GitHub, e.g. `chitkara-memories`.
2. Upload all the files (keep the folders), or with git:
   ```bash
   git init
   git add .
   git commit -m "Chitkara Memories"
   git branch -M main
   git remote add origin https://github.com/<your-username>/chitkara-memories.git
   git push -u origin main
   ```
3. Repo **Settings → Pages → Source: Deploy from a branch → main / (root) → Save**.
4. After ~1 minute the site is live at `https://<your-username>.github.io/chitkara-memories/`.
5. **Important:** back in Firebase → **Authentication → Settings → Authorized domains → Add domain** → `<your-username>.github.io`.
   Without this, Google sign-in shows an "unauthorized domain" error.

## Step 4 — Test it

- Open the site → Sign in with your `@chitkara.edu.in` account → **Add memory** → upload a photo.
- Open it on a second device: the photo appears live, no refresh needed.
- Share the link in the batch group 🎉

---

## Customising

| What | Where |
|---|---|
| Site name, subtitle, text on the 3D core | `SITE` in `js/config.js` |
| Year names / adding "4th year" | `YEARS` in `js/config.js` **and** the `year in [...]` list in `firestore.rules` |
| "Moment" options (Fest, Trip…) | `EVENTS` in `js/config.js` |
| Allow any Google account | `ALLOWED_EMAIL_DOMAIN = ""` and simplify `isStudent()` in the rules |
| Colours | CSS variables at the top of `css/style.css` |

**Run locally:** the site uses ES modules, so open it through a local server instead of double-clicking:
`python -m http.server 8000` then visit <http://localhost:8000>. (Add `localhost` to Firebase authorized domains — it's there by default.)

## Good to know

- Check the college email format: rules assume `something@chitkara.edu.in`. If student emails use a different domain, change it in both `config.js` and `firestore.rules`.
- iPhone HEIC photos may not load in some browsers — iPhone Settings → Camera → Formats → **Most Compatible** fixes it.
- Deleting a memory removes it from the site; with Cloudinary the file itself stays in your Cloudinary media library.
- The site loads the newest 250 memories (`MAX_PHOTOS`). Each visit costs about that many Firestore reads, and the free
  plan allows 50,000 reads/day — roughly 200 visits a day. If the whole batch is on it at once (farewell week!),
  lower `MAX_PHOTOS` or upgrade to Blaze (pay-as-you-go, still very cheap at this scale).
- Cloudinary (Option B) also saves Firestore bandwidth, since photos are served from Cloudinary's CDN.

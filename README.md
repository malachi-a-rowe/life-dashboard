# Life Dashboard

A self-contained personal dashboard — habits, goals, AFSPECWAR fitness tracking, and finance — that installs as an app on your phone and desktop.

This folder is a complete, installable **Progressive Web App (PWA)**. Everything runs in the browser; your data lives in the browser's local storage on each device.

---

## Deploy it to GitHub Pages (~5 minutes)

You only do steps 1–4 once. After that, updating the app is just "commit and push."

### 1. Create the repository
1. Go to <https://github.com/new>
2. Name it something like `life-dashboard`
3. Set it to **Private** (your seeded data is in here) or Public — either works for Pages
4. **Don't** check "add a README" (this folder already has one)
5. Click **Create repository**

### 2. Push this folder up
On your Windows machine, open a terminal **in this folder** and run:

```bash
git init
git add .
git commit -m "Initial dashboard"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/life-dashboard.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username.

### 3. Turn on Pages
1. In the repo on GitHub, go to **Settings → Pages**
2. Under **Build and deployment → Source**, choose **GitHub Actions**
3. That's it — the included workflow (`.github/workflows/deploy.yml`) takes over

### 4. Watch it deploy
1. Go to the **Actions** tab in your repo
2. You'll see the "Deploy to GitHub Pages" job running
3. When it's green, your app is live at:

```
https://YOUR_USERNAME.github.io/life-dashboard/
```

---

## Install it on your phone
1. Open that URL in **Chrome** on your Pixel
2. Tap the **⋮** menu → **Add to Home screen** → **Install**
3. It now has its own icon and opens fullscreen, like any app — and works offline

## Install it on your desktop
1. Open the same URL in Chrome
2. Click the **install icon** in the address bar (a monitor with a down-arrow)
3. It opens in its own window

---

## Updating the app (this is the "sync from desktop" part)
Whenever you change anything:

```bash
git add .
git commit -m "what you changed"
git push
```

The Action redeploys automatically. Your phone picks up the new version next time you open it.

> **Note:** Pushing code updates the *app*. Your *data* now syncs separately through Supabase (see below).

---

## Cloud sync (Supabase)
Sync is built in. Your data lives locally on each device **and** backs up to your private Supabase row, so it travels between phone and desktop.

**To use it:** open the app, tap the **cloud chip** (top-right of the dashboard) or **Sync** in the sidebar, and sign in with the email + password you created in Supabase. Do this once on each device.

- The **cloud chip** shows sync status and how long ago you last synced.
- **Sync now** (in the Sync panel) forces a reconcile — tap it before switching devices to pull your latest.
- Conflict handling is **last-write-wins**: your most recent save on any device is the one that's kept. If you edit the same data on two devices while offline, the later save wins.
- The app works **fully offline and signed out** — sync just switches on when you log in.

Your connection details live in `config.js`. The key in there is the **anon public** key, which is safe to ship publicly; your data is protected by Supabase Row Level Security and your password, not by hiding the key.

---

## What's in this folder
| File | Purpose |
|------|---------|
| `index.html` | The entire app |
| `manifest.webmanifest` | Tells the browser it's an installable app (name, icons, colors) |
| `sw.js` | Service worker — offline capability + instant loading |
| `icon.svg` / `icon-*.png` | App icons |
| `.github/workflows/deploy.yml` | Auto-deploys to Pages on every push |

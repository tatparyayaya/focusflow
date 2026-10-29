# ⚡ FocusFlow — Minimal AI Study Partner

A lightweight, minimal, and beautiful study partner web application. Includes an interactive Pomodoro timer, AI study coach tips, and habit stats in a clean glassmorphic UI.

---

## 🚀 How to Run

You only need **Python** (built-in standard library, zero `pip install` needed!):

```bash
python app.py
```

It will automatically launch in your default browser at `http://localhost:8000`.

---

## 📁 File Structure

Everything is minimal and easy to understand:

```
├── app.py          # Minimal Python server (built-in standard library)
├── index.html      # Homepage layout & structure
├── style.css       # Clean glassmorphism & dark/light theme styles
├── script.js       # Live Pomodoro timer, AI coach, and theme logic
└── README.md       # Quick start guide
```

---

## ✨ Features

- **Live Pomodoro Timer** — 25-minute focus intervals with 5m and 15m breaks.
- **Instant AI Study Coach** — Quick study tips, 2-hour study plans, and motivation.
- **Dark & Light Mode** — Eye-friendly themes with glassmorphic visuals.
- **Zero Dependencies** — Runs out of the box with standard Python.


## Local and Vercel authentication

Local development keeps the existing private `students.sqlite3` database and salted scrypt password hashes. On Vercel, signup and login use Supabase Auth; local accounts do not automatically transfer. Users must register on the hosted site or be created through Supabase Authentication. Hosted sessions use Secure, HttpOnly, SameSite cookies and are verified with Supabase on every request, so they survive Vercel instance changes. Sessions expire within one hour.

## Deploy on Vercel

The included `vercel.json` and `api/index.py` run the existing Python backend and route requests through its access checks. The HTML, CSS, JavaScript, two-item fallback media library, and MP3 are included in the deployment. Private SQLite accounts are excluded. Vercel uses Supabase for persistent account/media writes and never attempts to write into the deployment filesystem.

1. In the connected Vercel project, use the **Other** framework preset, repository root, no build command and the default output directory. Push/redeploy the repository.
2. Run `schema.sql` in the Supabase SQL editor. This creates the missing media table, installs public-read/admin-write policies, and seeds only the requested YouTube video and MP3. It is safe to run repeatedly.
3. Under Supabase **Authentication → URL Configuration**, set **Site URL** to your live Vercel URL and add that URL to **Redirect URLs**. Email confirmation is currently enabled; users confirm their email before logging in.
4. Create the admin account through Supabase **Authentication → Users**. Use trusted Supabase admin tooling or SQL to assign `app_metadata.role = admin`. For an existing account you can run: `update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb where email = 'admin@ff.com';`. The local admin account/password is not deployed or embedded in frontend code.

The supplied public project settings are used by default. Optional Vercel environment overrides are `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. Never put service-role keys or admin passwords in frontend code. The public key cannot create database tables or assign admin roles.

The fallback video/audio work even before the media table is initialized; admin media writes require the schema and an authenticated Supabase admin. Back up local account data separately if needed; do not commit it to Git.

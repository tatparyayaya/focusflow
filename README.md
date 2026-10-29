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


## Authentication and admin setup

Login uses existing Supabase Auth email/password accounts. Create accounts using the Supabase dashboard (Authentication → Users). Set the display name in user metadata `name`. Assign administrators through trusted Supabase admin tooling by setting **app_metadata** to `{"role":"admin"}`; user-editable metadata never grants admin access. There are no frontend admin passwords.

Apply the policy section of `schema.sql` to the existing Supabase database before deployment. It removes the previous anonymous INSERT/DELETE policies and replaces them with authenticated admin policies. Do not rerun the sample INSERT section unless you want additional sample tracks. The application cannot apply database migrations with its public project key.

Sessions use opaque HttpOnly, SameSite=Strict cookies, expire within one hour, and end on server restart. Serve production over HTTPS and set `FOCUSFLOW_SECURE_COOKIE=1`. Database writes use the verified user's token; authorization failures never fall back to local writes. Public media reads retain the existing local cache fallback. The AI Coach page reuses `script.js` and the existing Gemini integration.

Student self-registration stores accounts locally in the private, Git-ignored `students.sqlite3` database with individually salted scrypt password hashes. Students can log in immediately with the same email/password; email matching is case-insensitive. Back up this database to preserve student accounts. Student accounts never receive admin privileges. Supabase authentication remains available for existing accounts and administrators.

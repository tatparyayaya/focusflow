"""
FocusFlow — Lightweight Python Server with Supabase Database Proxy
Handles ADHD Music/Video API (GET, POST, DELETE) for Main Web App & Admin Portal.
Runs with standard Python 3. No external dependencies required!
"""

import http.server
import socketserver
import urllib.request
import urllib.error
import json
import os
import webbrowser
import sqlite3
import hashlib
import hmac
import re
import threading
import secrets
import time
from http.cookies import SimpleCookie
from datetime import datetime, timezone, timedelta
from uuid import UUID
from urllib.parse import urlsplit, unquote, urlencode

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://btxturluhszfkredivbs.supabase.co").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_vYDFt1ltXwcu4Cya08vBnA_4WXsK1Wm")
HOSTED = os.environ.get("VERCEL") == "1"
SESSIONS = {}
LOGIN_ATTEMPTS = {}
MEDIA_LOCK = threading.RLock()
LOCAL_STORE = os.path.join(DIRECTORY, "media_store.json")

DEFAULT_MEDIA = []

def get_local_media():
    if os.path.exists(LOCAL_STORE):
        try:
            with open(LOCAL_STORE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return DEFAULT_MEDIA

def save_local_media(items):
    if HOSTED:
        return  # Deployments are read-only; hosted writes persist in Supabase.
    with open(LOCAL_STORE, "w", encoding="utf-8") as f:
        json.dump(items, f, indent=2)

def supabase_request(endpoint, method="GET", data=None, token=None, ignore_duplicates=False):
    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }
    if ignore_duplicates:
        headers["Prefer"] = "resolution=ignore-duplicates,return=representation"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    payload = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=payload, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            content = resp.read().decode("utf-8")
            return json.loads(content) if content else {}, resp.status
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        return {"error": body, "status": e.code}, e.code
    except Exception as e:
        return {"error": str(e)}, 500

def student_database():
    db = sqlite3.connect(os.path.join(DIRECTORY, "students.sqlite3"))
    db.execute("CREATE TABLE IF NOT EXISTS students (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL)")
    if "role" not in {column[1] for column in db.execute("PRAGMA table_info(students)")}:
        db.execute("ALTER TABLE students ADD COLUMN role TEXT NOT NULL DEFAULT 'student'")
    db.execute("CREATE TABLE IF NOT EXISTS analytics_events (user_id TEXT NOT NULL REFERENCES students(id), id TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, seconds INTEGER NOT NULL, PRIMARY KEY (user_id, id))")
    return db


def student_password(password, salt):
    return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()


def student_user(row):
    return {"id": row[0], "email": row[1], "user_metadata": {"name": row[2]}, "app_metadata": {"role": row[3]}}


class FocusFlowHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        if unquote(urlsplit(self.path).path) in ("/", "/index.html", "/script.js", "/style.css", "/ai-coach", "/ai-coach.html", "/analytics", "/analytics.html", "/admin", "/admin/", "/admin.html"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _auth_request(self, endpoint, data=None, token=None):
        headers = {"apikey": SUPABASE_KEY, "Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        req = urllib.request.Request(SUPABASE_URL + "/auth/v1/" + endpoint,
            data=json.dumps(data).encode() if data is not None else None, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            try:
                details = json.loads(error.read())
            except (ValueError, UnicodeError):
                details = {}
            return {"auth_error": details.get("error_code", "auth_failed"), "auth_status": error.code}
        except Exception:
            return {"auth_error": "auth_unavailable", "auth_status": 503}

    def _send_auth_error(self, result):
        if not isinstance(result, dict) or not result.get("auth_error"):
            return False
        messages = {
            "over_email_send_rate_limit": "Confirmation email limit reached. Please wait before trying again. The site owner needs to configure Supabase email delivery (SMTP).",
            "over_request_rate_limit": "Too many authentication requests. Please wait before trying again.",
            "email_not_confirmed": "Please confirm your email before logging in. Check your inbox and spam folder for the confirmation link.",
            "invalid_credentials": "Incorrect email or password. Accounts created only on localhost must be registered separately on this live site.",
            "user_already_exists": "This account already exists. Please log in.",
            "email_exists": "This account already exists. Please log in.",
            "email_address_invalid": "Please enter a valid email address.",
            "weak_password": "Please choose a stronger password with at least eight characters.",
            "signup_disabled": "Account registration is disabled in Supabase. Please contact the site owner.",
            "auth_unavailable": "The sign-in service is temporarily unavailable. Please try again shortly."
        }
        status = result.get("auth_status", 400)
        self._send_json({"error": messages.get(result["auth_error"], "Authentication failed. Please try again or contact the site owner."),
            "code": result["auth_error"]}, status if 400 <= status <= 599 else 400)
        return True

    def _session(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
            sid = cookie["focusflow_session"].value
        except (KeyError, ValueError):
            return None
        if HOSTED:
            user = self._auth_request("user", token=sid)
            return {"token": sid, "user": user} if user and user.get("id") else None
        session = SESSIONS.get(sid)
        if not session or session["expires"] <= time.time():
            SESSIONS.pop(sid, None)
            return None
        if session.get("student_id"):
            with student_database() as db:
                row = db.execute("SELECT id, email, name, role FROM students WHERE id = ?", (session["student_id"],)).fetchone()
            user = student_user(row) if row else None
        else:
            user = self._auth_request("user", token=session["token"])
        if not user or not user.get("id"):
            SESSIONS.pop(sid, None)
            return None
        return {**session, "user": user}

    def _require_admin(self):
        session = self._session()
        if not session:
            self._send_json({"error": "Login required"}, 401)
        elif session["user"].get("app_metadata", {}).get("role") != "admin":
            self._send_json({"error": "Admin access required"}, 403)
        else:
            return session
        return None

    def _same_origin(self):
        origin = self.headers.get("Origin")
        fetch_site = self.headers.get("Sec-Fetch-Site")
        host = self.headers.get("X-Forwarded-Host", self.headers.get("Host")) if HOSTED else self.headers.get("Host")
        return fetch_site not in ("cross-site", "same-site") and (not origin or urlsplit(origin).netloc == host)

    def _body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length <= 16384:
            raise ValueError("Invalid request size")
        body = json.loads(self.rfile.read(length))
        if not isinstance(body, dict):
            raise ValueError("Expected an object")
        return body

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if path == "/api/session":
            session = self._session()
            user = session["user"] if session else None
            self._send_json({"user": {"name": user.get("user_metadata", {}).get("name") or user.get("email", "User").split("@")[0],
                "admin": user.get("app_metadata", {}).get("role") == "admin", "id": user["id"]} if user else None})
            return
        if path == "/api/analytics":
            session = self._session()
            if not session:
                self._send_json({"error": "Log in to view your analytics."}, 401)
                return
            since = (datetime.now(timezone.utc).date() - timedelta(days=31)).isoformat()
            if session.get("student_id"):
                with student_database() as db:
                    rows = db.execute("SELECT day, kind, SUM(seconds), COUNT(*) FROM analytics_events WHERE user_id = ? AND day >= ? GROUP BY day, kind ORDER BY day", (session["user"]["id"], since)).fetchall()
                daily = {}
                for day, kind, seconds, count in rows:
                    entry = daily.setdefault(day, {"day": day, "focus_mode_seconds": 0, "focus_seconds": 0, "break_seconds": 0, "sessions": 0})
                    field = {"focus_mode": "focus_mode_seconds", "pomodoro_focus": "focus_seconds", "short_break": "break_seconds", "long_break": "break_seconds", "completed_session": "sessions"}[kind]
                    entry[field] += count if kind == "completed_session" else seconds
                self._send_json({"daily": list(daily.values())})
            else:
                rows, code = supabase_request("rpc/my_analytics", method="POST", data={}, token=session["token"])
                if code >= 400:
                    self._send_json({"error": "Analytics database needs setup. Run the analytics section of schema.sql in Supabase."}, 503)
                else:
                    self._send_json({"daily": rows})
            return
        if path == "/api/media":
            if HOSTED:
                res, code = supabase_request("media?select=*&order=id.desc")
                self._send_json(res if code == 200 and isinstance(res, list) else get_local_media())
                return
            with student_database() as db:
                db.execute("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
                local_library = db.execute("SELECT value FROM app_settings WHERE key = 'media_source'").fetchone()
            if local_library and local_library[0] == "local":
                self._send_json(get_local_media())
                return
            res, code = supabase_request("media?select=*&order=id.desc")
            if code == 200 and isinstance(res, list):
                local_items = [item for item in get_local_media() if item.get("local_managed")]
                merged = local_items + [item for item in res if str(item.get("id")) not in {str(i.get("id")) for i in local_items}]
                save_local_media(merged)
                self._send_json(merged)
            else:
                self._send_json(get_local_media())
            return
        # Explicit allowlist prevents source, credentials, cache and path alias leaks.
        assets = {"/": "/index.html", "/index.html": "/index.html", "/style.css": "/style.css",
            "/script.js": "/script.js", "/analytics": "/analytics.html", "/analytics.html": "/analytics.html", "/vendor/marked.umd.js": "/vendor/marked.umd.js", "/vendor/purify.min.js": "/vendor/purify.min.js", "/media/adhd-focus-lofi.mp3": "/media/adhd-focus-lofi.mp3", "/ai-coach": "/ai-coach.html", "/ai-coach.html": "/ai-coach.html"}
        if path in ("/admin", "/admin/", "/admin.html"):
            if not self._require_admin():
                return
            self.path = "/admin.html"
        elif path in assets:
            self.path = assets[path]
        else:
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self):
        # Apply the same access checks as GET without serving protected files.
        if unquote(urlsplit(self.path).path) in ("/admin", "/admin/", "/admin.html"):
            if not self._require_admin():
                return
        if urlsplit(self.path).path not in ("/", "/index.html", "/style.css", "/script.js", "/ai-coach.html", "/analytics.html", "/admin.html", "/media/adhd-focus-lofi.mp3", "/vendor/marked.umd.js", "/vendor/purify.min.js"):
            self.send_error(404)
            return
        super().do_HEAD()

    def do_POST(self):
        if not self._same_origin():
            self._send_json({"error": "Cross-origin request denied"}, 403)
            return
        if self.path == "/api/analytics":
            session = self._session()
            if not session:
                self._send_json({"error": "Log in to save analytics."}, 401)
                return
            try:
                body = self._body()
                if body.get("expected_user_id") != session["user"]["id"]:
                    self._send_json({"error": "Analytics account changed. Please log in again."}, 409)
                    return
                events = body.get("events")
                if not isinstance(events, list) or not 1 <= len(events) <= 32:
                    raise ValueError()
                records = []
                today = datetime.now(timezone.utc).date()
                for event in events:
                    if not isinstance(event, dict):
                        raise ValueError()
                    event_id = str(UUID(event["id"]))
                    day = datetime.strptime(event["day"], "%Y-%m-%d").date()
                    kind = event["kind"]
                    seconds = event["seconds"]
                    if (kind not in ("focus_mode", "pomodoro_focus", "short_break", "long_break", "completed_session")
                            or type(seconds) is not int or not 0 <= seconds <= 300
                            or (seconds != 0 if kind == "completed_session" else seconds == 0)
                            or not today - timedelta(days=366) <= day <= today + timedelta(days=1)):
                        raise ValueError()
                    records.append({"user_id": session["user"]["id"], "id": event_id, "day": day.isoformat(), "kind": kind, "seconds": seconds})
            except (ValueError, TypeError, KeyError, UnicodeError):
                self._send_json({"error": "Invalid analytics events."}, 400)
                return
            if session.get("student_id"):
                with student_database() as db:
                    db.executemany("INSERT OR IGNORE INTO analytics_events (user_id,id,day,kind,seconds) VALUES (:user_id,:id,:day,:kind,:seconds)", records)
            else:
                _, code = supabase_request("analytics_events?on_conflict=user_id,id", method="POST", data=records, token=session["token"], ignore_duplicates=True)
                if code >= 400:
                    self._send_json({"error": "Analytics could not sync. The analytics database may need setup."}, 503)
                    return
            self._send_json({"saved": True})
            return
        if self.path == "/api/coach":
            key = os.environ.get("GEMINI_API_KEY", "")
            if not key and not HOSTED:
                env_path = os.path.join(DIRECTORY, ".env")
                if os.path.exists(env_path):
                    with open(env_path, encoding="utf-8") as env_file:
                        for line in env_file:
                            if line.startswith("GEMINI_API_KEY="):
                                key = line.partition("=")[2].strip().strip("\"'")
                                break
            if not key:
                self._send_json({"error": "AI Coach is not configured. Set GEMINI_API_KEY on the server."}, 503)
                return
            try:
                body = self._body()
            except (ValueError, UnicodeError):
                self._send_json({"error": "Invalid chat request"}, 400)
                return
            request = urllib.request.Request(
                "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent",
                data=json.dumps(body).encode("utf-8"),
                headers={"Content-Type": "application/json", "x-goog-api-key": key}, method="POST")
            try:
                with urllib.request.urlopen(request, timeout=20) as response:
                    self._send_json(json.load(response))
            except urllib.error.HTTPError as error:
                self._send_json({"error": "AI service request failed"}, error.code)
            except Exception:
                self._send_json({"error": "AI service is temporarily unavailable"}, 502)
            return
        if self.path == "/api/logout":
            cookie = SimpleCookie(self.headers.get("Cookie", ""))
            if "focusflow_session" in cookie:
                token = cookie["focusflow_session"].value
                if HOSTED:
                    self._auth_request("logout?scope=local", data={}, token=token)
                else:
                    SESSIONS.pop(token, None)
            secure = "; Secure" if HOSTED else ""
            self._send_json({"success": True}, cookie="focusflow_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" + secure)
            return
        if self.path not in ("/api/login", "/api/signup", "/api/media"):
            self.send_error(404)
            return
        session = None
        if self.path == "/api/media":
            session = self._require_admin()
            if not session:
                return
        try:
            body = self._body()
        except (ValueError, UnicodeError):
            self._send_json({"error": "Invalid request body"}, 400)
            return
        if self.path in ("/api/login", "/api/signup"):
            now = time.time()
            address = self.client_address[0]
            attempts = [t for t in LOGIN_ATTEMPTS.get(address, []) if now - t < 300]
            LOGIN_ATTEMPTS[address] = attempts
            if len(attempts) >= 10:
                self._send_json({"error": "Too many login attempts. Try again in five minutes."}, 429)
                return
            attempts.append(now)
            if not isinstance(body.get("email"), str) or not isinstance(body.get("password"), str):
                self._send_json({"error": "Email and password required"}, 400)
                return
            if self.path == "/api/signup":
                name = body.get("name")
                if (not isinstance(name, str) or not 1 <= len(name.strip()) <= 80
                        or not 8 <= len(body["password"]) <= 1024
                        or "@" not in body["email"] or len(body["email"]) > 254):
                    self._send_json({"error": "Enter your name, a valid email and a password of at least 8 characters."}, 400)
                    return
                if HOSTED:
                    host = self.headers.get("X-Forwarded-Host", self.headers.get("Host", ""))
                    redirect = "https://" + host + "/"
                    result = self._auth_request("signup?" + urlencode({"redirect_to": redirect}),
                        {"email": body["email"].strip().casefold(), "password": body["password"], "data": {"name": name.strip()}})
                    if self._send_auth_error(result):
                        return
                    if not result or not (result.get("id") or result.get("user", {}).get("id")):
                        self._send_json({"error": "Unable to register with Supabase. Check your details, or log in if you already registered. Please wait before retrying if email is rate limited."}, 400)
                        return
                    if not result.get("access_token"):
                        self._send_json({"success": True, "confirmation_required": True}, 201)
                        return
                else:
                    email = body["email"].strip().casefold()
                    salt = secrets.token_hex(16)
                    student_id = secrets.token_urlsafe(24)
                    with student_database() as db:
                        try:
                            db.execute("INSERT INTO students (id, email, name, salt, password_hash) VALUES (?, ?, ?, ?, ?)",
                                (student_id, email, name.strip(), salt, student_password(body["password"], salt)))
                        except sqlite3.IntegrityError:
                            self._send_json({"error": "This email already has an account. Please log in."}, 409)
                            return
                    result = {"access_token": "local-student", "student_id": student_id, "expires_in": 3600}
            else:
                email = body["email"].strip().casefold()
                if len(body["password"]) > 1024:
                    self._send_json({"error": "Invalid login details"}, 400)
                    return
                if HOSTED:
                    result = self._auth_request("token?grant_type=password", {"email": email, "password": body["password"]})
                else:
                    with student_database() as db:
                        row = db.execute("SELECT id, salt, password_hash FROM students WHERE email = ?", (email,)).fetchone()
                    if row:
                        valid = hmac.compare_digest(student_password(body["password"], row[1]), row[2])
                        result = {"access_token": "local-student", "student_id": row[0], "expires_in": 3600} if valid else None
                    else:
                        result = self._auth_request("token?grant_type=password", {"email": email, "password": body["password"]})
            if self._send_auth_error(result):
                return
            if not result or not result.get("access_token"):
                self._send_json({"error": "Unable to sign in. Check your email and password."}, 401)
                return
            LOGIN_ATTEMPTS.pop(address, None)
            for expired in [key for key, value in SESSIONS.items() if value["expires"] <= time.time()]:
                SESSIONS.pop(expired, None)
            sid = result["access_token"] if HOSTED else secrets.token_urlsafe(32)
            lifetime = min(int(result.get("expires_in", 3600)), 3600)
            if not HOSTED:
                SESSIONS[sid] = {"token": result["access_token"], "student_id": result.get("student_id"), "expires": time.time() + lifetime}
            secure = "; Secure" if HOSTED or os.environ.get("FOCUSFLOW_SECURE_COOKIE") == "1" else ""
            self._send_json({"success": True}, cookie=f"focusflow_session={sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age={lifetime}" + secure)
            return
        if (not all(isinstance(body.get(k), str) and 0 < len(body[k]) <= 2048 for k in ("title", "url", "type"))
                or body["type"] not in ("audio", "video") or (urlsplit(body["url"]).scheme != "https" and body["url"] != "/media/adhd-focus-lofi.mp3")):
            self._send_json({"error": "A title, HTTPS media URL and audio/video type are required"}, 400)
            return
        item = {k: body[k] for k in ("title", "url", "type", "category") if k in body}
        if item["type"] == "video":
            parsed = urlsplit(item["url"])
            host = parsed.hostname or ""
            if host in ("youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com", "youtu.be"):
                from urllib.parse import parse_qs
                parts = parsed.path.strip("/").split("/")
                video_id = parts[0] if host == "youtu.be" and len(parts) == 1 else parts[1] if len(parts) == 2 and parts[0] in ("embed", "shorts", "live") else parse_qs(parsed.query).get("v", [""])[0]
                valid = re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id or "")
            else:
                valid = re.search(r"\.(mp4|webm|ogv|ogg|mov)$", parsed.path, re.I)
            if not host or not valid:
                self._send_json({"error": "Use a valid YouTube video URL or a direct MP4, WebM or Ogg video URL."}, 400)
                return
        if session.get("student_id"):
            # Authenticated local admins use the existing persistent media store.
            with MEDIA_LOCK:
                items = get_local_media()
                item["id"] = max([int(i.get("id", 0)) for i in items] + [int(time.time() * 1000)]) + 1
                item["local_managed"] = True
                items.insert(0, item)
                save_local_media(items)
            self._send_json(item, 201)
            return
        res, code = supabase_request("media", method="POST", data=item, token=session["token"])
        # Never turn database authorization failures into successful local writes.
        if code >= 400:
            self._send_json({"error": "Database write failed"}, code)
            return
        new_item = res[0] if isinstance(res, list) and res else res
        items = get_local_media()
        items.insert(0, new_item)
        save_local_media(items)
        self._send_json(new_item, 201)

    def do_DELETE(self):
        if not self._same_origin():
            self._send_json({"error": "Cross-origin request denied"}, 403)
            return
        session = self._require_admin()
        if not session:
            return
        item_id = self.path.removeprefix("/api/media/")
        if not self.path.startswith("/api/media/") or not item_id.isdigit():
            self.send_error(404)
            return
        if session.get("student_id"):
            with MEDIA_LOCK:
                items = get_local_media()
                target = next((i for i in items if str(i.get("id")) == item_id), None)
                if not target or not target.get("local_managed"):
                    self._send_json({"error": "This remote entry requires a Supabase admin account."}, 403)
                    return
                save_local_media([i for i in items if str(i.get("id")) != item_id])
            self._send_json({"success": True, "deleted_id": item_id})
            return
        _, code = supabase_request(f"media?id=eq.{item_id}", method="DELETE", token=session["token"])
        if code >= 400:
            self._send_json({"error": "Database delete failed"}, code)
            return
        save_local_media([i for i in get_local_media() if str(i.get("id")) != item_id])
        self._send_json({"success": True, "deleted_id": item_id})

    def _send_json(self, data, status=200, cookie=None):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

def main():
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("", PORT), FocusFlowHandler) as httpd:
        url = f"http://localhost:{PORT}"
        print(f"[FocusFlow] Website running at: {url}")
        print(f"[FocusFlow] Admin Portal running at: {url}/admin")
        print(f"[FocusFlow] Connected to Supabase Project: btxturluhszfkredivbs")
        print("[FocusFlow] Press Ctrl+C to stop the server.")
        try:
            webbrowser.open(url)
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[FocusFlow] Server stopped.")

if __name__ == "__main__":
    main()

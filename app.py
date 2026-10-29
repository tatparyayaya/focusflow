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
from urllib.parse import urlsplit, unquote

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
SUPABASE_URL = "https://btxturluhszfkredivbs.supabase.co"
SUPABASE_KEY = "sb_publishable_vYDFt1ltXwcu4Cya08vBnA_4WXsK1Wm"
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
    with open(LOCAL_STORE, "w", encoding="utf-8") as f:
        json.dump(items, f, indent=2)

def supabase_request(endpoint, method="GET", data=None, token=None):
    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {token or SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }
    payload = json.dumps(data).encode("utf-8") if data else None
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
        if unquote(urlsplit(self.path).path) in ("/admin", "/admin/", "/admin.html"):
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
        except Exception:
            return None

    def _session(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
            sid = cookie["focusflow_session"].value
        except (KeyError, ValueError):
            return None
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
        return fetch_site not in ("cross-site", "same-site") and (not origin or urlsplit(origin).netloc == self.headers.get("Host"))

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
                "admin": user.get("app_metadata", {}).get("role") == "admin"} if user else None})
            return
        if path == "/api/media":
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
            "/script.js": "/script.js", "/media/adhd-focus-lofi.mp3": "/media/adhd-focus-lofi.mp3", "/ai-coach": "/ai-coach.html", "/ai-coach.html": "/ai-coach.html"}
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
        if urlsplit(self.path).path not in ("/", "/index.html", "/style.css", "/script.js", "/ai-coach.html", "/admin.html", "/media/adhd-focus-lofi.mp3"):
            self.send_error(404)
            return
        super().do_HEAD()

    def do_POST(self):
        if not self._same_origin():
            self._send_json({"error": "Cross-origin request denied"}, 403)
            return
        if self.path == "/api/logout":
            cookie = SimpleCookie(self.headers.get("Cookie", ""))
            if "focusflow_session" in cookie:
                SESSIONS.pop(cookie["focusflow_session"].value, None)
            self._send_json({"success": True}, cookie="focusflow_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0")
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
                with student_database() as db:
                    row = db.execute("SELECT id, salt, password_hash FROM students WHERE email = ?", (email,)).fetchone()
                if row:
                    valid = hmac.compare_digest(student_password(body["password"], row[1]), row[2])
                    result = {"access_token": "local-student", "student_id": row[0], "expires_in": 3600} if valid else None
                else:
                    result = self._auth_request("token?grant_type=password", {"email": email, "password": body["password"]})
            if not result or not result.get("access_token"):
                self._send_json({"error": "Unable to sign in. Check your email and password."}, 401)
                return
            LOGIN_ATTEMPTS.pop(address, None)
            for expired in [key for key, value in SESSIONS.items() if value["expires"] <= time.time()]:
                SESSIONS.pop(expired, None)
            sid = secrets.token_urlsafe(32)
            lifetime = min(int(result.get("expires_in", 3600)), 3600)
            SESSIONS[sid] = {"token": result["access_token"], "student_id": result.get("student_id"), "expires": time.time() + lifetime}
            secure = "; Secure" if os.environ.get("FOCUSFLOW_SECURE_COOKIE") == "1" else ""
            self._send_json({"success": True}, cookie=f"focusflow_session={sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age={lifetime}" + secure)
            return
        if (not all(isinstance(body.get(k), str) and 0 < len(body[k]) <= 2048 for k in ("title", "url", "type"))
                or body["type"] not in ("audio", "video") or urlsplit(body["url"]).scheme != "https"):
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

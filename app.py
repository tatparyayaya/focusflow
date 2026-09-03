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

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
SUPABASE_URL = "https://btxturluhszfkredivbs.supabase.co"
SUPABASE_KEY = "sb_publishable_vYDFt1ltXwcu4Cya08vBnA_4WXsK1Wm"
LOCAL_STORE = os.path.join(DIRECTORY, "media_store.json")

DEFAULT_MEDIA = [
    {"id": 1, "title": "40Hz Gamma Focus (Binaural Beats)", "type": "audio", "url": "https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3", "category": "Binaural Beats"},
    {"id": 2, "title": "Deep Focus Rain & Ambient Sound", "type": "audio", "url": "https://cdn.pixabay.com/download/audio/2021/09/06/audio_8b2d13b28b.mp3", "category": "Ambient Sound"},
    {"id": 3, "title": "Cosmic Lo-Fi Study Beats", "type": "audio", "url": "https://cdn.pixabay.com/download/audio/2022/03/15/audio_c8c8a73562.mp3", "category": "Lo-Fi Beats"},
    {"id": 4, "title": "Brown Noise for Deep Concentration", "type": "audio", "url": "https://cdn.pixabay.com/download/audio/2022/01/18/audio_d0a13f69d2.mp3", "category": "ADHD Focus"},
    {"id": 5, "title": "Aesthetic Lofi Study Room", "type": "video", "url": "https://www.youtube.com/embed/jfKfPfyJRdk", "category": "Lofi Video"},
    {"id": 6, "title": "Cozy Library Rain Ambient", "type": "video", "url": "https://www.youtube.com/embed/5qap5aO4i9A", "category": "Study Video"}
]

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

def supabase_request(endpoint, method="GET", data=None):
    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
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

class FocusFlowHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        if self.path in ("/admin", "/admin/"):
            self.path = "/admin.html"
        if self.path == "/api/media":
            res, code = supabase_request("media?select=*&order=id.desc")
            if code == 200 and isinstance(res, list):
                save_local_media(res)
                self._send_json(res)
            else:
                self._send_json(get_local_media())
            return
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/media":
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length).decode('utf-8'))
            res, code = supabase_request("media", method="POST", data=body)
            
            items = get_local_media()
            new_item = body
            if isinstance(res, list) and len(res) > 0:
                new_item = res[0]
            elif isinstance(res, dict) and "id" in res:
                new_item = res
            else:
                new_item["id"] = max([int(i.get("id", 0)) for i in items] or [0]) + 1
            
            items.insert(0, new_item)
            save_local_media(items)
            self._send_json(new_item, status=201)
            return

    def do_DELETE(self):
        if self.path.startswith("/api/media/"):
            item_id = self.path.split("/")[-1]
            supabase_request(f"media?id=eq.{item_id}", method="DELETE")
            
            items = [i for i in get_local_media() if str(i.get("id")) != item_id]
            save_local_media(items)
            self._send_json({"success": True, "deleted_id": item_id})
            return

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

def main():
    with socketserver.TCPServer(("", PORT), FocusFlowHandler) as httpd:
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

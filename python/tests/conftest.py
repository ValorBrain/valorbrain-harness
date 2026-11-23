"""Offline fixtures: an in-process fake ValorBrain engine on 127.0.0.1.

The fake implements just enough of the REST contract (store, documents upsert /
glob list / get / forget, search, prepare, used) for the adapters to be tested
end to end over real HTTP without touching the network.
"""

from __future__ import annotations

import json
import re
import secrets
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

import pytest

from valorbrain import ValorBrain

TOKEN = "vbm_offline_test_token_000000000000"


def _glob(pattern: str) -> re.Pattern[str]:
    out = ""
    i = 0
    while i < len(pattern):
        if pattern.startswith("**", i):
            out += ".*"
            i += 2
        elif pattern[i] == "*":
            out += "[^/]*"
            i += 1
        else:
            out += re.escape(pattern[i])
            i += 1
    return re.compile(out + r"\Z")


class FakeEngine:
    def __init__(self) -> None:
        self.docs: dict[str, dict] = {}  # docid -> doc
        self.dead_paths: set[str] = set()
        self.requests: list[tuple[str, str, dict | None, dict]] = []
        self.fail_with: int | None = None

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def handle(self, method: str, path: str, query: dict, body: dict | None):
        if self.fail_with:
            return self.fail_with, {"error": "forced failure"}
        if method == "POST" and path == "/api/v1/memory/store":
            if len(body.get("title", "")) < 5 or len(body.get("content", "")) < 20:
                return 400, {"error": "title/content too short"}
            coll = body.get("collection") or "agent-test"
            p = f"notes/{secrets.token_hex(4)}.md"
            docid = self._add(coll, p, body["content"], body["title"], None)
            return 200, {"ok": True, "action": "inserted", "docid": docid, "collection": coll, "path": p}
        if method == "POST" and path == "/documents":
            full = f"{body['collection']}/{body['path']}"
            existing = [d for d in self.docs.values() if d["path"] == full]
            if full in self.dead_paths:  # mirrors the engine: a forgotten path stays dead
                return 200, {"docid": secrets.token_hex(3), "action": "updated", "path": body["path"]}
            if existing:
                d = existing[0]
                d.update(body=body["content"], title=body.get("title") or d["title"], modifiedAt=self._now())
                return 200, {"docid": d["docid"], "action": "updated", "path": body["path"]}
            docid = self._add(body["collection"], body["path"], body["content"], body.get("title"), body.get("event_at"))
            self.docs[docid]["metadata"] = body.get("metadata")
            return 200, {"docid": docid, "action": "created", "path": body["path"], "collection": body["collection"]}
        if method == "GET" and path == "/documents":
            coll = query.get("collection")
            pat = (coll + "/" if coll else "") + query["pattern"]
            rx = _glob(pat)
            docs = [dict(d, bodyLength=len(d["body"])) for d in self.docs.values() if rx.match(d["path"])]
            return 200, {"pattern": query["pattern"], "count": len(docs), "documents": docs}
        m = re.fullmatch(r"/documents/([^/]+)(/forget)?", path)
        if m:
            docid = unquote(m.group(1))
            d = self.docs.get(docid)
            if not d:
                return 404, {"error": f"Document not found: {docid}"}
            if m.group(2) and method == "POST":
                del self.docs[docid]
                self.dead_paths.add(d["path"])
                return 200, {"docid": docid, "forgotten": True}
            return 200, d
        if method == "POST" and path == "/search":
            words = [w for w in re.findall(r"\w+", body["query"].lower()) if len(w) > 2]
            coll = body.get("collection")
            hits = []
            for d in self.docs.values():
                if coll and d["collection"] != coll:
                    continue
                text = (d["body"] + " " + (d["title"] or "")).lower()
                score = sum(w in text for w in words) / max(len(words), 1)
                if score > 0:
                    r = {k: d[k] for k in ("docid", "path", "title", "modifiedAt")}
                    r.update(score=round(score, 3), snippet=d["body"][:120])
                    if d.get("eventAt"):
                        r["eventAt"] = d["eventAt"]
                    if body.get("compact") is False:
                        r["body"] = d["body"]
                    hits.append(r)
            hits.sort(key=lambda r: -r["score"])
            return 200, {"query": body["query"], "results": hits[: body.get("limit", 10)]}
        if method == "POST" and path == "/api/v1/memory/prepare":
            return 200, {"markdown": f"## Context\nAbout: {body['message']}", "blocks": {}, "recall_used": 0}
        if method == "POST" and path == "/api/v1/memory/used":
            ids = body["docids"]
            known = {"#" + d for d in self.docs} | {d["path"] for d in self.docs.values()}
            unresolved = [i for i in ids if i not in known]
            if ids and len(unresolved) == len(ids):
                return 404, {"error": f"No memory recognized in: {', '.join(ids)}"}
            return 200, {"declared": len(ids), "marked": len(ids) - len(unresolved), "unresolved": unresolved}
        return 404, {"error": f"no route {method} {path}"}

    def _add(self, coll, path, content, title, event_at) -> str:
        docid = secrets.token_hex(3)
        self.docs[docid] = {
            "docid": docid,
            "collection": coll,
            "path": f"{coll}/{path}",
            "title": title or path.rsplit("/", 1)[-1],
            "body": content,
            "modifiedAt": self._now(),
            "eventAt": event_at,
        }
        return docid


@pytest.fixture
def engine():
    fake = FakeEngine()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):  # silence
            pass

        def _do(self, method):
            url = urlparse(self.path)
            query = {k: v[0] for k, v in parse_qs(url.query).items()}
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length)) if length else None
            fake.requests.append((method, url.path, body, dict(self.headers)))
            if self.headers.get("Authorization") != f"Bearer {TOKEN}":
                status, payload = 401, {"error": "Unauthorized"}
            else:
                status, payload = fake.handle(method, url.path, query, body)
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            self._do("GET")

        def do_POST(self):
            self._do("POST")

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    fake.url = f"http://127.0.0.1:{server.server_address[1]}"
    yield fake
    server.shutdown()
    server.server_close()


@pytest.fixture
def client(engine) -> ValorBrain:
    return ValorBrain(TOKEN, base_url=engine.url, timeout=5)

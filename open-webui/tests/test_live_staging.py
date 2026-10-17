"""Live round trip against a ValorBrain test tenant. Skipped unless both
VB_STAGING_URL and VB_STAGING_MCP_TOKEN are set (never point it at production).

outlet stores a turn with a unique fact and a fake secret -> search finds it
(positive control) -> the stored text has the secret redacted and no injected
context -> inlet recalls it into the system message -> the Tool searches and
saves -> everything created is forgotten.
"""

import json
import os
import sys
import time
import unittest
import urllib.request
import uuid

sys.path.insert(0, os.path.dirname(__file__))

from owui_harness import (  # noqa: E402
    FILTER_PATH,
    TOOL_PATH,
    call_plugin,
    call_tool,
    load_plugin,
    make_inlet,
    make_outlet,
    run,
)

URL = os.environ.get("VB_STAGING_URL", "").rstrip("/")
TOKEN = os.environ.get("VB_STAGING_MCP_TOKEN", "")


def api(method, path, payload=None):
    request = urllib.request.Request(
        URL + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        method=method,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json",
                 "User-Agent": "valorbrain-openwebui/live-test"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read() or b"{}")


def wait_for_docs(marker, timeout=60):
    deadline = time.time() + timeout
    while time.time() < deadline:
        hits = api("POST", "/search", {"query": marker, "limit": 10, "mode": "keyword"}).get("results") or []
        hits = [h for h in hits if marker in (h.get("snippet") or "") + (h.get("title") or "")]
        if hits:
            return hits
        time.sleep(2)
    return []


@unittest.skipUnless(URL and TOKEN, "set VB_STAGING_URL and VB_STAGING_MCP_TOKEN to run")
class LiveStagingTests(unittest.TestCase):
    def setUp(self):
        self.created: set[str] = set()
        self.valves = {"api_url": URL, "api_token": TOKEN, "timeout_seconds": 20}

    def tearDown(self):
        for docid in self.created:
            try:
                api("POST", f"/documents/{docid}/forget", {})
                print(f"[live] forgot {docid}")
            except Exception as error:  # report, do not hide
                print(f"[live] forget {docid} failed: {error}")

    def test_round_trip(self):
        marker = f"Kestrel{uuid.uuid4().hex[:8]}"
        code = f"KD-{uuid.uuid4().int % 10000:04d}"
        fake_secret = "ghp_" + "Z" * 36
        filt, _, _, _ = load_plugin(FILTER_PATH)

        # 1. outlet captures the turn
        question = (
            '<valorbrain-context source="open-webui">\nstale recalled text\n</valorbrain-context>\n'
            f"Which dock code does the {marker} warehouse use? My token is {fake_secret}."
        )
        answer = f"The {marker} warehouse uses dock code {code}."
        body, extra = make_outlet(question, answer, chat_id=str(uuid.uuid4()), message_id=str(uuid.uuid4()))
        started = time.time()
        run(call_plugin(filt, "outlet", body, extra, self.valves))
        print(f"[live] outlet stored in {time.time() - started:.1f}s")

        # 2. positive control: search finds it
        started = time.time()
        hits = wait_for_docs(marker)
        self.assertTrue(hits, "captured turn not searchable")
        self.created.update(h["docid"] for h in hits)
        print(f"[live] search found {[h['docid'] for h in hits]} after {time.time() - started:.1f}s")

        doc = api("GET", f"/documents/{hits[0]['docid']}")
        stored = json.dumps(doc)
        self.assertIn(code, stored)
        self.assertNotIn(fake_secret, stored)
        self.assertIn("[redacted]", stored)
        self.assertNotIn("stale recalled text", stored)
        print("[live] stored text: secret redacted, injected context stripped")

        # 3. inlet recalls it
        recalled = False
        for _ in range(10):
            body, extra = make_inlet(f"What dock code does the {marker} warehouse use?")
            out = run(call_plugin(filt, "inlet", body, extra, self.valves))
            system = out["messages"][0]
            if system["role"] == "system" and code in system["content"]:
                recalled = True
                break
            time.sleep(3)
        self.assertTrue(recalled, "inlet did not inject the captured fact")
        print(f"[live] inlet injected {len(system['content'])} chars containing {code}")

        # 4. Tool: search and remember
        tool, _, _, _ = load_plugin(TOOL_PATH)
        found = run(call_tool(tool, "search_memory", valves=self.valves, query=f"{marker} dock code"))
        self.assertIn(marker, found)
        print("[live] tool search_memory found the memory")
        saved = run(call_tool(tool, "remember", valves=self.valves, title=f"{marker} owner",
                              content=f"The {marker} warehouse is run by the night shift lead."))
        self.assertTrue(saved.startswith("Saved to ValorBrain ("), saved)
        print(f"[live] tool remember -> {saved}")
        more = wait_for_docs(f"{marker} owner")
        self.assertTrue(more, "remembered note not searchable")
        self.created.update(h["docid"] for h in more)


if __name__ == "__main__":
    unittest.main()

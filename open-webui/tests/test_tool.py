import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from owui_harness import FILTER_PATH, TOOL_PATH, FakeValorBrain, call_tool, load_plugin, run  # noqa: E402

TOKEN = "vbm_" + "x" * 40


class ToolTests(unittest.TestCase):
    def setUp(self):
        self.vb = FakeValorBrain()
        self.tool, self.kind, self.frontmatter, self.module = load_plugin(TOOL_PATH)
        self.valves = {"api_url": self.vb.url, "api_token": TOKEN, "timeout_seconds": 2}

    def tearDown(self):
        self.vb.close()

    def call(self, method, valves=None, **kwargs):
        return run(call_tool(self.tool, method, valves=valves or self.valves, **kwargs))

    def test_open_webui_detects_a_toolkit(self):
        self.assertEqual(self.kind, "tools")
        self.assertEqual(self.frontmatter["title"], "ValorBrain Memory Tools")
        self.assertNotIn("requirements", self.frontmatter)

    def test_tool_specs_are_documented(self):
        # Open WebUI builds the tool spec from the signature and the docstring.
        for name in ("search_memory", "remember"):
            doc = getattr(self.tool, name).__doc__
            self.assertIn(":param", doc)
            self.assertIn(":return:", doc)

    def test_search_formats_results(self):
        self.vb.responses["/search"] = (200, {"results": [
            {"docid": "737b5b", "title": "Dock codes", "score": 0.4, "snippet": "Zephyr uses\n dock ZX-4417."},
            {"docid": "aa11bb", "path": "agent-x/notes/n.md", "score": 0.2},
        ]})
        out = self.call("search_memory", query="zephyr dock", limit=50)
        self.assertEqual(
            out,
            "ValorBrain memories:\n- Dock codes (737b5b): Zephyr uses dock ZX-4417.\n- agent-x/notes/n.md (aa11bb)",
        )
        req = self.vb.requests[0]
        self.assertEqual(req["json"], {"query": "zephyr dock", "limit": 8})
        self.assertEqual(req["headers"]["Authorization"], f"Bearer {TOKEN}")

    def test_search_no_results_and_errors_return_text(self):
        self.vb.responses["/search"] = (200, {"results": []})
        self.assertEqual(self.call("search_memory", query="nothing"), "No matching memories.")
        self.vb.responses["/search"] = (500, {})
        self.assertEqual(self.call("search_memory", query="x"), "ValorBrain search failed: ValorBrain /search returned HTTP 500")
        self.assertIn("not configured", self.call("search_memory", valves={**self.valves, "api_token": ""}, query="x"))

    def test_remember_redacts_and_stores(self):
        self.vb.responses["/api/v1/memory/store"] = (
            200, {"ok": True, "action": "inserted", "docid": 319862, "path": "notes/2026-10-17-note.md"},
        )
        out = self.call(
            "remember",
            title="Staging database",
            content="Staging DB is postgres://app:pa55word99@db/app, owner is Ada.",
            user_valves={"api_token": "vbm_" + "u" * 40},
        )
        self.assertEqual(out, "Saved to ValorBrain (notes/2026-10-17-note.md).")
        req = self.vb.requests[0]
        self.assertEqual(req["path"], "/api/v1/memory/store")
        self.assertEqual(req["headers"]["Authorization"], "Bearer vbm_" + "u" * 40)
        self.assertEqual(req["json"], {
            "title": "Staging database",
            "content": "Staging DB is postgres://app:[redacted]@db/app, owner is Ada.",
            "type": "note",
            "tags": ["open-webui", "explicit"],
        })

    def test_remember_validates_lengths(self):
        self.assertIn("Not saved", self.call("remember", title="x", content="short"))
        self.assertEqual(self.vb.requests, [])

    def test_tool_and_filter_share_the_same_redaction(self):
        _, _, _, filter_module = load_plugin(FILTER_PATH)
        self.assertEqual(
            [(p.pattern, g) for p, g in self.module._SECRET_PATTERNS],
            [(p.pattern, g) for p, g in filter_module._SECRET_PATTERNS],
        )


if __name__ == "__main__":
    unittest.main()

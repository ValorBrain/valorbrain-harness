"""Run the filter through Open WebUI's own dispatcher (open_webui/utils/filter.py).

Opt-in: point OPEN_WEBUI_FILTER_PY at that file from an Open WebUI checkout or
release, e.g.

    gh api 'repos/open-webui/open-webui/contents/backend/open_webui/utils/filter.py?ref=v0.12.3' \
      --jq .content | base64 -d > /tmp/owui-filter.py
    OPEN_WEBUI_FILTER_PY=/tmp/owui-filter.py python -m unittest tests.test_upstream_dispatch

Only the three imports of that module (env flag, Functions table, module
cache) are stubbed; valve loading, reserved-argument binding and the
inlet/outlet loop are Open WebUI's code.
"""

import importlib.util
import os
import sys
import types
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from owui_harness import FILTER_PATH, FakeValorBrain, load_plugin, make_inlet, make_outlet, run  # noqa: E402

FILTER_PY = os.environ.get("OPEN_WEBUI_FILTER_PY", "")
TOKEN = "vbm_" + "x" * 40


def load_upstream_filter_module(instance, valves: dict, user_valves: dict):
    class Functions:
        @staticmethod
        async def get_function_valves_by_ids(ids):
            return {i: valves for i in ids}

        @staticmethod
        async def get_user_valves_by_id_and_user_id(function_id, user_id):
            return user_valves

    async def get_function_module_from_cache(request, function_id, function=None, load_from_db=True):
        return instance, "filter", {}

    stubs = {
        "open_webui": types.ModuleType("open_webui"),
        "open_webui.env": types.ModuleType("open_webui.env"),
        "open_webui.models": types.ModuleType("open_webui.models"),
        "open_webui.models.functions": types.ModuleType("open_webui.models.functions"),
        "open_webui.utils": types.ModuleType("open_webui.utils"),
        "open_webui.utils.plugin": types.ModuleType("open_webui.utils.plugin"),
    }
    stubs["open_webui.env"].ENABLE_FUNCTIONS = True
    stubs["open_webui.models.functions"].Functions = Functions
    stubs["open_webui.utils.plugin"].get_function_module_from_cache = get_function_module_from_cache
    saved = {name: sys.modules.get(name) for name in stubs}
    sys.modules.update(stubs)
    try:
        spec = importlib.util.spec_from_file_location("open_webui.utils.filter", FILTER_PY)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        for name, previous in saved.items():
            if previous is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = previous


@unittest.skipUnless(FILTER_PY and os.path.isfile(FILTER_PY), "set OPEN_WEBUI_FILTER_PY to run")
class UpstreamDispatchTests(unittest.TestCase):
    def setUp(self):
        self.vb = FakeValorBrain()
        self.vb.responses["/api/v1/memory/prepare"] = (200, {"markdown": "Dock code is ZX-4417."})
        self.vb.responses["/api/v1/memory/store"] = (200, {"ok": True, "docid": "d1"})
        self.instance, _, _, _ = load_plugin(FILTER_PATH)
        valves = {"api_url": self.vb.url, "api_token": TOKEN, "timeout_seconds": 2}
        self.upstream = load_upstream_filter_module(self.instance, valves, {"capture_enabled": True})
        self.functions = [types.SimpleNamespace(id="valorbrain_memory")]

    def tearDown(self):
        self.vb.close()

    def test_inlet_through_open_webui_dispatcher(self):
        body, extra = make_inlet("What is the dock code?")
        context = self.upstream.FilterContext()
        out, _ = run(self.upstream.process_filter_functions(
            request=None, filter_context=context, filter_functions=self.functions,
            filter_type="inlet", form_data=body, extra_params=extra,
        ))
        self.assertEqual(out["messages"][0]["role"], "system")
        self.assertIn("ZX-4417", out["messages"][0]["content"])
        self.assertIsInstance(extra["__user__"]["valves"], self.instance.UserValves)

    def test_outlet_through_open_webui_dispatcher(self):
        body, extra = make_outlet("What is the dock code?", "The dock code is ZX-4417.")
        out, _ = run(self.upstream.process_filter_functions(
            request=None, filter_context=None, filter_functions=self.functions,
            filter_type="outlet", form_data=body, extra_params=extra,
        ))
        self.assertEqual(out, body)
        self.assertEqual([r["path"] for r in self.vb.requests], ["/api/v1/memory/store"])

    def test_valorbrain_outage_does_not_raise_through_dispatcher(self):
        self.vb.responses["/api/v1/memory/prepare"] = (500, {})
        self.vb.responses["/api/v1/memory/store"] = (500, {})
        body, extra = make_inlet("What is the dock code?")
        out, _ = run(self.upstream.process_filter_functions(
            request=None, filter_context=None, filter_functions=self.functions,
            filter_type="inlet", form_data=body, extra_params=extra,
        ))
        self.assertEqual(out["messages"][-1]["content"], "What is the dock code?")
        body, extra = make_outlet("What is the dock code?", "The dock code is ZX-4417.")
        run(self.upstream.process_filter_functions(
            request=None, filter_context=None, filter_functions=self.functions,
            filter_type="outlet", form_data=body, extra_params=extra,
        ))


if __name__ == "__main__":
    unittest.main()

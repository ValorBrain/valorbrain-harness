#!/usr/bin/env python3
"""Live end-to-end test: the real Hermes agent loop + this plugin (hosted mode)
against a ValorBrain engine. Skips (exit 0) without the staging variables.

What it proves, in a throwaway HOME / HERMES_HOME:
  1. Hermes discovers and activates the `valorbrain` memory provider
     (from $HERMES_HOME/plugins/valorbrain, or from the pip entry point with --entry-point);
  2. store -> wait -> retrieve works through the plugin's own tools;
  3. memory from the engine reaches the model inside Hermes' <memory-context>
     block (the model is a local canned OpenAI-compatible server: no paid
     model, no third party);
  4. session end ships the transcript to the hosted extraction hooks and the
     engine writes the session handoff;
  5. everything created is forgotten at the end.

Start it through live_hermes_e2e.sh, which isolates HOME/HERMES_HOME before
Python starts and picks Hermes' interpreter.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
import urllib.request
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLUGIN_DIR = HERE.parent
# The live Hermes home of the person running this, passed by live_hermes_e2e.sh
# (HOME is already the throwaway one when this file starts).
REAL_HERMES = Path(os.environ.get("VBH_REAL_HERMES") or Path(os.path.expanduser("~")) / ".hermes")
UA = "valorbrain-hermes-e2e/1"


def log(msg: str) -> None:
    print(f"[e2e] {msg}", flush=True)


def engine(method: str, path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(
        os.environ["VB_STAGING_URL"].rstrip("/") + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"Authorization": f"Bearer {os.environ['VB_STAGING_MCP_TOKEN']}",
                 "Content-Type": "application/json", "User-Agent": UA},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read() or b"{}")


def wait_for(fn, timeout: float, step: float = 1.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = fn()
        if value:
            return value
        time.sleep(step)
    return None


def memory_block(text: str) -> str:
    if "<memory-context>" not in text:
        return ""
    return text.split("<memory-context>", 1)[1].split("</memory-context>", 1)[0]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--entry-point", action="store_true",
                    help="load the provider from the pip entry point (valorbrain_hermes on sys.path), not a plugin dir")
    ap.add_argument("--keep", action="store_true", help="keep the temp dirs")
    args = ap.parse_args()

    if not (os.environ.get("VB_STAGING_URL") and os.environ.get("VB_STAGING_MCP_TOKEN")):
        log("SKIP: VB_STAGING_URL / VB_STAGING_MCP_TOKEN not set")
        return 0

    # Isolation is set by live_hermes_e2e.sh BEFORE Python starts: Hermes'
    # bootstrap resolves its data root (HERMES_HOME) at interpreter start.
    hermes_home = Path(os.environ.get("HERMES_HOME") or "").resolve()
    tmp = Path(os.environ.get("VBH_E2E_TMP") or "")
    live = REAL_HERMES.resolve()
    if (not os.environ.get("HERMES_HOME") or not os.environ.get("VBH_E2E_TMP")
            or hermes_home == live or live in hermes_home.parents or Path.home() == live.parent):
        log(f"refusing to run without an isolated HOME/HERMES_HOME (live home {REAL_HERMES}); use live_hermes_e2e.sh")
        return 2

    plugins = hermes_home / "plugins" / "valorbrain"
    shutil.rmtree(plugins, ignore_errors=True)
    if args.entry_point:
        # live_hermes_e2e.sh pip-installed this directory into VBH_SITE; Hermes finds
        # it through importlib.metadata (group hermes_agent.memory_providers).
        sys.path.insert(0, os.environ["VBH_SITE"])
    else:
        plugins.mkdir(parents=True)
        for name in ("__init__.py", "plugin.yaml"):
            shutil.copy(PLUGIN_DIR / name, plugins / name)

    sys.path.insert(0, str(HERE))
    from fake_openai import FakeOpenAI
    llm = FakeOpenAI(reply="Noted, thanks.")
    (hermes_home / "config.yaml").write_text(
        "model:\n"
        "  provider: custom\n"
        "  model: fake-model\n"
        f"  base_url: {llm.base_url}\n"
        "  api_key: none\n"
        "memory:\n"
        "  provider: valorbrain\n"
    )

    # The plugin's configuration (names from the plugin: _hosted_mode, _engine_url, _rest_call).
    os.environ.update({
        "VALORBRAIN_HOOKS_MODE": "hosted",
        "VALORBRAIN_ENGINE_URL": os.environ["VB_STAGING_URL"].rstrip("/"),
        "VALORBRAIN_API_TOKEN": os.environ["VB_STAGING_MCP_TOKEN"],
        "VALORBRAIN_SEND_TRANSCRIPT": "on",
        "VALORBRAIN_SOURCE_AGENT": "hermes-e2e",
    })
    for leftover in ("VALORBRAIN_BIN", "VALORBRAIN_TENANT_ID", "VALORBRAIN_DEFAULT_TENANT_ID", "VALORBRAIN_RUN_KIND"):
        os.environ.pop(leftover, None)

    created: list[str] = []
    ok = True
    try:
        # Observe what the plugin sends to the engine (test side only; the plugin uses httpx).
        import httpx
        sent: list = []
        real_send = httpx.Client.send

        def observing_send(self, request, *a, **kw):
            resp = real_send(self, request, *a, **kw)
            if str(request.url).startswith(os.environ["VALORBRAIN_ENGINE_URL"]):
                hook = ""
                if request.url.path.endswith("/hooks/run"):
                    try:
                        payload = json.loads(request.content or b"{}")
                        hook = payload.get("hook", "")
                        if "transcript" in payload:
                            hook += f" (+transcript {len(payload['transcript'])} bytes)"
                        hook += f" [context {len(resp.json().get('context') or '')} chars]"
                    except Exception:
                        pass
                sent.append(f"{request.method} {request.url.path} {hook}".rstrip() + f" -> {resp.status_code}")
            return resp

        httpx.Client.send = observing_send

        agent_dir = Path(os.environ.get("HERMES_AGENT_DIR") or REAL_HERMES / "hermes-agent")
        sys.path.insert(0, str(agent_dir))
        from run_agent import AIAgent

        # 1. Hermes loads the provider.
        agent = AIAgent(base_url=llm.base_url, api_key="none", provider="custom", model="fake-model",
                        platform="cli", quiet_mode=True, skip_context_files=True,
                        enabled_toolsets=[], save_trajectories=False)
        providers = list(getattr(agent._memory_manager, "providers", []) or []) if agent._memory_manager else []
        provider = next((p for p in providers if p.name == "valorbrain"), None)
        log(f"memory providers active: {[p.name for p in providers]}")
        if provider is None:
            log("FAIL: valorbrain provider not active")
            return 1
        log(f"valorbrain loaded from {sys.modules[type(provider).__module__].__file__}")
        log(f"session_id={agent.session_id}")

        # 2. Store -> wait -> retrieve through the plugin's own tools (positive
        #    control), with REST /search as a second witness.
        topic = f"heron-{uuid.uuid4().hex[:8]}"
        codename = f"BLUE-LANTERN-{uuid.uuid4().hex[:6].upper()}"
        title = f"Project {topic} codename"
        stored = json.loads(provider.handle_tool_call("valorbrain_store", {
            "type": "decision", "title": title, "tags": ["hermes-e2e"],
            "content": f"Decision: the codename of project {topic} is {codename}.",
        }))
        log("valorbrain_store -> " + json.dumps({k: stored.get(k) for k in ("ok", "action", "docid", "collection", "path", "error")}))
        if stored.get("docid") is None:
            log("FAIL: store returned no docid")
            return 1
        created.append(str(stored["docid"]))
        t0 = time.time()
        last: dict = {}

        def retrieve_hit():
            last["out"] = provider.handle_tool_call("valorbrain_retrieve", {"query": title, "limit": 5})
            return topic in last["out"]
        retrieved = wait_for(retrieve_hit, timeout=60, step=1.0)
        log(f"valorbrain_retrieve found it after {time.time() - t0:.1f}s" if retrieved
            else f"valorbrain_retrieve did NOT find it within 60s; last answer: {last.get('out', '')[:300]}")
        found = wait_for(lambda: any(r.get("path") == stored.get("path") or r.get("title") == title
                                     for r in engine("POST", "/search", {"query": title, "limit": 5}).get("results", [])),
                         timeout=30, step=1.0)
        log(f"REST /search witness: {'found' if found else 'not found'}")
        ok &= bool(retrieved) and bool(found)
        time.sleep(5)  # embedding is asynchronous (~4 s): let vector recall see it too

        # 3. Two real turns through Hermes' loop; the recall for turn N is queued after turn N-1.
        r1 = agent.run_conversation(f"What is the codename of project {topic}?")
        wait_for(lambda: provider._prefetch_thread is not None and not provider._prefetch_thread.is_alive(),
                 timeout=120, step=0.5)
        r2 = agent.run_conversation("Thanks. Repeat it once more, please.", conversation_history=r1.get("messages"))

        users = llm.user_messages()
        log(f"model requests: {len(llm.requests)}; user turns seen by the model: {len(users)}")
        first = memory_block(next((u for u in users if topic in u and "Repeat" not in u), ""))
        second = memory_block(next((u for u in users if "Repeat it once more" in u), ""))
        log(f"turn 1 <memory-context> (session start: bootstrap + foundations): {len(first)} chars")
        log(f"turn 2 <memory-context> (recall for turn 1's prompt): {len(second)} chars; "
            f"vault-context={'<vault-context>' in second}; seeded memory in it={title in second or codename in second}")
        for ln in second.splitlines():
            if topic in ln or codename in ln:
                log(f"  recalled: {ln.strip()[:200]}")
        ok &= bool(first.strip()) and bool(second.strip())

        # 4. Session end: transcript to the hosted extraction hooks; the engine writes the handoff.
        transcript = Path(provider._transcript_path)
        agent.shutdown_memory_provider(r2.get("messages"))
        log(f"transcript lines written locally: {len(transcript.read_text().splitlines()) if transcript.exists() else 0}")
        log("plugin -> engine requests:")
        for line in sent:
            log(f"  {line}")

        def handoff():
            res = engine("GET", f"/documents?collection=_valorbrain&pattern=handoffs/*{agent.session_id}*")
            return res.get("documents") or res.get("results") or (res if isinstance(res, list) else [])
        docs = wait_for(handoff, timeout=90, step=3.0)
        if docs:
            d = docs[0]
            log(f"session end wrote: {d.get('path')} docid={d.get('docid') or d.get('id')}")
            created.extend(str(x.get("docid") or x.get("id")) for x in docs if (x.get("docid") or x.get("id")))
        else:
            log("session end: no handoff document found within 90s")
        ok &= bool(docs)
    finally:
        for docid in created:
            try:
                engine("POST", f"/documents/{docid.lstrip('#')}/forget", {})
                log(f"forgot {docid}")
            except Exception as exc:
                log(f"forget {docid} failed: {exc}")
        llm.close()
        if not args.keep:
            shutil.rmtree(tmp, ignore_errors=True)
    log("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

"""Run the packaged plugin inside the official Dify plugin runtime and call ValorBrain through it.

`dify plugin run <package>` (Dify plugin CLI, dify-plugin-daemon) unpacks the .difypkg, builds its
Python environment with uv, starts the plugin and accepts invoke requests on stdin. This script
sends the same requests the Dify API sends: validate the credentials, then Store memory, Search
memory (until the memory is searchable), Prepare context and Forget memory.

    VB_STAGING_URL=http://127.0.0.1:7439 VB_STAGING_MCP_TOKEN=vbm_... \\
        python scripts/daemon_check.py --cli ./dify --package valorbrain-0.1.0.difypkg

The token goes to the plugin process inside the request JSON on stdin and is never printed.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import uuid

PRODUCTION_HOSTS = ("valorbrain-api.valor.digital", "mcpbrain.valor.digital")


class Runtime:
    def __init__(self, cli: str, package: str) -> None:
        self.process = subprocess.Popen(
            [cli, "plugin", "run", package, "--response-format", "json"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        self._wait_for("plugin_ready", None, timeout=300)

    def _read(self) -> dict:
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError("the plugin runtime exited")
        return json.loads(line) if line.strip().startswith("{") else {}

    def _wait_for(self, kind: str, invoke_id: str | None, timeout: float) -> list[dict]:
        responses: list[dict] = []
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            message = self._read()
            if invoke_id is not None and message.get("invoke_id") not in ("", invoke_id):
                continue
            if message.get("type") == "error":
                raise RuntimeError(f"plugin error: {message.get('response', {}).get('error')}")
            if message.get("type") == "plugin_response":
                responses.append(message["response"])
            if message.get("type") == kind:
                return responses
        raise TimeoutError(f"no {kind} within {timeout} s")

    def call(self, action: str, request: dict, user_id: str) -> list[dict]:
        invoke_id = uuid.uuid4().hex
        payload = {"invoke_id": invoke_id, "type": "tool", "action": action,
                   "request": {"type": "tool", "action": action, "user_id": user_id, **request}}
        self.process.stdin.write(json.dumps(payload) + "\n")
        self.process.stdin.flush()
        return self._wait_for("plugin_invoke_end", invoke_id, timeout=120)

    def tool(self, name: str, parameters: dict, credentials: dict, user_id: str) -> tuple[str, dict]:
        responses = self.call(
            "invoke_tool",
            {"provider": "valorbrain", "tool": name, "credentials": credentials, "tool_parameters": parameters},
            user_id,
        )
        text, data = "", {}
        for response in responses:
            if response.get("type") == "text":
                text += response["message"]["text"]
            elif response.get("type") == "json":
                data = response["message"]["json_object"]
        return text, data

    def close(self) -> None:
        self.process.terminate()
        self.process.wait(timeout=30)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cli", required=True, help="path to the dify plugin CLI binary")
    parser.add_argument("--package", required=True, help="path to the .difypkg")
    args = parser.parse_args()

    url, token = os.environ.get("VB_STAGING_URL", ""), os.environ.get("VB_STAGING_MCP_TOKEN", "")
    if not (url and token):
        print("Set VB_STAGING_URL and VB_STAGING_MCP_TOKEN.", file=sys.stderr)
        return 2
    if any(host in url for host in PRODUCTION_HOSTS):
        print("This check never runs against production.", file=sys.stderr)
        return 2

    credentials = {"api_token": token, "api_url": url}
    run_id = uuid.uuid4().hex[:10]
    user_id = f"daemon-{run_id}"
    marker = f"cobalt-lantern-{run_id}"
    scope = {"scope": "dify_user"}

    runtime = Runtime(args.cli, args.package)
    try:
        print("0. Runtime: plugin loaded by `dify plugin run`.")
        result = runtime.call("validate_tool_credentials", {"provider": "valorbrain", "credentials": credentials},
                              user_id)
        print(f"1. Validate credentials: {result}")
        wrong = {"api_token": "vbm_" + "0" * 32, "api_url": url}
        try:
            runtime.call("validate_tool_credentials", {"provider": "valorbrain", "credentials": wrong}, user_id)
            print("1b. Validate a wrong token: ACCEPTED (unexpected)")
            return 1
        except RuntimeError as error:
            print(f"1b. Validate a wrong token: refused ({error})")

        text, data = runtime.tool(
            "store_memory",
            {"title": f"Dify daemon check {run_id}", "content": f"The daemon check {run_id} hangs a {marker} on the porch.",
             "type": "observation", "fail_open": False, **scope},
            credentials, user_id,
        )
        print(f"2. Store memory: {text}")

        started, hits = time.monotonic(), []
        while time.monotonic() - started < 30 and not hits:
            text, data = runtime.tool("search_memory", {"query": marker, **scope}, credentials, user_id)
            hits = [r for r in data.get("results", []) if marker in str(r.get("snippet"))]
            if not hits:
                time.sleep(2)
        if not hits:
            print("3. Search memory: NOT FOUND within 30 s")
            return 1
        print(f"3. Search memory: found #{hits[0]['docid']} after {time.monotonic() - started:.1f} s")

        text, _ = runtime.tool("prepare_context", {"message": f"Where is the {marker}?", "fail_open": False, **scope},
                               credentials, user_id)
        context_ok = marker in text
        print(f"4. Prepare context: marker {'present' if context_ok else 'MISSING'} ({len(text)} chars)")

        text, _ = runtime.tool("forget_memory", {"docid": f"#{hits[0]['docid']}", **scope}, credentials, user_id)
        print(f"5. Forget memory: {text}")

        _, data = runtime.tool("search_memory", {"query": marker, **scope}, credentials, user_id)
        left = [r for r in data.get("results", []) if marker in str(r.get("snippet"))]
        print(f"6. Search after forget: {len(left)} hit(s)")
        return 0 if context_ok and not left else 1
    finally:
        runtime.close()


if __name__ == "__main__":
    raise SystemExit(main())

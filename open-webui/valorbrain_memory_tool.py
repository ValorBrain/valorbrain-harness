"""
title: ValorBrain Memory Tools
author: ValorBrain
author_url: https://github.com/ValorBrain/valorbrain-harness
funding_url: https://valorbrain.com.br
version: 0.1.0
license: MIT
required_open_webui_version: 0.9.0
description: Lets the model search ValorBrain memory and save a memory on request. Pairs with the ValorBrain Memory filter.
"""

# Explicit ValorBrain memory tools for Open WebUI: the model calls them when
# the user asks to look something up in memory or to remember something.
# Standard library only. Errors come back as a short text result instead of
# raising, so a ValorBrain outage never breaks the chat.

import asyncio
import json
import re
import urllib.error
import urllib.request
from typing import Optional

from pydantic import BaseModel, Field

VERSION = "0.1.0"
USER_AGENT = f"valorbrain-openwebui/{VERSION}"

_REDACTED = "[redacted]"
# Same list as valorbrain_memory_filter.py (each Open WebUI plugin is one file).
_SECRET_PATTERNS: list[tuple[re.Pattern, Optional[int]]] = [
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"), None),
    (re.compile(r"\b(?:ghp_|gho_|ghs_|ghu_)[A-Za-z0-9]{20,}\b"), None),
    (re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b"), None),
    (re.compile(r"\bglpat-[A-Za-z0-9_\-]{20,}\b"), None),
    (re.compile(r"\bsk-(?:or-v1-|ant-|proj-)[A-Za-z0-9_\-]{20,}"), None),
    (re.compile(r"\bsk-[A-Za-z0-9]{32,}\b"), None),
    (re.compile(r"\b(?:vb_admin_|vbm_)[A-Za-z0-9_]{20,}\b"), None),
    (re.compile(r"\bvb_(?:[A-Za-z0-9]+_)*(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{16,}\b"), None),
    (re.compile(r"\bcf[au]t_[A-Za-z0-9_\-]{30,}"), None),
    (re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"), None),
    (re.compile(r"\bxox[baprs]-[A-Za-z0-9\-]{10,}\b"), None),
    (re.compile(r"\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b"), None),
    (re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}"), None),
    (re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/\-]{20,}=*"), None),
    (re.compile(r"(?i)\b[a-z][a-z0-9+.\-]*://[^\s/:@'\"\[]{1,64}:([^\s/@'\"\[\]]{6,128})@"), 1),
    (
        re.compile(
            r"(?i)\b[A-Z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|PRIVATE_?KEY|CREDENTIAL)[A-Z0-9_]*"
            r"\s*[:=]\s*[\"']?((?=[^\s\"']*\d)[^\s\"']{8,})"
        ),
        1,
    ),
]


def redact_secrets(text: str) -> str:
    """Replace obvious credentials in `text` with [redacted]."""
    if not text:
        return text
    for pattern, group in _SECRET_PATTERNS:
        if group is None:
            text = pattern.sub(_REDACTED, text)
        else:
            text = pattern.sub(
                lambda m, g=group: m.group(0)[: m.start(g) - m.start(0)]
                + _REDACTED
                + m.group(0)[m.end(g) - m.start(0) :],
                text,
            )
    return text


def _post_json(base_url: str, path: str, token: str, payload: dict, timeout: float) -> dict:
    url = base_url.rstrip("/") + path
    if not url.startswith(("https://", "http://")):
        raise ValueError("ValorBrain api_url must start with http:// or https://")
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"ValorBrain {path} returned HTTP {error.code}") from None
    data = json.loads(raw.decode("utf-8") or "{}")
    if not isinstance(data, dict):
        raise RuntimeError(f"ValorBrain {path} returned a non-object response")
    return data


class Tools:
    class Valves(BaseModel):
        api_url: str = Field(
            default="https://valorbrain-api.valor.digital",
            description="ValorBrain REST base URL.",
        )
        api_token: str = Field(
            default="",
            description="ValorBrain token (vbm_... or vb_agent_...). Users may override it in their own valves.",
            json_schema_extra={"input": {"type": "password"}},
        )
        collection: str = Field(
            default="",
            description="Collection to search and save into. Empty = the token's own agent collection.",
        )
        max_results: int = Field(default=8, description="Upper bound on search results returned to the model.")
        require_user_token: bool = Field(
            default=False,
            description="Only act for users who set their own token (the admin token is never used for them).",
        )
        timeout_seconds: float = Field(default=8.0, description="Timeout for each ValorBrain call.")

    class UserValves(BaseModel):
        api_token: str = Field(
            default="",
            description="My own ValorBrain token. Empty = the admin's token.",
            json_schema_extra={"input": {"type": "password"}},
        )

    def __init__(self):
        self.valves = self.Valves()

    def _token(self, __user__: Optional[dict]) -> str:
        user_valves = (__user__ or {}).get("valves")
        if isinstance(user_valves, dict):
            user_token = user_valves.get("api_token", "")
        else:
            user_token = getattr(user_valves, "api_token", "")
        user_token = (user_token or "").strip()
        if self.valves.require_user_token:
            return user_token
        return user_token or (self.valves.api_token or "").strip()

    async def _call(self, path: str, token: str, payload: dict) -> dict:
        return await asyncio.to_thread(
            _post_json, self.valves.api_url, path, token, payload, float(self.valves.timeout_seconds)
        )

    async def search_memory(self, query: str, limit: int = 5, __user__: Optional[dict] = None) -> str:
        """
        Search the user's long-term ValorBrain memory. Use it when the user refers to past work,
        decisions, people or facts that are not in this conversation.
        :param query: What to look for, in natural language.
        :param limit: How many results to return (1-8).
        :return: Matching memories with title, id and a short excerpt.
        """
        token = self._token(__user__)
        if not token:
            return "ValorBrain is not configured (no API token)."
        query = redact_secrets((query or "").strip())
        if not query:
            return "Empty query."
        payload: dict = {
            "query": query[:2000],
            "limit": max(1, min(int(limit or 5), int(self.valves.max_results))),
        }
        if self.valves.collection.strip():
            payload["collection"] = self.valves.collection.strip()
        try:
            result = await self._call("/search", token, payload)
        except Exception as error:
            return f"ValorBrain search failed: {error}"
        hits = result.get("results") or []
        if not hits:
            return "No matching memories."
        lines = []
        for hit in hits:
            if not isinstance(hit, dict):
                continue
            title = hit.get("title") or hit.get("path") or "untitled"
            docid = hit.get("docid") or ""
            excerpt = " ".join(str(hit.get("snippet") or hit.get("content") or "").split())[:400]
            lines.append(f"- {title} ({docid})" + (f": {excerpt}" if excerpt else ""))
        return "ValorBrain memories:\n" + "\n".join(lines)

    async def remember(self, title: str, content: str, __user__: Optional[dict] = None) -> str:
        """
        Save something to the user's long-term ValorBrain memory. Use it only when the user asks
        you to remember, note or save something. Never save passwords, keys or tokens.
        :param title: Short title for the memory (at least 5 characters).
        :param content: The fact, decision or note to remember, self-contained (at least 20 characters).
        :return: Confirmation with the memory id, or the reason it was not saved.
        """
        token = self._token(__user__)
        if not token:
            return "ValorBrain is not configured (no API token)."
        title = redact_secrets(" ".join((title or "").split()))[:200]
        content = redact_secrets((content or "").strip())
        if len(title) < 5 or len(content) < 20:
            return "Not saved: the title needs 5+ characters and the content 20+."
        payload: dict = {
            "title": title,
            "content": content[:20000],
            "type": "note",
            "tags": ["open-webui", "explicit"],
        }
        if self.valves.collection.strip():
            payload["collection"] = self.valves.collection.strip()
        try:
            result = await self._call("/api/v1/memory/store", token, payload)
        except Exception as error:
            return f"ValorBrain save failed: {error}"
        # /api/v1/memory/store answers with the document path and an internal numeric id;
        # the path is the stable, human-readable handle.
        return f"Saved to ValorBrain ({result.get('path') or result.get('docid') or 'ok'})."

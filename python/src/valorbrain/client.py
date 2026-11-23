"""Minimal synchronous REST client for the ValorBrain engine (stdlib only)."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any, Literal, Sequence

from ._version import __version__
from .errors import APIConnectionError, error_for_status

DEFAULT_BASE_URL = "https://valorbrain-api.valor.digital"

SearchMode = Literal["auto", "keyword", "semantic", "hybrid"]
Profile = Literal["speed", "balanced", "deep"]


def _iso(value: datetime | str | None) -> str | None:
    if value is None or isinstance(value, str):
        return value
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def _drop_none(data: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in data.items() if v is not None}


def _bare_docid(docid: str | int) -> str:
    return str(docid).lstrip("#")


class ValorBrain:
    """Small client for the ValorBrain REST API.

    Every method maps to one documented route and returns the decoded JSON
    (``search`` and ``list_documents`` return the result list). Errors raise a
    subclass of :class:`valorbrain.errors.ValorBrainError`.

    Args:
        api_key: ``vbm_…`` (preferred) or ``vb_agent_…`` token. Defaults to
            ``$VALORBRAIN_API_KEY``. The tenant is derived from the token.
        base_url: Engine URL. Defaults to ``$VALORBRAIN_URL`` or production.
        timeout: Per-request timeout in seconds.
        integration: Name sent in ``User-Agent`` (``valorbrain-<integration>/<version>``).
    """

    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str | None = None,
        timeout: float = 30.0,
        integration: str = "python",
    ) -> None:
        key = api_key or os.environ.get("VALORBRAIN_API_KEY")
        if not key:
            raise ValueError(
                "ValorBrain API key missing: pass api_key= or set VALORBRAIN_API_KEY"
            )
        self._api_key = key
        self.base_url = (
            base_url or os.environ.get("VALORBRAIN_URL") or DEFAULT_BASE_URL
        ).rstrip("/")
        self.timeout = timeout
        self.user_agent = f"valorbrain-{integration}/{__version__}"

    def __repr__(self) -> str:  # never show the token
        return f"ValorBrain(base_url={self.base_url!r})"

    # ------------------------------------------------------------------ http
    def request(
        self,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Send one request and return the decoded JSON body."""
        url = self.base_url + path
        if params:
            url += "?" + urllib.parse.urlencode(_drop_none(params))
        data = None
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "User-Agent": self.user_agent,
            "Accept": "application/json",
        }
        if json_body is not None:
            data = json.dumps(json_body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as exc:
            raw = exc.read()
            body: Any
            try:
                body = json.loads(raw) if raw else None
            except ValueError:
                body = raw.decode("utf-8", "replace")
            message = body.get("error") if isinstance(body, dict) else None
            raise error_for_status(
                exc.code, f"{method} {path} -> {exc.code}: {message or exc.reason}", body
            ) from None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            reason = getattr(exc, "reason", exc)
            raise APIConnectionError(f"{method} {path}: {reason}") from None
        return json.loads(raw) if raw else None

    # ---------------------------------------------------------------- memory
    def store(
        self,
        title: str,
        content: str,
        *,
        type: str | None = None,
        tags: Sequence[str] | None = None,
        collection: str | None = None,
        confidence: float | None = None,
    ) -> dict[str, Any]:
        """``POST /api/v1/memory/store`` - persist a typed memory.

        ``type`` is one of decision, observation, problem, milestone, handoff,
        lesson, note. The engine requires ``title`` >= 5 and ``content`` >= 20
        characters. Without ``collection`` it lands in the caller agent's collection.
        """
        return self.request(
            "POST",
            "/api/v1/memory/store",
            json_body=_drop_none(
                {
                    "title": title,
                    "content": content,
                    "type": type,
                    "tags": list(tags) if tags is not None else None,
                    "collection": collection,
                    "confidence": confidence,
                }
            ),
        )

    def write_document(
        self,
        collection: str,
        path: str,
        content: str,
        *,
        title: str | None = None,
        content_type: str | None = None,
        metadata: dict[str, Any] | None = None,
        event_at: datetime | str | None = None,
        user_id: str | None = None,
        run_id: str | None = None,
        confidence: float | None = None,
    ) -> dict[str, Any]:
        """``POST /documents`` - upsert a document by ``collection`` + ``path``.

        ``event_at`` is when the fact happened (not when it was written); naive
        datetimes are treated as UTC.
        """
        return self.request(
            "POST",
            "/documents",
            json_body=_drop_none(
                {
                    "collection": collection,
                    "path": path,
                    "content": content,
                    "title": title,
                    "content_type": content_type,
                    "metadata": metadata,
                    "event_at": _iso(event_at),
                    "user_id": user_id,
                    "run_id": run_id,
                    "confidence": confidence,
                }
            ),
        )

    def prepare(
        self,
        message: str,
        *,
        collection: str | None = None,
        recall_budget: int | None = None,
        fast_mode: bool | None = None,
        include_recall: bool | None = None,
        episode_id: str | None = None,
    ) -> dict[str, Any]:
        """``POST /api/v1/memory/prepare`` - context ready to inject.

        The ``markdown`` key of the result is the block to put in a prompt.
        """
        return self.request(
            "POST",
            "/api/v1/memory/prepare",
            json_body=_drop_none(
                {
                    "message": message,
                    "collection": collection,
                    "recall_budget": recall_budget,
                    "fast_mode": fast_mode,
                    "include_recall": include_recall,
                    "episode_id": episode_id,
                }
            ),
        )

    def search(
        self,
        query: str,
        *,
        limit: int | None = None,
        mode: SearchMode | None = None,
        collection: str | None = None,
        profile: Profile | None = None,
        compact: bool | None = None,
    ) -> list[dict[str, Any]]:
        """``POST /search`` - ranked results (``docid``, ``path``, ``title``, ``score``, ``snippet``…).

        ``compact=False`` also returns each document's ``body``.
        """
        data = self.request(
            "POST",
            "/search",
            json_body=_drop_none(
                {
                    "query": query,
                    "limit": limit,
                    "mode": mode,
                    "collection": collection,
                    "profile": profile,
                    "compact": compact,
                }
            ),
        )
        return list((data or {}).get("results") or [])

    def get_document(self, docid: str | int) -> dict[str, Any]:
        """``GET /documents/{id}`` - one document by docid."""
        return self.request(
            "GET", "/documents/" + urllib.parse.quote(_bare_docid(docid), safe="")
        )

    def list_documents(
        self,
        pattern: str,
        *,
        collection: str | None = None,
        max_bytes: int | None = None,
    ) -> list[dict[str, Any]]:
        """``GET /documents?pattern=`` - documents whose path matches a glob.

        ``*`` stays inside one path segment, ``**`` crosses segments. The engine
        caps the total body payload at ``max_bytes`` (default 10240).
        """
        data = self.request(
            "GET",
            "/documents",
            params={"pattern": pattern, "collection": collection, "max_bytes": max_bytes},
        )
        return list((data or {}).get("documents") or [])

    def forget(self, docid: str | int) -> dict[str, Any]:
        """``POST /documents/{id}/forget`` - remove a document from recall."""
        return self.request(
            "POST",
            "/documents/" + urllib.parse.quote(_bare_docid(docid), safe="") + "/forget",
        )

    def used(
        self,
        docids: Sequence[str],
        *,
        verdict: Literal["confirmed", "corrected"] | None = None,
        note: str | None = None,
    ) -> dict[str, Any]:
        """``POST /api/v1/memory/used`` - declare which memories informed an answer.

        Accepts docids (``"#ab12cd"`` or ``"ab12cd"``) or document paths.
        """
        ids = [d if "/" in d or d.startswith("#") else f"#{d}" for d in docids]
        return self.request(
            "POST",
            "/api/v1/memory/used",
            json_body=_drop_none({"docids": ids, "verdict": verdict, "note": note}),
        )

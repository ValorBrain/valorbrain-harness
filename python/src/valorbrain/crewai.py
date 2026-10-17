"""CrewAI memory backed by ValorBrain.

Requires ``crewai`` >= 1.14 (unified ``Memory``; ``pip install valorbrain[crewai]``).

``ValorBrainMemory`` is a drop-in ``crewai.Memory``: pass it as ``Crew(memory=…)``
or ``Agent(memory=…)``. CrewAI then calls ``recall`` before each task and
``extract_memories`` + ``remember_many`` after it; both go to ValorBrain instead
of the local LanceDB store, and neither needs an embedding model or an LLM on
the CrewAI side (ValorBrain embeds and ranks server-side).

Failures never break the crew: a ValorBrain error is logged, ``remember``
returns ``None`` and ``recall`` returns ``[]``. Automatically captured text is
passed through :func:`valorbrain.redact` before it leaves the machine.
"""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone
from typing import Any, Literal

from crewai.memory.types import MemoryMatch, MemoryRecord, ScopeInfo
from crewai.memory.unified_memory import Memory
from pydantic import Field, PrivateAttr

from .client import ValorBrain
from .errors import NotFoundError, ValorBrainError
from .redact import redact

logger = logging.getLogger("valorbrain.crewai")


class _UnusedStorage:
    """Placeholder so ``Memory`` never builds a local LanceDB store.

    Only the browsing helpers (``list_records``, ``tree``, ``info``…) reach it;
    they report an empty local store because the records live in ValorBrain.
    """

    def save(self, records: list[MemoryRecord]) -> None: ...
    def search(self, *args: Any, **kwargs: Any) -> list[tuple[MemoryRecord, float]]:
        return []
    def delete(self, *args: Any, **kwargs: Any) -> int:
        return 0
    def update(self, record: MemoryRecord) -> None: ...
    def get_record(self, record_id: str) -> MemoryRecord | None:
        return None
    def list_records(self, *args: Any, **kwargs: Any) -> list[MemoryRecord]:
        return []
    def get_scope_info(self, scope: str) -> ScopeInfo:
        return ScopeInfo(path=scope)
    def list_scopes(self, parent: str = "/") -> list[str]:
        return []
    def list_categories(self, scope_prefix: str | None = None) -> dict[str, int]:
        return {}
    def count(self, scope_prefix: str | None = None) -> int:
        return 0
    def reset(self, scope_prefix: str | None = None) -> None: ...
    async def asave(self, records: list[MemoryRecord]) -> None: ...
    async def asearch(self, *args: Any, **kwargs: Any) -> list[tuple[MemoryRecord, float]]:
        return []
    async def adelete(self, *args: Any, **kwargs: Any) -> int:
        return 0


def _scope_path(*parts: str | None) -> str:
    segs: list[str] = []
    for p in parts:
        if p:
            segs.extend(s for s in p.strip("/").split("/") if s)
    return "/".join(segs)


def _title(content: str) -> str:
    first = content.strip().splitlines()[0] if content.strip() else "CrewAI memory"
    title = first[:80].strip()
    return title if len(title) >= 5 else f"CrewAI memory: {title}"


class ValorBrainMemory(Memory):
    """CrewAI ``Memory`` that stores and recalls through ValorBrain.

    Args:
        client: :class:`valorbrain.ValorBrain`; defaults to one built from env.
        collection: Collection where memories are written (default ``crewai``).
        recall_collection: Collection searched on recall. ``None`` (default)
            searches every memory the token can read, so the crew sees what
            other agents of the tenant recorded.
        extract_with_llm: Use CrewAI's LLM to split task output into discrete
            memories before saving. Default ``False``: the raw (redacted) task
            summary is stored as one memory and ValorBrain extracts server-side.
        redact_secrets: Redact obvious secrets before sending (default ``True``).
    """

    client: Any = Field(default=None, exclude=True)
    collection: str = "crewai"
    recall_collection: str | None = None
    extract_with_llm: bool = False
    redact_secrets: bool = True
    storage: Any = Field(default_factory=_UnusedStorage)

    _vb: ValorBrain = PrivateAttr()

    def model_post_init(self, __context: Any) -> None:
        super().model_post_init(__context)
        self._vb = self.client or ValorBrain(integration="crewai")

    # ------------------------------------------------------------ writing
    def extract_memories(self, content: str) -> list[str]:
        if self.extract_with_llm:
            return super().extract_memories(content)
        return [content] if content.strip() else []

    def remember(
        self,
        content: str,
        scope: str | None = None,
        categories: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        importance: float | None = None,
        source: str | None = None,
        private: bool = False,
        agent_role: str | None = None,
        root_scope: str | None = None,
    ) -> MemoryRecord | None:
        if self.read_only or not content.strip():
            return None
        text = redact(content) if self.redact_secrets else content
        root = root_scope if root_scope is not None else self.root_scope
        scope_path = _scope_path(root, scope)
        now = datetime.now(timezone.utc)
        name = f"{now.strftime('%Y%m%dT%H%M%S%fZ')}-{secrets.token_hex(3)}.md"
        meta: dict[str, Any] = {
            "scope": "/" + scope_path,
            "categories": categories or [],
            "importance": importance if importance is not None else self.default_importance,
            "source": source,
            "private": private,
            "agent_role": agent_role,
            **(metadata or {}),
        }
        try:
            res = self._vb.write_document(
                self.collection,
                f"{scope_path}/{name}" if scope_path else name,
                text,
                title=_title(text),
                content_type="note",
                metadata={k: v for k, v in meta.items() if v is not None},
                event_at=now,
            )
        except ValorBrainError as exc:
            logger.warning("ValorBrain remember failed: %s", exc)
            return None
        return MemoryRecord(
            id=str(res.get("docid") or res.get("id") or ""),
            content=text,
            scope="/" + scope_path,
            categories=categories or [],
            metadata=metadata or {},
            importance=meta["importance"],
            created_at=now.replace(tzinfo=None),
            last_accessed=now.replace(tzinfo=None),
            source=source,
            private=private,
        )

    def remember_many(
        self,
        contents: list[str],
        scope: str | None = None,
        categories: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        importance: float | None = None,
        source: str | None = None,
        private: bool = False,
        agent_role: str | None = None,
        root_scope: str | None = None,
    ) -> list[MemoryRecord]:
        records = []
        for content in contents:
            rec = self.remember(
                content,
                scope=scope,
                categories=categories,
                metadata=metadata,
                importance=importance,
                source=source,
                private=private,
                agent_role=agent_role,
                root_scope=root_scope,
            )
            if rec is not None:
                records.append(rec)
        return records

    def drain_writes(self) -> None:
        """Writes are synchronous; nothing to wait for."""

    # ------------------------------------------------------------ reading
    def recall(
        self,
        query: str,
        scope: str | None = None,
        categories: list[str] | None = None,
        limit: int = 10,
        depth: Literal["shallow", "deep"] = "deep",
        source: str | None = None,
        include_private: bool = False,
    ) -> list[MemoryMatch]:
        scope_path = _scope_path(self.root_scope, scope)
        collection = self.recall_collection
        if scope_path:
            collection = self.collection
        try:
            results = self._vb.search(
                query, limit=limit, collection=collection, compact=False
            )
        except ValorBrainError as exc:
            logger.warning("ValorBrain recall failed: %s", exc)
            return []
        matches: list[MemoryMatch] = []
        for r in results:
            path = str(r.get("path") or "")
            if scope_path and not path.startswith(f"{self.collection}/{scope_path}/"):
                continue
            meta = {k: r.get(k) for k in ("title", "path", "eventAt") if r.get(k)}
            matches.append(
                MemoryMatch(
                    record=MemoryRecord(
                        id=str(r.get("docid") or path),
                        content=r.get("body") or r.get("snippet") or "",
                        metadata=meta,
                    ),
                    score=float(r.get("score") or 0.0),
                    match_reasons=["valorbrain"],
                )
            )
        return matches

    # ----------------------------------------------------------- deleting
    def forget(
        self,
        scope: str | None = None,
        categories: list[str] | None = None,
        older_than: datetime | None = None,
        metadata_filter: dict[str, Any] | None = None,
        record_ids: list[str] | None = None,
    ) -> int:
        """Forget memories by ``record_ids`` (ValorBrain docids).

        Bulk deletes by scope/category/age are not supported remotely and raise
        ``NotImplementedError``.
        """
        if not record_ids:
            raise NotImplementedError(
                "ValorBrainMemory.forget supports record_ids only"
            )
        removed = 0
        for rid in record_ids:
            try:
                self._vb.forget(rid)
                removed += 1
            except NotFoundError:
                continue
        return removed

    def reset(self, scope: str | None = None) -> None:
        """No-op: bulk-wiping shared tenant memory from a crew is refused."""
        logger.warning(
            "ValorBrainMemory.reset is a no-op; forget specific record_ids instead"
        )

    def reset_all(self) -> None:
        self.reset()

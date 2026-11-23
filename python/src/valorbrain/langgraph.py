"""LangGraph long-term memory store backed by ValorBrain documents.

Requires ``langgraph`` (``pip install valorbrain[langgraph]``).

Layout: every item lives in one collection (default ``langgraph``). A put writes
a new document at ``<ns1>/<ns2>/…/<key>/<updated_ms>-<created_ms>-<rand>.json``
(segments percent-encoded) whose body is the JSON value, then forgets the older
versions of that key. Writing a fresh path on every put keeps put-after-delete
working: the engine does not revive a path that was forgotten. Semantic search
uses ValorBrain's own ranking, so no ``index`` / embedding config is needed.
"""

from __future__ import annotations

import asyncio
import json
import secrets
import time
import urllib.parse
from collections.abc import Iterable
from datetime import datetime, timezone
from typing import Any

from langgraph.store.base import (
    BaseStore,
    GetOp,
    Item,
    ListNamespacesOp,
    MatchCondition,
    Op,
    PutOp,
    Result,
    SearchItem,
    SearchOp,
)

from .client import ValorBrain
from .errors import NotFoundError


def _enc(segment: str) -> str:
    if segment == "":
        return "~"
    return urllib.parse.quote(segment, safe="").replace(".", "%2E").replace("~", "%7E")


def _dec(segment: str) -> str:
    return "" if segment == "~" else urllib.parse.unquote(segment)


def _ms_to_dt(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc)


def _compare(item_value: Any, filter_value: Any) -> bool:
    """JSONB-like comparison, same semantics as LangGraph's ``InMemoryStore``."""
    if isinstance(filter_value, dict):
        if any(k.startswith("$") for k in filter_value):
            return all(_operator(item_value, k, v) for k, v in filter_value.items())
        if not isinstance(item_value, dict):
            return False
        return all(_compare(item_value.get(k), v) for k, v in filter_value.items())
    if isinstance(filter_value, (list, tuple)):
        return (
            isinstance(item_value, (list, tuple))
            and len(item_value) == len(filter_value)
            and all(_compare(a, b) for a, b in zip(item_value, filter_value))
        )
    return item_value == filter_value


def _operator(value: Any, op: str, target: Any) -> bool:
    if op == "$eq":
        return value == target
    if op == "$ne":
        return value != target
    if value is None:
        return False
    if op == "$gt":
        return float(value) > float(target)
    if op == "$gte":
        return float(value) >= float(target)
    if op == "$lt":
        return float(value) < float(target)
    if op == "$lte":
        return float(value) <= float(target)
    raise ValueError(f"Unsupported operator: {op}")


def _matches(condition: MatchCondition, ns: tuple[str, ...]) -> bool:
    path = tuple(condition.path)
    if len(ns) < len(path):
        return False
    pairs = (
        zip(ns, path)
        if condition.match_type == "prefix"
        else zip(reversed(ns), reversed(path))
    )
    return all(p == "*" or n == p for n, p in pairs)


class _Version:
    __slots__ = ("namespace", "key", "updated_ms", "created_ms", "name", "doc")

    def __init__(self, namespace, key, updated_ms, created_ms, name, doc):
        self.namespace: tuple[str, ...] = namespace
        self.key: str = key
        self.updated_ms: int = updated_ms
        self.created_ms: int = created_ms
        self.name: str = name
        self.doc: dict[str, Any] = doc


class ValorBrainStore(BaseStore):
    """``BaseStore`` implementation on top of the ValorBrain REST API.

    Args:
        client: A :class:`valorbrain.ValorBrain`; defaults to one built from env.
        collection: ValorBrain collection holding the store (default ``langgraph``).
    """

    supports_ttl = False
    list_max_bytes = 2_000_000

    def __init__(self, client: ValorBrain | None = None, *, collection: str = "langgraph"):
        self.client = client or ValorBrain(integration="langgraph")
        self.collection = collection

    # ------------------------------------------------------------- helpers
    def _parse(self, doc: dict[str, Any]) -> _Version | None:
        path = str(doc.get("path") or doc.get("filepath") or "")
        prefix = self.collection + "/"
        if path.startswith(prefix):
            path = path[len(prefix):]
        parts = path.split("/")
        if len(parts) < 3 or not parts[-1].endswith(".json"):
            return None
        stamp = parts[-1][: -len(".json")].split("-")
        if len(stamp) != 3 or not (stamp[0].isdigit() and stamp[1].isdigit()):
            return None
        namespace = tuple(_dec(p) for p in parts[:-2])
        return _Version(namespace, _dec(parts[-2]), int(stamp[0]), int(stamp[1]), parts[-1], doc)

    def _list(self, pattern: str) -> list[_Version]:
        docs = self.client.list_documents(
            pattern, collection=self.collection, max_bytes=self.list_max_bytes
        )
        return [v for v in map(self._parse, docs) if v is not None]

    def _key_dir(self, namespace: tuple[str, ...], key: str) -> str:
        return "/".join(_enc(s) for s in (*namespace, key))

    def _versions(self, namespace: tuple[str, ...], key: str) -> list[_Version]:
        return self._list(self._key_dir(namespace, key) + "/*")

    @staticmethod
    def _latest(versions: Iterable[_Version]) -> dict[tuple[tuple[str, ...], str], _Version]:
        latest: dict[tuple[tuple[str, ...], str], _Version] = {}
        for v in versions:
            cur = latest.get((v.namespace, v.key))
            if cur is None or v.name > cur.name:
                latest[(v.namespace, v.key)] = v
        return latest

    def _value(self, v: _Version) -> dict[str, Any]:
        body = v.doc.get("body")
        length = v.doc.get("bodyLength")
        if body is None or (isinstance(length, int) and len(body) < length):
            docid = v.doc.get("docid")
            body = self.client.get_document(docid).get("body") if docid else body
        try:
            value = json.loads(body or "null")
        except ValueError:
            value = None
        return value if isinstance(value, dict) else {"content": body}

    def _item(self, v: _Version) -> Item:
        return Item(
            value=self._value(v),
            key=v.key,
            namespace=v.namespace,
            created_at=_ms_to_dt(v.created_ms),
            updated_at=_ms_to_dt(v.updated_ms),
        )

    def _forget(self, versions: Iterable[_Version]) -> None:
        for v in versions:
            docid = v.doc.get("docid")
            if not docid:
                continue
            try:
                self.client.forget(docid)
            except NotFoundError:
                pass

    # ----------------------------------------------------------------- ops
    def _get(self, op: GetOp) -> Item | None:
        latest = self._latest(self._versions(op.namespace, op.key))
        v = latest.get((op.namespace, op.key))
        return self._item(v) if v else None

    def _put(self, op: PutOp) -> None:
        old = self._versions(op.namespace, op.key)
        if op.value is None:
            self._forget(old)
            return
        now = max([int(time.time() * 1000)] + [v.updated_ms + 1 for v in old])
        created = min((v.created_ms for v in old), default=now)
        name = f"{now:013d}-{created:013d}-{secrets.token_hex(3)}.json"
        self.client.write_document(
            self.collection,
            self._key_dir(op.namespace, op.key) + "/" + name,
            json.dumps(op.value, ensure_ascii=False, sort_keys=True, default=str),
            title="/".join((*op.namespace, op.key)),
            metadata={"langgraph_namespace": list(op.namespace), "langgraph_key": op.key},
        )
        self._forget(old)

    def _search(self, op: SearchOp) -> list[SearchItem]:
        prefix = tuple(op.namespace_prefix)
        n = len(prefix)
        if op.query:
            want = min(100, max(op.limit + op.offset, 10) * 3)
            results = self.client.search(
                op.query, limit=want, collection=self.collection, compact=False
            )
            scored: list[tuple[_Version, float]] = []
            for r in results:
                v = self._parse(r)
                if v is not None and v.namespace[:n] == prefix:
                    scored.append((v, float(r.get("score") or 0.0)))
            latest = self._latest(v for v, _ in scored)
            score_of = {id(v): s for v, s in scored}
            ordered = sorted(latest.values(), key=lambda v: score_of[id(v)], reverse=True)
        else:
            pattern = (self._key_dir(prefix[:-1], prefix[-1]) + "/**") if n else "**"
            latest = self._latest(v for v in self._list(pattern) if v.namespace[:n] == prefix)
            score_of = {}
            ordered = sorted(latest.values(), key=lambda v: v.updated_ms, reverse=True)

        out: list[SearchItem] = []
        skipped = 0
        for v in ordered:
            value = self._value(v)
            if op.filter and not all(_compare(value.get(k), f) for k, f in op.filter.items()):
                continue
            if skipped < op.offset:
                skipped += 1
                continue
            out.append(
                SearchItem(
                    namespace=v.namespace,
                    key=v.key,
                    value=value,
                    created_at=_ms_to_dt(v.created_ms),
                    updated_at=_ms_to_dt(v.updated_ms),
                    score=score_of.get(id(v)),
                )
            )
            if len(out) >= op.limit:
                break
        return out

    def _list_namespaces(self, op: ListNamespacesOp) -> list[tuple[str, ...]]:
        namespaces = {v.namespace for v in self._list("**")}
        if op.match_conditions:
            namespaces = {
                ns for ns in namespaces if all(_matches(c, ns) for c in op.match_conditions)
            }
        if op.max_depth is not None:
            namespaces = {ns[: op.max_depth] for ns in namespaces}
        return sorted(namespaces)[op.offset : op.offset + op.limit]

    def batch(self, ops: Iterable[Op]) -> list[Result]:
        results: list[Result] = []
        for op in ops:
            if isinstance(op, GetOp):
                results.append(self._get(op))
            elif isinstance(op, PutOp):
                results.append(self._put(op))
            elif isinstance(op, SearchOp):
                results.append(self._search(op))
            elif isinstance(op, ListNamespacesOp):
                results.append(self._list_namespaces(op))
            else:
                raise ValueError(f"Unknown operation type: {type(op)}")
        return results

    async def abatch(self, ops: Iterable[Op]) -> list[Result]:
        return await asyncio.to_thread(self.batch, list(ops))

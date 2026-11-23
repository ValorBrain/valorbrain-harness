"""LangChain retriever backed by ValorBrain search.

Requires ``langchain-core`` (``pip install valorbrain[langchain]``).
"""

from __future__ import annotations

from typing import Any

from langchain_core.callbacks import CallbackManagerForRetrieverRun
from langchain_core.documents import Document
from langchain_core.retrievers import BaseRetriever
from pydantic import ConfigDict, Field

from .client import ValorBrain

_META_KEYS = ("docid", "path", "title", "score", "contentType", "modifiedAt", "eventAt")


class ValorBrainRetriever(BaseRetriever):
    """Return ValorBrain memories relevant to a query as LangChain ``Document``s.

    Each document's ``page_content`` is the memory body (falling back to the
    snippet) and ``metadata`` carries ``docid``, ``path``, ``title``, ``score``,
    ``contentType``, ``modifiedAt`` and ``eventAt`` when the engine returns them.

    Example:
        >>> retriever = ValorBrainRetriever(client=ValorBrain(), k=5)
        >>> retriever.invoke("what did we decide about pricing?")
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    client: ValorBrain = Field(default_factory=lambda: ValorBrain(integration="langchain"))
    k: int = 5
    collection: str | None = None
    mode: str | None = None
    profile: str | None = None

    def _get_relevant_documents(
        self, query: str, *, run_manager: CallbackManagerForRetrieverRun
    ) -> list[Document]:
        results = self.client.search(
            query,
            limit=self.k,
            collection=self.collection,
            mode=self.mode,  # type: ignore[arg-type]
            profile=self.profile,  # type: ignore[arg-type]
            compact=False,
        )
        docs: list[Document] = []
        for r in results:
            metadata: dict[str, Any] = {k: r[k] for k in _META_KEYS if r.get(k) is not None}
            docs.append(
                Document(
                    id=r.get("docid"),
                    page_content=r.get("body") or r.get("snippet") or "",
                    metadata=metadata,
                )
            )
        return docs

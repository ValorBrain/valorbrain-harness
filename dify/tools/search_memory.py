from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from valorbrain_client import (
    ValorBrainClient,
    ValorBrainConfigError,
    format_search,
    resolve_collection,
    text,
    whole_number,
)

SEARCH_MODES = ("auto", "hybrid", "keyword", "semantic")


class SearchMemoryTool(Tool):
    """POST /search: hybrid search over ValorBrain documents."""

    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        query = text(tool_parameters, "query")
        if query is None:
            raise ValorBrainConfigError("Query is empty.")
        mode = text(tool_parameters, "mode") or "auto"
        if mode not in SEARCH_MODES:
            raise ValorBrainConfigError(f"Mode must be one of: {', '.join(SEARCH_MODES)}.")

        body: dict[str, Any] = {
            "query": query,
            "limit": whole_number(tool_parameters, "limit", "Limit", low=1, high=50) or 5,
            "mode": mode,
        }
        collection = resolve_collection(tool_parameters, self.runtime.user_id)
        if collection is not None:
            body["collection"] = collection

        result = ValorBrainClient.from_credentials(self.runtime.credentials).search(body)

        yield self.create_text_message(format_search(result))
        yield self.create_json_message(result)

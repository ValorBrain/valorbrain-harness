from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from valorbrain_client import (
    ValorBrainClient,
    ValorBrainConfigError,
    flag,
    is_transient,
    resolve_collection,
    text,
    whole_number,
)

# Fields of the prepare answer that the JSON output carries. tenant_id stays out.
RESPONSE_FIELDS = ("markdown", "blocks", "intent", "recall_used", "tokens_estimate", "elapsed_ms")


class PrepareContextTool(Tool):
    """POST /api/v1/memory/prepare: Markdown context for a message, ready to inject."""

    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        message = text(tool_parameters, "message")
        if message is None:
            raise ValorBrainConfigError("Message is empty.")

        body: dict[str, Any] = {"message": message, "fast_mode": flag(tool_parameters, "fast_mode", True)}
        collection = resolve_collection(tool_parameters, self.runtime.user_id)
        if collection is not None:
            body["collection"] = collection
        budget = whole_number(tool_parameters, "recall_budget", "Recall budget", low=64, high=2000)
        if budget is not None:
            body["recall_budget"] = budget

        client = ValorBrainClient.from_credentials(self.runtime.credentials)
        try:
            result = client.prepare(body)
        except Exception as error:
            if not (flag(tool_parameters, "fail_open", True) and is_transient(error)):
                raise
            # Fail open: the app answers without memory instead of failing the run.
            yield self.create_text_message("")
            yield self.create_json_message({"markdown": "", "unavailable": True, "error": str(error)})
            return

        yield self.create_text_message(str(result.get("markdown") or ""))
        yield self.create_json_message({key: result[key] for key in RESPONSE_FIELDS if key in result})

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from valorbrain_client import (
    ValorBrainClient,
    ValorBrainConfigError,
    flag,
    is_transient,
    redact,
    resolve_collection,
    text,
)

MEMORY_TYPES = ("note", "decision", "observation", "problem", "lesson", "milestone", "handoff")


class StoreMemoryTool(Tool):
    """POST /api/v1/memory/store: persist one typed memory."""

    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        title = text(tool_parameters, "title")
        content = text(tool_parameters, "content")
        if title is None or content is None:
            raise ValorBrainConfigError("Title and Content are required.")
        memory_type = text(tool_parameters, "type") or "note"
        if memory_type not in MEMORY_TYPES:
            raise ValorBrainConfigError(f"Type must be one of: {', '.join(MEMORY_TYPES)}.")

        if flag(tool_parameters, "redact_secrets", True):
            title, content = redact(title), redact(content)
        tags = [tag.strip() for tag in (text(tool_parameters, "tags") or "").split(",") if tag.strip()]
        body: dict[str, Any] = {
            "title": title,
            "content": content,
            "type": memory_type,
            "tags": [*dict.fromkeys([*tags, "dify"])],
        }
        collection = resolve_collection(tool_parameters, self.runtime.user_id)
        if collection is not None:
            body["collection"] = collection
        confidence = tool_parameters.get("confidence")
        if confidence not in (None, ""):
            try:
                body["confidence"] = float(confidence)
            except (TypeError, ValueError) as error:
                raise ValorBrainConfigError("Confidence must be a number from 0 to 1.") from error
            if not 0 <= body["confidence"] <= 1:
                raise ValorBrainConfigError("Confidence must be a number from 0 to 1.")

        client = ValorBrainClient.from_credentials(self.runtime.credentials)
        try:
            result = client.store(body)
        except Exception as error:
            if not (flag(tool_parameters, "fail_open", True) and is_transient(error)):
                raise
            yield self.create_text_message(f"ValorBrain did not store the memory: {error}")
            yield self.create_json_message({"ok": False, "error": str(error)})
            return

        yield self.create_text_message(
            f"ValorBrain stored the memory (docid {result.get('docid', '?')}, "
            f"collection {result.get('collection', '?')}, {result.get('action', 'stored')})."
        )
        yield self.create_json_message(result)

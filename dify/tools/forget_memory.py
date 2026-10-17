from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from valorbrain_client import (
    ValorBrainClient,
    ValorBrainConfigError,
    normalize_docid,
    resolve_collection,
)


class ForgetMemoryTool(Tool):
    """POST /documents/{id}/forget: permanently deactivate one document."""

    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        docid = normalize_docid(tool_parameters.get("docid"))
        client = ValorBrainClient.from_credentials(self.runtime.credentials)

        # With a collection scope the model may only forget documents inside that collection.
        collection = resolve_collection(tool_parameters, self.runtime.user_id)
        if collection is not None:
            found = client.get_document(docid).get("collection")
            if found != collection:
                raise ValorBrainConfigError(
                    f"Document {docid} is not in collection {collection}. Nothing was forgotten."
                )

        result = client.forget(docid)
        yield self.create_text_message(f"ValorBrain forgot document {result.get('docid', docid)}.")
        yield self.create_json_message(result)

from typing import Any

from dify_plugin import ToolProvider
from dify_plugin.errors.tool import ToolProviderCredentialValidationError

from valorbrain_client import (
    ValorBrainApiError,
    ValorBrainClient,
    ValorBrainConfigError,
    ValorBrainConnectionError,
)


class ValorBrainProvider(ToolProvider):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        # GET /api/v1/memory/health needs a valid token, reads only and writes nothing.
        try:
            ValorBrainClient.from_credentials(credentials).check()
        except ValorBrainApiError as error:
            if error.status in (401, 403):
                raise ToolProviderCredentialValidationError(
                    f"ValorBrain refused the token (HTTP {error.status}). Use an active token that starts with vbm_."
                ) from error
            raise ToolProviderCredentialValidationError(str(error)) from error
        except (ValorBrainConfigError, ValorBrainConnectionError) as error:
            raise ToolProviderCredentialValidationError(str(error)) from error

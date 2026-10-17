"""A small client for the ValorBrain REST API, shared by the provider and the tools.

This module defines no Tool or ToolProvider subclass: the Dify loader takes the one
subclass it finds in each tool and provider file, so those files keep exactly one.
"""

from __future__ import annotations

import hashlib
import ipaddress
import re
import time
from collections.abc import Callable, Mapping
from typing import Any
from urllib.parse import quote, urlsplit

import httpx

VERSION = "0.1.0"
DEFAULT_API_URL = "https://valorbrain-api.valor.digital"
USER_AGENT = f"valorbrain-dify/{VERSION}"
TOKEN_PREFIXES = ("vbm_", "vb_agent_")

# The Dify plugin runtime stops a call at 120 seconds.
REQUEST_TIMEOUT = httpx.Timeout(60.0, connect=10.0)

# A 429 or a 503 is tried again at most this many times, and never for longer than this.
MAX_RETRIES = 2
MAX_RETRY_WAIT_SECONDS = 10.0

SCOPE_DEFAULT = "token"
SCOPE_COLLECTION = "collection"
SCOPE_DIFY_USER = "dify_user"
DIFY_USER_PREFIX = "dify-user"


class ValorBrainConfigError(ValueError):
    """The tool settings or the credentials are not usable. Nothing was sent."""


class ValorBrainConnectionError(Exception):
    """ValorBrain could not be reached, or it did not answer in time."""


class ValorBrainApiError(Exception):
    """ValorBrain refused the request. The message never contains the token."""

    def __init__(self, status: int, message: str | None) -> None:
        self.status = status
        self.detail = message
        text = f"ValorBrain returned HTTP {status}"
        if message:
            text += f": {message}"
        super().__init__(text)


def is_transient(error: Exception) -> bool:
    """True for failures that say nothing about the settings: network, timeouts, 429 and 5xx."""
    if isinstance(error, ValorBrainConnectionError):
        return True
    return isinstance(error, ValorBrainApiError) and (error.status == 429 or error.status >= 500)


def _plain_http_allowed(host: str) -> bool:
    """Plain HTTP is accepted only inside a machine or a private network (self-hosted engine)."""
    if host == "localhost" or host.endswith(".localhost") or "." not in host:
        return True  # loopback name, or a single-label name such as a Docker Compose service
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    return address.is_loopback or address.is_private


def normalize_api_url(raw: Any) -> str:
    """Return the API URL without a trailing slash.

    HTTPS is required, except for loopback, private and single-label hosts, where a
    self-hosted engine usually listens on plain HTTP.
    """
    url = str(raw or "").strip() or DEFAULT_API_URL
    parts = urlsplit(url)
    if parts.scheme not in ("https", "http") or not parts.hostname:
        raise ValorBrainConfigError(
            "API URL must be an HTTPS address, for example https://valorbrain-api.valor.digital."
        )
    if parts.query or parts.fragment or "@" in parts.netloc:
        raise ValorBrainConfigError(
            "API URL must be a plain address, without credentials, a query or a fragment."
        )
    if parts.scheme == "http" and not _plain_http_allowed(parts.hostname.lower()):
        raise ValorBrainConfigError(
            "API URL must use HTTPS. Plain HTTP is accepted only for localhost and private-network hosts."
        )
    return f"{parts.scheme}://{parts.netloc}{parts.path.rstrip('/')}"


def check_token(token: str) -> None:
    if not token:
        raise ValorBrainConfigError("Set the ValorBrain token in the plugin credentials.")
    if not token.startswith(TOKEN_PREFIXES):
        raise ValorBrainConfigError("The ValorBrain token must start with vbm_ (or the legacy vb_agent_).")


class ValorBrainClient:
    """Calls the ValorBrain REST API with one tenant token. The tenant comes from the token."""

    def __init__(
        self,
        api_token: str,
        api_url: str | None = None,
        *,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._token = str(api_token or "").strip()
        check_token(self._token)
        self._base_url = normalize_api_url(api_url)
        self._transport = transport
        self._sleep = sleep

    @classmethod
    def from_credentials(cls, credentials: Mapping[str, Any]) -> ValorBrainClient:
        return cls(str(credentials.get("api_token") or ""), credentials.get("api_url"))

    def check(self) -> dict[str, Any]:
        """GET /api/v1/memory/health: authenticated, read-only, writes nothing."""
        return self._request("GET", "/api/v1/memory/health")

    def store(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/memory/store", body)

    def prepare(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/memory/prepare", body)

    def search(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/search", body)

    def get_document(self, docid: str) -> dict[str, Any]:
        return self._request("GET", f"/documents/{quote(docid, safe='')}")

    def forget(self, docid: str) -> dict[str, Any]:
        return self._request("POST", f"/documents/{quote(docid, safe='')}/forget")

    def _request(self, method: str, path: str, body: Mapping[str, Any] | None = None) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        }
        with httpx.Client(
            base_url=self._base_url,
            timeout=REQUEST_TIMEOUT,
            transport=self._transport,
            follow_redirects=False,
        ) as http:
            attempt = 0
            while True:
                try:
                    response = http.request(method, path, headers=headers, json=body)
                except httpx.TimeoutException as error:
                    raise ValorBrainConnectionError(
                        f"ValorBrain did not answer in time at {self._base_url}."
                    ) from error
                except httpx.HTTPError as error:
                    raise ValorBrainConnectionError(
                        f"Could not reach ValorBrain at {self._base_url}: {type(error).__name__}."
                    ) from error

                if response.is_success:
                    if not response.content:
                        return {}
                    try:
                        payload = response.json()
                    except ValueError as error:
                        raise ValorBrainApiError(response.status_code, "the answer is not JSON") from error
                    return payload if isinstance(payload, dict) else {"data": payload}

                wait = _retry_wait(response)
                if wait is not None and attempt < MAX_RETRIES:
                    attempt += 1
                    self._sleep(wait)
                    continue
                raise ValorBrainApiError(response.status_code, _error_message(response))


def _retry_wait(response: httpx.Response) -> float | None:
    """Seconds to wait before a retry, or None when the call must not be retried."""
    if response.status_code not in (429, 503):
        return None
    header = response.headers.get("Retry-After", "").strip()
    try:
        wait = float(header) if header else 1.0
    except ValueError:
        wait = 1.0
    if wait > MAX_RETRY_WAIT_SECONDS:
        return None
    return max(wait, 0.0)


def _error_message(response: httpx.Response) -> str | None:
    try:
        payload = response.json()
    except ValueError:
        return None
    if isinstance(payload, dict):
        for key in ("error", "message", "detail"):
            if payload.get(key):
                return str(payload[key])[:500]
    return None


# ---------------------------------------------------------------------------
# Parameter helpers shared by the tools
# ---------------------------------------------------------------------------


def text(parameters: Mapping[str, Any], name: str) -> str | None:
    """Return a trimmed string parameter, or None when it is empty."""
    value = parameters.get(name)
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def flag(parameters: Mapping[str, Any], name: str, default: bool) -> bool:
    value = parameters.get(name)
    if value is None or value == "":
        return default
    if isinstance(value, str):
        return value.strip().lower() in ("true", "1", "yes", "on")
    return bool(value)


def whole_number(
    parameters: Mapping[str, Any], name: str, label: str, *, low: int, high: int
) -> int | None:
    """Return a whole-number parameter inside [low, high], or None when it is empty."""
    value = parameters.get(name)
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValorBrainConfigError(f"{label} must be a whole number.") from error
    if not number.is_integer() or not low <= number <= high:
        raise ValorBrainConfigError(f"{label} must be a whole number from {low} to {high}.")
    return int(number)


def dify_user_collection(user_id: str, prefix: str | None) -> str:
    """One collection per Dify end user. A lossy slug gets a hash suffix, so two IDs never meet."""
    slug = re.sub(r"[^a-z0-9_-]+", "-", user_id.lower()).strip("-")[:64]
    if slug != user_id:
        slug = f"{slug}-{hashlib.sha256(user_id.encode()).hexdigest()[:8]}".lstrip("-")
    return f"{prefix or DIFY_USER_PREFIX}-{slug}"


def resolve_collection(parameters: Mapping[str, Any], dify_user_id: str | None) -> str | None:
    """Return the collection the app builder chose. The model never sets it.

    - token: no collection; ValorBrain uses the token's default (writes) and the whole
      tenant view of the token (reads).
    - collection: the Collection field (a fixed value or a workflow variable).
    - dify_user: one collection per Dify end user, named <Collection or dify-user>-<user id>.
    """
    scope = text(parameters, "scope") or SCOPE_DEFAULT
    collection = text(parameters, "collection")
    if scope == SCOPE_DEFAULT:
        return None
    if scope == SCOPE_COLLECTION:
        if collection is None:
            raise ValorBrainConfigError("Scope is Collection field, but Collection is empty.")
        return collection
    if scope == SCOPE_DIFY_USER:
        if not dify_user_id:
            raise ValorBrainConfigError("Scope is Dify end user, but Dify gave no user ID for this run.")
        return dify_user_collection(dify_user_id, collection)
    raise ValorBrainConfigError(f"Unknown scope: {scope}.")


def normalize_docid(raw: str | None) -> str:
    """Accept '#3b60cf', '3b60cf' or a numeric id, as Search and Store return them."""
    docid = (raw or "").strip().lstrip("#").strip()
    if not re.fullmatch(r"[0-9A-Za-z_-]{1,64}", docid):
        raise ValorBrainConfigError("Document ID must look like #3b60cf or 319816.")
    return docid


# Conservative redaction: the obvious shapes of keys and tokens never leave Dify by accident.
# It is not a guarantee. Mirrors the patterns the other ValorBrain integrations use.
_SECRET_PATTERNS = [
    re.compile(
        r"\b(?:vbm_|vb_agent_|sk-ant-|sk-|ghp_|gho_|ghu_|ghs_|github_pat_|glpat-|xox[baprs]-)[A-Za-z0-9_\-]{12,}"
    ),
    re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    re.compile(r"\bBearer\s+[A-Za-z0-9._\-]{20,}", re.IGNORECASE),
    re.compile(r"\beyJ[A-Za-z0-9._\-]{20,}"),
    re.compile(r"\b([A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|API_?KEY|PRIVATE_?KEY|CREDENTIAL)[A-Z0-9_]*)\s*[=:]\s*\S+"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
]


def redact(value: str) -> str:
    for pattern in _SECRET_PATTERNS:
        value = pattern.sub(lambda m: f"{m.group(1)}=[redacted]" if m.groups() else "[redacted]", value)
    return value


def format_search(response: Mapping[str, Any]) -> str:
    results = response.get("results") or []
    if not results:
        return "ValorBrain found no memory that matches this query."
    lines = [f"ValorBrain found {len(results)} memory document(s)."]
    for result in results:
        header = f"[#{result.get('docid', '?')}] {result.get('title') or result.get('path') or 'untitled'}"
        details = [str(result["contentType"])] if result.get("contentType") else []
        if result.get("modifiedAt"):
            details.append(str(result["modifiedAt"])[:10])
        if details:
            header += f" ({', '.join(details)})"
        lines.append("")
        lines.append(header)
        snippet = str(result.get("snippet") or "").strip()
        if snippet:
            lines.append(snippet)
    return "\n".join(lines)

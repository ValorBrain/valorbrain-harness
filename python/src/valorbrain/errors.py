"""Typed errors raised by :class:`valorbrain.ValorBrain`."""

from __future__ import annotations

from typing import Any


class ValorBrainError(Exception):
    """Base class for every error raised by this package."""

    def __init__(
        self,
        message: str,
        *,
        status: int | None = None,
        body: Any = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.body = body


class APIConnectionError(ValorBrainError):
    """The engine could not be reached (DNS, refused connection, timeout)."""


class APIStatusError(ValorBrainError):
    """The engine answered with a non-2xx status."""


class BadRequestError(APIStatusError):
    """400 / 413 / 422: the request was rejected as invalid."""


class AuthenticationError(APIStatusError):
    """401 / 403: missing, invalid or insufficient token."""


class NotFoundError(APIStatusError):
    """404: the document or memory does not exist (or is not visible)."""


class RateLimitError(APIStatusError):
    """429: too many requests or credits exhausted."""


class ServerError(APIStatusError):
    """5xx: the engine failed."""


def error_for_status(status: int, message: str, body: Any) -> APIStatusError:
    """Map an HTTP status code to the matching typed error."""
    if status in (401, 403):
        cls: type[APIStatusError] = AuthenticationError
    elif status == 404:
        cls = NotFoundError
    elif status == 429:
        cls = RateLimitError
    elif status >= 500:
        cls = ServerError
    elif status in (400, 413, 422):
        cls = BadRequestError
    else:
        cls = APIStatusError
    return cls(message, status=status, body=body)

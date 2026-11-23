"""ValorBrain memory for Python agents: a small REST client plus framework adapters.

Adapters live in optional submodules so the core has no dependencies:

- ``valorbrain.langchain``: ``ValorBrainRetriever`` (``pip install valorbrain[langchain]``)
- ``valorbrain.langgraph``: ``ValorBrainStore`` (``pip install valorbrain[langgraph]``)
- ``valorbrain.crewai``: ``ValorBrainMemory`` (``pip install valorbrain[crewai]``)
"""

from ._version import __version__
from .client import DEFAULT_BASE_URL, ValorBrain
from .errors import (
    APIConnectionError,
    APIStatusError,
    AuthenticationError,
    BadRequestError,
    NotFoundError,
    RateLimitError,
    ServerError,
    ValorBrainError,
)
from .redact import redact

__all__ = [
    "DEFAULT_BASE_URL",
    "APIConnectionError",
    "APIStatusError",
    "AuthenticationError",
    "BadRequestError",
    "NotFoundError",
    "RateLimitError",
    "ServerError",
    "ValorBrain",
    "ValorBrainError",
    "__version__",
    "redact",
]

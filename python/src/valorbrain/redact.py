"""Conservative client-side secret redaction.

Applied to text that an integration captures automatically before it leaves the
machine. It catches the obvious shapes (API keys, bearer tokens, JWTs, private
keys, ``NAME_TOKEN=value`` assignments, credentials in URLs); it is not a
guarantee.
"""

from __future__ import annotations

import re

_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (
        re.compile(
            r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"
        ),
        "[redacted]",
    ),
    (
        re.compile(
            r"\b(?:vb_admin_|vbm_|vb_agent_|sk-ant-|sk-|ghp_|gho_|ghu_|ghs_|github_pat_|"
            r"xox[baprs]-|glpat-|AKIA|ASIA)[A-Za-z0-9_\-]{12,}"
        ),
        "[redacted]",
    ),
    (re.compile(r"\bBearer\s+[A-Za-z0-9._\-]{20,}", re.IGNORECASE), "Bearer [redacted]"),
    (re.compile(r"\beyJ[A-Za-z0-9._\-]{20,}"), "[redacted]"),
    (
        re.compile(r"\b([a-z][a-z0-9+.\-]*://[^\s/:@'\"]{1,64}):[^\s/@'\"]{6,128}@", re.IGNORECASE),
        r"\1:[redacted]@",
    ),
    (
        re.compile(
            r"\b([A-Za-z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|PRIVATE_?KEY|CREDENTIAL)"
            r"[A-Za-z0-9_]*)\s*([=:])\s*[\"']?[^\s\"']+[\"']?",
            re.IGNORECASE,
        ),
        r"\1\2[redacted]",
    ),
]


def redact(text: str) -> str:
    """Return ``text`` with obvious secrets replaced by ``[redacted]``."""
    for pattern, replacement in _PATTERNS:
        text = pattern.sub(replacement, text)
    return text

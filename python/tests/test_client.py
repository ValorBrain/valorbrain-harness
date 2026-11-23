from datetime import datetime

import pytest

from valorbrain import (
    APIConnectionError,
    AuthenticationError,
    BadRequestError,
    NotFoundError,
    RateLimitError,
    ServerError,
    ValorBrain,
    __version__,
    redact,
)


def test_requires_key(monkeypatch):
    monkeypatch.delenv("VALORBRAIN_API_KEY", raising=False)
    with pytest.raises(ValueError):
        ValorBrain()


def test_env_defaults(monkeypatch):
    monkeypatch.setenv("VALORBRAIN_API_KEY", "vbm_x")
    monkeypatch.setenv("VALORBRAIN_URL", "http://example.invalid/")
    c = ValorBrain()
    assert c.base_url == "http://example.invalid"
    assert "vbm_x" not in repr(c)


def test_headers_and_store(client, engine):
    res = client.store("Pricing decision", "We decided the Pro plan costs 49 per month.", type="decision", tags=["pricing"])
    assert res["ok"] and res["docid"]
    method, path, body, headers = engine.requests[-1]
    assert (method, path) == ("POST", "/api/v1/memory/store")
    assert body == {"title": "Pricing decision", "content": "We decided the Pro plan costs 49 per month.", "type": "decision", "tags": ["pricing"]}
    assert headers["User-Agent"] == f"valorbrain-python/{__version__}"
    assert "X-Tenant-ID" not in headers


def test_write_document_event_at_naive_is_utc(client, engine):
    client.write_document("notes", "a/b.md", "Body text", event_at=datetime(2026, 10, 1, 9, 30), metadata={"k": 1})
    body = engine.requests[-1][2]
    assert body["event_at"] == "2026-10-01T09:30:00+00:00"
    assert body["metadata"] == {"k": 1}
    assert "title" not in body


def test_search_get_list_forget_used(client):
    doc = client.write_document("notes", "x/1.md", "The orca Belmiro eats kiwi every morning")
    results = client.search("orca kiwi", limit=3, compact=False)
    assert results[0]["docid"] == doc["docid"]
    assert results[0]["body"].startswith("The orca")
    assert client.get_document("#" + doc["docid"])["path"] == "notes/x/1.md"
    assert [d["docid"] for d in client.list_documents("x/*", collection="notes")] == [doc["docid"]]
    assert client.used([doc["docid"]], note="helped")["marked"] == 1
    assert client.forget(doc["docid"])["forgotten"] is True
    with pytest.raises(NotFoundError) as exc:
        client.forget(doc["docid"])
    assert exc.value.status == 404


def test_prepare(client, engine):
    out = client.prepare("what did we decide?", fast_mode=True)
    assert "what did we decide?" in out["markdown"]
    assert engine.requests[-1][2] == {"message": "what did we decide?", "fast_mode": True}


def test_typed_errors(client, engine):
    with pytest.raises(BadRequestError):
        client.store("tiny", "short")
    bad = ValorBrain("vbm_wrong", base_url=engine.url)
    with pytest.raises(AuthenticationError):
        bad.search("x")
    for status, cls in ((429, RateLimitError), (503, ServerError)):
        engine.fail_with = status
        with pytest.raises(cls) as exc:
            client.search("x")
        assert exc.value.body == {"error": "forced failure"}
    engine.fail_with = None


def test_connection_error():
    c = ValorBrain("vbm_x", base_url="http://127.0.0.1:9", timeout=2)
    with pytest.raises(APIConnectionError):
        c.search("x")


@pytest.mark.parametrize(
    "secret",
    [
        "vbm_" + "a" * 30,
        "sk-ant-" + "b" * 30,
        "ghp_" + "c" * 36,
        "Bearer " + "d" * 40,
        "eyJ" + "e" * 40,
        "AKIA" + "F" * 16,
    ],
)
def test_redact_tokens(secret):
    assert secret not in redact(f"use {secret} now")


def test_redact_assignments_and_urls():
    out = redact("OPENAI_API_KEY=abc123xyz and postgres://bob:hunter22@db/x and password: s3cr3tvalue")
    assert "abc123xyz" not in out and "hunter22" not in out and "s3cr3tvalue" not in out
    assert "OPENAI_API_KEY=[redacted]" in out
    assert redact("plain text stays") == "plain text stays"

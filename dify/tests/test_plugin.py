"""Unit tests over a fake HTTP transport. Nothing leaves the machine."""

import httpx
import pytest
from conftest import API_URL, FAKE_TOKEN, make_tool, run

from valorbrain_client import (
    ValorBrainApiError,
    ValorBrainConfigError,
    dify_user_collection,
    normalize_api_url,
    normalize_docid,
    redact,
)

STORE_RESPONSE = {
    "ok": True,
    "action": "inserted",
    "docid": 319816,
    "collection": "agent-dify",
    "path": "observations/2026-10-17-14-14-48-hoaf8h.md",
    "type": "observation",
}
SEARCH_RESPONSE = {
    "query": "wrench",
    "count": 1,
    "results": [
        {
            "docid": "3b60cf",
            "title": "Dify probe memory",
            "score": 0.242,
            "contentType": "observation",
            "modifiedAt": "2026-10-17T14:14:48.365Z",
            "snippet": "The favourite tool is a periwinkle wrench.",
        }
    ],
}
PREPARE_RESPONSE = {
    "tenant_id": "00000000-0000-0000-0000-000000000000",
    "intent": "lookup",
    "markdown": "## You here\nActor here: dify\n\n<funnel>\n- #3b60cf wrench\n</funnel>",
    "blocks": {"identity": "## You here"},
    "recall_used": True,
    "tokens_estimate": 40,
    "elapsed_ms": 12,
}


# --- API URL and token ----------------------------------------------------


def test_api_url_defaults_to_the_hosted_service():
    assert normalize_api_url(None) == "https://valorbrain-api.valor.digital"
    assert normalize_api_url("  ") == "https://valorbrain-api.valor.digital"


@pytest.mark.parametrize(
    "url",
    ["http://127.0.0.1:7439", "http://localhost:7439/", "http://valorbrain:7439", "http://10.0.0.5:7439",
     "https://memory.example.com/vb/"],
)
def test_api_url_accepts_https_and_local_plain_http(url):
    assert normalize_api_url(url) == url.rstrip("/")


@pytest.mark.parametrize(
    "url",
    ["http://valorbrain-api.valor.digital", "valorbrain-api.valor.digital", "https://u:p@example.com",
     "https://example.com/?x=1", "ftp://example.com", "http://8.8.8.8"],
)
def test_api_url_refuses_public_plain_http_and_odd_addresses(url):
    with pytest.raises(ValorBrainConfigError):
        normalize_api_url(url)


def test_a_token_without_a_valorbrain_prefix_is_refused_before_any_request(fake_api):
    from tools.search_memory import SearchMemoryTool

    tool = make_tool(SearchMemoryTool, credentials={"api_token": "sk-not-valorbrain", "api_url": API_URL})
    with pytest.raises(ValorBrainConfigError, match="vbm_"):
        run(tool, {"query": "x"})
    assert fake_api.requests == []


# --- Credential validation ------------------------------------------------


def test_credential_validation_reads_memory_health_with_the_token(fake_api):
    from provider.valorbrain import ValorBrainProvider

    fake_api.answer(200, {"open_conflicts_count": 0})
    ValorBrainProvider()._validate_credentials({"api_token": FAKE_TOKEN, "api_url": API_URL})

    request = fake_api.requests[0]
    assert request.method == "GET"
    assert str(request.url) == f"{API_URL}/api/v1/memory/health"
    assert request.headers["Authorization"] == f"Bearer {FAKE_TOKEN}"
    assert request.headers["User-Agent"] == "valorbrain-dify/0.1.0"
    assert "X-Tenant-ID" not in request.headers


def test_credential_validation_reports_a_refused_token_without_echoing_it(fake_api):
    from dify_plugin.errors.tool import ToolProviderCredentialValidationError
    from provider.valorbrain import ValorBrainProvider

    fake_api.answer(401, {"error": "Unauthorized"})
    with pytest.raises(ToolProviderCredentialValidationError) as raised:
        ValorBrainProvider()._validate_credentials({"api_token": FAKE_TOKEN})
    assert "401" in str(raised.value)
    assert FAKE_TOKEN not in str(raised.value)


def test_credential_validation_reports_an_unreachable_engine(fake_api):
    from dify_plugin.errors.tool import ToolProviderCredentialValidationError
    from provider.valorbrain import ValorBrainProvider

    fake_api.fail(httpx.ConnectError("refused"))
    with pytest.raises(ToolProviderCredentialValidationError, match="Could not reach"):
        ValorBrainProvider()._validate_credentials({"api_token": FAKE_TOKEN})


# --- Store memory ---------------------------------------------------------


def test_store_sends_a_typed_memory_with_the_dify_tag(fake_api):
    from tools.store_memory import StoreMemoryTool

    fake_api.answer(200, STORE_RESPONSE)
    messages = run(
        make_tool(StoreMemoryTool),
        {"title": "Wrench colour", "content": "The favourite tool is a periwinkle wrench.", "type": "observation",
         "tags": "probe, dify ,  colour", "confidence": 0.8},
    )

    request = fake_api.requests[0]
    assert request.method == "POST" and request.url.path == "/api/v1/memory/store"
    assert fake_api.body() == {
        "title": "Wrench colour",
        "content": "The favourite tool is a periwinkle wrench.",
        "type": "observation",
        "tags": ["probe", "dify", "colour"],
        "confidence": 0.8,
    }
    assert "docid 319816" in messages[0].message.text
    assert messages[1].message.json_object == STORE_RESPONSE


def test_store_defaults_to_a_note_in_the_token_collection(fake_api):
    from tools.store_memory import StoreMemoryTool

    fake_api.answer(200, STORE_RESPONSE)
    run(make_tool(StoreMemoryTool), {"title": "Plain note", "content": "Something worth keeping for later."})
    body = fake_api.body()
    assert body["type"] == "note"
    assert "collection" not in body
    assert body["tags"] == ["dify"]


def test_store_redacts_obvious_secrets_by_default(fake_api):
    from tools.store_memory import StoreMemoryTool

    fake_api.answer(200, STORE_RESPONSE)
    run(
        make_tool(StoreMemoryTool),
        {"title": "Deploy notes", "content": "Use vbm_abcdefghijklmnop1234 and OPENAI_API_KEY=sk-123 to deploy."},
    )
    content = fake_api.body()["content"]
    assert "vbm_abcdefghijklmnop1234" not in content and "sk-123" not in content
    assert "[redacted]" in content and "OPENAI_API_KEY=[redacted]" in content


def test_store_sends_raw_content_when_redaction_is_off(fake_api):
    from tools.store_memory import StoreMemoryTool

    fake_api.answer(200, STORE_RESPONSE)
    content = "Use vbm_abcdefghijklmnop1234 to deploy the thing."
    run(make_tool(StoreMemoryTool), {"title": "Deploy notes", "content": content, "redact_secrets": False})
    assert fake_api.body()["content"] == content


def test_store_refuses_an_unknown_type_before_any_request(fake_api):
    from tools.store_memory import StoreMemoryTool

    with pytest.raises(ValorBrainConfigError, match="Type"):
        run(make_tool(StoreMemoryTool), {"title": "Title", "content": "Some content here.", "type": "secret"})
    assert fake_api.requests == []


def test_store_fails_open_when_the_engine_is_down(fake_api):
    from tools.store_memory import StoreMemoryTool

    fake_api.fail(httpx.ConnectError("refused"))
    messages = run(make_tool(StoreMemoryTool), {"title": "Title", "content": "Some content here please."})
    assert messages[0].message.text.startswith("ValorBrain did not store the memory")
    assert messages[1].message.json_object["ok"] is False


def test_store_still_fails_on_a_settings_error(fake_api):
    from tools.store_memory import StoreMemoryTool

    fake_api.answer(400, {"error": "title must be at least 5 characters"})
    with pytest.raises(ValorBrainApiError, match="title must be at least 5"):
        run(make_tool(StoreMemoryTool), {"title": "abc", "content": "Some content here please."})


def test_store_fails_closed_when_fail_open_is_off(fake_api):
    from tools.store_memory import StoreMemoryTool

    fake_api.answer(500, {"error": "boom"})
    with pytest.raises(ValorBrainApiError, match="500"):
        run(make_tool(StoreMemoryTool), {"title": "Title", "content": "Some content here.", "fail_open": False})


# --- Scope ----------------------------------------------------------------


def test_collection_scope_uses_the_collection_field(fake_api):
    from tools.store_memory import StoreMemoryTool

    fake_api.answer(200, STORE_RESPONSE)
    run(make_tool(StoreMemoryTool), {"title": "Title", "content": "Some content here.", "scope": "collection",
                                     "collection": "support-team"})
    assert fake_api.body()["collection"] == "support-team"


def test_collection_scope_without_a_collection_is_refused(fake_api):
    from tools.search_memory import SearchMemoryTool

    with pytest.raises(ValorBrainConfigError, match="Collection is empty"):
        run(make_tool(SearchMemoryTool), {"query": "x", "scope": "collection"})
    assert fake_api.requests == []


def test_dify_user_scope_gives_each_end_user_a_collection(fake_api):
    from tools.search_memory import SearchMemoryTool

    fake_api.answer(200, SEARCH_RESPONSE)
    fake_api.answer(200, SEARCH_RESPONSE)
    run(make_tool(SearchMemoryTool, user_id="u-42"), {"query": "x", "scope": "dify_user"})
    run(make_tool(SearchMemoryTool, user_id="u-42"), {"query": "x", "scope": "dify_user", "collection": "crm"})
    assert fake_api.body(0)["collection"] == "dify-user-u-42"
    assert fake_api.body(1)["collection"] == "crm-u-42"


def test_dify_user_scope_without_a_user_is_refused(fake_api):
    from tools.prepare_context import PrepareContextTool

    with pytest.raises(ValorBrainConfigError, match="no user ID"):
        run(make_tool(PrepareContextTool, user_id=None), {"message": "x", "scope": "dify_user"})


def test_lossy_user_ids_never_share_a_collection():
    assert dify_user_collection("7f3c2a90-1b2c", None) == "dify-user-7f3c2a90-1b2c"
    a, b = dify_user_collection("Ana.Silva", None), dify_user_collection("ana-silva", None)
    assert a != b and a.startswith("dify-user-ana-silva-")


def test_the_model_cannot_override_the_scope_with_extra_arguments(fake_api):
    """Dify passes only declared parameters, but even an injected key is resolved from the builder fields."""
    from tools.search_memory import SearchMemoryTool

    fake_api.answer(200, SEARCH_RESPONSE)
    run(make_tool(SearchMemoryTool, user_id="u-1"), {"query": "x", "scope": "dify_user", "user_id": "u-2"})
    assert fake_api.body()["collection"] == "dify-user-u-1"


# --- Prepare context ------------------------------------------------------


def test_prepare_returns_markdown_and_drops_the_tenant_id(fake_api):
    from tools.prepare_context import PrepareContextTool

    fake_api.answer(200, PREPARE_RESPONSE)
    messages = run(make_tool(PrepareContextTool), {"message": "what tool?", "recall_budget": 800})

    assert fake_api.requests[0].url.path == "/api/v1/memory/prepare"
    assert fake_api.body() == {"message": "what tool?", "fast_mode": True, "recall_budget": 800}
    assert messages[0].message.text == PREPARE_RESPONSE["markdown"]
    assert "tenant_id" not in messages[1].message.json_object
    assert messages[1].message.json_object["recall_used"] is True


def test_prepare_refuses_a_budget_outside_the_engine_range(fake_api):
    from tools.prepare_context import PrepareContextTool

    with pytest.raises(ValorBrainConfigError, match="64 to 2000"):
        run(make_tool(PrepareContextTool), {"message": "x", "recall_budget": 5000})


@pytest.mark.parametrize("failure", [httpx.ReadTimeout("slow"), (502, {"error": "bad gateway"})])
def test_prepare_fails_open_with_empty_context(fake_api, failure):
    from tools.prepare_context import PrepareContextTool

    if isinstance(failure, Exception):
        fake_api.fail(failure)
    else:
        fake_api.answer(*failure)
    messages = run(make_tool(PrepareContextTool), {"message": "x"})
    assert messages[0].message.text == ""
    assert messages[1].message.json_object["unavailable"] is True


def test_prepare_does_not_hide_a_revoked_token(fake_api):
    from tools.prepare_context import PrepareContextTool

    fake_api.answer(401, {"error": "Unauthorized"})
    with pytest.raises(ValorBrainApiError, match="401"):
        run(make_tool(PrepareContextTool), {"message": "x"})


# --- Search memory --------------------------------------------------------


def test_search_lists_document_ids_for_the_model(fake_api):
    from tools.search_memory import SearchMemoryTool

    fake_api.answer(200, SEARCH_RESPONSE)
    messages = run(make_tool(SearchMemoryTool), {"query": "wrench", "limit": 3, "mode": "hybrid"})

    assert fake_api.requests[0].url.path == "/search"
    assert fake_api.body() == {"query": "wrench", "limit": 3, "mode": "hybrid"}
    assert "[#3b60cf] Dify probe memory (observation, 2026-10-17)" in messages[0].message.text
    assert "periwinkle wrench" in messages[0].message.text
    assert messages[1].message.json_object == SEARCH_RESPONSE


def test_search_with_no_results_says_so(fake_api):
    from tools.search_memory import SearchMemoryTool

    fake_api.answer(200, {"results": []})
    messages = run(make_tool(SearchMemoryTool), {"query": "nothing"})
    assert "no memory" in messages[0].message.text


def test_search_retries_a_rate_limit_once_then_succeeds(fake_api):
    from tools.search_memory import SearchMemoryTool

    fake_api.answer(429, {"error": "slow down"}, {"Retry-After": "2"})
    fake_api.answer(200, SEARCH_RESPONSE)
    run(make_tool(SearchMemoryTool), {"query": "wrench"})
    assert len(fake_api.requests) == 2
    assert fake_api.sleeps == [2.0]


def test_search_does_not_wait_for_a_long_retry_after(fake_api):
    from tools.search_memory import SearchMemoryTool

    fake_api.answer(429, {"error": "slow down"}, {"Retry-After": "60"})
    with pytest.raises(ValorBrainApiError, match="429"):
        run(make_tool(SearchMemoryTool), {"query": "wrench"})
    assert fake_api.sleeps == []


# --- Forget memory --------------------------------------------------------


def test_forget_accepts_the_id_search_shows(fake_api):
    from tools.forget_memory import ForgetMemoryTool

    fake_api.answer(200, {"docid": "3b60cf", "forgotten": True})
    messages = run(make_tool(ForgetMemoryTool), {"docid": "#3b60cf"})

    request = fake_api.requests[0]
    assert request.method == "POST" and request.url.path == "/documents/3b60cf/forget"
    assert messages[0].message.text == "ValorBrain forgot document 3b60cf."


def test_forget_inside_a_collection_scope_checks_the_document_first(fake_api):
    from tools.forget_memory import ForgetMemoryTool

    fake_api.answer(200, {"docid": "3b60cf", "collection": "dify-user-u-1"})
    fake_api.answer(200, {"docid": "3b60cf", "forgotten": True})
    run(make_tool(ForgetMemoryTool, user_id="u-1"), {"docid": "3b60cf", "scope": "dify_user"})
    assert [r.url.path for r in fake_api.requests] == ["/documents/3b60cf", "/documents/3b60cf/forget"]


def test_forget_refuses_a_document_from_another_collection(fake_api):
    from tools.forget_memory import ForgetMemoryTool

    fake_api.answer(200, {"docid": "3b60cf", "collection": "dify-user-someone-else"})
    with pytest.raises(ValorBrainConfigError, match="Nothing was forgotten"):
        run(make_tool(ForgetMemoryTool, user_id="u-1"), {"docid": "3b60cf", "scope": "dify_user"})
    assert len(fake_api.requests) == 1


@pytest.mark.parametrize("docid", ["", "#", "../health", "3b60cf/forget"])
def test_forget_refuses_an_id_that_is_not_a_document_id(fake_api, docid):
    from tools.forget_memory import ForgetMemoryTool

    with pytest.raises(ValorBrainConfigError):
        run(make_tool(ForgetMemoryTool), {"docid": docid})
    assert fake_api.requests == []


def test_docid_forms():
    assert normalize_docid(" #3b60cf ") == "3b60cf"
    assert normalize_docid("319816") == "319816"


# --- Redaction ------------------------------------------------------------


@pytest.mark.parametrize(
    "secret",
    ["vbm_" + "a" * 24, "vb_agent_" + "b" * 20, "sk-ant-" + "c" * 20, "ghp_" + "d" * 30, "AKIA" + "E" * 16,
     "Bearer " + "f" * 30, "eyJ" + "g" * 30],
)
def test_redaction_removes_known_token_shapes(secret):
    assert secret not in redact(f"before {secret} after")


def test_redaction_leaves_ordinary_words_alone():
    sentence = "The skateboarding team asked about vbm tokens and the Bearer of bad news."
    assert redact(sentence) == sentence

# valorbrain (Python)

ValorBrain memory for Python agents: a small REST client with no runtime
dependencies, plus adapters for **LangChain**, **LangGraph** and **CrewAI**.

| Module | What you get | Extra |
|---|---|---|
| `valorbrain` | `ValorBrain` client: `store`, `write_document` (with `event_at`), `prepare`, `search`, `get_document`, `list_documents`, `forget`, `used`; typed errors; `redact()` | none (stdlib only) |
| `valorbrain.langchain` | `ValorBrainRetriever`, a LangChain `BaseRetriever` | `valorbrain[langchain]` |
| `valorbrain.langgraph` | `ValorBrainStore`, a LangGraph `BaseStore` for long-term memory | `valorbrain[langgraph]` |
| `valorbrain.crewai` | `ValorBrainMemory`, a drop-in CrewAI `Memory` | `valorbrain[crewai]` |

Tested with Python 3.12, langchain-core 1.6.12, langgraph 1.2.16
(langgraph-checkpoint 4.3.0) and crewai 1.15.28, against the ValorBrain engine
on 2026-10-17.

## Install

```bash
pip install valorbrain                 # client only
pip install "valorbrain[langchain]"    # + LangChain retriever
pip install "valorbrain[langgraph]"    # + LangGraph store
pip install "valorbrain[crewai]"       # + CrewAI memory
```

Until the package is on PyPI, install from this repository:

```bash
pip install "valorbrain[langchain,langgraph] @ git+https://github.com/ValorBrain/valorbrain-harness#subdirectory=python"
```

## Configure

Get a token (`vbm_…`) from the ValorBrain dashboard, or headlessly with
`npx -y @valorbrain/cli@latest init --agent --agent-caller my-app --json`
(use its `mcp_token`). Then:

```bash
export VALORBRAIN_API_KEY=vbm_...                          # never commit it
export VALORBRAIN_URL=https://valorbrain-api.valor.digital # default; set for self-hosted engines
```

The tenant comes from the token; the client never sends a tenant header.
Every request carries `User-Agent: valorbrain-<integration>/<version>`.

## Client

```python
from datetime import datetime, timezone
import time

from valorbrain import ValorBrain, NotFoundError

vb = ValorBrain()  # reads VALORBRAIN_API_KEY / VALORBRAIN_URL

# Typed memory in your agent's collection (title >= 5 chars, content >= 20 chars)
saved = vb.store("Pricing decision", "The Pro plan costs 49 per month, decided on 2026-10-01.", type="decision")

# Upsert a document by path; event_at = when the fact happened
doc = vb.write_document(
    "my-app", "meetings/2026-10-01.md", "Kickoff with ACME: launch moved to November.",
    title="ACME kickoff", event_at=datetime(2026, 10, 1, 14, 0, tzinfo=timezone.utc),
)

time.sleep(5)  # writes become searchable in a few seconds (async embedding)

for hit in vb.search("when is the ACME launch?", limit=3):
    print(hit["docid"], hit["score"], hit["title"])

context = vb.prepare("Prepare me for the ACME call")["markdown"]  # ready to inject in a prompt
vb.used([doc["docid"]], note="answered the launch date")          # declare what informed the answer

vb.forget(doc["docid"])
vb.forget(saved["docid"])
try:
    vb.forget(doc["docid"])
except NotFoundError:
    pass
```

Errors are typed: `AuthenticationError` (401/403), `BadRequestError`
(400/413/422), `NotFoundError` (404), `RateLimitError` (429), `ServerError`
(5xx), `APIConnectionError` (network); all subclass `ValorBrainError` and carry
`.status` and `.body`.

## LangChain

```python
from valorbrain import ValorBrain
from valorbrain.langchain import ValorBrainRetriever

retriever = ValorBrainRetriever(client=ValorBrain(integration="langchain"), k=5)
for d in retriever.invoke("what did we decide about pricing?"):
    print(d.metadata["score"], d.metadata["path"], d.page_content[:80])
```

`page_content` is the memory body; `metadata` has `docid`, `path`, `title`,
`score`, `contentType`, `modifiedAt` and `eventAt`. Options: `collection`,
`mode` (`auto|keyword|semantic|hybrid`), `profile` (`speed|balanced|deep`).
It composes like any retriever (`retriever | format_docs | prompt | llm`).

## LangGraph

```python
from typing import TypedDict

from langgraph.graph import START, StateGraph
from langgraph.runtime import Runtime

from valorbrain.langgraph import ValorBrainStore

store = ValorBrainStore(collection="langgraph")

class State(TypedDict):
    user: str
    reply: str

def respond(state: State, runtime: Runtime) -> dict:
    ns = ("prefs", state["user"])
    runtime.store.put(ns, "language", {"language": "Portuguese"})
    return {"reply": runtime.store.get(ns, "language").value["language"]}

graph = StateGraph(State).add_node(respond).add_edge(START, "respond").compile(store=store)
print(graph.invoke({"user": "gus", "reply": ""})["reply"])

store.delete(("prefs", "gus"), "language")
```

`get`, `put`, `delete`, `search` (with `filter`, `limit`, `offset` and natural
language `query`), `list_namespaces` (prefix/suffix/`*`/`max_depth`) and their
async variants all work. Semantic `query` search uses ValorBrain's own ranking,
so no `index`/embedding config is needed (the `index` argument is ignored).

How it is stored: one collection per store; each put writes a new document at
`<namespace…>/<key>/<updated_ms>-<created_ms>-<rand>.json` (segments
percent-encoded, body = the JSON value) and forgets the previous version.

## CrewAI

```python
from crewai import Agent, Crew, Task

from valorbrain.crewai import ValorBrainMemory

memory = ValorBrainMemory(collection="crewai")
analyst = Agent(role="Analyst", goal="Answer with context", backstory="...", memory=memory)
task = Task(description="Summarize what we know about ACME", expected_output="3 bullets", agent=analyst)
Crew(agents=[analyst], tasks=[task], memory=memory).kickoff()
```

CrewAI calls `recall()` before each task and saves the task result after it;
with `ValorBrainMemory` both go to ValorBrain and no local LanceDB store,
embedding model or memory LLM is needed. Options:

- `collection` (default `crewai`): where memories are written, at `<scope>/<timestamp>.md`.
- `recall_collection` (default `None` = every memory the token can read, so the
  crew sees what other agents of your tenant recorded). An explicit `scope` (or
  `root_scope`) restricts recall to that scope inside `collection`.
- `extract_with_llm` (default `False`): store the task summary as one memory and
  let ValorBrain extract server-side; `True` uses CrewAI's LLM to split it first.
- `redact_secrets` (default `True`).

`forget(record_ids=[...])` works; bulk `forget` by scope/category raises
`NotImplementedError` and `reset()` is a logged no-op, so a crew can never wipe
shared tenant memory.

## What leaves the machine, and when

Only HTTPS calls to `VALORBRAIN_URL`, authenticated with your token:

- **Client**: exactly what you pass, when you call a method.
- **LangChain retriever**: the query text, on every `invoke`.
- **LangGraph store**: namespaces, keys and JSON values on `put`; namespace
  prefixes and query text on `get`/`search`/`list_namespaces`.
- **CrewAI memory**: before each task, the task description (recall query);
  after each task, a summary `Task / Agent / Expected result / Result` plus
  scope, categories and agent role as metadata. This text is captured
  automatically, so it is passed through `valorbrain.redact()` first, which
  removes obvious secrets (API keys, bearer tokens, JWTs, private keys,
  `NAME_TOKEN=value` assignments, passwords in URLs). Redaction is best effort,
  not a guarantee.

Nothing is sent at import time, and no telemetry is collected. ValorBrain
errors never break a crew: `remember` returns `None`, `recall` returns `[]`, and
a warning goes to the `valorbrain.crewai` logger.

## Turn it off

Remove the adapter from your code (`memory=` / `store=` / the retriever) or
unset `VALORBRAIN_API_KEY`; to delete what was written, `forget` the docids
(`search` or `list_documents` find them). `pip uninstall valorbrain` removes
the package.

## Known limits

- Writes take a few seconds to become searchable (embedding is async). `get`
  and `list` in the LangGraph store read by path and see writes immediately; a
  natural language `query` search may miss an item updated in the last seconds.
- The LangGraph store does not support TTL (`supports_ttl = False`), and
  `created_at` / `updated_at` have millisecond precision.
- `list_namespaces` and unfiltered `search` list the whole collection.
- CrewAI `private=` memories are stored with `private: true` in metadata but
  are not filtered on recall; use a separate `collection` for private data.

## Development

```bash
python -m venv .venv && . .venv/bin/activate
pip install -e ".[langchain,langgraph,crewai,test]"
pytest -q                 # offline: a fake engine on 127.0.0.1, no network
VB_STAGING_URL=... VB_STAGING_MCP_TOKEN=... pytest -q -m live   # against a test engine
```

Never point the live tests at a production tenant: they write and then forget
test memories.

## License

MIT

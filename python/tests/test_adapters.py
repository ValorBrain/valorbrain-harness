import asyncio

import pytest


# ------------------------------------------------------------------ LangChain
def test_langchain_retriever(client):
    pytest.importorskip("langchain_core")
    from langchain_core.documents import Document

    from valorbrain.langchain import ValorBrainRetriever

    doc = client.write_document("notes", "p.md", "The Pro plan costs 49 per month", event_at="2026-10-01T00:00:00Z")
    retriever = ValorBrainRetriever(client=client, k=3)
    docs = retriever.invoke("how much is the Pro plan?")
    assert docs and isinstance(docs[0], Document)
    assert docs[0].page_content == "The Pro plan costs 49 per month"
    assert docs[0].id == doc["docid"]
    assert docs[0].metadata["path"] == "notes/p.md"
    assert docs[0].metadata["eventAt"] == "2026-10-01T00:00:00Z"
    assert asyncio.run(retriever.ainvoke("Pro plan"))[0].id == doc["docid"]


def test_langchain_retriever_in_chain(client):
    pytest.importorskip("langchain_core")
    from langchain_core.runnables import RunnableLambda

    from valorbrain.langchain import ValorBrainRetriever

    client.write_document("notes", "q.md", "Gus prefers Portuguese answers")
    chain = ValorBrainRetriever(client=client) | RunnableLambda(lambda ds: "\n".join(d.page_content for d in ds))
    assert "Portuguese" in chain.invoke("which language does Gus prefer?")


# ------------------------------------------------------------------ LangGraph
@pytest.fixture
def store(client):
    pytest.importorskip("langgraph")
    from valorbrain.langgraph import ValorBrainStore

    return ValorBrainStore(client, collection="lg")


def test_store_put_get_update_delete(store, engine):
    ns = ("users", "u:1")
    assert store.get(ns, "prefs") is None
    store.put(ns, "prefs", {"food": "pizza"})
    first = store.get(ns, "prefs")
    assert first.value == {"food": "pizza"} and first.namespace == ns and first.key == "prefs"
    store.put(ns, "prefs", {"food": "sushi"})
    second = store.get(ns, "prefs")
    assert second.value == {"food": "sushi"}
    assert second.created_at == first.created_at
    assert second.updated_at >= first.updated_at
    assert len([d for d in engine.docs.values() if d["collection"] == "lg"]) == 1  # old version forgotten
    store.delete(ns, "prefs")
    assert store.get(ns, "prefs") is None
    # put after delete must work even though the engine never revives a forgotten path
    store.put(ns, "prefs", {"food": "ramen"})
    assert store.get(ns, "prefs").value == {"food": "ramen"}


def test_store_awkward_keys(store):
    ns = ("a b", "x/y*z%")
    for key in ("..", "", "k?[1]", "ünï~"):
        store.put(ns, key, {"key": key})
        assert store.get(ns, key).value == {"key": key}
    assert store.list_namespaces() == [ns]


def test_store_search_filter_and_query(store):
    store.put(("docs", "a"), "1", {"text": "kiwi smoothie recipe", "type": "recipe", "stars": 5})
    store.put(("docs", "a"), "2", {"text": "orca migration notes", "type": "note", "stars": 2})
    store.put(("docs", "b"), "3", {"text": "kiwi farm visit", "type": "note", "stars": 4})
    store.put(("other",), "4", {"text": "kiwi elsewhere", "type": "note"})

    listed = store.search(("docs",))
    assert {i.key for i in listed} == {"1", "2", "3"}
    assert all(i.score is None for i in listed)
    assert [i.key for i in store.search(("docs",), filter={"type": "note", "stars": {"$gte": 3}})] == ["3"]
    assert len(store.search(("docs",), limit=1, offset=1)) == 1

    hits = store.search(("docs",), query="kiwi")
    assert {i.key for i in hits} == {"1", "3"}
    assert all(i.score and i.score > 0 for i in hits)
    assert [i.key for i in store.search(("docs", "a"), query="kiwi")] == ["1"]
    assert {i.key for i in store.search((), query="kiwi")} == {"1", "3", "4"}


def test_store_list_namespaces(store):
    for ns in (("a", "x"), ("a", "y", "z"), ("b",)):
        store.put(ns, "k", {"v": 1})
    assert store.list_namespaces() == [("a", "x"), ("a", "y", "z"), ("b",)]
    assert store.list_namespaces(prefix=("a",)) == [("a", "x"), ("a", "y", "z")]
    assert store.list_namespaces(suffix=("z",)) == [("a", "y", "z")]
    assert store.list_namespaces(max_depth=1) == [("a",), ("b",)]
    assert store.list_namespaces(prefix=("a", "*")) == [("a", "x"), ("a", "y", "z")]


def test_store_async(store):
    async def run():
        await store.aput(("n",), "k", {"v": 2})
        item = await store.aget(("n",), "k")
        found = await store.asearch(("n",))
        return item, found

    item, found = asyncio.run(run())
    assert item.value == {"v": 2} and found[0].key == "k"


def test_store_in_langgraph_graph(store):
    from typing import TypedDict

    from langgraph.graph import END, START, StateGraph
    from langgraph.runtime import Runtime

    class State(TypedDict):
        user: str
        food: str

    def remember(state: State, runtime: Runtime) -> dict:
        runtime.store.put(("prefs", state["user"]), "food", {"food": state["food"]})
        return {}

    def recall(state: State, runtime: Runtime) -> dict:
        return {"food": runtime.store.get(("prefs", state["user"]), "food").value["food"] + "!"}

    graph = (
        StateGraph(State)
        .add_node("remember", remember)
        .add_node("recall", recall)
        .add_edge(START, "remember")
        .add_edge("remember", "recall")
        .add_edge("recall", END)
        .compile(store=store)
    )
    assert graph.invoke({"user": "gus", "food": "pao de queijo"})["food"] == "pao de queijo!"


# --------------------------------------------------------------------- CrewAI
@pytest.fixture
def crew_memory(client):
    pytest.importorskip("crewai")
    from valorbrain.crewai import ValorBrainMemory

    return ValorBrainMemory(client=client)


def test_crewai_is_a_memory_without_local_store(crew_memory):
    from crewai.memory.unified_memory import Memory

    assert isinstance(crew_memory, Memory)
    assert type(crew_memory._storage).__name__ == "_UnusedStorage"


def test_crewai_remember_recall_forget(crew_memory, engine):
    rec = crew_memory.remember(
        "The client meeting moved to Friday. OPENAI_API_KEY=sk-should-not-leak",
        scope="/meetings",
        categories=["calendar"],
        agent_role="planner",
    )
    sent = engine.requests[-1][2]
    assert sent["collection"] == "crewai"
    assert sent["path"].startswith("meetings/") and sent["path"].endswith(".md")
    assert "sk-should-not-leak" not in sent["content"]
    assert sent["metadata"]["categories"] == ["calendar"] and sent["metadata"]["agent_role"] == "planner"
    assert sent["event_at"]
    assert rec.id and rec.scope == "/meetings"

    matches = crew_memory.recall("when is the client meeting?", limit=5)
    assert matches[0].record.id == rec.id
    assert "Friday" in matches[0].format()
    assert crew_memory.recall("client meeting", scope="/meetings")[0].record.id == rec.id
    assert crew_memory.recall("client meeting", scope="/other") == []
    assert crew_memory.forget(record_ids=[rec.id]) == 1
    assert crew_memory.recall("client meeting") == []
    with pytest.raises(NotImplementedError):
        crew_memory.forget(scope="/meetings")


def test_crewai_extract_and_remember_many_without_llm(crew_memory, engine):
    raw = "Task: summarize\nAgent: writer\nResult: The launch is on Monday."
    assert crew_memory.extract_memories(raw) == [raw]
    recs = crew_memory.remember_many(crew_memory.extract_memories(raw), agent_role="writer")
    assert len(recs) == 1 and engine.docs[recs[0].id]["body"] == raw


def test_crewai_fails_open(crew_memory, engine):
    engine.fail_with = 503
    assert crew_memory.remember("This should not crash the crew at all.") is None
    assert crew_memory.recall("anything") == []
    engine.fail_with = None


def test_crewai_read_only_and_reset(client, engine):
    pytest.importorskip("crewai")
    from valorbrain.crewai import ValorBrainMemory

    mem = ValorBrainMemory(client=client, read_only=True)
    assert mem.remember("Nothing is written in read only mode.") is None
    assert not engine.docs
    mem.reset()  # refused, no exception


def test_crewai_accepted_by_crew_and_agent(crew_memory):
    from crewai import Agent, Crew, Task

    agent = Agent(role="r", goal="g", backstory="b", llm="gpt-4o-mini", memory=crew_memory)
    task = Task(description="d", expected_output="e", agent=agent)
    crew = Crew(agents=[agent], tasks=[task], memory=crew_memory)
    assert crew._memory is crew_memory
    assert agent.memory is crew_memory

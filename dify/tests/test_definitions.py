"""Checks that the YAML definitions load the way the Dify runtime loads them."""

from pathlib import Path

import yaml
from conftest import PLUGIN_ROOT

TOOLS = ("store_memory", "prepare_context", "search_memory", "forget_memory")


def load_provider():
    from dify_plugin.entities.tool import ToolProviderConfiguration

    return ToolProviderConfiguration(**yaml.safe_load(Path("provider/valorbrain.yaml").read_text()))


def test_the_provider_and_its_tools_load(plugin_cwd):
    configuration = load_provider()

    assert configuration.identity.label.en_us == "ValorBrain"
    assert [tool.identity.name for tool in configuration.tools] == list(TOOLS)
    credentials = {item.name: item for item in configuration.credentials_schema}
    assert credentials["api_token"].type.value == "secret-input"
    assert credentials["api_token"].required is True
    assert credentials["api_url"].required is False
    assert credentials["api_url"].default == "https://valorbrain-api.valor.digital"


def test_the_model_never_sets_the_scope(plugin_cwd):
    builder_only = {"scope", "collection", "tags", "confidence", "redact_secrets", "fail_open",
                    "recall_budget", "fast_mode", "limit", "mode"}
    for tool in load_provider().tools:
        names = {parameter.name for parameter in tool.parameters}
        assert {"scope", "collection"} <= names, tool.identity.name
        for parameter in tool.parameters:
            if parameter.name in builder_only:
                assert parameter.form.value == "form", f"{tool.identity.name}.{parameter.name} must be set by the builder"
            else:
                assert parameter.form.value == "llm", f"{tool.identity.name}.{parameter.name} is model input"


def test_model_inputs_are_the_documented_ones(plugin_cwd):
    llm = {
        tool.identity.name: {p.name for p in tool.parameters if p.form.value == "llm"} for tool in load_provider().tools
    }
    assert llm == {
        "store_memory": {"title", "content", "type"},
        "prepare_context": {"message"},
        "search_memory": {"query"},
        "forget_memory": {"docid"},
    }


def test_each_python_file_holds_exactly_one_tool_or_provider(plugin_cwd):
    from dify_plugin import Tool, ToolProvider
    from dify_plugin.core.utils.class_loader import load_single_subclass_from_source

    for name in TOOLS:
        load_single_subclass_from_source(
            module_name=f"tools.{name}", script_path=str(PLUGIN_ROOT / "tools" / f"{name}.py"), parent_type=Tool
        )
    load_single_subclass_from_source(
        module_name="provider.valorbrain",
        script_path=str(PLUGIN_ROOT / "provider" / "valorbrain.py"),
        parent_type=ToolProvider,
    )


def test_the_manifest_names_the_plugin(plugin_cwd):
    manifest = yaml.safe_load(Path("manifest.yaml").read_text())

    assert manifest["name"] == "valorbrain"
    assert manifest["author"] == "valorbrain"
    assert manifest["privacy"] == "PRIVACY.md"
    assert manifest["repo"] == "https://github.com/ValorBrain/valorbrain-harness"
    assert Path("PRIVACY.md").is_file()
    assert Path("_assets", manifest["icon"]).is_file()
    assert manifest["network"]["domains"] == ["valorbrain-api.valor.digital"]


def test_versions_agree(plugin_cwd):
    import valorbrain_client

    manifest = yaml.safe_load(Path("manifest.yaml").read_text())
    pyproject = Path("pyproject.toml").read_text()
    assert manifest["version"] == valorbrain_client.VERSION
    assert f'version = "{valorbrain_client.VERSION}"' in pyproject

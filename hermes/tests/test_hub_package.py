#!/usr/bin/env python3
"""Offline checks of what this hub adds around the vendored plugin.

- the vendored files are byte-for-byte what VENDORED_FROM records;
- plugin.yaml, _PLUGIN_VERSION, VENDORED_FROM, the catalog entry and the pip
  package agree on the version, and the catalog entry declares exactly the
  hooks and middleware the manifest does;
- the pip entry point is the group Hermes scans (hermes_agent.memory_providers);
- each patch in patches/ applies, in order, to the recorded commit of a local
  valorbrain-cli checkout (skipped without one).

Stdlib only. Run: python3 -m unittest discover -s hermes/tests -v
"""
from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import tempfile
import tomllib
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def vendored() -> tuple[dict, dict]:
    meta, sums = {}, {}
    for line in (ROOT / "VENDORED_FROM").read_text().splitlines():
        m = re.fullmatch(r"([0-9a-f]{64})  (.+)", line)
        if m:
            sums[m.group(2)] = m.group(1)
        elif ": " in line and not line.startswith("#"):
            k, v = line.split(": ", 1)
            meta[k] = v
    return meta, sums


def nested_lists(text: str, block: str) -> dict:
    """`block:` → {key: [items]} for its indented `key:` + `- item` children."""
    out: dict = {}
    inside, current = False, None
    for raw in text.splitlines():
        if raw.startswith(f"{block}:"):
            inside = True
            continue
        if inside and raw and not raw.startswith(" "):
            break
        if not inside or not raw.strip():
            continue
        line = raw.strip()
        if line.startswith("- ") and current:
            out[current].append(line[2:].strip())
        elif line.endswith(":"):
            current = line[:-1]
            out[current] = []
        elif line.endswith(": []"):
            out[line[:-4]] = []
            current = None
    return out


def top_lists(text: str) -> dict:
    """Top-level `key:` + `- item` lists."""
    out: dict = {}
    current = None
    for raw in text.splitlines():
        if raw and not raw.startswith((" ", "-")):
            current = raw[:-1] if raw.endswith(":") else None
            if current:
                out[current] = []
        elif current and raw.strip().startswith("- "):
            out[current].append(raw.strip()[2:])
    return out


def scalar(text: str, key: str) -> str:
    m = re.search(rf'^{re.escape(key)}:\s*"?([^"\n]*)"?\s*$', text, re.M)
    return m.group(1) if m else ""


class HubPackageTest(unittest.TestCase):
    def setUp(self):
        self.meta, self.sums = vendored()
        self.manifest = (ROOT / "plugin.yaml").read_text()
        self.catalog = (ROOT / "catalog" / "valorbrain.yaml").read_text()
        self.pyproject = tomllib.loads((ROOT / "pyproject.toml").read_text())
        self.plugin_src = (ROOT / "__init__.py").read_text()

    def test_vendored_files_match_their_recorded_sha256(self):
        self.assertIn("__init__.py", self.sums)
        self.assertIn("plugin.yaml", self.sums)
        for rel, digest in self.sums.items():
            with self.subTest(file=rel):
                self.assertEqual(hashlib.sha256((ROOT / rel).read_bytes()).hexdigest(), digest)

    def test_source_is_the_public_canonical_package(self):
        self.assertEqual(self.meta["repo"], "https://github.com/ValorBrain/valorbrain-cli")
        self.assertEqual(self.meta["path"], "packages/hermes-plugin")
        self.assertRegex(self.meta["commit"], r"^[0-9a-f]{40}$")

    def test_versions_agree(self):
        version = scalar(self.manifest, "version")
        code = re.search(r'^_PLUGIN_VERSION = "([^"]+)"', self.plugin_src, re.M).group(1)
        self.assertEqual(version, code)
        self.assertEqual(version, self.meta["plugin_version"])
        self.assertEqual(scalar(self.catalog, "version"), version)
        self.assertEqual(self.pyproject["tool"]["setuptools"]["dynamic"]["version"]["attr"],
                         "valorbrain_hermes._PLUGIN_VERSION")

    def test_catalog_entry_points_at_the_vendored_source(self):
        self.assertEqual(scalar(self.catalog, "name"), "valorbrain")
        self.assertEqual(scalar(self.catalog, "repo"), self.meta["repo"])
        self.assertEqual(scalar(self.catalog, "subdir"), self.meta["path"])
        self.assertEqual(scalar(self.catalog, "sha"), self.meta["commit"])
        self.assertEqual(scalar(self.catalog, "category"), "memory")
        self.assertIn("Disclosure —", scalar(self.catalog, "description"))
        self.assertIn("gateway", scalar(self.catalog, "description"))

    def test_catalog_capabilities_match_the_manifest(self):
        caps = nested_lists(self.catalog, "capabilities")
        manifest = top_lists(self.manifest)
        self.assertEqual(caps.get("provides_hooks"), manifest.get("hooks", []))
        self.assertEqual(caps.get("provides_middleware"), manifest.get("provides_middleware", []))
        self.assertEqual(caps.get("provides_tools"), manifest.get("provides_tools", []))
        self.assertEqual(caps.get("requires_env"), manifest.get("requires_env", []))

    def test_pip_entry_point_is_the_group_hermes_scans(self):
        eps = self.pyproject["project"]["entry-points"]
        self.assertEqual(eps, {"hermes_agent.memory_providers": {"valorbrain": "valorbrain_hermes"}})
        self.assertEqual(self.pyproject["project"]["name"], "valorbrain-hermes")
        self.assertEqual(self.pyproject["tool"]["setuptools"]["package-dir"], {"valorbrain_hermes": "."})
        self.assertEqual(self.pyproject["project"]["dependencies"], [])

    def test_every_patch_ships_a_test(self):
        patches = sorted((ROOT / "patches").glob("*.diff"))
        self.assertTrue(patches)
        for patch in patches:
            with self.subTest(patch=patch.name):
                text = patch.read_text()
                self.assertTrue(text.startswith("From "), "git format-patch output")
                self.assertRegex(text, r"\+\+\+ b/packages/hermes-plugin/tests/test_\w+\.py")

    def test_patches_apply_in_order_to_the_recorded_commit(self):
        src = Path(os.environ.get("VALORBRAIN_CLI_DIR", "/www/valorbrain-cli"))
        if not shutil.which("git") or not (src / ".git").exists():
            self.skipTest("no local valorbrain-cli checkout")
        commit = self.meta["commit"]
        if subprocess.run(["git", "-C", str(src), "cat-file", "-e", f"{commit}^{{commit}}"],
                          capture_output=True).returncode != 0:
            self.skipTest(f"{commit} not in {src}")
        with tempfile.TemporaryDirectory() as tmp:
            archive = subprocess.run(["git", "-C", str(src), "archive", commit, "packages/hermes-plugin"],
                                     capture_output=True, check=True).stdout
            subprocess.run(["tar", "-x", "-C", tmp], input=archive, check=True)
            for patch in sorted((ROOT / "patches").glob("*.diff")):
                with self.subTest(patch=patch.name):
                    res = subprocess.run(["git", "apply", str(patch)], cwd=tmp, capture_output=True, text=True)
                    self.assertEqual(res.returncode, 0, res.stderr)


if __name__ == "__main__":
    unittest.main()

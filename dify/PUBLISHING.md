# Publishing to the Dify Marketplace

The Dify Marketplace takes a pull request to
[langgenius/dify-plugins](https://github.com/langgenius/dify-plugins) that adds one `.difypkg`
file. Dify reviews it; after the merge, Dify uploads the package to the Marketplace. The
`.difyignore` file keeps this file, the tests and the scripts out of the package.

Dify's guide: https://docs.dify.ai/en/develop-plugin/publishing/marketplace-listing/submit-plugin-to-marketplace

## Decisions before the pull request

Each item makes something public, so the owner of the `ValorBrain` GitHub organization approves
it first:

1. The `dify/` folder of `github.com/ValorBrain/valorbrain-harness` is public on `main` (the
   manifest `repo` and the README link there; Dify reviewers read the source there).
2. The listing shows the name "ValorBrain", the icon, the README, `PRIVACY.md` and the contact
   `comercial@valor.digital` to all Dify users. Confirm the contact address.
3. Agree to the Dify Plugin Developer Agreement (the pull request template asks for it).
4. Choose the GitHub account that opens the pull request and watches it for reviewer comments.
   Use a member of the `ValorBrain` organization, so the organization can claim the plugin later
   in the Dify Creator Center (https://creators.dify.ai).

Also check:

1. Test on Dify Cloud and on the current Dify Community Edition (the template asks for both):
   remote debugging (see `README.md`) or install the `.difypkg` file.
2. `version` in `manifest.yaml` does not exist on the Marketplace yet. For an update, increase it
   (and `VERSION` in `valorbrain_client/__init__.py`, and `pyproject.toml`; a test checks they agree).
3. `created_at` in `manifest.yaml` is not in the future.

## Build and validate the package

From the repository root, with the Dify plugin CLI 0.6.11 or later
(https://github.com/langgenius/dify-plugin-daemon/releases) and `yq`:

```bash
dify plugin package ./dify -o valorbrain-0.1.0.difypkg
git clone https://github.com/langgenius/dify-marketplace-toolkit.git
python3 dify-marketplace-toolkit/validator/validate-difypkg.py valorbrain-0.1.0.difypkg \
  --pr-body-file pr-body.md --output-dir validation-report
```

Save the pull request text below as `pr-body.md` first. Exit code 0 means no blocking finding.
Read `validation-report/summary.md` for the warnings.

The package must contain only these files:

```text
LICENSE
PRIVACY.md
README.md
_assets/icon.svg
main.py
manifest.yaml
provider/valorbrain.py
provider/valorbrain.yaml
pyproject.toml
requirements.txt
tools/forget_memory.py
tools/forget_memory.yaml
tools/prepare_context.py
tools/prepare_context.yaml
tools/search_memory.py
tools/search_memory.yaml
tools/store_memory.py
tools/store_memory.yaml
valorbrain_client/__init__.py
```

## Open the pull request

From a fork of `langgenius/dify-plugins`. The package goes in `<author>/<plugin-name>/`, so the
path is `valorbrain/valorbrain/valorbrain-0.1.0.difypkg`. One package per pull request.

```bash
git clone https://github.com/<your-account>/dify-plugins.git
cd dify-plugins
git remote add upstream https://github.com/langgenius/dify-plugins.git
git fetch upstream
git switch main
git merge --ff-only upstream/main
git switch -c add-valorbrain-0.1.0
mkdir -p valorbrain/valorbrain
cp ../valorbrain-0.1.0.difypkg valorbrain/valorbrain/
git add valorbrain/valorbrain/valorbrain-0.1.0.difypkg
git commit -m "add valorbrain 0.1.0"
git push -u origin HEAD
```

Open the pull request to `langgenius/dify-plugins:main` with the title `add valorbrain 0.1.0`.
Keep the template, use the text below as the body, and replace **Local validation** with the
result of your own run.

## Pull request text

```markdown
# Plugin Submission

## Plugin information

- **Author**: valorbrain
- **Plugin name**: valorbrain (label: ValorBrain)
- **Version**: 0.1.0
- **Source repository**: https://github.com/ValorBrain/valorbrain-harness
- **Contact**: comercial@valor.digital

## Submission type

- [x] New plugin
- [ ] Version update

## What changed

New tool plugin for ValorBrain (https://valorbrain.com.br), persistent memory for AI agents. It
adds four tools that call the documented ValorBrain REST API over HTTPS:

- **Store memory** (`POST /api/v1/memory/store`): save one typed memory.
- **Prepare context** (`POST /api/v1/memory/prepare`): Markdown context for a message, ready to
  put in an LLM prompt.
- **Search memory** (`POST /search`): hybrid search; each result carries its document ID.
- **Forget memory** (`POST /documents/{id}/forget`): permanently remove one document.

Why it is needed: Dify apps have no tool today for ValorBrain. With this plugin, Workflow, Chatflow
and Agent apps keep long-term memory per app, per collection or per end user. The scope (which
collection is read or written) is a builder setting (`form` parameter), never chosen by the model.

Credentials: a ValorBrain token (`vbm_`, secret input) and an optional API URL. Credential
validation calls `GET /api/v1/memory/health`, which reads only.

## Risk level

- [ ] Low risk
- [x] Medium risk
- [ ] High risk

Medium because the plugin sends user content to an external service (ValorBrain) and performs
write actions there (store and forget).

## Required checks

- [ ] I have read and followed the [Marketplace submission requirements](https://github.com/langgenius/dify-plugins/blob/main/docs/plugin-submission-requirements.md).
- [ ] I have read and comply with the Plugin Developer Agreement.
- [ ] I tested this plugin on Dify Community Edition and Dify Cloud, or documented any limitation below.
- [x] The package contains only files needed at runtime.
- [x] The package does not contain secrets, local credentials, `.env` files, `.git` directories, virtual environments, caches, logs, or IDE files.
- [x] The package does not contain executables or bundled binaries, or I explained why they are required below.
- [x] The plugin README includes setup steps, usage instructions, required APIs or credentials, connection requirements, and the source repository link.
- [x] The plugin includes `PRIVACY.md` or a hosted privacy policy, and `manifest.yaml` references it.
- [x] All user-facing text is primarily in English, with any localized README files following the [i18n guidance](https://docs.dify.ai/en/develop-plugin/features-and-specs/plugin-types/multilingual-readme).

## Security and privacy notes

- User content is sent to an external service: the tool inputs (memory title and content,
  messages, queries, document IDs, and the collection name, which can contain the Dify end-user
  ID) go to the ValorBrain REST API at `valorbrain-api.valor.digital`, declared in
  `network.domains`. They can contain personal data, depending on what the Dify app sends.
  `PRIVACY.md` describes what is sent and links to https://valor.digital/privacidade/.
- Store memory replaces obvious secrets (API key shapes, Bearer values, JWTs, KEY=value
  assignments, private keys) with `[redacted]` before sending, on by default.
- Configurable network destination: the optional `api_url` credential lets a workspace admin point
  the plugin at a self-hosted ValorBrain engine. HTTPS is required; plain HTTP only for localhost,
  private-network and single-label hosts. No user info, query or fragment; redirects are not
  followed; only the fixed ValorBrain API paths are called. Tool inputs and the model cannot change
  the host.
- Write and delete actions: Forget memory deletes one document by ID. With a collection scope it
  first checks that the document belongs to that collection.
- Timeouts: 60 seconds per request, 10 seconds to connect. A 429 or 503 is retried at most two
  times, only when `Retry-After` is 10 seconds or less.
- Errors show the HTTP status and the API error message. The token is never returned in an error
  or a message. The plugin writes no logs of tool inputs or outputs.
- None of these apply: command or code execution, SQL, SSH/SFTP, browser automation, file
  operations, arbitrary URL fetching, proxying, bundled executables.

## Local validation

    dify plugin package ./dify -o valorbrain-0.1.0.difypkg   # Dify plugin CLI v0.6.11
    python3 validator/validate-difypkg.py valorbrain-0.1.0.difypkg --pr-body-file pr-body.md --output-dir validation-report

<paste the summary table and the exit code here>

Unit tests (fake HTTP transport): `python -m pytest`, all passing. The package was also run with
`dify plugin run` and exercised against a ValorBrain staging engine (validate, store, search,
prepare, forget).

## Reviewer notes

- Requires Dify 1.14.2 or later (`dify_plugin` 0.9.1).
```

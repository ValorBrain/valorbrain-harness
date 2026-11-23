# Publishing to the Open WebUI Community (openwebui.com)

Nothing here has been published. This is the material and the steps for a maintainer to do it.

## How publishing works

openwebui.com never talks to an Open WebUI server; posts are created from a browser session
([docs](https://docs.openwebui.com/ecosystem/community)). Two ways in:

- From an Open WebUI instance where the plugin is installed: Admin Panel → Functions → *ValorBrain Memory* → menu
  → **Share** (Functions), Workspace → Tools → *ValorBrain Memory Tools* → menu → **Share** (Tools). This opens
  openwebui.com with a draft prefilled with the code; nothing is public until the post is finished there.
- Directly on openwebui.com: sign in, create a Function / Tool post, paste the file.

Sharing publishes the full source. Valve values (tokens) are not included in a share.

## Before publishing

1. The files are merged on `main` of `github.com/ValorBrain/valorbrain-harness` (the README links point there).
2. `version:` in the frontmatter of both files matches `VERSION` in the code, and both match the tag/changelog.
3. Offline tests pass: `python -m unittest discover -s tests -v` (and the upstream-dispatcher test with the
   current Open WebUI release's `filter.py`).
4. Code contains no token, internal hostname or staging URL (`grep -nE 'vbm_|vb_agent_|127\.0\.0\.1' *.py` returns
   only the redaction regexes and the `api_token` valve descriptions).
5. Use the ValorBrain organization account on openwebui.com, not a personal one.

## Post 1: Function (Filter)

- **Type:** Function
- **Title:** ValorBrain Memory
- **File:** `open-webui/valorbrain_memory_filter.py`
- **Short description:** Long-term memory for Open WebUI: recalls relevant context before each turn and saves
  each finished turn (secrets redacted) to ValorBrain.
- **Tags:** memory, long-term memory, filter, context, rag, valorbrain
- **Body:**

  > ValorBrain gives your Open WebUI models a memory that lasts across chats and is shared with your other
  > agents (Claude Code, Codex, Cursor, Hermes, OpenClaw…).
  >
  > **What it does**
  > - Before each turn: sends the user's message to ValorBrain and adds the matching context as a clearly
  >   marked system message (treated as data, not instructions).
  > - After each turn: saves the question and answer. Obvious secrets (API keys, tokens, passwords, private
  >   keys) are redacted before anything leaves your server; recalled context is stripped so it is never saved
  >   back.
  > - Fails open: if ValorBrain is slow or down, the chat continues unchanged.
  >
  > **Setup**
  > 1. Get a token: `npx -y @valorbrain/cli@latest init --agent --agent-caller open-webui --json` (use
  >    `mcp_token`).
  > 2. Paste it in the Valves (`api_token`), enable the function, make it Global or attach it to models.
  > 3. Optional: each user can set a personal token in Chat → Controls → Valves; turn on `require_user_token`
  >    on multi-user servers.
  >
  > **Privacy:** only the latest user message (for recall) and the finished turn (for capture) are sent; no
  > files, images, names, emails or earlier messages. Temporary chats are not saved. Recall and capture can be
  > turned off per user or globally.
  >
  > Source, tests and full data-flow table: https://github.com/ValorBrain/valorbrain-harness/tree/main/open-webui
  > (MIT).

## Post 2: Tool

- **Type:** Tool
- **Title:** ValorBrain Memory Tools
- **File:** `open-webui/valorbrain_memory_tool.py`
- **Short description:** Lets the model search ValorBrain memory and save notes when you ask it to remember
  something.
- **Tags:** memory, search, tool, knowledge, valorbrain
- **Body:**

  > Two tools for the model: `search_memory(query, limit)` searches your ValorBrain memory;
  > `remember(title, content)` saves a note when you ask it to. Secrets are redacted before saving. Works on its
  > own or together with the *ValorBrain Memory* filter. Setup: paste a ValorBrain token in the Valves (or each
  > user's own in their User Valves) and enable the tool on a model with native function calling.
  >
  > Source and tests: https://github.com/ValorBrain/valorbrain-harness/tree/main/open-webui (MIT).

## After publishing

- Add the two openwebui.com post URLs to `open-webui/README.md` (Install section) and to the hub index.
- New releases: bump `version` in the frontmatter and `VERSION`, then update the existing posts (do not create
  new ones).

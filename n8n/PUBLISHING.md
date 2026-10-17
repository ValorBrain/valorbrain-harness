# Publishing n8n-nodes-valorbrain

Steps to publish the package to npm and to submit it to n8n for verification. Nothing here has been
run yet: each step needs an owner of the `ValorBrain` GitHub organization and of the npm account
that will own the package.

n8n verifies a community node only when: the package is published from GitHub Actions with an npm
provenance statement (required since 1 May 2026), the repository is public, the license is MIT, the
npm `repository.url` is the GitHub repository, `n8n-node lint` passes in strict mode, and the
package has no runtime dependency.

## 1. Turn on the publish workflow (hub owner)

The package lives in the `n8n/` folder of `ValorBrain/valorbrain-harness`. Copy the workflow to the
hub root and push it to `main`:

```bash
cp n8n/ci/n8n-publish.yml .github/workflows/n8n-publish.yml
git add .github/workflows/n8n-publish.yml && git commit -m "ci: publish n8n node" && git push
```

It runs on tags `n8n-v<version>`, from the `n8n/` folder: `npm ci`, `npm test`, then
`npm run release`, which in GitHub Actions runs lint, build and `npm publish` with provenance.

Optional: add `cd n8n && npm ci && npm test && npm run lint` to the hub CI for pull requests.

## 2. First publish credential (npm owner)

The package does not exist on npm yet, and npm adds a trusted publisher only to an existing package.

1. On npmjs.com, Access Tokens > Generate New Token > Granular Access Token: expiration 1 day,
   packages **Read and write**, all packages.
2. In the GitHub repository: Settings > Secrets and variables > Actions > New repository secret,
   name `NPM_TOKEN`.

If npmjs.com lets you add a trusted publisher for the new name before the first publish, do step 4
now and skip the token.

## 3. Publish 0.1.0 (hub owner)

`package.json` already says `0.1.0`. Push the tag only:

```bash
git tag n8n-v0.1.0
git push origin n8n-v0.1.0
```

Then check:

```bash
npm view n8n-nodes-valorbrain version          # 0.1.0
npm view n8n-nodes-valorbrain repository       # ValorBrain/valorbrain-harness, directory n8n
```

The npm page must show the **Provenance** section, linking the workflow run and the commit.

## 4. Switch to trusted publishing (npm owner)

1. npmjs.com > package `n8n-nodes-valorbrain` > Settings > Trusted Publisher > GitHub Actions:
   organization `ValorBrain`, repository `valorbrain-harness`, workflow `n8n-publish.yml`,
   environment empty.
2. Publishing access: **Require two-factor authentication and disallow tokens**.
3. Delete the `NPM_TOKEN` secret and the token.

Later releases: bump `version` in `n8n/package.json` and `VERSION` in
`n8n/nodes/ValorBrain/GenericFunctions.ts` (a test checks they match), commit, push, then tag
`n8n-v<version>` and push the tag. Do not run `npm run release` on a laptop: outside GitHub Actions
it calls release-it, which tags the whole hub with a bare version and requires a clean `main`.

## 5. Run the n8n scanner (submitter)

```bash
npx @n8n/scan-community-package n8n-nodes-valorbrain
```

It checks the provenance, fetches the attested commit from GitHub, finds the `n8n/` folder by the
package name, and lints the source and the published files. All checks must pass. Before a publish,
`npm run scan` in `n8n/` runs the same lint offline on the folder and on the packed tarball.

## 6. Submit on the n8n Creator Portal (submitter)

1. Open https://creators.n8n.io/nodes and sign in.
2. Submit `n8n-nodes-valorbrain` with:
   - **Name**: ValorBrain
   - **npm package**: `n8n-nodes-valorbrain`
   - **Repository**: https://github.com/ValorBrain/valorbrain-harness (folder `n8n/`)
   - **Short description**: Durable memory for AI agents. Store memories, write dated documents,
     prepare context for a prompt, search and forget.
   - **Description**: ValorBrain is durable memory for AI agents and teams. The node has five
     operations on the resource Memory: Store Memory, Write Document (with the time the fact
     happened), Prepare Context (Markdown ready for a system prompt), Search (hybrid search) and
     Forget. It can be a tool of the AI Agent node. The tenant comes from the token.
   - **Categories**: Data & Storage, Development
   - **Documentation**: https://github.com/ValorBrain/valorbrain-harness/tree/main/n8n#readme and
     https://docs.valorbrain.com.br
   - **Website**: https://valorbrain.com.br
   - **Contact**: comercial@valor.digital
3. If reviewers ask for a way to test, give them a `vbm_` token of a throwaway tenant through a
   private channel. Never put a token in a public form, an issue or the repository.

## Checklist for the verification rules

| Rule | Where |
| --- | --- |
| Built with the `n8n-node` CLI, `n8n-node lint` passes in strict mode | `package.json` (`n8n.strict`), `npm run lint` |
| Name `n8n-nodes-…`, keyword `n8n-community-node-package` | `package.json` |
| MIT license | `LICENSE`, `package.json` |
| No runtime dependencies | only `devDependencies` and a peer dependency on `n8n-workflow` |
| No environment variables, no file system in the node | `nodes/`, `credentials/` use n8n's HTTP helper only |
| English only | node, credential, README |
| README with install, credential, operations, examples | `README.md`, `examples/` |
| Published from GitHub Actions with provenance | `ci/n8n-publish.yml` → `.github/workflows/n8n-publish.yml` |
| npm repository URL is the GitHub repository | `package.json` `repository` (with `directory: n8n`) |

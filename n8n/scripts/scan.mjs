// Runs the static analysis of `npx @n8n/scan-community-package` on this folder and on its packed
// tarball, without the registry. The published scanner also checks npm provenance and fetches the
// attested source from GitHub; those two steps need a published version, so this script skips
// them and runs the same ESLint analysis on the same files:
//   - the source: package.json and nodes/, credentials/ (.ts, .js, .json)
//   - the tarball: every .js file and package.json
// The scanner is installed in a temporary folder, so that its own TypeScript does not replace the
// one this package builds with. Installing it is the only step that uses the network.
import {execFileSync} from 'node:child_process'
import {mkdtempSync, readdirSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

const SCANNER = '@n8n/scan-community-package@0.39.0'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = mkdtempSync(join(tmpdir(), 'n8n-scan-'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
// Under `npm run scan`, the npm_config_* variables of this package leak into the nested install
// (with npm 12 they made it fail), so the scanner is installed with them removed.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key)))

try {
  console.log(`Installing ${SCANNER} in a temporary folder...`)
  execFileSync(npm, ['install', '--prefix', join(work, 'scanner'), '--no-audit', '--no-fund', '--silent', SCANNER], {stdio: 'inherit', cwd: work, env: cleanEnv})

  console.log('Building and packing this package...')
  execFileSync(npm, ['run', 'build', '--silent'], {cwd: root, stdio: 'inherit'})
  execFileSync(npm, ['pack', '--silent', '--pack-destination', work], {cwd: root, stdio: ['ignore', 'ignore', 'inherit']})
  const tarball = readdirSync(work).find((name) => name.endsWith('.tgz'))
  if (!tarball) throw new Error('npm pack wrote no tarball')
  execFileSync('tar', ['-xzf', join(work, tarball), '-C', work])

  const scanner = await import(
    pathToFileURL(join(work, 'scanner/node_modules/@n8n/scan-community-package/scanner/scanner.mjs')).href
  )
  const source = await scanner.analyzePackage(root, scanner.SOURCE_FILE_PATTERNS)
  const shipped = await scanner.analyzePackage(join(work, 'package'), ['**/*.js', 'package.json'])

  let failed = false
  for (const [name, result] of [['source', source], ['tarball', shipped]]) {
    if (result.passed) {
      console.log(`passed: ${name}${result.message ? ` (${result.message})` : ''}`)
    } else {
      failed = true
      console.log(`failed: ${name}: ${result.message}`)
      if (result.details) console.log(result.details)
    }
  }
  console.log('Not run here: the provenance check and the source fetch, which need a version published from GitHub Actions.')
  process.exitCode = failed ? 1 : 0
} finally {
  rmSync(work, {recursive: true, force: true})
}

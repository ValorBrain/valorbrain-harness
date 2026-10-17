// Live test of the ValorBrain node against a real engine. It runs the operations of the node with
// a fake n8n context whose HTTP helper sends real requests, the way n8n does: it writes a memory and
// a dated document, waits until search finds them (positive control), prepares context, then forgets
// both. It skips unless VB_LIVE_URL and VB_LIVE_TOKEN are set. Point it at a staging or a throwaway
// tenant, never at production data you care about. The token is read from the environment only.
const assert = require('node:assert/strict')
const {test} = require('node:test')

const {ValorBrain} = require('../dist/nodes/ValorBrain/ValorBrain.node.js')
const {ValorBrainApi} = require('../dist/credentials/ValorBrainApi.credentials.js')

const URL_ = process.env.VB_LIVE_URL
const TOKEN = process.env.VB_LIVE_TOKEN
const skip = !URL_ || !TOKEN ? 'set VB_LIVE_URL and VB_LIVE_TOKEN to run' : false

/** What httpRequestWithAuthentication does for this credential: add the bearer, send, read JSON. */
async function send(options, token = TOKEN) {
  const url = new URL(options.url)
  for (const [k, v] of Object.entries(options.qs ?? {})) url.searchParams.set(k, String(v))
  const headers = {...options.headers, Authorization: `Bearer ${token}`}
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(url, {method: options.method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body)})
  const raw = await res.text()
  let body
  try { body = raw ? JSON.parse(raw) : {} } catch { body = {raw} }
  return {statusCode: res.status, statusMessage: res.statusText, headers: Object.fromEntries(res.headers), body}
}

async function op(operation, params) {
  const node = {id: 'live', name: 'ValorBrain', type: 'n8n-nodes-valorbrain.valorBrain', typeVersion: 1, position: [0, 0], parameters: {}}
  const ctx = {
    getInputData: () => [{json: {}}],
    getNodeParameter: (name, _i, fallback) => {
      const all = {resource: 'memory', operation, ...params}
      if (all[name] === undefined) {
        if (fallback !== undefined) return fallback
        throw new Error(`no parameter ${name}`)
      }
      return all[name]
    },
    getNode: () => node,
    getCredentials: async () => ({token: TOKEN, apiUrl: URL_}),
    continueOnFail: () => false,
    helpers: {httpRequestWithAuthentication: async (_type, options) => send(options)},
  }
  const [[out]] = await new ValorBrain().execute.call(ctx)
  return out.json
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...args) => console.log('[live]', ...args)

test('credential test: the read answers 200 with the token and 401 with a bad one', {skip}, async () => {
  const {request} = new ValorBrainApi().test
  const options = {method: request.method, url: `${URL_.replace(/\/+$/, '')}${request.url}`, qs: request.qs, headers: request.headers}
  assert.equal((await send(options)).statusCode, 200)
  assert.equal((await send(options, 'vbm_not_a_real_token')).statusCode, 401)
  log('credential test ok: 200 with token, 401 with bad token')
})

test('store, write, search, prepare and forget against the engine', {skip, timeout: 120_000}, async () => {
  const marker = `n8nlive${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const eventAt = '2026-07-28T16:00:00Z'
  const forgets = []
  try {
    const stored = await op('store', {
      title: `n8n live test ${marker}`,
      content: `The n8n live test stored the marker ${marker} to check the ValorBrain node.`,
      additionalFields: {type: 'observation', tags: 'n8n-live-test'},
    })
    log('store ->', JSON.stringify({ok: stored.ok, docid: stored.docid, collection: stored.collection, action: stored.action}))
    assert.equal(stored.ok, true)
    assert.ok(stored.docid)
    forgets.push(stored.docid)

    const written = await op('writeDocument', {
      collection: stored.collection,
      path: `n8n-live/${marker}.md`,
      content: `# Dated fact ${marker}\n\nOn 28 July 2026 the n8n live test recorded the dated fact ${marker}.`,
      eventAt,
      additionalFields: {title: `n8n dated fact ${marker}`, contentType: 'note', runId: marker},
    })
    log('writeDocument ->', JSON.stringify({docid: written.docid, action: written.action, path: written.path, event_at: written.event_at}))
    assert.ok(written.docid)
    forgets.push(written.docid)
    assert.equal(written.event_at, eventAt)

    let found = []
    const started = Date.now()
    for (let attempt = 0; attempt < 20 && found.length < 2; attempt++) {
      await sleep(2000)
      const page = await op('search', {query: marker, options: {limit: 10, collection: stored.collection}})
      found = (page.results ?? []).filter((r) => `${r.title ?? ''} ${r.snippet ?? ''} ${r.body ?? ''} ${r.filepath ?? ''}`.includes(marker))
    }
    log(`search -> ${found.length} result(s) with the marker after ${((Date.now() - started) / 1000).toFixed(1)} s:`, found.map((r) => `${r.docid} ${r.title}`).join(' | '))
    // /api/v1/memory/store answers with the numeric row id as "docid"; search answers with the hash
    // prefix. Match the memory by its title, and the document by its docid.
    assert.ok(found.some((r) => String(r.title).startsWith('n8n live test')), 'search finds the stored memory')
    assert.ok(found.some((r) => String(r.docid).replace(/^#/, '') === written.docid), 'search finds the written document')

    const prepared = await op('prepare', {message: `What do we know about ${marker}?`, options: {recallBudget: 1500}})
    assert.equal(typeof prepared.markdown, 'string')
    log('prepare ->', JSON.stringify({markdownChars: prepared.markdown.length, mentionsMarker: prepared.markdown.includes(marker), recall_used: prepared.recall_used, tokens_estimate: prepared.tokens_estimate}))
  } finally {
    for (const id of forgets) {
      const res = await op('forget', {documentId: id})
      log('forget ->', JSON.stringify({docid: res.docid, forgotten: res.forgotten}))
      assert.equal(res.forgotten, true)
    }
  }
  await sleep(2000)
  const after = await op('search', {query: marker, options: {limit: 10}})
  const left = (after.results ?? []).filter((r) => `${r.title ?? ''} ${r.snippet ?? ''}`.includes(marker))
  log(`search after forget -> ${left.length} result(s) with the marker`)
  assert.equal(left.length, 0)
})

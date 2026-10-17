// The ValorBrain node and its credential, run against a fake n8n context: the requests that each
// operation sends, the items it returns and the errors it raises. The tests run against the build
// in dist. Nothing leaves the machine.
const assert = require('node:assert/strict')
const {readFileSync} = require('node:fs')
const {join} = require('node:path')
const {describe, test} = require('node:test')

const {NodeApiError, NodeOperationError} = require('n8n-workflow')

const {ValorBrain} = require('../dist/nodes/ValorBrain/ValorBrain.node.js')
const {ValorBrainApi} = require('../dist/credentials/ValorBrainApi.credentials.js')
const {VERSION, USER_AGENT, DEFAULT_API_URL} = require('../dist/nodes/ValorBrain/GenericFunctions.js')

/**
 * A fake IExecuteFunctions. `items` is one parameter object for each input item. `replies` are the
 * responses of httpRequestWithAuthentication, in order: {statusCode, body, headers}, or {throws}.
 */
function context({items = [{}], replies = [], credentials = {token: 'vbm_fake', apiUrl: 'https://vb.example.test/'}, continueOnFail = false}) {
  const calls = []
  const node = {id: 'n1', name: 'ValorBrain', type: 'n8n-nodes-valorbrain.valorBrain', typeVersion: 1, position: [0, 0], parameters: {}}
  return {
    calls,
    getInputData: () => items.map(() => ({json: {}})),
    getNodeParameter: (name, index, fallback) => {
      const value = items[index][name]
      if (value === undefined) {
        if (fallback !== undefined) return fallback
        throw new Error(`no parameter ${name}`)
      }
      return value
    },
    getNode: () => node,
    getCredentials: async (type) => {
      assert.equal(type, 'valorBrainApi')
      return credentials
    },
    continueOnFail: () => continueOnFail,
    helpers: {
      httpRequestWithAuthentication: async function (type, options) {
        calls.push({type, ...options})
        const reply = replies.shift() ?? {statusCode: 200, body: {}}
        if (reply.throws) throw reply.throws
        return {statusCode: reply.statusCode, statusMessage: '', headers: reply.headers ?? {}, body: reply.body}
      },
    },
  }
}

const run = (ctx) => new ValorBrain().execute.call(ctx)
const item = (operation, extra = {}) => ({resource: 'memory', operation, ...extra})
const HEADERS = {Accept: 'application/json', 'User-Agent': USER_AGENT}

describe('description', () => {
  test('the node is ValorBrain, usable as a tool, with five Memory operations', () => {
    const {description} = new ValorBrain()
    assert.equal(description.name, 'valorBrain')
    assert.equal(description.displayName, 'ValorBrain')
    assert.equal(description.usableAsTool, true)
    assert.deepEqual(description.credentials, [{name: 'valorBrainApi', required: true}])
    const operations = description.properties.find((p) => p.name === 'operation').options
    assert.deepEqual(operations.map((o) => o.value), ['forget', 'prepare', 'search', 'store', 'writeDocument'])
  })

  test('the user ID is described as set by the workflow, never by a model', () => {
    const write = new ValorBrain().description.properties.find(
      (p) => p.name === 'additionalFields' && p.displayOptions.show.operation[0] === 'writeDocument',
    )
    const userId = write.options.find((o) => o.name === 'userId')
    assert.match(userId.description, /never from a model/)
  })

  test('the credential sends the token as a bearer and tests it with a read that matches nothing', () => {
    const credential = new ValorBrainApi()
    assert.equal(credential.name, 'valorBrainApi')
    const token = credential.properties.find((p) => p.name === 'token')
    assert.equal(token.typeOptions.password, true)
    assert.equal(token.required, true)
    assert.equal(credential.properties.find((p) => p.name === 'apiUrl').default, 'https://valorbrain-api.valor.digital')
    assert.equal(DEFAULT_API_URL, 'https://valorbrain-api.valor.digital')
    assert.deepEqual(credential.authenticate, {type: 'generic', properties: {headers: {Authorization: '=Bearer {{$credentials.token}}'}}})
    assert.equal(credential.test.request.method, 'GET')
    assert.equal(credential.test.request.url, '/documents')
    assert.deepEqual(credential.test.request.qs, {pattern: 'n8n-credential-test'})
    assert.match(credential.test.request.baseURL, /^=\{\{.*valorbrain-api\.valor\.digital.*\}\}$/)
  })

  test('VERSION and the User-Agent follow package.json', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))
    assert.equal(VERSION, pkg.version)
    assert.equal(USER_AGENT, `valorbrain-n8n/${pkg.version}`)
    assert.ok(pkg.keywords.includes('n8n-community-node-package'))
    assert.equal(pkg.dependencies, undefined, 'a verified community node has no runtime dependency')
  })
})

describe('requests', () => {
  test('Store Memory posts title, content and the set fields to /api/v1/memory/store', async () => {
    const ctx = context({
      items: [item('store', {title: '  Acme budget  ', content: 'The Acme pilot budget moved to 40k.', additionalFields: {type: 'decision', tags: 'acme, budget, ', collection: '', confidence: 0.9}})],
      replies: [{statusCode: 200, body: {ok: true, docid: '#abc123', path: 'agent-n8n/x.md'}}],
    })
    const [out] = await run(ctx)
    assert.deepEqual(ctx.calls, [{
      type: 'valorBrainApi', method: 'POST', url: 'https://vb.example.test/api/v1/memory/store', headers: HEADERS,
      json: true, returnFullResponse: true, ignoreHttpStatusErrors: true,
      body: {title: 'Acme budget', content: 'The Acme pilot budget moved to 40k.', type: 'decision', confidence: 0.9, tags: ['acme', 'budget']},
    }])
    assert.deepEqual(out, [{json: {ok: true, docid: '#abc123', path: 'agent-n8n/x.md'}, pairedItem: {item: 0}}])
  })

  test('Store Memory refuses a short title or content before any request', async () => {
    const ctx = context({items: [item('store', {title: 'abc', content: 'long enough content here', additionalFields: {}})]})
    await assert.rejects(run(ctx), (e) => e instanceof NodeOperationError && /'Title' needs at least 5/.test(e.message))
    const ctx2 = context({items: [item('store', {title: 'A title', content: 'short', additionalFields: {}})]})
    await assert.rejects(run(ctx2), /'Content' needs at least 20/)
    assert.equal(ctx.calls.length + ctx2.calls.length, 0)
  })

  test('Write Document posts to /documents with event_at and the API keys of the fields', async () => {
    const ctx = context({
      credentials: {token: 'vbm_fake', apiUrl: ''},
      items: [item('writeDocument', {
        collection: 'tickets', path: 'tickets/4821.md', content: 'Customer asked for a refund.', eventAt: '2026-07-28T16:00:00Z',
        additionalFields: {title: 'Ticket 4821', contentType: 'ticket', eventType: 'email', userId: 'u-1', runId: 'run-9', metadata: '{"priority":"high"}'},
      })],
      replies: [{statusCode: 200, body: {ok: true, action: 'created', id: 7, hash: 'deadbeef'}}],
    })
    const [out] = await run(ctx)
    assert.equal(ctx.calls[0].url, 'https://valorbrain-api.valor.digital/documents')
    assert.deepEqual(ctx.calls[0].body, {
      collection: 'tickets', path: 'tickets/4821.md', content: 'Customer asked for a refund.', event_at: '2026-07-28T16:00:00Z',
      title: 'Ticket 4821', content_type: 'ticket', event_type: 'email', user_id: 'u-1', run_id: 'run-9', metadata: {priority: 'high'},
    })
    assert.equal(out[0].json.action, 'created')
  })

  test('Write Document refuses a time with no zone and bad metadata JSON', async () => {
    const base = {collection: 'c', path: 'p', content: 'x', additionalFields: {}}
    await assert.rejects(run(context({items: [item('writeDocument', {...base, eventAt: '2026-07-28 16:00'})]})), /'Occurred At' is not an ISO 8601 time with a zone/)
    await assert.rejects(run(context({items: [item('writeDocument', {...base, additionalFields: {metadata: '{bad'}})]})), /'Metadata' is not valid JSON/)
  })

  test('Write Document accepts a Luxon-like value from $now', async () => {
    const ctx = context({items: [item('writeDocument', {collection: 'c', path: 'p', content: 'x', eventAt: {toISO: () => '2026-10-17T12:00:00.000-03:00'}, additionalFields: {}})]})
    await run(ctx)
    assert.equal(ctx.calls[0].body.event_at, '2026-10-17T12:00:00.000-03:00')
  })

  test('Prepare Context posts the message and the options to /api/v1/memory/prepare', async () => {
    const ctx = context({
      items: [item('prepare', {message: 'What did we agree with Acme?', options: {collection: 'tickets', recallBudget: 1500, fastMode: true, includeRecall: false, episodeId: 'ep-1'}})],
      replies: [{statusCode: 200, body: {markdown: '# Context', tokens_estimate: 12}}],
    })
    const [out] = await run(ctx)
    assert.equal(ctx.calls[0].url, 'https://vb.example.test/api/v1/memory/prepare')
    assert.deepEqual(ctx.calls[0].body, {message: 'What did we agree with Acme?', collection: 'tickets', episode_id: 'ep-1', recall_budget: 1500, fast_mode: true, include_recall: false})
    assert.equal(out[0].json.markdown, '# Context')
  })

  test('Search posts the query and the options to /search', async () => {
    const ctx = context({
      items: [item('search', {query: 'acme budget', options: {limit: 5, mode: 'hybrid', profile: 'speed', order: 'event_time', collection: 'a,b'}})],
      replies: [{statusCode: 200, body: {results: [{docid: '#abc123', title: 'Acme', score: 0.9}]}}],
    })
    const [out] = await run(ctx)
    assert.equal(ctx.calls[0].url, 'https://vb.example.test/search')
    assert.deepEqual(ctx.calls[0].body, {query: 'acme budget', collection: 'a,b', limit: 5, mode: 'hybrid', order: 'event_time', profile: 'speed'})
    assert.equal(out[0].json.results[0].docid, '#abc123')
  })

  test('Forget posts to /documents/{id}/forget without the # and with the ID encoded', async () => {
    const ctx = context({items: [item('forget', {documentId: ' #abc123 '}), item('forget', {documentId: 'a/b'})]})
    await run(ctx)
    assert.equal(ctx.calls[0].url, 'https://vb.example.test/documents/abc123/forget')
    assert.equal(ctx.calls[0].method, 'POST')
    assert.equal(ctx.calls[0].body, undefined)
    assert.equal(ctx.calls[1].url, 'https://vb.example.test/documents/a%2Fb/forget')
  })
})

describe('errors', () => {
  test('a 401 becomes a NodeApiError that names the credential', async () => {
    const ctx = context({items: [item('search', {query: 'x', options: {}})], replies: [{statusCode: 401, body: {error: 'Unauthorized: invalid or inactive MCP token'}}]})
    await assert.rejects(run(ctx), (e) => {
      assert.ok(e instanceof NodeApiError)
      assert.equal(e.message, 'ValorBrain refused the request: Unauthorized: invalid or inactive MCP token')
      assert.match(e.description, /'Token' and the 'API URL'/)
      assert.equal(e.httpCode, '401')
      return true
    })
  })

  test('a 429 gives the retry time', async () => {
    const ctx = context({items: [item('search', {query: 'x', options: {}})], replies: [{statusCode: 429, body: {}, headers: {'retry-after': '7'}}]})
    await assert.rejects(run(ctx), (e) => /status 429/.test(e.message) && /after 7 seconds/.test(e.description))
  })

  test('a network failure becomes a NodeApiError', async () => {
    const ctx = context({items: [item('search', {query: 'x', options: {}})], replies: [{throws: Object.assign(new Error('connect ECONNREFUSED'), {code: 'ECONNREFUSED'})}]})
    await assert.rejects(run(ctx), (e) => e instanceof NodeApiError)
  })

  test('Continue On Fail returns the error as an item and goes on', async () => {
    const ctx = context({
      continueOnFail: true,
      items: [item('forget', {documentId: ''}), item('forget', {documentId: 'abc123'})],
      replies: [{statusCode: 200, body: {docid: 'abc123', forgotten: true}}],
    })
    const [out] = await run(ctx)
    assert.match(out[0].json.error, /'Document ID' is empty/)
    assert.deepEqual(out[1], {json: {docid: 'abc123', forgotten: true}, pairedItem: {item: 1}})
  })

  test('an unknown operation is refused', async () => {
    await assert.rejects(run(context({items: [item('nope')]})), /The operation 'nope' is not known/)
  })
})

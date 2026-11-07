/**
 * Team context node — the elastic half.
 *
 * Every DSH instance embeds one node. A node owns an append-only event log, serves
 * the same HTTP API the hub used to serve, and reconciles with peers by exchanging
 * per-origin digests. No central writer, no lost writes: the local log is always
 * appendable, peers converge whenever two of them are reachable at the same time.
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'

const KINDS = new Set(['fact', 'decision', 'failure', 'env', 'bench', 'change'])
const STATUSES = new Set(['draft', 'verified', 'stale', 'superseded'])
const MAX_BODY = 1024 * 1024

export const DEFAULT_PEER_PORT = 7420

function pad(n, width) {
  return String(n).padStart(width, '0')
}

class Clock {
  constructor(nodeId) {
    this.nodeId = nodeId
    this.wall = 0
    this.counter = 0
  }
  now() {
    const wall = Date.now()
    if (wall > this.wall) {
      this.wall = wall
      this.counter = 0
    } else {
      this.counter += 1
    }
    return this.stamp()
  }
  stamp() {
    return `${pad(this.wall, 13)}-${pad(this.counter, 4)}-${this.nodeId}`
  }
  observe(stamp) {
    const m = /^(\d{13})-(\d{4})-(.+)$/.exec(String(stamp || ''))
    if (!m) return
    const wall = Number(m[1])
    const counter = Number(m[2])
    if (wall > this.wall || (wall === this.wall && counter > this.counter)) {
      this.wall = wall
      this.counter = counter
    }
  }
}

function clip(value, length) {
  return typeof value === 'string' ? value.slice(0, length) : ''
}

function strList(value, max, length) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => clip(item.trim(), length))
    .slice(0, max)
}

function sanitizeScope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = {}
  for (const key of ['board', 'mcu', 'toolchain', 'module']) {
    if (typeof value[key] === 'string' && value[key].trim()) out[key] = clip(value[key].trim(), 80)
  }
  if (Array.isArray(value.paths)) out.paths = strList(value.paths, 8, 160)
  return out
}

function sanitizeEvidence(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const entry of value.slice(0, 12)) {
    if (!entry || typeof entry !== 'object') continue
    const item = { type: clip(String(entry.type || 'note'), 24), label: clip(String(entry.label || ''), 240) }
    if (typeof entry.ref === 'string' && entry.ref.trim()) item.ref = clip(entry.ref.trim(), 400)
    if (item.label) out.push(item)
  }
  return out
}

function tokenize(query) {
  const out = new Set()
  const source = String(query || '').toLowerCase()
  for (const match of source.matchAll(/[a-z0-9_./+-]+|[\u4e00-\u9fff]+/g)) {
    const term = match[0]
    if (/^[\u4e00-\u9fff]/.test(term)) {
      if (term.length === 1) out.add(term)
      for (let i = 0; i + 1 < term.length; i++) out.add(term.slice(i, i + 2))
    } else if (term.length > 1) {
      out.add(term)
    }
  }
  return [...out]
}

function scoreOf(record, terms) {
  if (!terms.length) return 0
  const title = record.title.toLowerCase()
  const body = record.body.toLowerCase()
  const tags = record.tags.join(' ').toLowerCase()
  let score = 0
  for (const term of terms) {
    if (title.includes(term)) score += 6
    if (tags.includes(term)) score += 4
    if (body.includes(term)) score += 1
  }
  return score
}

function rank(record) {
  if (record.status === 'verified') return 3
  if (record.status === 'draft') return 2
  if (record.status === 'stale') return 1
  return 0
}

export async function startNode(options = {}) {
  const dataDir = options.dataDir
  if (!dataDir) throw new Error('dataDir is required')
  fs.mkdirSync(dataDir, { recursive: true })

  const token = options.token ?? 'dev-token'
  const adminToken = options.adminToken || token
  const peerToken = options.peerToken || adminToken
  const localName = String(options.localName || 'admin')
  const host = options.host ?? '127.0.0.1'
  const requestedPort = Number(options.port ?? DEFAULT_PEER_PORT)
  let peers = Array.isArray(options.peers) ? options.peers.filter(Boolean) : []
  const syncMs = Number(options.syncMs ?? 15000)
  const log = typeof options.log === 'function' ? options.log : () => {}

  // --- identity -----------------------------------------------------------
  const nodeFile = path.join(dataDir, 'node.json')
  let nodeId = ''
  if (fs.existsSync(nodeFile)) {
    try {
      nodeId = JSON.parse(fs.readFileSync(nodeFile, 'utf8')).id || ''
    } catch {
      nodeId = ''
    }
  }
  if (!nodeId) {
    nodeId = 'n_' + crypto.randomBytes(4).toString('hex')
    fs.writeFileSync(nodeFile, JSON.stringify({ id: nodeId, createdAt: new Date().toISOString() }, null, 2))
  }

  const clock = new Clock(nodeId)
  const storeFile = path.join(dataDir, 'events.jsonl')

  /** @type {any[]} */
  const events = []
  const byOrigin = new Map()
  const pending = new Map()
  const records = new Map()
  const deleted = new Set()
  const orphans = new Map()
  let appending = false

  function commitEvent(event) {
    const known = byOrigin.get(event.origin) || 0
    if (event.seq <= known) return false
    byOrigin.set(event.origin, event.seq)
    events.push(event)
    applyEvent(event)
    return true
  }

  function flushPending(origin) {
    let map = pending.get(origin)
    if (!map) return
    let next = (byOrigin.get(origin) || 0) + 1
    while (map.has(next)) {
      commitEvent(map.get(next))
      map.delete(next)
      next += 1
    }
    if (!map.size) pending.delete(origin)
  }

  function ingest(event) {
    if (!event || typeof event.origin !== 'string' || !Number.isInteger(event.seq) || event.seq < 1) return false
    const known = byOrigin.get(event.origin) || 0
    if (event.seq <= known) return false
    if (event.seq === known + 1) {
      const committed = commitEvent(event)
      flushPending(event.origin)
      return committed
    }
    let map = pending.get(event.origin)
    if (!map) {
      map = new Map()
      pending.set(event.origin, map)
    }
    map.set(event.seq, event)
    return false
  }

  function applyStatus(event) {
    const record = records.get(event.id)
    if (!record) {
      const list = orphans.get(event.id) || []
      list.push(event)
      orphans.set(event.id, list)
      return
    }
    if (event.hlc > record.statusHlc) {
      const from = record.status
      record.status = event.status
      record.statusHlc = event.hlc
      record.updatedAt = event.at
      record.history.push({ at: event.at, by: event.by, action: 'status', from, to: event.status, note: event.note })
    }
  }

  function applyEvent(event) {
    if (event.type === 'record' && event.record && event.record.id) {
      if (records.has(event.record.id) || deleted.has(event.record.id)) return
      const record = {
        ...event.record,
        status: 'draft',
        statusHlc: event.hlc,
        createdAt: event.record.createdAt || event.at,
        updatedAt: event.record.updatedAt || event.at,
        history: [{ at: event.at, by: event.by, action: 'created' }],
      }
      records.set(record.id, record)
      const waiting = orphans.get(record.id)
      if (waiting) {
        orphans.delete(record.id)
        for (const statusEvent of waiting) applyStatus(statusEvent)
      }
      return
    }
    if (event.type === 'status' && event.id && STATUSES.has(event.status)) {
      applyStatus(event)
      return
    }
    if (event.type === 'delete' && event.id) {
      deleted.add(event.id)
      records.delete(event.id)
    }
  }

  // --- load ---------------------------------------------------------------
  function loadLog() {
    if (fs.existsSync(storeFile)) {
      for (const line of fs.readFileSync(storeFile, 'utf8').split('\n')) {
        if (!line.trim()) continue
        try {
          ingest(JSON.parse(line))
        } catch {
          // torn tail line: ignore
        }
      }
    }
    // migrate the v0.1 single-file store if this data dir has one
    const legacy = path.join(dataDir, 'records.jsonl')
    if (!events.length && fs.existsSync(legacy)) {
      let seq = 0
      for (const line of fs.readFileSync(legacy, 'utf8').split('\n')) {
        if (!line.trim()) continue
        let row
        try {
          row = JSON.parse(line)
        } catch {
          continue
        }
        const record = row && row.record
        if (!record || !record.id) continue
        seq += 1
        const wall = Date.parse(record.updatedAt || record.createdAt || '') || Date.now()
        const hlc = `${pad(wall, 13)}-0000-legacy`
        ingest({ origin: 'legacy', seq, hlc, at: record.createdAt || new Date(wall).toISOString(), type: 'record', by: record.author || 'legacy', record })
        if (record.status && record.status !== 'draft') {
          ingest({ origin: 'legacy', seq: ++seq, hlc, at: record.updatedAt || new Date(wall).toISOString(), type: 'status', id: record.id, status: record.status, by: record.author || 'legacy' })
        }
      }
      if (seq) log(`migrated ${seq} legacy event(s) from records.jsonl`)
    }
  }

  loadLog()

  function persist(event) {
    fs.appendFileSync(storeFile, JSON.stringify(event) + '\n')
  }

  function nextSeq() {
    return (byOrigin.get(nodeId) || 0) + 1
  }

  function appendLocal(payload) {
    const event = {
      origin: nodeId,
      seq: nextSeq(),
      hlc: clock.now(),
      at: new Date().toISOString(),
      ...payload,
    }
    commitEvent(event)
    persist(event)
    return event
  }

  // --- queries ------------------------------------------------------------
  function currentDigest() {
    const digest = {}
    for (const [origin, seq] of byOrigin) digest[origin] = seq
    return digest
  }

  function eventsSince(digest, limit = 200) {
    const out = []
    for (const event of events) {
      if (event.seq > (digest[event.origin] || 0)) out.push(event)
      if (out.length >= limit) break
    }
    return out
  }

  function listRecords(searchParams) {
    const project = searchParams.get('project')
    const kind = searchParams.get('kind')
    const status = searchParams.get('status')
    const since = Number(searchParams.get('since') || 0)
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 50), 1), 500)
    const query = (searchParams.get('q') || '').trim()
    const terms = tokenize(query)

    let matched = []
    for (const record of records.values()) {
      if (project && record.project !== project) continue
      if (kind && record.kind !== kind) continue
      if (status && record.status !== status) continue
      if (since && (record.updatedAt || '') < new Date(since).toISOString()) continue
      if (terms.length) {
        const score = scoreOf(record, terms)
        if (!score) continue
        matched.push({ record, score })
      } else {
        matched.push({ record, score: 0 })
      }
    }
    if (terms.length) {
      matched.sort((a, b) => b.score - a.score || rank(b.record) - rank(a.record) || cmp(b.record, a.record))
    } else {
      matched.sort((a, b) => cmp(a.record, b.record))
    }
    matched = matched.slice(0, limit)
    return matched.map((entry) => entry.record)
  }

  function cmp(a, b) {
    return String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''))
  }

  function briefData(searchParams) {
    const project = searchParams.get('project')
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 8), 1), 30)
    const scoped = [...records.values()].filter((record) => !project || record.project === project)
    const verified = scoped
      .filter((record) => record.status === 'verified')
      .sort((a, b) => cmp(b, a))
      .slice(0, limit)
    const drafts = scoped.filter((record) => record.status === 'draft').length
    return {
      records: verified.map((record) => ({
        id: record.id,
        title: record.title,
        kind: record.kind,
        scope: record.scope,
        updatedAt: record.updatedAt,
        author: record.author,
      })),
      drafts,
      total: scoped.length,
    }
  }

  function membersData(project) {
    const map = new Map()
    for (const record of records.values()) {
      if (project && record.project !== project) continue
      const current = map.get(record.author) || { author: record.author, records: 0, verified: 0, lastAt: '' }
      current.records += 1
      if (record.status === 'verified') current.verified += 1
      if (record.updatedAt > current.lastAt) current.lastAt = record.updatedAt
      map.set(record.author, current)
    }
    return [...map.values()].sort((a, b) => b.records - a.records)
  }

  const filesDir = path.join(dataDir, 'files')
  const filesIndexFile = path.join(dataDir, 'files.json')
  fs.mkdirSync(filesDir, { recursive: true })
  /** @type {Record<string, Array<{ path: string, hash: string, size: number, mtime: number, by: string }>>} */
  let fileIndex = {}
  try {
    fileIndex = JSON.parse(fs.readFileSync(filesIndexFile, 'utf8')) || {}
  } catch {
    fileIndex = {}
  }
  function saveFileIndex() {
    fs.writeFileSync(filesIndexFile, JSON.stringify(fileIndex, null, 2))
  }

  // --- members: one token per person --------------------------------------
  const membersFile = path.join(dataDir, 'members.json')
  /** @type {Array<{ id: string, name: string, role: string, tokenHash: string, createdAt: string, disabled?: boolean }>} */
  let members = []
  try {
    const raw = JSON.parse(fs.readFileSync(membersFile, 'utf8'))
    members = Array.isArray(raw.members) ? raw.members : []
  } catch {
    members = []
  }
  function saveMembers() {
    fs.writeFileSync(membersFile, JSON.stringify({ members }, null, 2))
  }
  const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
  function authOf(req) {
    const presented = String(req.headers['x-team-token'] || '')
    if (!presented) return null
    // The shared secret is the admin and peer credential; the per-instance
    // token only lets this machine's own plugin talk to its embedded node.
    if (presented === adminToken) return { id: 'admin', name: 'admin', role: 'admin' }
    if (presented === token) return { id: 'local', name: localName, role: 'admin' }
    const hash = sha256(presented)
    const member = members.find((entry) => entry.tokenHash === hash && !entry.disabled)
    return member ? { id: member.id, name: member.name, role: member.role || 'member' } : null
  }

  const zoneRegistryFile = path.join(dataDir, 'zones-registry.json')
  let zoneRegistry = []
  let zoneRegistryLoaded = false
  try {
    const raw = JSON.parse(fs.readFileSync(zoneRegistryFile, 'utf8'))
    zoneRegistry = Array.isArray(raw.zones) ? raw.zones.filter((zone) => typeof zone === 'string' && zone) : []
    zoneRegistryLoaded = true
  } catch {
    zoneRegistry = []
  }
  if (!zoneRegistryLoaded) {
    // First run with an existing store: the projects already in use become zones.
    zoneRegistry = [...new Set([...records.values()].map((record) => record.project))]
    if (zoneRegistry.length) {
      fs.writeFileSync(zoneRegistryFile, JSON.stringify({ zones: zoneRegistry }, null, 2))
    }
  }
  function saveZoneRegistry() {
    fs.writeFileSync(zoneRegistryFile, JSON.stringify({ zones: zoneRegistry }, null, 2))
  }
  function zoneNames() {
    return [...zoneRegistry].sort()
  }

  // --- HTTP ---------------------------------------------------------------
  function send(res, code, value) {
    const body = JSON.stringify(value)
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, x-team-token, x-team-member',
      'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
    })
    res.end(body)
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0
      const chunks = []
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_BODY) {
          reject(new Error('body too large'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        if (!raw) return resolve({})
        try {
          resolve(JSON.parse(raw))
        } catch {
          reject(new Error('invalid json'))
        }
      })
      req.on('error', reject)
    })
  }

  function normalizedRecord(input, by) {
    return {
      id: 'r_' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'),
      project: clip(String(input.project || 'default').trim(), 80) || 'default',
      kind: KINDS.has(input.kind) ? input.kind : 'fact',
      title: clip(String(input.title || '').trim(), 200),
      body: clip(String(input.body || '').trim(), 20000),
      scope: sanitizeScope(input.scope),
      evidence: sanitizeEvidence(input.evidence),
      author: clip(String(by || input.author || 'anonymous').trim(), 60) || 'anonymous',
      sessionId: typeof input.sessionId === 'string' ? clip(input.sessionId, 80) : undefined,
      tags: strList(input.tags, 10, 32),
      auto: input.auto === true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return send(res, 204, {})
      const url = new URL(req.url || '/', 'http://localhost')
      const pathname = url.pathname

      if (pathname === '/api/health') {
        return send(res, 200, { ok: true, node: nodeId, records: records.size, events: events.length, peers: peers.length })
      }
      const auth = authOf(req)
      if (!auth) return send(res, 401, { error: 'invalid team token' })

      if (pathname === '/api/zones') {
        if (req.method === 'GET') return send(res, 200, { zones: zoneNames() })
        if (req.method === 'POST') {
          if (auth.role !== 'admin') return send(res, 403, { error: 'admin only' })
          const body = await readBody(req)
          const name = clip(String(body.name || '').trim(), 80)
          if (!name) return send(res, 400, { error: 'name is required' })
          if (!zoneRegistry.includes(name)) {
            zoneRegistry.push(name)
            saveZoneRegistry()
          }
          return send(res, 201, { zones: zoneNames() })
        }
        return send(res, 405, { error: 'method not allowed' })
      }

      const zoneRoute = pathname.match(/^\/api\/zones\/(.+)$/)
      if (zoneRoute && req.method === 'DELETE') {
        if (auth.role !== 'admin') return send(res, 403, { error: 'admin only' })
        const name = decodeURIComponent(zoneRoute[1])
        zoneRegistry = zoneRegistry.filter((zone) => zone !== name)
        saveZoneRegistry()
        return send(res, 200, { zones: zoneNames() })
      }

      if (pathname === '/api/team/members') {
        if (req.method === 'GET') {
          return send(res, 200, {
            members: members.map((entry) => ({
              id: entry.id,
              name: entry.name,
              role: entry.role,
              createdAt: entry.createdAt,
              disabled: Boolean(entry.disabled),
            })),
            delegated: members.length > 0,
          })
        }
        if (req.method === 'POST') {
          if (auth.role !== 'admin') return send(res, 403, { error: 'admin only' })
          const body = await readBody(req)
          const name = clip(String(body.name || '').trim(), 60)
          if (!name) return send(res, 400, { error: 'name is required' })
          if (members.some((entry) => entry.name === name && !entry.disabled)) {
            return send(res, 409, { error: 'member already exists' })
          }
          const plain = crypto.randomBytes(18).toString('base64url')
          const member = {
            id: 'm_' + crypto.randomBytes(4).toString('hex'),
            name,
            role: body.role === 'admin' ? 'admin' : 'member',
            tokenHash: sha256(plain),
            createdAt: new Date().toISOString(),
            disabled: false,
          }
          members.push(member)
          saveMembers()
          return send(res, 201, {
            member: { id: member.id, name: member.name, role: member.role, createdAt: member.createdAt },
            token: plain,
          })
        }
      }

      const memberRoute = pathname.match(/^\/api\/team\/members\/([A-Za-z0-9_]+)$/)
      if (memberRoute && req.method === 'DELETE') {
        if (auth.role !== 'admin') return send(res, 403, { error: 'admin only' })
        const index = members.findIndex((entry) => entry.id === memberRoute[1])
        if (index === -1) return send(res, 404, { error: 'not found' })
        members.splice(index, 1)
        saveMembers()
        return send(res, 200, { ok: true })
      }

      const tokenRoute = pathname.match(/^\/api\/team\/members\/([A-Za-z0-9_]+)\/token$/)
      if (tokenRoute && req.method === 'POST') {
        if (auth.role !== 'admin') return send(res, 403, { error: 'admin only' })
        const member = members.find((entry) => entry.id === tokenRoute[1])
        if (!member) return send(res, 404, { error: 'not found' })
        const plain = crypto.randomBytes(18).toString('base64url')
        member.tokenHash = sha256(plain)
        member.disabled = false
        saveMembers()
        return send(res, 200, { token: plain })
      }

      if (req.method === 'POST' && pathname === '/api/sync') {
        const body = await readBody(req)
        const incoming = Array.isArray(body.events) ? body.events : []
        let merged = 0
        for (const event of incoming) {
          if (event && typeof event.hlc === 'string') clock.observe(event.hlc)
          if (ingest(event)) merged += 1
        }
        const digest = (body.digest && typeof body.digest === 'object' && body.digest) || {}
        const outgoing = eventsSince(digest, 200)
        for (const event of incoming) {
          if (event && typeof event.hlc === 'string') clock.observe(event.hlc)
        }
        return send(res, 200, { node: nodeId, merged, digest: currentDigest(), events: outgoing })
      }

      if (req.method === 'GET' && pathname === '/api/node') {
        const states = [...peerState.values()].map((state) => ({ ...state, pending: pendingFor(state) }))
        return send(res, 200, {
          node: nodeId,
          digest: currentDigest(),
          records: records.size,
          events: events.length,
          peers: states,
          pending: states.reduce((sum, state) => sum + state.pending, 0),
        })
      }

      if (req.method === 'GET' && pathname === '/api/records') {
        return send(res, 200, { records: listRecords(url.searchParams) })
      }

      if (req.method === 'POST' && pathname === '/api/records') {
        const input = await readBody(req)
        if (!String(input.title || '').trim()) return send(res, 400, { error: 'title is required' })
        if (!String(input.body || '').trim()) return send(res, 400, { error: 'body is required' })
        const by = auth.name
        const record = normalizedRecord(input, by)
        appendLocal({ type: 'record', by, record })
        if (input.status === 'verified') {
          appendLocal({ type: 'status', id: record.id, status: 'verified', by, note: 'created as verified' })
        }
        syncNow().catch(() => {})
        return send(res, 201, { record: records.get(record.id) })
      }

      const one = pathname.match(/^\/api\/records\/([A-Za-z0-9_-]+)$/)
      if (one) {
        const record = records.get(one[1])
        if (!record) return send(res, 404, { error: 'not found' })
        if (req.method === 'GET') return send(res, 200, { record })
        if (req.method === 'PATCH') {
          const patch = await readBody(req)
          const by = auth.name
          if (patch.status !== undefined) {
            if (!STATUSES.has(patch.status)) return send(res, 400, { error: 'invalid status' })
            appendLocal({ type: 'status', id: record.id, status: patch.status, by, note: patch.note })
          }
          syncNow().catch(() => {})
          return send(res, 200, { record: records.get(record.id) })
        }
        if (req.method === 'DELETE') {
          if (auth.role !== 'admin') return send(res, 403, { error: 'admin only' })
          appendLocal({ type: 'delete', id: record.id, by: auth.name })
          syncNow().catch(() => {})
          return send(res, 200, { ok: true })
        }
        return send(res, 405, { error: 'method not allowed' })
      }

      if (req.method === 'GET' && pathname === '/api/brief') {
        return send(res, 200, briefData(url.searchParams))
      }
      if (req.method === 'GET' && pathname === '/api/members') {
        return send(res, 200, { members: membersData(url.searchParams.get('project') || '') })
      }

      // Shared files: a manifest per project plus content-addressed blobs.
      const manifestRoute = pathname.match(/^\/api\/files\/([^/]+)\/manifest$/)
      if (manifestRoute) {
        const project = decodeURIComponent(manifestRoute[1])
        if (req.method === 'GET') {
          return send(res, 200, { project, files: fileIndex[project] || [] })
        }
        if (req.method === 'PUT') {
          const body = await readBody(req)
          const list = Array.isArray(body.files) ? body.files : []
          const merged = new Map((fileIndex[project] || []).map((entry) => [entry.path, entry]))
          for (const entry of list) {
            if (!entry || typeof entry.path !== 'string' || typeof entry.hash !== 'string') continue
            merged.set(entry.path, {
              path: entry.path,
              hash: entry.hash,
              size: Number(entry.size) || 0,
              mtime: Number(entry.mtime) || 0,
              by: String(entry.by || ''),
            })
          }
          fileIndex[project] = [...merged.values()]
          saveFileIndex()
          return send(res, 200, { project, files: fileIndex[project] })
        }
      }

      const blobRoute = pathname.match(/^\/api\/files\/([^/]+)\/blob\/([a-f0-9]{64})$/)
      if (blobRoute) {
        const hash = blobRoute[2]
        const target = path.join(filesDir, hash)
        if (req.method === 'HEAD') {
          if (!fs.existsSync(target)) {
            res.writeHead(404)
            res.end()
            return
          }
          res.writeHead(200, { 'content-length': fs.statSync(target).size })
          res.end()
          return
        }
        if (req.method === 'GET') {
          if (!fs.existsSync(target)) return send(res, 404, { error: 'blob not found' })
          const stat = fs.statSync(target)
          res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': stat.size })
          fs.createReadStream(target).pipe(res)
          return
        }
        if (req.method === 'PUT') {
          const chunks = []
          let size = 0
          for await (const chunk of req) {
            size += chunk.length
            if (size > 512 * 1024 * 1024) {
              req.destroy()
              return send(res, 413, { error: 'blob too large' })
            }
            chunks.push(chunk)
          }
          const buffer = Buffer.concat(chunks)
          const actual = crypto.createHash('sha256').update(buffer).digest('hex')
          if (actual !== hash) return send(res, 400, { error: 'hash mismatch' })
          fs.writeFileSync(target, buffer)
          return send(res, 200, { hash, size: buffer.length })
        }
      }

      return send(res, 404, { error: 'not found' })
    } catch (error) {
      return send(res, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  })

  // --- peer sync ----------------------------------------------------------
  let syncing = false
  let lastSync = { at: '', ok: 0, failed: 0 }
  const peerState = new Map()

  function stateOf(peer) {
    let state = peerState.get(peer)
    if (!state) {
      state = { url: peer, online: false, lastOk: '', lastError: '', pending: 0, digest: {}, acked: 0 }
      peerState.set(peer, state)
    }
    return state
  }

  function pendingFor(state) {
    return events.filter((event) => event.seq > (state.digest[event.origin] || 0)).length
  }
  const baseUrlOf = (value) => String(value).replace(/\/+$/, '')

  async function postSync(peer, payload) {
    const res = await fetch(peer + '/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-team-token': peerToken },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error('sync ' + res.status)
    return res.json()
  }

  async function syncPeer(peer) {
    const state = stateOf(peer)
    let rounds = 0
    let changed = 0
    try {
      while (rounds < 5) {
        rounds += 1
        const first = await postSync(peer, { digest: currentDigest() })
        for (const event of first.events || []) {
          if (event && typeof event.hlc === 'string') clock.observe(event.hlc)
          if (ingest(event)) changed += 1
        }
        const theirDigest = first.digest || {}
        state.digest = theirDigest
        state.acked = Number(theirDigest[nodeId] || 0)
        state.online = true
        state.lastOk = new Date().toISOString()
        state.lastError = ''
        const outgoing = events.filter((event) => event.seq > (theirDigest[event.origin] || 0)).slice(0, 200)
        state.pending = pendingFor(state)
        if (!outgoing.length) break
        const second = await postSync(peer, { digest: currentDigest(), events: outgoing })
        for (const event of second.events || []) {
          if (event && typeof event.hlc === 'string') clock.observe(event.hlc)
          if (ingest(event)) changed += 1
        }
        if (second.digest && typeof second.digest === 'object') {
          state.digest = second.digest
          state.acked = Number(second.digest[nodeId] || 0)
        }
        if (!changed && !outgoing.length) break
      }
      state.pending = pendingFor(state)
      return changed
    } catch (error) {
      state.online = false
      state.lastError = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  async function syncNow() {
    if (syncing || !peers.length) return lastSync
    syncing = true
    let ok = 0
    let failed = 0
    for (const peer of peers) {
      try {
        await syncPeer(baseUrlOf(peer))
        ok += 1
      } catch (error) {
        failed += 1
        log(`peer ${peer} unreachable: ${error instanceof Error ? error.message : error}`)
      }
    }
    syncing = false
    lastSync = { at: new Date().toISOString(), ok, failed }
    return lastSync
  }

  const timer = setInterval(() => {
    syncNow().catch(() => {})
  }, syncMs)
  timer.unref?.()

  // --- listen -------------------------------------------------------------
  const listening = await new Promise((resolve, reject) => {
    const onError = (error) => {
      if (error && error.code === 'EADDRINUSE' && requestedPort !== 0) {
        server.removeListener('error', onError)
        server.listen(0, host, () => resolve(server.address()))
        return
      }
      reject(error)
    }
    server.once('error', onError)
    server.listen(requestedPort, host, () => {
      server.removeListener('error', onError)
      resolve(server.address())
    })
  })

  const port = typeof listening === 'object' && listening ? listening.port : requestedPort
  const url = `http://127.0.0.1:${port}`
  const advertised = `http://${options.advertiseHost || host}:${port}`
  log(`node ${nodeId} on ${url} (advertise ${advertised}), ${peers.length} peer(s)`)

  return {
    nodeId,
    url,
    advertised,
    port,
    digest: currentDigest,
    syncNow,
    lastSync: () => lastSync,
    peerState: () => [...peerState.values()].map((state) => ({ ...state, pending: pendingFor(state) })),
    setPeers: (list) => {
      peers = Array.isArray(list) ? list.filter(Boolean) : []
      for (const url of [...peerState.keys()]) {
        if (!peers.includes(url)) peerState.delete(url)
      }
      for (const url of peers) stateOf(url)
      return peers.slice()
    },
    peers: () => peers.slice(),
    close: async () => {
      clearInterval(timer)
      await new Promise((resolve) => {
        server.close(() => resolve(undefined))
        server.closeAllConnections?.()
      })
    },
  }
}

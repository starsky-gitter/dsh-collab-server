/**
 * Team Context — host half.
 *
 * Adds three model tools (team_recall / team_get / team_share), injects a small
 * team brief into the prompt, and proxies the browser panel to the hub so the
 * page never needs the team token.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startNode } from './core.js'

export const name = 'dsh-team-context'

export const inject = ['tools', 'webServer', 'systemPrompt', 'agents']

const DEFAULTS = {
  hubUrl: 'http://127.0.0.1:7420',
  token: 'dev-token',
  project: 'default',
  member: '',
  autoBrief: true,
  briefLimit: 8,
  refreshMs: 60000,
  timeoutMs: 4000,
  embedded: true,
  peerPort: 7420,
  peers: [],
  primary: '',
  dataDir: '',
  advertiseHost: '',
  expose: false,
}

function lanAddress() {
  const interfaces = os.networkInterfaces()
  for (const list of Object.values(interfaces)) {
    for (const net of list || []) {
      if (net && net.family === 'IPv4' && !net.internal) return net.address
    }
  }
  return '127.0.0.1'
}

const PROTOCOL = [
  '团队共享上下文：任务收尾前（准备交付、结束本轮、或宣布完成之前）自检一次：',
  '这一轮是否得出了可复用的结论（硬件事实、设计取舍、踩坑教训、环境差异）？',
  '有就先 team_recall 查重，再用 team_share 提交一条 200–600 字的记录（标题写症状+条件+结论，正文写现象、适用条件、验证方式）。',
  '纯实现改动、通用知识、含密钥或客户数据的内容不提交。没有构建或上板证据时保持 draft。',
].join('')

function redact(text) {
  const patterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    /\bsk-[A-Za-z0-9_-]{16,}\b/g,
    /\bghp_[A-Za-z0-9]{20,}\b/g,
    /\bAKIA[0-9A-Z]{16}\b/g,
    /\b(password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*["']?[^\s"',;]{6,}/gi,
  ]
  let out = String(text || '')
  for (const re of patterns) out = out.replace(re, '[已脱敏]')
  return out
}

function scopeLine(scope) {
  if (!scope || typeof scope !== 'object') return ''
  const parts = []
  if (scope.board) parts.push(scope.board)
  if (scope.mcu) parts.push(scope.mcu)
  if (scope.toolchain) parts.push(scope.toolchain)
  if (Array.isArray(scope.paths) && scope.paths.length) parts.push(scope.paths.join(','))
  return parts.join(' · ')
}

function formatRecord(r, withBody) {
  const lines = [`[${r.kind}|${r.status}] ${r.title}`, `id=${r.id} · ${r.author} · ${r.updatedAt}`]
  const scope = scopeLine(r.scope)
  if (scope) lines.push(`适用范围: ${scope}`)
  if (withBody) {
    lines.push('', r.body)
    if (Array.isArray(r.evidence) && r.evidence.length) {
      lines.push('', '证据:')
      for (const e of r.evidence) lines.push(`- [${e.type}] ${e.label}${e.ref ? ' (' + e.ref + ')' : ''}`)
    }
  } else {
    const oneLine = String(r.body || '').replace(/\s+/g, ' ').slice(0, 160)
    if (oneLine) lines.push(`要点: ${oneLine}`)
  }
  return lines.join('\n')
}

function ago(iso) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '?'
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return `${Math.floor(s / 86400)} 天前`
}

export function apply(ctx, config) {
  const cfg = { ...DEFAULTS, ...(config || {}) }
  const member = cfg.member || 'me'
  const remoteBase = String(cfg.hubUrl || '').replace(/\/+$/, '')
  const configuredPeers = Array.isArray(cfg.peers) ? cfg.peers.filter(Boolean) : []
  const peerList = [cfg.primary, ...configuredPeers]
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
  // A host exposes its port so slaves can push; a slave only dials out.
  const exposed = cfg.expose === true || (peerList.length > 0 && !cfg.primary)
  const advertiseHost = cfg.advertiseHost || (exposed ? lanAddress() : '127.0.0.1')

  let brief = ''
  const briefs = new Map()
  let online = false
  let lastError = ''
  let node = null
  let nodePromise = null
  let nodeFailed = false

  function localDataDir() {
    if (cfg.dataDir) return cfg.dataDir
    const home = process.env.DSH_PROFILE_DIR || path.join(os.homedir(), '.dsh')
    const project = String(cfg.project || 'default').replace(/[^\w.-]+/g, '_')
    return path.join(home, 'team-context', project)
  }

  function ensureNode() {
    if (cfg.embedded === false) return Promise.resolve(null)
    if (node) return Promise.resolve(node)
    if (nodeFailed) return Promise.resolve(null)
    if (!nodePromise) {
      nodePromise = startNode({
        dataDir: localDataDir(),
        host: exposed ? '0.0.0.0' : '127.0.0.1',
        port: Number(cfg.peerPort) || 7420,
        token: cfg.token,
        peers: peerList,
        advertiseHost,
        log: (line) => console.log('[team-context] ' + line),
      })
        .then((started) => {
          node = started
          return started
        })
        .catch((error) => {
          nodeFailed = true
          console.error('[team-context] embedded node failed, falling back to hubUrl:', error && error.message)
          return null
        })
    }
    return nodePromise
  }

  async function baseUrl() {
    if (cfg.embedded === false) return remoteBase
    await ensureNode()
    return node ? node.url : remoteBase
  }

  // --- zones: workspace path -> project -----------------------------------
  const zonesFile = path.join(localDataDir(), 'zones.json')
  /** @type {Record<string, string>} */
  let zones = {}
  try {
    zones = JSON.parse(fs.readFileSync(zonesFile, 'utf8')) || {}
  } catch {
    zones = {}
  }

  function saveZones() {
    fs.mkdirSync(path.dirname(zonesFile), { recursive: true })
    fs.writeFileSync(zonesFile, JSON.stringify(zones, null, 2))
  }

  function cwdOf(agent) {
    try {
      const session = agent && agent.session
      const header = session && session.header
      return String((header && header.cwd) || (session && session.cwd) || '')
    } catch {
      return ''
    }
  }

  function projectOf(agent) {
    const cwd = cwdOf(agent)
    return (cwd && zones[cwd]) || cfg.project
  }

  function projectList() {
    return [...new Set([cfg.project, ...Object.values(zones)])]
  }

  function sendJson(res, code, value) {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(value))
  }

  async function api(pathname, init = {}) {
    const signal = AbortSignal.timeout(cfg.timeoutMs)
    const res = await fetch((await baseUrl()) + pathname, {
      ...init,
      signal,
      headers: {
        'content-type': 'application/json',
        'x-team-token': cfg.token,
        'x-team-member': member,
        ...(init.headers || {}),
      },
    })
    const text = await res.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = null
    }
    if (!res.ok) throw new Error((data && data.error) || `hub ${res.status}`)
    return data
  }

  function renderBrief(data) {
    if (!data) return ''
    const rows = Array.isArray(data.records) ? data.records : []
    if (!rows.length && !data.drafts) return ''
    const lines = [`## 团队共享上下文（本项目 ${data.total || 0} 条，待审 ${data.drafts || 0}）`]
    for (const r of rows) {
      const scope = scopeLine(r.scope)
      lines.push(`- [${r.kind}] ${r.title} (id=${r.id}, ${ago(r.updatedAt)}, ${r.author}${scope ? ', ' + scope : ''})`)
    }
    if (!rows.length) lines.push('- 暂无已验证记录。')
    lines.push('细节用 team_recall 检索，提交结论用 team_share。')
    return lines.join('\n')
  }

  async function refreshBrief() {
    try {
      for (const project of projectList()) {
        const data = await api(`/api/brief?project=${encodeURIComponent(project)}&limit=${cfg.briefLimit}`)
        briefs.set(project, renderBrief(data))
      }
      brief = briefs.get(cfg.project) || ''
      online = true
      lastError = ''
    } catch (error) {
      online = false
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  // Refresh on start and on an interval. The brief is a cached string so the
  // prompt provider stays synchronous.
  refreshBrief()
  ctx.effect(() => {
    const timer = setInterval(refreshBrief, cfg.refreshMs)
    timer.unref?.()
    return () => clearInterval(timer)
  })

  ctx.effect(() => () => {
    if (node) node.close().catch(() => {})
  })

  if (cfg.autoBrief) {
    ctx.effect(() =>
      ctx.systemPrompt.context({
        name: 'team-brief',
        order: 60,
        text: () => brief,
      }),
    )
  }

  // Every agent reads the brief of the project its workspace is bound to. The
  // project is resolved on every assembly, so binding a zone takes effect for
  // sessions that already exist, not only for new ones.
  ctx.effect(() =>
    ctx.on('agent/created', ({ agent }) => {
      try {
        agent.ctx.effect(() =>
          agent.ctx.systemPrompt.context({
            name: 'team-brief',
            order: 60,
            text: () => briefs.get(projectOf(agent)) || '',
          }),
        )
      } catch (error) {
        console.error('[team-context] scoped brief failed:', error && error.message)
      }
    }),
  )

  ctx.effect(() =>
    ctx.systemPrompt.section({
      name: 'team-context-protocol',
      order: 61,
      text: PROTOCOL,
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'team_recall',
      description:
        'Search the team knowledge base for records shared by teammates (facts, decisions, failures, environment notes). Use it before solving a problem that may already have a known answer. Returns matching records with id, title, status and a one-line summary; call team_get for the full text.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keywords: board name, peripheral, symptom, file path, Chinese or English.' },
          kind: { type: 'string', enum: ['fact', 'decision', 'failure', 'env', 'bench', 'change'] },
          status: { type: 'string', enum: ['draft', 'verified', 'stale', 'superseded'] },
          limit: { type: 'number', description: 'Max records to return, default 8.' },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        render(_args, value) {
          return [{ type: 'text', text: String((value && value.text) || '') }]
        },
      },
      async execute(args, exec) {
        const params = new URLSearchParams()
        params.set('project', projectOf(exec && exec.agent))
        params.set('limit', String(Math.min(Math.max(Number(args.limit) || 8, 1), 30)))
        if (args.query) params.set('q', String(args.query))
        if (args.kind) params.set('kind', String(args.kind))
        if (args.status) params.set('status', String(args.status))
        const data = await api(`/api/records?${params.toString()}`)
        const rows = (data && data.records) || []
        if (!rows.length) return { text: '没有匹配的团队记录。' }
        return { text: rows.map((r) => formatRecord(r, false)).join('\n\n') }
      },
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'team_get',
      description: 'Read one team record in full by its id, including evidence and scope.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Record id, for example r_abc123.' } },
        required: ['id'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        render(_args, value) {
          return [{ type: 'text', text: String((value && value.text) || '') }]
        },
      },
      async execute(args) {
        const data = await api(`/api/records/${encodeURIComponent(String(args.id || ''))}`)
        if (!data || !data.record) return { text: '记录不存在。' }
        return { text: formatRecord(data.record, true) }
      },
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'team_share',
      description:
        'Share one atomic conclusion with the team as a record. Use it for reusable hardware facts, design decisions, failure lessons or environment differences. Keep the body 200-600 characters: conclusion, conditions, and how it was verified. Default status is draft; set verified only when you actually have build or hardware evidence in this turn.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'One line, specific, searchable.' },
          body: { type: 'string', description: 'Conclusion, applicability, how verified.' },
          kind: { type: 'string', enum: ['fact', 'decision', 'failure', 'env', 'bench', 'change'] },
          board: { type: 'string', description: 'Board or hardware revision, e.g. F407IG rev.C.' },
          mcu: { type: 'string', description: 'MCU or module part number.' },
          toolchain: { type: 'string', description: 'Toolchain / SDK version when it matters.' },
          paths: { type: 'array', items: { type: 'string' }, description: 'Related source paths or globs.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Free-form tags for search.' },
          evidence: {
            type: 'array',
            description: 'Concrete evidence labels, e.g. a serial log summary or a build result.',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', description: 'serial | build | flash | scope | test | note' },
                label: { type: 'string' },
                ref: { type: 'string', description: 'File name or id the evidence lives at.' },
              },
              required: ['type', 'label'],
            },
          },
          status: { type: 'string', enum: ['draft', 'verified'] },
          sessionId: { type: 'string' },
        },
        required: ['title', 'body', 'kind'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        render(_args, value) {
          return [{ type: 'text', text: String((value && value.text) || '') }]
        },
      },
      async execute(args, exec) {
        const payload = {
          project: projectOf(exec.agent),
          title: redact(args.title),
          body: redact(args.body),
          kind: args.kind,
          status: args.status === 'verified' ? 'verified' : 'draft',
          scope: {
            board: args.board ? redact(args.board) : undefined,
            mcu: args.mcu ? redact(args.mcu) : undefined,
            toolchain: args.toolchain ? redact(args.toolchain) : undefined,
            paths: Array.isArray(args.paths) ? args.paths.map((p) => redact(p)) : undefined,
          },
          tags: Array.isArray(args.tags) ? args.tags.map((t) => redact(t)) : [],
          evidence: Array.isArray(args.evidence) ? args.evidence : [],
          author: member,
        }
        const data = await api('/api/records', { method: 'POST', body: JSON.stringify(payload) })
        const rec = data && data.record
        await refreshBrief()
        return {
          text: rec
            ? `已提交记录 ${rec.id}（${rec.status}）。${rec.status === 'draft' ? '等待团队成员在面板中审核。' : ''}`
            : '已提交。',
        }
      },
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'team_review',
      description:
        'Change the review status of a team record. Use verified only with concrete evidence; use stale when the record no longer matches the current board or toolchain.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['verified', 'stale', 'superseded', 'draft'] },
          note: { type: 'string', description: 'Why the status changed.' },
        },
        required: ['id', 'status'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        render(_args, value) {
          return [{ type: 'text', text: String((value && value.text) || '') }]
        },
      },
      async execute(args) {
        const data = await api(`/api/records/${encodeURIComponent(String(args.id || ''))}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: args.status, note: args.note }),
        })
        await refreshBrief()
        return { text: `记录 ${args.id} 状态已改为 ${data.record.status}。` }
      },
    }),
  )

  async function readRaw(req) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    return Buffer.concat(chunks).toString('utf8')
  }

  async function proxy(req, res) {
    try {
      const url = req.url || '/team-api'
      if (url === '/team-api/zones' || url.startsWith('/team-api/zones?')) {
        if (req.method === 'GET') {
          const query = new URL(url, 'http://local').searchParams
          const sessionId = query.get('sessionId')
          let current = null
          if (sessionId) {
            const agent = ctx.agents.get(sessionId)
            const cwd = agent ? cwdOf(agent) : ''
            if (cwd) current = { cwd, project: zones[cwd] || '', bound: Boolean(zones[cwd]) }
          }
          return sendJson(res, 200, {
            zones: Object.entries(zones).map(([cwd, project]) => ({ cwd, project })),
            defaultProject: cfg.project,
            current,
          })
        }
        if (req.method === 'POST') {
          let body = {}
          try {
            body = JSON.parse((await readRaw(req)) || '{}')
          } catch {
            body = {}
          }
          let cwd = typeof body.cwd === 'string' ? body.cwd : ''
          if (!cwd && body.sessionId) {
            const agent = ctx.agents.get(body.sessionId)
            cwd = agent ? cwdOf(agent) : ''
          }
          if (!cwd) return sendJson(res, 400, { error: '无法确定这个会话的工作区路径' })
          const project = String(body.project || path.basename(cwd) || 'default')
          zones[cwd] = project
          saveZones()
          refreshBrief()
          return sendJson(res, 201, { cwd, project })
        }
        if (req.method === 'DELETE') {
          let body = {}
          try {
            body = JSON.parse((await readRaw(req)) || '{}')
          } catch {
            body = {}
          }
          if (body.cwd && zones[body.cwd]) {
            delete zones[body.cwd]
            saveZones()
            refreshBrief()
            return sendJson(res, 200, { ok: true })
          }
          return sendJson(res, 404, { error: 'not found' })
        }
        return sendJson(res, 405, { error: 'method not allowed' })
      }
      if (url === '/team-api/config' || url.startsWith('/team-api/config?')) {
        const current = await baseUrl()
        const body = JSON.stringify({
          project: cfg.project,
          projects: [...new Set([cfg.project, ...Object.values(zones)])],
          member,
          hubUrl: current,
          online,
          error: lastError,
          embedded: cfg.embedded !== false,
          node: node ? node.nodeId : '',
          peers: node ? node.peers() : peerList,
          primary: cfg.primary || '',
          advertise: node ? node.advertised : '',
          digest: node ? node.digest() : {},
          sync: node ? node.peerState() : [],
          pending: node ? node.peerState().reduce((sum, state) => sum + state.pending, 0) : 0,
        })
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(body)
        return
      }
      const target = (await baseUrl()) + url.replace(/^\/team-api/, '/api')
      const init = {
        method: req.method,
        headers: {
          'content-type': req.headers['content-type'] || 'application/json',
          'x-team-token': cfg.token,
          'x-team-member': member,
        },
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') init.body = await readRaw(req)
      const upstream = await fetch(target, init)
      const text = await upstream.text()
      res.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(text)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: `hub unreachable: ${message}` }))
    }
  }

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: '/team-api',
      handler: proxy,
    }),
  )
}

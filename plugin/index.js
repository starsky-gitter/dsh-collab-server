/**
 * Team Context — host half.
 *
 * Adds three model tools (team_recall / team_get / team_share), injects a small
 * team brief into the prompt, and proxies the browser panel to the hub so the
 * page never needs the team token.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startNode } from './core.js'

export const name = 'dsh-collab-server'

export const inject = ['tools', 'webServer', 'systemPrompt']

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
  adminToken: '',
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

const TEAM_SKILL = [
  '# 团队共享上下文',
  '',
  '团队里每个人的 AI 都能检索一个共享记录库。你的责任是在任务收尾时，把这一轮真正可复用的结论留下一条，而不是把过程倒进去。',
  '',
  '## 什么时候提交',
  '',
  '- 定位到硬件/时序/驱动问题，并知道触发条件和规避方式。',
  '- 做了有取舍的设计决定，且理由不明显。',
  '- 发现某个"常识"在当前板卡/工具链上不成立。',
  '- 确认了环境差异：某个版本、某块板、某个 SDK 补丁是必需的。',
  '- 一条路走死了，下一个人的 AI 很可能再走一遍。',
  '',
  '## 什么时候不提交',
  '',
  '- 只是改代码、没有结论（纯实现、重命名、格式化）。',
  '- 通用知识、网上随处可查。',
  '- 含密钥、客户数据、完整日志原文。',
  '- 同一结论本轮已经提交过。',
  '',
  '## 怎么做',
  '',
  '1. 先 team_recall 查重；已有就跳过，过期就 team_review 标失效。',
  '2. 没有就 team_share，一条只讲一个结论：title 写"症状 + 条件 + 结论"；body 200–600 字，写现象、适用条件（板卡/芯片/工具链）、验证方式；scope 能填就填；evidence 写一条具体证据。',
  '3. 一律以 draft 提交；verified 只能由人在面板里点，工具改不了。',
  '4. 不要为了写记录额外做验证。',
].join('\n')

const PROTOCOL = [
  '团队共享上下文：任务收尾前（准备交付、结束本轮、或宣布完成之前）自检一次：',
  '这一轮是否得出了可复用的结论（硬件事实、设计取舍、踩坑教训、环境差异）？',
  '有就先 team_recall 查重，再用 team_share 提交一条 200–600 字的记录（标题写症状+条件+结论，正文写现象、适用条件、验证方式）。',
  '纯实现改动、通用知识、含密钥或客户数据的内容不提交。记录一律以 draft 提交，由人在面板里审核为 verified。',
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
  const stateHome = cfg.dataDir || process.env.DSH_PROFILE_DIR || path.join(os.homedir(), '.dsh')
  if (!cfg.dataDir) {
    try {
      const legacy = path.join(stateHome, 'team-context')
      const next = path.join(stateHome, 'collab-server')
      if (!fs.existsSync(next) && fs.existsSync(legacy)) fs.renameSync(legacy, next)
    } catch {
      // a locked directory just keeps the old location
    }
  }
  const settingsProject = String(cfg.project || 'default').replace(/[^\w.-]+/g, '_')
  const settingsFile = path.join(stateHome, 'collab-server', settingsProject, 'settings.json')
  try {
    Object.assign(cfg, JSON.parse(fs.readFileSync(settingsFile, 'utf8')) || {})
  } catch {
    // first run: no persisted settings yet
  }
  let member = cfg.member || os.userInfo().username || 'me'
  const remoteBase = String(cfg.hubUrl || '').replace(/\/+$/, '')
  let peerList = [cfg.primary, ...(Array.isArray(cfg.peers) ? cfg.peers : [])]
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
  // A host exposes its port so slaves can push; a slave only dials out.
  const exposed = cfg.expose === true || (peerList.length > 0 && !cfg.primary)
  const advertiseHost = cfg.advertiseHost || lanAddress()

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
    return path.join(home, 'collab-server', project)
  }

  // The embedded node authenticates this machine's own plugin with a local
  // secret; peers and the admin still use the shared/member token.
  function readLocalSecret() {
    const file = path.join(localDataDir(), 'local-token')
    try {
      const existing = fs.readFileSync(file, 'utf8').trim()
      if (existing) return existing
    } catch {
      // generate below
    }
    const value = crypto.randomBytes(24).toString('base64url')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, value)
    return value
  }
  const localSecret = readLocalSecret()

  function ensureNode() {
    if (cfg.embedded === false) return Promise.resolve(null)
    if (node) return Promise.resolve(node)
    if (nodeFailed) return Promise.resolve(null)
    if (!nodePromise) {
      nodePromise = startNode({
        dataDir: localDataDir(),
        host: exposed ? '0.0.0.0' : '127.0.0.1',
        port: Number(cfg.peerPort) || 7420,
        token: localSecret,
        adminToken: cfg.adminToken || cfg.token,
        peerToken: cfg.token,
        localName: member,
        peers: peerList,
        advertiseHost,
        log: (line) => console.log('[dsh-collab-server] ' + line),
      })
        .then((started) => {
          node = started
          return started
        })
        .catch((error) => {
          nodeFailed = true
          console.error('[dsh-collab-server] embedded node failed, falling back to hubUrl:', error && error.message)
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
      const fromHeader = String((header && header.cwd) || (session && session.cwd) || '')
      if (fromHeader) return fromHeader
      // Some sessions carry their directory on the working-directory service
      // instead of the header; ask it before giving up.
      const wd = ctx.get && ctx.get('workingDirectory')
      if (wd && session && typeof wd.get === 'function') {
        const dir = wd.get(session)
        if (dir) return String(dir)
      }
      return ''
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

  // --- shared files -------------------------------------------------------
  const SKIP_DIRS = new Set(['.git', 'node_modules', 'Objects', 'Listings', 'DebugConfig', 'RTE', '.vscode'])
  const SKIP_FILE = /\.(o|d|crf|dep|lnp|axf|map|lst|htm|iex|bak)$/i
  const hashCache = new Map()

  function walkFiles(root) {
    const out = []
    const stack = [root]
    while (stack.length) {
      const dir = stack.pop()
      let entries = []
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) stack.push(full)
        } else if (entry.isFile() && !SKIP_FILE.test(entry.name)) {
          out.push(full)
        }
      }
    }
    return out
  }

  function hashOfFile(full, stat) {
    const cached = hashCache.get(full)
    if (cached && cached.size === stat.size && cached.mtime === stat.mtimeMs) return cached.hash
    const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')
    hashCache.set(full, { size: stat.size, mtime: stat.mtimeMs, hash })
    return hash
  }

  async function fileBase() {
    return cfg.primary ? String(cfg.primary).replace(/\/+$/, '') : await baseUrl()
  }

  async function remoteManifest(project) {
    const base = await fileBase()
    const res = await fetch(`${base}/api/files/${encodeURIComponent(project)}/manifest`, {
      headers: { 'x-team-token': cfg.token },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error('manifest ' + res.status)
    return (await res.json()).files || []
  }

  async function scanFiles(root, project) {
    const remote = await remoteManifest(project).catch(() => [])
    const remoteMap = new Map(remote.map((entry) => [entry.path, entry.hash]))
    const files = []
    for (const full of walkFiles(root)) {
      const rel = path.relative(root, full).split(path.sep).join('/')
      const stat = fs.statSync(full)
      const hash = hashOfFile(full, stat)
      const remoteHash = remoteMap.get(rel) || ''
      files.push({
        path: rel,
        size: stat.size,
        mtime: Math.round(stat.mtimeMs),
        hash,
        remoteHash,
        status: !remoteHash ? 'local' : remoteHash === hash ? 'synced' : 'changed',
      })
    }
    const manifest = files.map((file) => ({ path: file.path, hash: file.hash, size: file.size, mtime: file.mtime, by: member }))
    await api(`/api/files/${encodeURIComponent(project)}/manifest`, { method: 'PUT', body: JSON.stringify({ files: manifest }) })
    return files
  }

  async function syncFiles(root, project, paths, direction) {
    const base = await fileBase()
    const remote = await remoteManifest(project)
    const remoteMap = new Map(remote.map((entry) => [entry.path, entry.hash]))
    const selected = Array.isArray(paths) && paths.length ? new Set(paths) : null
    let pulled = 0
    let pushed = 0

    if (direction !== 'push') {
      for (const entry of remote) {
        if (selected && !selected.has(entry.path)) continue
        const full = path.join(root, entry.path)
        if (fs.existsSync(full) && hashOfFile(full, fs.statSync(full)) === entry.hash) continue
        const res = await fetch(`${base}/api/files/${encodeURIComponent(project)}/blob/${entry.hash}`, {
          headers: { 'x-team-token': cfg.token },
          signal: AbortSignal.timeout(60000),
        })
        if (!res.ok) continue
        fs.mkdirSync(path.dirname(full), { recursive: true })
        fs.writeFileSync(full, Buffer.from(await res.arrayBuffer()))
        pulled += 1
      }
    }

    const localFiles = walkFiles(root)
    const manifest = []
    for (const full of localFiles) {
      const rel = path.relative(root, full).split(path.sep).join('/')
      const stat = fs.statSync(full)
      const hash = hashOfFile(full, stat)
      manifest.push({ path: rel, hash, size: stat.size, mtime: Math.round(stat.mtimeMs), by: member })
      if (direction === 'pull') continue
      if (selected && !selected.has(rel)) continue
      if (remoteMap.get(rel) === hash) continue
      const res = await fetch(`${base}/api/files/${encodeURIComponent(project)}/blob/${hash}`, {
        method: 'PUT',
        headers: { 'x-team-token': cfg.token, 'content-type': 'application/octet-stream' },
        body: fs.readFileSync(full),
        signal: AbortSignal.timeout(60000),
      })
      if (res.ok) pushed += 1
    }
    if (direction !== 'pull') {
      await fetch(`${base}/api/files/${encodeURIComponent(project)}/manifest`, {
        method: 'PUT',
        headers: { 'x-team-token': cfg.token, 'content-type': 'application/json' },
        body: JSON.stringify({ files: manifest }),
      })
    }
    return { pulled, pushed, total: manifest.length }
  }

  async function api(pathname, init = {}) {
    const signal = AbortSignal.timeout(cfg.timeoutMs)
    const res = await fetch((await baseUrl()) + pathname, {
      ...init,
      signal,
      headers: {
        'content-type': 'application/json',
        'x-team-token': localSecret,
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
        text: () => (cfg.autoBrief !== false ? brief : ''),
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
            text: () => (cfg.autoBrief !== false ? briefs.get(projectOf(agent)) || '' : ''),
          }),
        )
      } catch (error) {
        console.error('[dsh-collab-server] scoped brief failed:', error && error.message)
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

  // Ship the checklist as a runtime skill so installing the plugin is enough;
  // profiles that also load a filesystem skill with the same name keep theirs.
  ctx.effect(() => {
    const skills = ctx.get && ctx.get('skills')
    if (!skills || typeof skills.register !== 'function') return () => {}
    try {
      return skills.register({
        name: 'team-context',
        description: '任务收尾时判断本轮是否有可复用的团队结论，并用 team_share 提交一条记录。',
        whenToUse: '改了代码、跑过构建/烧录、定位过硬件问题，或做了设计取舍之后。',
        source: 'runtime',
        content: TEAM_SKILL,
      })
    } catch (error) {
      console.error('[dsh-collab-server] skill registration failed:', error && error.message)
      return () => {}
    }
  })

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
        'Share one atomic conclusion with the team as a record. Use it for reusable hardware facts, design decisions, failure lessons or environment differences. Keep the body 200-600 characters: conclusion, conditions, and how it was verified. Records always start as drafts; a human reviews them in the panel before they become verified.',
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
          status: { type: 'string', description: 'Ignored: records always start as drafts.' },
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
          status: 'draft',
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
        'Change the review state of a record you own. Verification is a human action in the panel, so this tool cannot set verified: use it to mark a record stale or superseded when it no longer matches reality.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['draft', 'stale', 'superseded'] },
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
      if (url === '/team-api/settings' || url.startsWith('/team-api/settings?')) {
        if (req.method === 'GET') {
          return sendJson(res, 200, {
            project: cfg.project,
            member,
            primary: cfg.primary || '',
            token: cfg.token || '',
            adminToken: cfg.adminToken || '',
            peerPort: Number(cfg.peerPort) || 7420,
            expose: cfg.expose === true,
            autoBrief: cfg.autoBrief !== false,
            briefLimit: Number(cfg.briefLimit) || 8,
            peers: Array.isArray(cfg.peers) ? cfg.peers : [],
            advertise: node ? node.advertised : '',
            node: node ? node.nodeId : '',
          })
        }
        if (req.method === 'POST') {
          let body = {}
          try {
            body = JSON.parse((await readRaw(req)) || '{}')
          } catch {
            body = {}
          }
          const portChanged = body.peerPort !== undefined && Number(body.peerPort) !== Number(cfg.peerPort)
          const exposeChanged = body.expose !== undefined && Boolean(body.expose) !== Boolean(cfg.expose)
          for (const key of ['project', 'member', 'primary', 'token', 'adminToken', 'peerPort', 'briefLimit']) {
            if (body[key] !== undefined) cfg[key] = body[key]
          }
          if (body.expose !== undefined) cfg.expose = body.expose === true
          if (body.autoBrief !== undefined) cfg.autoBrief = body.autoBrief !== false
          if (Array.isArray(body.peers)) cfg.peers = body.peers.filter(Boolean)
          if (!cfg.member) cfg.member = os.userInfo().username || 'me'
          member = cfg.member
          peerList = [cfg.primary, ...(Array.isArray(cfg.peers) ? cfg.peers : [])]
            .filter(Boolean)
            .filter((value, index, list) => list.indexOf(value) === index)
          if (node) node.setPeers(peerList)
          fs.mkdirSync(path.dirname(settingsFile), { recursive: true })
          fs.writeFileSync(
            settingsFile,
            JSON.stringify(
              {
                project: cfg.project,
                member: cfg.member,
                primary: cfg.primary,
                token: cfg.token,
                adminToken: cfg.adminToken,
                peerPort: cfg.peerPort,
                expose: cfg.expose === true,
                autoBrief: cfg.autoBrief,
                briefLimit: cfg.briefLimit,
                peers: cfg.peers,
              },
              null,
              2,
            ),
          )
          refreshBrief()
          return sendJson(res, 200, { ok: true, restartRequired: portChanged || exposeChanged })
        }
        return sendJson(res, 405, { error: 'method not allowed' })
      }
      if (url.startsWith('/team-api/admin/members')) {
        const suffix = url.slice('/team-api/admin/members'.length).split('?')[0]
        const target = (await baseUrl()) + '/api/team/members' + suffix
        const init = { method: req.method, headers: { 'x-team-token': cfg.adminToken || cfg.token } }
        if (req.method !== 'GET' && req.method !== 'DELETE') {
          init.body = await readRaw(req)
          init.headers['content-type'] = 'application/json'
        }
        const upstream = await fetch(target, init)
        const text = await upstream.text()
        res.writeHead(upstream.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(text)
        return
      }
      if (url.startsWith('/team-api/files/')) {
        const action = url.split('?')[0].replace('/team-api/files/', '')
        let body = {}
        try {
          body = JSON.parse((await readRaw(req)) || '{}')
        } catch {
          body = {}
        }
        const root = typeof body.root === 'string' ? body.root : ''
        const project = String(body.project || cfg.project)
        if (!root || !fs.existsSync(root)) return sendJson(res, 400, { error: '目录不存在：' + root })
        if (req.method === 'POST' && action === 'scan') {
          const files = await scanFiles(root, project)
          return sendJson(res, 200, { project, root, files })
        }
        if (req.method === 'POST' && action === 'sync') {
          const direction = body.direction === 'push' ? 'push' : body.direction === 'pull' ? 'pull' : 'both'
          const result = await syncFiles(root, project, body.paths, direction)
          return sendJson(res, 200, { project, root, ...result })
        }
        return sendJson(res, 405, { error: 'unsupported file action' })
      }
      if (url.startsWith('/team-api/zones/available')) {
        const target = cfg.primary ? String(cfg.primary).replace(/\/+$/, '') : await baseUrl()
        const zoneToken = cfg.primary ? cfg.token : localSecret
        if (req.method === 'GET') {
          const upstream = await fetch(target + '/api/zones', { headers: { 'x-team-token': zoneToken } })
          const data = await upstream.json().catch(() => ({}))
          return sendJson(res, upstream.status, { zones: data.zones || [] })
        }
        if (req.method === 'POST') {
          let body = {}
          try {
            body = JSON.parse((await readRaw(req)) || '{}')
          } catch {
            body = {}
          }
          const upstream = await fetch(target + '/api/zones', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-team-token': zoneToken },
            body: JSON.stringify({ name: body.name }),
          })
          const data = await upstream.json().catch(() => ({}))
          return sendJson(res, upstream.status, data)
        }
      }
      if (url === '/team-api/zones' || url.startsWith('/team-api/zones?')) {
        if (req.method === 'GET') {
          return sendJson(res, 200, {
            zones: Object.entries(zones).map(([cwd, project]) => ({ cwd, project })),
            defaultProject: cfg.project,
          })
        }
        if (req.method === 'POST') {
          let body = {}
          try {
            body = JSON.parse((await readRaw(req)) || '{}')
          } catch {
            body = {}
          }
          const cwd = typeof body.cwd === 'string' ? body.cwd.trim() : ''
          const project = String(body.project || (cwd ? path.basename(cwd) : '')).trim()
          if (!cwd) return sendJson(res, 400, { error: '缺少工作区路径' })
          if (!project) return sendJson(res, 400, { error: '缺少合作区名' })
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
          zones: Object.entries(zones).map(([cwd, project]) => ({ cwd, project })),
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
          'x-team-token': localSecret,
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

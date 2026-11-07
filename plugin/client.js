window.__ModuleLoader__.load({
  id: 'dsh-collab-server',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const useState = React.useState
    const useEffect = React.useEffect
    const useRef = React.useRef
    const useCallback = React.useCallback

    const API = '/team-api'
    const KINDS = [
      ['fact', '事实'],
      ['decision', '决策'],
      ['failure', '教训'],
      ['env', '环境'],
      ['bench', '台架'],
      ['change', '变更'],
    ]
    const KIND_LABEL = Object.fromEntries(KINDS)
    const STATUS = [
      ['draft', '待审'],
      ['verified', '已验证'],
      ['stale', '已失效'],
      ['superseded', '已取代'],
    ]
    const STATUS_LABEL = Object.fromEntries(STATUS)

    async function api(path, init) {
      const res = await fetch(API + path, {
        ...(init || {}),
        headers: { 'content-type': 'application/json', ...((init && init.headers) || {}) },
      })
      let data = null
      try {
        data = await res.json()
      } catch {
        data = null
      }
      if (!res.ok) throw new Error((data && data.error) || 'HTTP ' + res.status)
      return data
    }

    function ago(iso) {
      const t = Date.parse(iso)
      if (!Number.isFinite(t)) return ''
      const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
      if (s < 60) return '刚刚'
      if (s < 3600) return Math.floor(s / 60) + ' 分钟前'
      if (s < 86400) return Math.floor(s / 3600) + ' 小时前'
      return Math.floor(s / 86400) + ' 天前'
    }

    function stamp(iso) {
      const t = Date.parse(iso)
      if (!Number.isFinite(t)) return iso
      const d = new Date(t)
      const p = (n) => String(n).padStart(2, '0')
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
    }

    const CSS = `
      .dtc-root{display:flex;flex-direction:column;height:100%;min-height:520px;color:var(--dsw-alias-label-primary);font-size:13px}
      .dtc-head{display:flex;align-items:center;gap:10px;padding:0 0 12px;flex-wrap:wrap;position:relative;z-index:2;flex-shrink:0}
      .dtc-switch{display:flex;gap:8px;margin:0 0 10px;flex-shrink:0}
      .dtc-switch-btn{flex:1;padding:9px 12px;font-size:13px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
      .dtc-switch-btn:hover{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,transparent)}
      .dtc-switch-btn.on{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 13%,transparent);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);font-weight:600}
      .dtc-preview-mask{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;display:flex;align-items:center;justify-content:center}
      .dtc-preview{width:min(760px,90vw);max-height:82vh;overflow:auto;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:14px}
      .dtc-preview-text{white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.6;max-height:62vh;overflow:auto;margin:8px 0 0}
      .dtc-title{font-size:16px;font-weight:600;line-height:1.2}
      .dtc-sub{color:var(--dsw-alias-label-secondary);font-size:12px}
      .dtc-spacer{flex:1}
      .dtc-dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:5px}
      .dtc-btn{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:7px;padding:5px 11px;font-size:12px;cursor:pointer;line-height:1.4}
      .dtc-btn:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent)}
      .dtc-btn:disabled{opacity:.45;cursor:default}
      .dtc-btn-primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-bg-base);font-weight:500}
      .dtc-btn-primary:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 86%,#000);border-color:transparent}
      .dtc-toolbar{display:flex;gap:8px;align-items:center;padding:0 0 10px;flex-wrap:wrap;position:relative;z-index:1}
      .dtc-search{flex:1;min-width:180px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 10px;font-size:12px;outline:none}
      .dtc-search:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)}
      .dtc-chip{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:999px;padding:4px 10px;font-size:12px;cursor:pointer}
      .dtc-chip:hover{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,transparent);color:var(--dsw-alias-label-primary)}
      .dtc-chip.on{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);font-weight:500}
      .dtc-select{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 8px;font-size:12px;outline:none}
      .dtc-select:focus{border-color:var(--dsw-alias-brand-primary)}
      .dtc-body{display:flex;flex:1;min-height:0;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
      .dtc-list{width:340px;min-width:260px;border-right:1px solid var(--dsw-alias-border-l1);overflow:auto}
      .dtc-item{padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:pointer;border-left:2px solid transparent}
      .dtc-item:hover{background:var(--dsw-alias-bg-layer-2)}
      .dtc-item.on{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 11%,transparent);border-left-color:var(--dsw-alias-brand-primary)}
      .dtc-item-title{font-weight:500;line-height:1.4;margin-bottom:5px;word-break:break-word}
      .dtc-meta{display:flex;gap:8px;align-items:center;color:var(--dsw-alias-label-secondary);font-size:11px;flex-wrap:wrap}
      .dtc-detail{flex:1;min-width:0;overflow:auto;padding:18px 22px}
      .dtc-h2{font-size:17px;font-weight:600;line-height:1.4;margin:0 0 8px;word-break:break-word}
      .dtc-bodytext{white-space:pre-wrap;word-break:break-word;line-height:1.65;margin:14px 0 18px;font-size:13px}
      .dtc-kv{display:flex;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary);margin:2px 0}
      .dtc-kv b{color:var(--dsw-alias-label-secondary);font-weight:500;min-width:56px}
      .dtc-kv span{color:var(--dsw-alias-label-primary);word-break:break-word}
      .dtc-evidence{margin:6px 0 0;padding-left:16px;line-height:1.7}
      .dtc-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px;padding-top:14px;border-top:1px solid var(--dsw-alias-border-l1)}
      .dtc-empty{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary);gap:8px;font-size:13px;padding:30px;text-align:center}
      .dtc-banner{display:flex;gap:10px;align-items:center;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 50%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 9%,transparent);color:var(--dsw-alias-state-error-primary);border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:12px}
      .dtc-toast{position:sticky;bottom:0;margin-top:8px;align-self:flex-end;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 12px;font-size:12px;color:var(--dsw-alias-label-primary);box-shadow:0 8px 24px color-mix(in srgb,#000 20%,transparent)}
      .dtc-form{display:flex;flex-direction:column;gap:10px;max-width:620px}
      .dtc-input,.dtc-textarea{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;font-family:inherit}
      .dtc-textarea{min-height:180px;resize:vertical;line-height:1.6}
      .dtc-input:focus,.dtc-textarea:focus{border-color:var(--dsw-alias-brand-primary)}
      .dtc-label{font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:4px}
      .dtc-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .dtc-skel{height:58px;border-bottom:1px solid var(--dsw-alias-border-l1);opacity:.5;background:linear-gradient(90deg,transparent,var(--dsw-alias-bg-layer-2),transparent);background-size:200% 100%;animation:dtc-sh 1.2s infinite}
      @keyframes dtc-sh{0%{background-position:200% 0}100%{background-position:-200% 0}}
    `

    function Badge(props) {
      const color = props.color || 'var(--dsw-alias-label-secondary)'
      return h(
        'span',
        {
          style: {
            border: '1px solid color-mix(in srgb, ' + color + ' 42%, transparent)',
            background: 'color-mix(in srgb, ' + color + ' 12%, transparent)',
            color: color,
            borderRadius: '999px',
            padding: '1px 7px',
            fontSize: '10.5px',
            lineHeight: '16px',
            whiteSpace: 'nowrap',
          },
        },
        props.children,
      )
    }

    function statusColor(status) {
      if (status === 'verified') return 'var(--dsw-alias-brand-primary)'
      if (status === 'draft') return 'var(--dsw-alias-state-warn-primary)'
      if (status === 'stale') return 'var(--dsw-alias-state-error-primary)'
      return 'var(--dsw-alias-state-idle-primary)'
    }

    function Panel() {
      const [cfg, setCfg] = useState(null)
      const [items, setItems] = useState([])
      const [q, setQ] = useState('')
      const [status, setStatus] = useState('all')
      const [kind, setKind] = useState('all')
      const [projectFilter, setProjectFilter] = useState('all')
      const [selected, setSelected] = useState(null)
      const [detail, setDetail] = useState(null)
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [creating, setCreating] = useState(false)
      const [sync, setSync] = useState(null)
      const [zoneView, setZoneView] = useState(null)
      const [fileView, setFileView] = useState(null)
      const [filePending, setFilePending] = useState(0)
      const [mode, setMode] = useState('records')
      const [preview, setPreview] = useState(null)
      const [memberView, setMemberView] = useState(null)
      const [settingsView, setSettingsView] = useState(null)
      const [form, setForm] = useState({ title: '', body: '', kind: 'fact', project: '' })
      const [toast, setToast] = useState('')
      const loadRef = useRef(null)

      const load = useCallback(async () => {
        const params = new URLSearchParams()
        if (projectFilter !== 'all') params.set('project', projectFilter)
        params.set('limit', '200')
        if (q.trim()) params.set('q', q.trim())
        if (status !== 'all') params.set('status', status)
        if (kind !== 'all') params.set('kind', kind)
        try {
          const data = await api('/records?' + params.toString())
          setItems((data && data.records) || [])
          setError('')
        } catch (e) {
          setError(String((e && e.message) || e))
        } finally {
          setLoading(false)
        }
        try {
          setSync(await api('/config'))
        } catch {
          setSync(null)
        }
        try {
          const root = window.localStorage.getItem('collab.fileRoot')
          const project = window.localStorage.getItem('collab.fileProject')
          if (root && project) {
            const pending = await api(`/files/pending?root=${encodeURIComponent(root)}&project=${encodeURIComponent(project)}`)
            setFilePending((pending && pending.pending) || 0)
          }
        } catch {
          // the file root simply is not configured or unreachable
        }
      }, [cfg, q, status, kind, projectFilter])

      loadRef.current = load

      useEffect(() => {
        api('/config')
          .then(setCfg)
          .catch((e) => {
            setError(String((e && e.message) || e))
            setLoading(false)
          })
      }, [])

      useEffect(() => {
        if (!cfg) return undefined
        const timer = setTimeout(() => {
          load()
        }, 200)
        return () => clearTimeout(timer)
      }, [cfg, load])

      useEffect(() => {
        const timer = setInterval(() => {
          if (loadRef.current) loadRef.current()
        }, 10000)
        return () => clearInterval(timer)
      }, [])

      useEffect(() => {
        if (!selected) {
          setDetail(null)
          return undefined
        }
        let alive = true
        api('/records/' + encodeURIComponent(selected))
          .then((data) => {
            if (alive) setDetail(data && data.record)
          })
          .catch((e) => setError(String((e && e.message) || e)))
        return () => {
          alive = false
        }
      }, [selected])

      useEffect(() => {
        if (!toast) return undefined
        const timer = setTimeout(() => setToast(''), 2600)
        return () => clearTimeout(timer)
      }, [toast])

      async function patchStatus(id, next) {
        setBusy(true)
        try {
          const note = next === 'stale' ? window.prompt('失效原因（可留空）') || '' : undefined
          await api('/records/' + encodeURIComponent(id), {
            method: 'PATCH',
            body: JSON.stringify(note === undefined ? { status: next } : { status: next, note }),
          })
          setToast('已更新为「' + (STATUS_LABEL[next] || next) + '」')
          if (loadRef.current) await loadRef.current()
          if (selected === id) {
            const data = await api('/records/' + encodeURIComponent(id))
            setDetail(data && data.record)
          }
        } catch (e) {
          setError(String((e && e.message) || e))
        } finally {
          setBusy(false)
        }
      }

      function projectForRoot(root) {
        const zones = (sync && sync.zones) || []
        const hit = zones.find((zone) => zone.cwd === root)
        if (hit) return hit.project
        return (cfg && cfg.project) || 'default'
      }

      async function openFiles() {
        const zones = (sync && sync.zones) || []
        const raw = window.localStorage.getItem('collab.fileRoot') || ''
        // Only accept an absolute Windows path or a POSIX path here; anything
        // else is leftover garbage from an earlier failed picker call.
        const stored = /^[A-Za-z]:[\\/]/.test(raw) || /^\\\\/.test(raw) || /^\//.test(raw) ? raw : ''
        if (raw && !stored) window.localStorage.removeItem('collab.fileRoot')
        const prefer = zones.find((zone) => zone.project === (sync && sync.project)) || zones[0]
        const root = stored || (prefer && prefer.cwd) || ''
        const next = { root, files: null, busy: false, msg: '', selected: {} }
        setFileView(next)
        if (root) scanFiles(next)
        setZoneView(null)
        setMemberView(null)
        setSettingsView(null)
        setCreating(false)
        setSelected(null)
      }

      async function openPreview(file) {
        const project = projectForRoot(fileView.root)
        const ext = String(file.path).split('.').pop().toLowerCase()
        const url = `/team-api/files/${encodeURIComponent(project)}/blob/${file.hash}`
        if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
          setPreview({ path: file.path, kind: 'image', url })
          return
        }
        const textExt = ['md', 'txt', 'c', 'h', 'cpp', 'hpp', 'json', 'js', 'ts', 'yaml', 'yml', 'ini', 'csv', 'log', 'py', 'sh', 'ps1', 'xml', 'html', 'css', 'uvprojx', 'ioc', 's', 'ld']
        if (textExt.includes(ext) && file.size < 512 * 1024) {
          setPreview({ path: file.path, kind: 'text', loading: true })
          try {
            const res = await fetch(url)
            if (!res.ok) throw new Error('HTTP ' + res.status)
            setPreview({ path: file.path, kind: 'text', text: await res.text() })
          } catch (e) {
            setPreview({ path: file.path, kind: 'text', error: String((e && e.message) || e) })
          }
          return
        }
        setPreview({ path: file.path, kind: 'binary', size: file.size, url })
      }

      async function scanFiles(target) {
        const view = target || fileView
        if (!view || !view.root) return
        setFileView({ ...view, busy: true, msg: '扫描中…' })
        try {
          const data = await api('/files/scan', {
            method: 'POST',
            body: JSON.stringify({ root: view.root, project: projectForRoot(view.root) }),
          })
          const selected = {}
          for (const file of data.files) if (file.status !== 'synced') selected[file.path] = true
          setFileView({ ...view, busy: false, msg: '', files: data.files, selected })
          window.localStorage.setItem('collab.fileRoot', view.root)
          window.localStorage.setItem('collab.fileProject', projectForRoot(view.root))
        } catch (e) {
          setFileView({ ...view, busy: false, msg: String((e && e.message) || e) })
        }
      }

      async function syncFileView(direction) {
        const view = fileView
        if (!view || !view.root || !view.files) return
        const paths = Object.keys(view.selected || {}).filter((key) => view.selected[key])
        if (direction === 'pull') {
          const risky = (view.files || []).filter((file) => paths.includes(file.path) && isProtectedFile(file))
          if (risky.length && !window.confirm('有 ' + risky.length + ' 个本机未上传的改动会被覆盖，继续？')) return
        }
        setFileView({ ...view, busy: true, msg: '同步中…' })
        try {
          const data = await api('/files/sync', {
            method: 'POST',
            body: JSON.stringify({ root: view.root, project: projectForRoot(view.root), paths, direction }),
          })
          if (data && data.queued) {
            setFileView({ ...view, busy: false, msg: '主机不可达，已排队；链路恢复后会自动上传' })
            return
          }
          setFileView({ ...view, busy: false, msg: '完成：下载 ' + data.pulled + '，上传 ' + data.pushed })
          setFilePending(0)
          await scanFiles()
        } catch (e) {
          setFileView({ ...view, busy: false, msg: String((e && e.message) || e) })
        }
      }

      async function openSettings() {
        setSettingsView({ loading: true })
        setFileView(null)
        setZoneView(null)
        setMemberView(null)
        setCreating(false)
        setSelected(null)
        try {
          setSettingsView({ ...(await api('/settings')), loading: false })
        } catch (e) {
          setSettingsView({ loading: false, msg: String((e && e.message) || e) })
        }
      }

      async function saveSettings() {
        const view = settingsView
        if (!view) return
        setSettingsView({ ...view, busy: true, msg: '' })
        try {
          const data = await api('/settings', { method: 'POST', body: JSON.stringify(view) })
          setSettingsView({ ...view, busy: false, msg: data.restartRequired ? '已保存；端口改动需重启 DSH 生效' : '已保存' })
          setSync(await api('/config'))
        } catch (e) {
          setSettingsView({ ...view, busy: false, msg: String((e && e.message) || e) })
        }
      }

      async function openMembers() {
        setMemberView({ members: [], busy: true, msg: '', token: '', newName: '' })
        setFileView(null)
        setZoneView(null)
        setSettingsView(null)
        setCreating(false)
        setSelected(null)
        try {
          const data = await api('/admin/members')
          setMemberView((current) => ({
            ...(current || {}),
            members: data.members || [],
            delegated: data.delegated,
            busy: false,
          }))
        } catch (e) {
          setMemberView((current) => ({ ...(current || {}), busy: false, msg: String((e && e.message) || e) }))
        }
      }

      async function addMember() {
        const view = memberView
        if (!view || !String(view.newName || '').trim()) return
        setMemberView({ ...view, busy: true, msg: '' })
        try {
          const data = await api('/admin/members', {
            method: 'POST',
            body: JSON.stringify({ name: String(view.newName).trim() }),
          })
          setMemberView({
            ...view,
            busy: false,
            token: data.token,
            newName: '',
            members: [...(view.members || []), data.member],
          })
        } catch (e) {
          setMemberView({ ...view, busy: false, msg: String((e && e.message) || e) })
        }
      }

      async function disableMember(id) {
        const view = memberView
        if (!view) return
        setMemberView({ ...view, busy: true })
        try {
          await api('/admin/members/' + encodeURIComponent(id), { method: 'DELETE' })
          setMemberView({
            ...view,
            busy: false,
            members: (view.members || []).map((member) => (member.id === id ? { ...member, disabled: true } : member)),
          })
        } catch (e) {
          setMemberView({ ...view, busy: false, msg: String((e && e.message) || e) })
        }
      }

      async function rotateMember(id) {
        const view = memberView
        if (!view) return
        setMemberView({ ...view, busy: true, msg: '' })
        try {
          const data = await api('/admin/members/' + encodeURIComponent(id) + '/token', { method: 'POST' })
          setMemberView({ ...view, busy: false, token: data.token })
        } catch (e) {
          setMemberView({ ...view, busy: false, msg: String((e && e.message) || e) })
        }
      }

      async function deleteMember(id) {
        const view = memberView
        if (!view) return
        setMemberView({ ...view, busy: true, msg: '' })
        try {
          await api('/admin/members/' + encodeURIComponent(id), { method: 'DELETE' })
          setMemberView({
            ...view,
            busy: false,
            token: '',
            members: (view.members || []).filter((member) => member.id !== id),
          })
        } catch (e) {
          setMemberView({ ...view, busy: false, msg: String((e && e.message) || e) })
        }
      }

      async function openZones() {
        setZoneView({ zones: [], available: [], loading: true, newName: '', bindPath: '', bindProject: '' })
        setFileView(null)
        setMemberView(null)
        setSettingsView(null)
        setCreating(false)
        setSelected(null)
        setError('')
        try {
          const bindings = await api('/zones')
          setZoneView((view) => ({ ...(view || {}), zones: bindings.zones || [], loading: true }))
        } catch (e) {
          setError(String((e && e.message) || e))
        }
        try {
          const available = await api('/zones/available')
          const names = (available && available.zones) || []
          setZoneView((view) => ({
            ...(view || { zones: [] }),
            available: names,
            bindProject: (view && view.bindProject) || names[0] || '',
            loading: false,
          }))
        } catch (e) {
          setZoneView((view) => ({ ...(view || { zones: [] }), loading: false }))
          setError(String((e && e.message) || e))
        }
      }

      async function removeZone(name) {
        if (!window.confirm('删除合作区 ' + name + '？里面的记录不会被删除。')) return
        try {
          await api('/zones/' + encodeURIComponent(name), { method: 'DELETE' })
          await openZones()
          setToast('已删除合作区 ' + name)
        } catch (e) {
          setError(String((e && e.message) || e))
        }
      }

      async function bindPath() {
        const view = zoneView
        const cwd = String((view && view.bindPath) || '').trim()
        const project = String((view && view.bindProject) || '').trim()
        if (!cwd || !project) {
          setToast('填一个目录并选择合作区')
          return
        }
        try {
          await api('/zones', { method: 'POST', body: JSON.stringify({ cwd, project }) })
          await openZones()
          setToast('已把该工作区加入 ' + project)
        } catch (e) {
          setError(String((e && e.message) || e))
        }
      }

      async function createZone() {
        const view = zoneView
        const name = String((view && view.newName) || '').trim()
        if (!name) return
        try {
          await api('/zones/available', { method: 'POST', body: JSON.stringify({ name }) })
          await openZones()
          setToast('已创建合作区 ' + name)
        } catch (e) {
          setError(String((e && e.message) || e))
        }
      }

      async function unbindZone(cwd) {
        try {
          await api('/zones', { method: 'DELETE', body: JSON.stringify({ cwd }) })
          await openZones()
          setToast('已解除绑定')
        } catch (e) {
          setError(String((e && e.message) || e))
        }
      }

      async function deleteRecord(id) {
        if (!window.confirm('删除这条记录？其他机器同步后也会删除。')) return
        setBusy(true)
        try {
          await api('/records/' + encodeURIComponent(id), { method: 'DELETE' })
          setDetail(null)
          setSelected(null)
          if (loadRef.current) await loadRef.current()
          setToast('已删除')
        } catch (e) {
          setError(String((e && e.message) || e))
        } finally {
          setBusy(false)
        }
      }

      async function copy(text, label) {
        try {
          await navigator.clipboard.writeText(text)
          setToast(label || '已复制')
        } catch {
          setToast('复制失败，请手动选择')
        }
      }

      function selectByFileStatus(predicate) {
        if (!fileView || !fileView.files) return
        const next = {}
        for (const file of fileView.files) if (predicate(file)) next[file.path] = true
        setFileView({ ...fileView, selected: next })
      }

      function defaultZone() {
        if (projectFilter !== 'all') return projectFilter
        const list = (sync && sync.projects) || []
        return list[0] || (cfg && cfg.project) || 'default'
      }

      async function submitNew() {
        if (!form.title.trim() || !form.body.trim()) {
          setToast('标题和正文不能为空')
          return
        }
        setBusy(true)
        try {
          const data = await api('/records', {
            method: 'POST',
            body: JSON.stringify({
              project: form.project || defaultZone(),
              title: form.title,
              body: form.body,
              kind: form.kind,
              status: 'draft',
            }),
          })
          setCreating(false)
          setForm({ title: '', body: '', kind: 'fact', project: '' })
          setToast('已新建记录')
          if (loadRef.current) await loadRef.current()
          if (data && data.record) setSelected(data.record.id)
        } catch (e) {
          setError(String((e && e.message) || e))
        } finally {
          setBusy(false)
        }
      }

      const filtered = items

      function renderList() {
        if (loading && !items.length) {
          return h(
            'div',
            null,
            h('div', { className: 'dtc-skel' }),
            h('div', { className: 'dtc-skel' }),
            h('div', { className: 'dtc-skel' }),
          )
        }
        if (!filtered.length) {
          return h(
            'div',
            { className: 'dtc-empty' },
            h('div', null, q || status !== 'all' || kind !== 'all' ? '没有匹配的记录' : '还没有记录'),
            h(
              'div',
              { style: { fontSize: '12px' } },
              '让 AI 在得出结论时调用 team_share，或点右上角「新建记录」。',
            ),
          )
        }
        return filtered.map((r) =>
          h(
            'div',
            {
              key: r.id,
              className: 'dtc-item' + (selected === r.id ? ' on' : ''),
              onClick: () => {
                setZoneView(null)
                setFileView(null)
                setMemberView(null)
                setSettingsView(null)
                setSelected(r.id)
              },
            },
            h('div', { className: 'dtc-item-title' }, r.title),
            h(
              'div',
              { className: 'dtc-meta' },
              h(Badge, { color: 'var(--dsw-alias-border-l2)' }, KIND_LABEL[r.kind] || r.kind),
              h(
                'span',
                { style: { color: statusColor(r.status) } },
                h('span', {
                  className: 'dtc-dot',
                  style: { background: statusColor(r.status) },
                }),
                STATUS_LABEL[r.status] || r.status,
              ),
              h('span', null, r.author),
              h('span', { style: { opacity: 0.8 } }, r.project),
              h('span', null, ago(r.updatedAt)),
            ),
          ),
        )
      }

      function settingsTabs(active) {
        const hostMode = !(sync && sync.isHost === false)
        const items = [
          ['general', '通用', openSettings],
          ...(hostMode ? [['members', '成员', openMembers]] : []),
          ['zones', '合作区', openZones],
        ]
        return h(
          'div',
          { className: 'dtc-row', style: { marginBottom: '12px' } },
          items.map(([key, label, open]) =>
            h(
              'button',
              {
                key,
                className: 'dtc-btn' + (active === key ? ' dtc-btn-primary' : ''),
                onClick: open,
              },
              label,
            ),
          ),
        )
      }

      function closeViews() {
        setCreating(false)
        setZoneView(null)
        setFileView(null)
        setMemberView(null)
        setSettingsView(null)
      }

      function isProtectedFile(file) {
        return file.status === 'local' || (file.status === 'changed' && file.mtime > (file.remoteMtime || 0))
      }

      function renderFileList() {
        const files = (fileView && fileView.files) || []
        if (!files.length) {
          return h(
            'div',
            { className: 'dtc-empty' },
            h('div', null, fileView && fileView.busy ? '扫描中…' : '还没有文件'),
            h('div', { style: { fontSize: '12px' } }, '填目录后点「扫描」。'),
          )
        }
        return files.map((file) =>
          h(
            'div',
            {
              key: file.path,
              style: {
                display: 'flex',
                gap: '8px',
                alignItems: 'center',
                padding: '4px 8px',
                fontSize: '12px',
                borderBottom: '1px solid var(--dsw-alias-border-l1)',
              },
            },
            h('input', {
              type: 'checkbox',
              checked: !!(fileView.selected && fileView.selected[file.path]),
              onChange: (e) => {
                const next = { ...(fileView.selected || {}) }
                next[file.path] = e.target.checked
                setFileView({ ...fileView, selected: next })
              },
            }),
            h(
              'span',
              {
                style: { flex: 1, wordBreak: 'break-all', cursor: 'pointer' },
                title: '点击预览',
                onClick: () => openPreview(file),
              },
              file.path,
            ),
            h(
              'span',
              {
                title:
                  '本地 ' +
                  new Date(file.mtime || 0).toLocaleString() +
                  ' / 远端 ' +
                  new Date(file.remoteMtime || 0).toLocaleString() +
                  (file.remoteBy ? ' · ' + file.remoteBy : ''),
                style: {
                  color:
                    file.status === 'synced'
                      ? 'var(--dsw-alias-state-success-primary)'
                      : file.status === 'changed' || file.status === 'remote'
                        ? 'var(--dsw-alias-state-warn-primary)'
                        : 'var(--dsw-alias-label-secondary)',
                  whiteSpace: 'nowrap',
                },
              },
              file.status === 'synced'
                ? '已同步'
                : file.status === 'remote'
                  ? '待下载'
                  : file.status === 'changed'
                    ? file.mtime > (file.remoteMtime || 0)
                      ? '本地更新'
                      : '远端更新'
                    : '仅本地',
            ),
            h(
              'span',
              { style: { color: 'var(--dsw-alias-label-secondary)', minWidth: '64px', textAlign: 'right' } },
              (file.size / 1024).toFixed(1) + ' KB',
            ),
          ),
        )
      }

      function renderFilePreview() {
        if (!preview) {
          return h(
            'div',
            { className: 'dtc-empty' },
            h('div', { style: { fontSize: '15px', fontWeight: '500' } }, '点击左侧文件预览'),
            h('div', null, '文本和图片直接显示，其他文件可下载。'),
          )
        }
        return [
          h(
            'div',
            { className: 'dtc-row', key: 'head' },
            h('div', { style: { flex: 1, fontWeight: 600, fontSize: '13px', wordBreak: 'break-all' } }, preview.path),
            h('button', { className: 'dtc-btn', onClick: () => setPreview(null) }, '关闭'),
          ),
          preview.kind === 'image'
            ? h('img', {
                key: 'img',
                src: preview.url,
                style: { maxWidth: '100%', marginTop: '10px', display: 'block' },
              })
            : preview.kind === 'text'
              ? preview.loading
                ? h('div', { key: 'load', style: { fontSize: '12px', marginTop: '10px' } }, '读取中…')
                : preview.error
                  ? h(
                      'div',
                      {
                        key: 'err',
                        style: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)', marginTop: '10px' },
                      },
                      preview.error,
                    )
                  : h('pre', { key: 'text', className: 'dtc-preview-text' }, preview.text)
              : h(
                  'div',
                  { key: 'bin', style: { fontSize: '12px', marginTop: '10px' } },
                  '二进制文件 · ' + (preview.size / 1024).toFixed(1) + ' KB · ',
                  h(
                    'a',
                    {
                      href: preview.url,
                      target: '_blank',
                      rel: 'noreferrer',
                      style: { color: 'var(--dsw-alias-brand-primary)' },
                    },
                    '下载',
                  ),
                ),
        ]
      }

      function renderDetail() {
        const isHost = !(sync && sync.isHost === false)
        if (settingsView) {
          const field = (key, label, opts) =>
            h(
              'div',
              { style: { marginBottom: '10px' } },
              h('div', { className: 'dtc-label' }, label),
              h('input', {
                className: 'dtc-input',
                value: settingsView[key] === undefined || settingsView[key] === null ? '' : settingsView[key],
                ...(opts || {}),
                onChange: (e) =>
                  setSettingsView({
                    ...settingsView,
                    [key]: opts && opts.type === 'number' ? Number(e.target.value) : e.target.value,
                  }),
              }),
            )
          return h(
            'div',
            { className: 'dtc-detail' },
            settingsTabs('general'),
            h('div', { className: 'dtc-h2' }, '设置'),
            h(
              'div',
              { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', marginBottom: '12px' } },
              '保存在本机；令牌和地址立即生效，端口改动需要重启 DSH。',
            ),
            settingsView.loading
              ? h(
                  'div',
                  { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', marginBottom: '8px' } },
                  '读取中…',
                )
              : null,
            settingsView.advertise
              ? h(
                  'div',
                  { className: 'dtc-row', style: { marginBottom: '10px' } },
                  h(
                    'div',
                    { style: { flex: 1, fontSize: '12px', wordBreak: 'break-all', color: 'var(--dsw-alias-label-secondary)' } },
                    '本机地址：' + settingsView.advertise,
                  ),
                  h(
                    'button',
                    { className: 'dtc-btn', onClick: () => copy(settingsView.advertise, '已复制本机地址') },
                    '复制',
                  ),
                )
              : null,
            field('member', '成员名（仅显示，作者由令牌决定）'),
            field('project', '默认合作区（未绑定工作区时使用）'),
            field(
              'primary',
              isHost
                ? '主库地址（留空 = 主机；填 http://主机IP:7420 后保存即成为从机）'
                : '主库地址（从机填，例如 http://192.168.1.20:7420）',
            ),
            field(
              'token',
              isHost ? '我的令牌（主机模式不使用）' : '我的令牌',
              isHost
                ? { disabled: true, style: { opacity: 0.5, background: 'var(--dsw-alias-bg-layer-2)' } }
                : undefined,
            ),
            isHost ? field('adminToken', '管理员令牌（只填在主机上）') : null,
            field('peerPort', '端口', { type: 'number' }),
            h(
              'div',
              { style: { margin: '12px 0', padding: '10px', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', fontSize: '12px', lineHeight: 1.7 } },
              h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, '同步状态'),
              h('div', null, '本机节点：' + (settingsView.node || '未启动')),
              h(
                'div',
                null,
                '对端：' +
                  ((settingsView.peers || []).length
                    ? settingsView.peers
                        .map((peer) => peer.url + (peer.online ? ' 在线' : ' 离线') + ' 待同步 ' + peer.pending + (peer.lastError ? ' / ' + peer.lastError : ''))
                        .join('；')
                    : '无（主机为空是正常的，从机应显示主库地址）'),
              ),
              settingsView.lastSync
                ? h('div', null, '上次同步：' + (settingsView.lastSync.at || '从未') + '，成功 ' + settingsView.lastSync.ok + ' 失败 ' + settingsView.lastSync.failed)
                : null,
            ),
            isHost
              ? h(
                  'label',
                  { style: { display: 'flex', gap: '8px', alignItems: 'center', margin: '10px 0', fontSize: '12px' } },
                  h('input', {
                    type: 'checkbox',
                    checked: settingsView.expose === true,
                    onChange: (e) => setSettingsView({ ...settingsView, expose: e.target.checked }),
                  }),
                  '允许其它机器连入（主机勾选，需重启）',
                )
              : null,
            h(
              'label',
              { style: { display: 'flex', gap: '8px', alignItems: 'center', margin: '10px 0', fontSize: '12px' } },
              h('input', {
                type: 'checkbox',
                checked: settingsView.autoBrief !== false,
                onChange: (e) => setSettingsView({ ...settingsView, autoBrief: e.target.checked }),
              }),
              '会话开始时注入团队简报',
            ),
            h(
              'div',
              { className: 'dtc-row' },
              h('button', { className: 'dtc-btn dtc-btn-primary', onClick: saveSettings, disabled: settingsView.busy }, '保存'),
              h('button', { className: 'dtc-btn', onClick: () => setSettingsView(null) }, '关闭'),
              h(
                'button',
                {
                  className: 'dtc-btn',
                  onClick: () =>
                    copy(
                      JSON.stringify(
                        {
                          project: settingsView.project,
                          member: settingsView.member,
                          primary: settingsView.primary,
                          peerPort: settingsView.peerPort,
                          expose: settingsView.expose,
                          node: settingsView.node,
                          advertise: settingsView.advertise,
                          peers: settingsView.peers,
                          lastSync: settingsView.lastSync,
                        },
                        null,
                        2,
                      ),
                      '诊断信息已复制',
                    ),
                },
                '复制诊断',
              ),
              h('div', { className: 'dtc-spacer' }),
              settingsView.msg
                ? h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' } }, settingsView.msg)
                : null,
            ),
          )
        }
        if (memberView && isHost) {
          return h(
            'div',
            { className: 'dtc-detail' },
            settingsTabs('members'),
            h('div', { className: 'dtc-h2' }, isHost ? '成员与令牌' : '成员'),
            h(
              'div',
              { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', marginBottom: '10px' } },
              '每人一个令牌，作者由令牌推导，不能自称。令牌只显示一次，复制后发给对方填进配置。',
            ),
            isHost
              ? h(
                  'div',
                  { className: 'dtc-row', style: { marginBottom: '12px' } },
                  h('input', {
                    className: 'dtc-input',
                    style: { flex: 1 },
                    placeholder: '成员名，例如 张三',
                    value: memberView.newName || '',
                    onChange: (e) => setMemberView({ ...memberView, newName: e.target.value }),
                  }),
                  h('button', { className: 'dtc-btn', onClick: addMember, disabled: memberView.busy }, '添加成员'),
                )
              : null,
            memberView.token
              ? h(
                  'div',
                  {
                    className: 'dtc-banner',
                    style: {
                      borderColor: 'var(--dsw-alias-brand-primary)',
                      color: 'var(--dsw-alias-label-primary)',
                    },
                  },
                  h('div', { style: { flex: 1, wordBreak: 'break-all' } }, '令牌：' + memberView.token),
                  h('button', { className: 'dtc-btn', onClick: () => copy(memberView.token, '令牌已复制') }, '复制'),
                )
              : null,
            memberView.msg
              ? h('div', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px' } }, memberView.msg)
              : null,
            (memberView.members || []).length
              ? memberView.members.map((member) =>
                  h(
                    'div',
                    {
                      key: member.id,
                      style: {
                        display: 'flex',
                        gap: '10px',
                        alignItems: 'center',
                        padding: '8px 0',
                        borderBottom: '1px solid var(--dsw-alias-border-l1)',
                      },
                    },
                    h(
                      'div',
                      { style: { flex: 1 } },
                      h('div', { style: { fontWeight: 500 } }, member.name),
                      h(
                        'div',
                        { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } },
                        member.role + ' · ' + String(member.createdAt || '').slice(0, 10),
                      ),
                    ),
                    isHost
                      ? [
                          h(
                            'button',
                            { key: 'rotate', className: 'dtc-btn', onClick: () => rotateMember(member.id), disabled: memberView.busy },
                            '重置令牌',
                          ),
                          h(
                            'button',
                            { key: 'delete', className: 'dtc-btn', onClick: () => deleteMember(member.id), disabled: memberView.busy },
                            '删除',
                          ),
                        ]
                      : h(
                          'span',
                          {
                            style: {
                              fontSize: '11px',
                              color: member.disabled
                                ? 'var(--dsw-alias-state-error-primary)'
                                : 'var(--dsw-alias-state-success-primary)',
                            },
                          },
                          member.disabled ? '已禁用' : '正常',
                        ),
                  ),
                )
              : h(
                  'div',
                  { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' } },
                  '还没有成员。用上面的表单创建，把令牌发给对方。',
                ),
            h(
              'div',
              { style: { marginTop: '16px' } },
              h('button', { className: 'dtc-btn', onClick: () => setMemberView(null) }, '关闭'),
            ),
          )
        }
        if (fileView) {
          return h('div', { className: 'dtc-detail' }, renderFilePreview())
        }

        if (zoneView) {
          return h(
            'div',
            { className: 'dtc-detail' },
            settingsTabs('zones'),
            h('div', { className: 'dtc-h2' }, '合作区'),
            h(
              'div',
              { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', marginBottom: '14px' } },
              '把工作区绑定到合作区后，该目录下的所有会话共享同一个记录池。',
            ),
            (() => {
              const grouped = {}
              for (const binding of zoneView.zones || []) {
                if (!grouped[binding.project]) grouped[binding.project] = []
                grouped[binding.project].push(binding.cwd)
              }
              const names = [...new Set([...(zoneView.available || []), ...Object.keys(grouped)])]
              if (zoneView.loading && !names.length) {
                return h(
                  'div',
                  { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' } },
                  '读取中…',
                )
              }
              if (!names.length) {
                return h(
                  'div',
                  { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' } },
                  '还没有合作区。先在主机上创建一个，再把工作区绑进去。',
                )
              }
              return names.map((name) =>
                h(
                  'div',
                  { key: name, style: { marginTop: '12px' } },
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'baseline', gap: '8px' } },
                    h('div', { style: { fontWeight: 600 } }, name),
                    h(
                      'span',
                      { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } },
                      (grouped[name] || []).length + ' 个工作区',
                    ),
                    h('div', { style: { flex: 1 } }),
                    isHost
                      ? h('button', { className: 'dtc-btn', onClick: () => removeZone(name) }, '删除')
                      : null,
                  ),
                  (grouped[name] || []).length
                    ? grouped[name].map((cwd) =>
                        h(
                          'div',
                          {
                            key: cwd,
                            style: {
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                              padding: '6px 0 6px 12px',
                              borderBottom: '1px solid var(--dsw-alias-border-l1)',
                            },
                          },
                          h(
                            'div',
                            {
                              style: {
                                flex: 1,
                                minWidth: 0,
                                fontSize: '12px',
                                wordBreak: 'break-all',
                                color: 'var(--dsw-alias-label-secondary)',
                              },
                            },
                            cwd,
                          ),
                          h('button', { className: 'dtc-btn', onClick: () => unbindZone(cwd) }, '解除'),
                        ),
                      )
                    : h(
                        'div',
                        {
                          style: {
                            fontSize: '11px',
                            color: 'var(--dsw-alias-label-secondary)',
                            padding: '6px 0 0 12px',
                          },
                        },
                        '还没有工作区绑定到这个名字',
                      ),
                ),
              )
            })(),
            h(
              'div',
              { style: { marginTop: '18px', paddingTop: '14px', borderTop: '1px solid var(--dsw-alias-border-l1)' } },
              h('div', { className: 'dtc-label' }, '主机上的合作区'),
              h(
                'div',
                { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', marginBottom: '6px' } },
                '成员在会话 "..." 菜单里从这里选，选完该工作区就加入这个合作区。',
              ),
              (zoneView.available || []).length
                ? zoneView.available.map((name) =>
                    h('div', { key: name, style: { fontSize: '12px', padding: '3px 0' } }, name),
                  )
                : h(
                    'div',
                    { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } },
                    '还没有合作区。',
                  ),
              sync && sync.isHost === false
                ? h(
                    'div',
                    { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', marginTop: '6px' } },
                    '合作区由主机创建，成员只能加入。',
                  )
                : h(
                    'div',
                    { className: 'dtc-row', style: { marginTop: '8px' } },
                    h('input', {
                      className: 'dtc-input',
                      style: { flex: 1 },
                      placeholder: '新合作区名，例如 motor-f407',
                      value: zoneView.newName || '',
                      onChange: (e) => setZoneView({ ...zoneView, newName: e.target.value }),
                    }),
                    h('button', { className: 'dtc-btn', onClick: createZone }, '创建'),
                  ),
            ),
            h(
              'div',
              { style: { marginTop: '18px', paddingTop: '14px', borderTop: '1px solid var(--dsw-alias-border-l1)' } },
              h('div', { className: 'dtc-label' }, '绑定工作区'),
              h(
                'div',
                { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', marginBottom: '6px' } },
                '把这个目录下的所有会话加入选中的合作区。',
              ),
              h(
                'div',
                { className: 'dtc-row' },
                h('input', {
                  className: 'dtc-input',
                  style: { flex: 2, minWidth: '200px' },
                  placeholder: 'D:\\Work\\Motor',
                  value: zoneView.bindPath || '',
                  onChange: (e) => setZoneView({ ...zoneView, bindPath: e.target.value }),
                }),
                h(
                  'button',
                  {
                    className: 'dtc-btn',
                    onClick: async () => {
                      try {
                        const data = await api('/pick-directory', { method: 'POST' })
                        if (data && data.path) setZoneView((view) => ({ ...(view || {}), bindPath: data.path }))
                      } catch (e) {
                        setError(String((e && e.message) || e))
                      }
                    },
                  },
                  '浏览…',
                ),
                h(
                  'select',
                  {
                    className: 'dtc-select',
                    value: zoneView.bindProject || '',
                    onChange: (e) => setZoneView({ ...zoneView, bindProject: e.target.value }),
                  },
                  (zoneView.available || []).map((name) => h('option', { key: name, value: name }, name)),
                ),
                h('button', { className: 'dtc-btn dtc-btn-primary', onClick: bindPath }, '绑定'),
              ),
            ),
            h(
              'div',
              { style: { marginTop: '16px' } },
              h('button', { className: 'dtc-btn', onClick: () => setZoneView(null) }, '关闭'),
            ),
          )
        }
        if (creating) {
          return h(
            'div',
            { className: 'dtc-detail' },
            h('div', { className: 'dtc-h2' }, '新建记录'),
            h(
              'div',
              { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', marginBottom: '14px' } },
              '记录会以「待审」保存；确认无误后可在详情里改为「已验证」。',
            ),
            h(
              'div',
              { className: 'dtc-form' },
              h(
                'div',
                null,
                h('div', { className: 'dtc-label' }, '标题'),
                h('input', {
                  className: 'dtc-input',
                  value: form.title,
                  placeholder: '一句话说清结论，例如：USART1 在 500k 波特率下 DMA 会丢首字节',
                  onChange: (e) => setForm({ ...form, title: e.target.value }),
                }),
              ),
              h(
                'div',
                null,
                h('div', { className: 'dtc-label' }, '正文'),
                h('textarea', {
                  className: 'dtc-textarea',
                  value: form.body,
                  placeholder: '结论、适用条件、怎么验证的。200–600 字即可。',
                  onChange: (e) => setForm({ ...form, body: e.target.value }),
                }),
              ),
              h(
                'div',
                { className: 'dtc-row' },
                h(
                  'select',
                  {
                    className: 'dtc-select',
                    value: form.project || defaultZone(),
                    onChange: (e) => setForm({ ...form, project: e.target.value }),
                  },
                  ((sync && sync.projects) || [defaultZone()]).map((name) => h('option', { key: name, value: name }, name)),
                ),
                h(
                  'select',
                  {
                    className: 'dtc-select',
                    value: form.kind,
                    onChange: (e) => setForm({ ...form, kind: e.target.value }),
                  },
                  KINDS.map(([v, label]) => h('option', { key: v, value: v }, label)),
                ),
                h('div', { className: 'dtc-spacer' }),
                h(
                  'button',
                  { className: 'dtc-btn', onClick: () => setCreating(false), disabled: busy },
                  '取消',
                ),
                h(
                  'button',
                  { className: 'dtc-btn dtc-btn-primary', onClick: submitNew, disabled: busy },
                  busy ? '保存中…' : '保存',
                ),
              ),
            ),
          )
        }
        if (!selected || !detail) {
          return h(
            'div',
            { className: 'dtc-empty' },
            h('div', { style: { fontSize: '15px', fontWeight: '500' } }, '选择左侧一条记录'),
            h('div', null, '这里显示正文、适用范围和证据，并可以审核状态。'),
            h('div', { style: { fontSize: '12px' } }, '记录越短越容易被 AI 精确命中。'),
          )
        }
        const r = detail
        return h(
          'div',
          { className: 'dtc-detail' },
          h(
            'div',
            { className: 'dtc-meta', style: { marginBottom: '8px' } },
            h(Badge, { color: 'var(--dsw-alias-border-l2)' }, KIND_LABEL[r.kind] || r.kind),
            h(Badge, { color: statusColor(r.status) }, STATUS_LABEL[r.status] || r.status),
            h('span', null, r.project),
          ),
          h('h2', { className: 'dtc-h2' }, r.title),
          h(
            'div',
            { className: 'dtc-meta' },
            h('span', null, r.author),
            h('span', null, stamp(r.updatedAt)),
            h('span', { style: { fontFamily: 'monospace' } }, r.id),
          ),
          h('div', { className: 'dtc-bodytext' }, r.body),
          r.scope && Object.keys(r.scope).length
            ? h(
                'div',
                null,
                h('div', { className: 'dtc-label' }, '适用范围'),
                r.scope.board ? h('div', { className: 'dtc-kv' }, h('b', null, '板卡'), h('span', null, r.scope.board)) : null,
                r.scope.mcu ? h('div', { className: 'dtc-kv' }, h('b', null, '芯片'), h('span', null, r.scope.mcu)) : null,
                r.scope.toolchain
                  ? h('div', { className: 'dtc-kv' }, h('b', null, '工具链'), h('span', null, r.scope.toolchain))
                  : null,
                Array.isArray(r.scope.paths) && r.scope.paths.length
                  ? h('div', { className: 'dtc-kv' }, h('b', null, '路径'), h('span', null, r.scope.paths.join('  ')))
                  : null,
              )
            : null,
          Array.isArray(r.evidence) && r.evidence.length
            ? h(
                'div',
                { style: { marginTop: '14px' } },
                h('div', { className: 'dtc-label' }, '证据'),
                h(
                  'ul',
                  { className: 'dtc-evidence' },
                  r.evidence.map((e, i) =>
                    h('li', { key: i }, '[' + e.type + '] ' + e.label + (e.ref ? '  (' + e.ref + ')' : '')),
                  ),
                ),
              )
            : null,
          Array.isArray(r.history) && r.history.length
            ? h(
                'div',
                { style: { marginTop: '14px' } },
                h('div', { className: 'dtc-label' }, '历史'),
                h(
                  'ul',
                  { className: 'dtc-evidence' },
                  r.history.slice(-10).map((entry, i) =>
                    h(
                      'li',
                      { key: i },
                      String(entry.at || '').slice(0, 16).replace('T', ' ') +
                        ' · ' +
                        (entry.by || '?') +
                        ' · ' +
                        (entry.action || '') +
                        (entry.from && entry.to ? ' ' + entry.from + '→' + entry.to : '') +
                        (entry.note ? ' · ' + entry.note : ''),
                    ),
                  ),
                ),
              )
            : null,
          h(
            'div',
            { className: 'dtc-actions' },
            h(
              'button',
              {
                className: 'dtc-btn dtc-btn-primary',
                disabled: busy || r.status === 'verified',
                onClick: () => patchStatus(r.id, 'verified'),
              },
              '通过验证',
            ),
            h(
              'button',
              {
                className: 'dtc-btn',
                disabled: busy || r.status === 'stale',
                onClick: () => patchStatus(r.id, 'stale'),
              },
              '标记失效',
            ),
            h(
              'button',
              {
                className: 'dtc-btn',
                disabled: busy,
                onClick: () => patchStatus(r.id, 'draft'),
              },
              '退回待审',
            ),
            isHost
              ? h(
                  'button',
                  {
                    className: 'dtc-btn',
                    disabled: busy,
                    onClick: () => deleteRecord(r.id),
                  },
                  '删除',
                )
              : null,
            h('div', { className: 'dtc-spacer' }),
            h('button', { className: 'dtc-btn', onClick: () => copy(r.id, '已复制记录 id') }, '复制 id'),
            h(
              'button',
              {
                className: 'dtc-btn',
                onClick: () => copy('团队记录 ' + r.id + '：' + r.title + '（用 team_get 读取全文）', '已复制引用'),
              },
              '在会话引用',
            ),
          ),
        )
      }

      const peer = sync && Array.isArray(sync.sync) ? sync.sync[0] : null
      const pending = sync && typeof sync.pending === 'number' ? sync.pending : 0
      const connected = peer ? Boolean(peer.online) : Boolean(cfg && cfg.online)
      const dotColor = !cfg
        ? 'var(--dsw-alias-state-idle-primary)'
        : !connected
          ? 'var(--dsw-alias-state-error-primary)'
          : pending > 0
            ? 'var(--dsw-alias-state-warn-primary)'
            : 'var(--dsw-alias-state-success-primary)'
      const peerError = (peer && peer.lastError) || (sync && sync.error) || ''
      const selectedPaths = Object.keys((fileView && fileView.selected) || {}).filter(
        (key) => fileView.selected[key],
      )
      const protectedSelected = ((fileView && fileView.files) || []).filter(
        (file) => selectedPaths.includes(file.path) && isProtectedFile(file),
      ).length
      const allSelected = Boolean(
        fileView &&
          fileView.files &&
          fileView.files.length &&
          fileView.files.every((file) => fileView.selected && fileView.selected[file.path]),
      )
      const statusText = cfg
        ? (cfg.primary
            ? '主库 ' + cfg.primary
            : '本机 ' + ((sync && sync.advertise) || cfg.hubUrl || '')) +
          (pending > 0 ? ' · 待同步 ' + pending : connected ? ' · 已同步' : ' · 未连接') +
          (connected ? '' : peerError ? ' · ' + String(peerError).slice(0, 48) : '') +
          ' · ' + cfg.project + ' · ' + cfg.member
        : '正在读取配置…'

      return h(
        'div',
        { className: 'dtc-root' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'dtc-head' },
          h('div', { className: 'dtc-title' }, '团队共享'),
          h(
            'div',
            { className: 'dtc-sub', title: peerError || (sync && sync.advertise ? '本机地址 ' + sync.advertise : '') },
            h('span', null, h('span', { className: 'dtc-dot', style: { background: dotColor } }), statusText),
          ),
          h('div', { className: 'dtc-spacer' }),
          creating || zoneView || memberView || settingsView || (mode === 'records' && fileView)
            ? h('button', { className: 'dtc-btn', onClick: closeViews }, '关闭')
            : null,
          h('button', { className: 'dtc-btn', onClick: openSettings }, '设置'),
          h('button', { className: 'dtc-btn', onClick: () => { if (mode === 'files') { scanFiles() } else if (loadRef.current) { loadRef.current() } } }, '刷新'),
          mode === 'records'
            ? h(
                'button',
                {
                  className: 'dtc-btn dtc-btn-primary',
                  onClick: () => {
                    closeViews()
                    setForm({ title: '', body: '', kind: 'fact', project: defaultZone() })
                    setCreating(true)
                    setSelected(null)
                  },
                },
                '新建记录',
              )
            : null,
        ),
        h(
          'div',
          { className: 'dtc-switch' },
          h(
            'button',
            {
              className: 'dtc-switch-btn' + (mode === 'records' ? ' on' : ''),
              onClick: () => {
                setMode('records')
                closeViews()
              },
            },
            '消息',
          ),
          h(
            'button',
            {
              className: 'dtc-switch-btn' + (mode === 'files' ? ' on' : ''),
              onClick: () => {
                setMode('files')
                closeViews()
                openFiles()
              },
            },
            filePending > 0 ? '文件 · ' + filePending : '文件',
          ),
        ),
        error
          ? h(
              'div',
              { className: 'dtc-banner' },
              h('span', null, error),
              h('div', { className: 'dtc-spacer' }),
              h('button', { className: 'dtc-btn', onClick: () => { setError(''); loadRef.current && loadRef.current() } }, '重试'),
            )
          : null,
        h(
          'div',
          { className: 'dtc-toolbar', style: { display: mode === 'files' ? 'none' : 'flex' } },
          h('input', {
            className: 'dtc-search',
            value: q,
            placeholder: '搜索标题、正文、标签（支持中文）',
            onChange: (e) => setQ(e.target.value),
          }),          [['all', '全部']].concat(STATUS).map(([v, label]) =>
            h(
              'button',
              {
                key: v,
                className: 'dtc-chip' + (status === v ? ' on' : ''),
                onClick: () => setStatus(v),
              },
              label,
            ),
          ),
          h(
            'select',
            {
              className: 'dtc-select',
              value: projectFilter,
              onChange: (e) => setProjectFilter(e.target.value),
            },
            h('option', { value: 'all' }, '全部合作区'),
            ((sync && sync.projects) || []).map((project) => h('option', { key: project, value: project }, project)),
          ),
          h(
            'select',
            { className: 'dtc-select', value: kind, onChange: (e) => setKind(e.target.value) },
            h('option', { value: 'all' }, '全部类型'),
            KINDS.map(([v, label]) => h('option', { key: v, value: v }, label)),
          ),
        ),
        mode === 'files'
          ? h(
              'div',
              { className: 'dtc-toolbar' },
              h('input', {
                className: 'dtc-search',
                value: (fileView && fileView.root) || '',
                placeholder: '工作区目录，例如 D:\\Project\\Motor',
                onChange: (e) => {
                  const root = e.target.value
                  setFileView({ ...(fileView || {}), root })
                  if (/^[A-Za-z]:[\\/]/.test(root) || /^\\\\/.test(root) || /^\//.test(root)) {
                    window.localStorage.setItem('collab.fileRoot', root)
                  }
                },
              }),
              h(
                'button',
                {
                  className: 'dtc-btn',
                  onClick: async () => {
                    try {
                      const data = await api('/pick-directory', { method: 'POST' })
                      if (data && data.path) {
                        window.localStorage.setItem('collab.fileRoot', data.path)
                        const next = { ...(fileView || {}), root: data.path, files: null, selected: {}, msg: '' }
                        setFileView(next)
                        scanFiles(next)
                      }
                    } catch (e) {
                      setError(String((e && e.message) || e))
                    }
                  },
                },
                '浏览…',
              ),
              h('button', { className: 'dtc-btn', onClick: scanFiles, disabled: !!(fileView && fileView.busy) }, '扫描'),
              h(
                'button',
                {
                  className: 'dtc-btn',
                  onClick: () => {
                    if (allSelected) {
                      setFileView({ ...(fileView || {}), selected: {} })
                      return
                    }
                    if (!fileView || !fileView.files) return
                    const all = {}
                    for (const file of fileView.files) all[file.path] = true
                    setFileView({ ...fileView, selected: all })
                  },
                },
                allSelected ? '全不选' : '全选',
              ),
              h(
                'button',
                {
                  className: 'dtc-btn',
                  title: '勾选本机改过、还没上传的文件（仅本地 + 本地更新）',
                  onClick: () => selectByFileStatus((file) => isProtectedFile(file)),
                },
                '选本机未上传',
              ),
              h(
                'button',
                {
                  className: 'dtc-btn',
                  title: '勾选远端有更新的文件（远端更新 + 待下载）',
                  onClick: () =>
                    selectByFileStatus(
                      (file) => file.status === 'remote' || (file.status === 'changed' && file.mtime <= (file.remoteMtime || 0)),
                    ),
                },
                '选远端更新',
              ),
              h(
                'button',
                {
                  className: 'dtc-btn',
                  onClick: () => syncFileView('pull'),
                  disabled: !!(fileView && fileView.busy) || !(sync && sync.isHost === false),
                  title: !(sync && sync.isHost === false)
                    ? '主机是发布方，没有可拉取的远端；请用「上传选中」'
                    : protectedSelected
                      ? '选中的 ' + protectedSelected + ' 个文件本机未上传，更新会覆盖'
                      : undefined,
                  style:
                    !(sync && sync.isHost === false) || protectedSelected
                      ? {
                          opacity: 0.55,
                          background: 'var(--dsw-alias-bg-layer-2)',
                          color: 'var(--dsw-alias-label-secondary)',
                        }
                      : undefined,
                },
                '更新选中',
              ),
              h(
                'button',
                { className: 'dtc-btn', onClick: () => syncFileView('push'), disabled: !!(fileView && fileView.busy) },
                '上传选中',
              ),
              fileView && fileView.msg
                ? h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, fileView.msg)
                : null,
            )
          : null,
        h(
          'div',
          { className: 'dtc-body' },
          mode === 'files'
            ? h(
                'div',
                { className: 'dtc-list' },
                h(
                  'div',
                  {
                    style: {
                      padding: '6px 10px',
                      fontSize: '12px',
                      color: 'var(--dsw-alias-label-secondary)',
                      borderBottom: '1px solid var(--dsw-alias-border-l1)',
                      display: 'flex',
                      gap: '8px',
                    },
                  },
                  h('span', null, '共 ' + ((fileView && fileView.files && fileView.files.length) || 0) + ' 个'),
                  h(
                    'span',
                    {
                      style: {
                        color:
                          fileView && fileView.files && fileView.files.some((file) => file.status !== 'synced')
                            ? 'var(--dsw-alias-state-warn-primary)'
                            : 'var(--dsw-alias-label-secondary)',
                      },
                    },
                    '待更新 ' +
                      ((fileView && fileView.files && fileView.files.filter((file) => file.status !== 'synced').length) || 0),
                  ),
                ),
                renderFileList(),
              )
            : h('div', { className: 'dtc-list' }, renderList()),
          renderDetail(),
        ),
        toast ? h('div', { className: 'dtc-toast' }, toast) : null,
      )
    }

    // Sidebar world: the shell owns the button and navigation; this half only
    // draws the icon and renders the page under the matching main key.
    function TeamIcon(props) {
      const size = (props && props.size) || 20
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('circle', { cx: 6, cy: 7, r: 2.4 }),
        h('circle', { cx: 18, cy: 7, r: 2.4 }),
        h('circle', { cx: 12, cy: 17, r: 2.4 }),
        h('path', { d: 'M8 8.2 10.6 15M16 8.2 13.4 15M8.4 7h7.2' }),
      )
    }

    function TeamPage(props) {
      return h(
        'div',
        { style: { padding: '20px 24px', height: '100%', boxSizing: 'border-box', minHeight: 0 } },
        h(Panel, props),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: 'team-context',
              order: 5,
              label: '团队共享',
            },
            TeamIcon,
          ),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: 'team-context',
            },
            TeamPage,
          ),
        )
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'team-context',
              order: 30,
              label: '团队共享',
            },
            Panel,
          ),
        )
      },
    }
  },
})

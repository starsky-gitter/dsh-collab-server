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
      const [memberView, setMemberView] = useState(null)
      const [settingsView, setSettingsView] = useState(null)
      const [form, setForm] = useState({ title: '', body: '', kind: 'fact' })
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
        }, 20000)
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
          await api('/records/' + encodeURIComponent(id), {
            method: 'PATCH',
            body: JSON.stringify({ status: next }),
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
        setFileView({ root: (zones[0] && zones[0].cwd) || '', files: null, busy: false, msg: '', selected: {} })
        setZoneView(null)
        setMemberView(null)
        setSettingsView(null)
        setCreating(false)
        setSelected(null)
      }

      async function scanFiles() {
        const view = fileView
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
        } catch (e) {
          setFileView({ ...view, busy: false, msg: String((e && e.message) || e) })
        }
      }

      async function syncFileView(direction) {
        const view = fileView
        if (!view || !view.root || !view.files) return
        const paths = Object.keys(view.selected || {}).filter((key) => view.selected[key])
        setFileView({ ...view, busy: true, msg: '同步中…' })
        try {
          const data = await api('/files/sync', {
            method: 'POST',
            body: JSON.stringify({ root: view.root, project: projectForRoot(view.root), paths, direction }),
          })
          setFileView({ ...view, busy: false, msg: '完成：下载 ' + data.pulled + '，上传 ' + data.pushed })
          await scanFiles()
        } catch (e) {
          setFileView({ ...view, busy: false, msg: String((e && e.message) || e) })
        }
      }

      async function openSettings() {
        setFileView(null)
        setZoneView(null)
        setMemberView(null)
        setCreating(false)
        setSelected(null)
        try {
          setSettingsView(await api('/settings'))
        } catch (e) {
          setError(String((e && e.message) || e))
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
        try {
          setZoneView(await api('/zones'))
          setFileView(null)
          setMemberView(null)
          setSettingsView(null)
          setCreating(false)
          setSelected(null)
          setError('')
        } catch (e) {
          setError(String((e && e.message) || e))
        }
      }

      async function unbindZone(cwd) {
        try {
          await api('/zones', { method: 'DELETE', body: JSON.stringify({ cwd }) })
          setZoneView(await api('/zones'))
          setToast('已解除绑定')
        } catch (e) {
          setError(String((e && e.message) || e))
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
              project: cfg.project,
              title: form.title,
              body: form.body,
              kind: form.kind,
              status: 'draft',
            }),
          })
          setCreating(false)
          setForm({ title: '', body: '', kind: 'fact' })
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

      function renderDetail() {
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
            h('div', { className: 'dtc-h2' }, '设置'),
            h(
              'div',
              { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', marginBottom: '12px' } },
              '保存在本机；令牌和地址立即生效，端口改动需要重启 DSH。',
            ),
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
            field('primary', '主库地址（从机填，例如 http://192.168.1.20:7420）'),
            field('token', '我的令牌'),
            field('adminToken', '管理员令牌（只填在主机上）'),
            field('peerPort', '端口', { type: 'number' }),
            h(
              'label',
              { style: { display: 'flex', gap: '8px', alignItems: 'center', margin: '10px 0', fontSize: '12px' } },
              h('input', {
                type: 'checkbox',
                checked: settingsView.expose === true,
                onChange: (e) => setSettingsView({ ...settingsView, expose: e.target.checked }),
              }),
              '允许其它机器连入（主机勾选，需重启）',
            ),
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
              h('div', { className: 'dtc-spacer' }),
              settingsView.msg
                ? h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' } }, settingsView.msg)
                : null,
            ),
          )
        }
        if (memberView) {
          return h(
            'div',
            { className: 'dtc-detail' },
            h('div', { className: 'dtc-h2' }, '成员与令牌'),
            h(
              'div',
              { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', marginBottom: '10px' } },
              '每人一个令牌，作者由令牌推导，不能自称。令牌只显示一次，复制后发给对方填进配置。',
            ),
            h(
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
            ),
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
                    h(
                      'button',
                      { className: 'dtc-btn', onClick: () => rotateMember(member.id), disabled: memberView.busy },
                      '重置令牌',
                    ),
                    h(
                      'button',
                      { className: 'dtc-btn', onClick: () => deleteMember(member.id), disabled: memberView.busy },
                      '删除',
                    ),
                  ),
                )
              : h(
                  'div',
                  { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' } },
                  '还没有成员。用上面的表单创建，把令牌发给对方。',
                ),
          )
        }
        if (fileView) {
          const pending = (fileView.files || []).filter((file) => file.status !== 'synced').length
          return h(
            'div',
            { className: 'dtc-detail' },
            h('div', { className: 'dtc-h2' }, '文件同步'),
            h(
              'div',
              { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', marginBottom: '10px' } },
              '勾选文件后：「更新」从主库下载，「上传」把本地改动推给主库。只传哈希不同的文件。',
            ),
            h(
              'div',
              { className: 'dtc-row', style: { marginBottom: '10px' } },
              h('input', {
                className: 'dtc-input',
                style: { flex: 1, minWidth: '220px' },
                value: fileView.root,
                placeholder: '工作区目录，例如 D:\\Project\\Motor',
                onChange: (e) => setFileView({ ...fileView, root: e.target.value }),
              }),
              h('button', { className: 'dtc-btn', onClick: scanFiles, disabled: fileView.busy }, '扫描'),
              h('button', { className: 'dtc-btn', onClick: () => setFileView(null) }, '关闭'),
            ),
            fileView.msg
              ? h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', marginBottom: '8px' } }, fileView.msg)
              : null,
            fileView.files
              ? h(
                  'div',
                  null,
                  h(
                    'div',
                    { className: 'dtc-row', style: { marginBottom: '8px' } },
                    h('button', { className: 'dtc-btn', onClick: () => syncFileView('pull'), disabled: fileView.busy }, '更新选中'),
                    h('button', { className: 'dtc-btn', onClick: () => syncFileView('push'), disabled: fileView.busy }, '上传选中'),
                    h(
                      'button',
                      {
                        className: 'dtc-btn',
                        onClick: () => {
                          const all = {}
                          for (const file of fileView.files) all[file.path] = true
                          setFileView({ ...fileView, selected: all })
                        },
                      },
                      '全选',
                    ),
                    h('div', { className: 'dtc-spacer' }),
                    h(
                      'span',
                      { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' } },
                      '共 ' + fileView.files.length + ' 个，待同步 ' + pending + ' 个',
                    ),
                  ),
                  fileView.files.map((file) =>
                    h(
                      'label',
                      {
                        key: file.path,
                        style: {
                          display: 'flex',
                          gap: '8px',
                          alignItems: 'center',
                          padding: '4px 0',
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
                      h('span', { style: { flex: 1, wordBreak: 'break-all' } }, file.path),
                      h(
                        'span',
                        {
                          style: {
                            color:
                              file.status === 'synced'
                                ? 'var(--dsw-alias-state-success-primary)'
                                : file.status === 'changed'
                                  ? 'var(--dsw-alias-state-warn-primary)'
                                  : 'var(--dsw-alias-label-secondary)',
                          },
                        },
                        file.status === 'synced' ? '已同步' : file.status === 'changed' ? '有差异' : '仅本地',
                      ),
                      h(
                        'span',
                        { style: { color: 'var(--dsw-alias-label-secondary)', minWidth: '64px', textAlign: 'right' } },
                        (file.size / 1024).toFixed(1) + ' KB',
                      ),
                    ),
                  ),
                )
              : null,
          )
        }
        if (zoneView) {
          return h(
            'div',
            { className: 'dtc-detail' },
            h('div', { className: 'dtc-h2' }, '合作区'),
            h(
              'div',
              { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', marginBottom: '14px' } },
              '把工作区绑定到合作区后，该目录下的所有会话共享同一个记录池。',
            ),
            zoneView.zones && zoneView.zones.length
              ? zoneView.zones.map((zone) =>
                  h(
                    'div',
                    {
                      key: zone.cwd,
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '10px 0',
                        borderBottom: '1px solid var(--dsw-alias-border-l1)',
                      },
                    },
                    h(
                      'div',
                      { style: { flex: 1, minWidth: 0 } },
                      h('div', { style: { fontWeight: 500 } }, zone.project),
                      h(
                        'div',
                        {
                          style: {
                            fontSize: '11px',
                            color: 'var(--dsw-alias-label-secondary)',
                            wordBreak: 'break-all',
                          },
                        },
                        zone.cwd,
                      ),
                    ),
                    h('button', { className: 'dtc-btn', onClick: () => unbindZone(zone.cwd) }, '解除绑定'),
                  ),
                )
              : h(
                  'div',
                  { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' } },
                  '还没有绑定任何工作区。在会话 "..." 菜单里点「加入团队合作区」。',
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
      const statusText = cfg
        ? (cfg.primary
            ? '主库 ' + cfg.primary
            : '本机 ' + ((sync && sync.advertise) || cfg.hubUrl || '')) +
          (pending > 0 ? ' · 待同步 ' + pending : ' · 已同步') +
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
            { className: 'dtc-sub', title: sync && sync.advertise ? '本机地址 ' + sync.advertise : '' },
            h('span', null, h('span', { className: 'dtc-dot', style: { background: dotColor } }), statusText),
          ),
          h('div', { className: 'dtc-spacer' }),
          h('button', { className: 'dtc-btn', onClick: openSettings }, '设置'),
          h('button', { className: 'dtc-btn', onClick: openMembers }, '成员'),
          h('button', { className: 'dtc-btn', onClick: openFiles }, '文件'),
          h('button', { className: 'dtc-btn', onClick: openZones }, '合作区'),
          h('button', { className: 'dtc-btn', onClick: () => loadRef.current && loadRef.current() }, '刷新'),
          h(
            'button',
            {
              className: 'dtc-btn dtc-btn-primary',
              onClick: () => {
                setCreating(true)
                setSelected(null)
              },
            },
            '新建记录',
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
          { className: 'dtc-toolbar' },
          h('input', {
            className: 'dtc-search',
            value: q,
            placeholder: '搜索标题、正文、标签（支持中文）',
            onChange: (e) => setQ(e.target.value),
          }),
          [['all', '全部']].concat(STATUS).map(([v, label]) =>
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
        h('div', { className: 'dtc-body' }, h('div', { className: 'dtc-list' }, renderList()), renderDetail()),
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

    function ZoneMenu(props) {
      const [state, setState] = useState('loading')
      const [hover, setHover] = useState(false)
      const [zone, setZone] = useState(null)

      useEffect(() => {
        let alive = true
        const id = props && props.sessionId
        if (!id) {
          setState('idle')
          return undefined
        }
        fetch('/team-api/zones?sessionId=' + encodeURIComponent(id))
          .then((res) => res.json())
          .then((data) => {
            if (!alive) return
            const current = data && data.current
            setZone(current || null)
            setState(current && current.bound ? 'bound' : 'idle')
          })
          .catch(() => {
            if (alive) setState('idle')
          })
        return () => {
          alive = false
        }
      }, [props && props.sessionId])

      function dismiss() {
        try {
          if (props && typeof props.close === 'function') return props.close()
          if (props && props.menuOpenState && typeof props.menuOpenState.close === 'function') return props.menuOpenState.close()
          if (props && typeof props.closeMenu === 'function') return props.closeMenu()
        } catch {
          // fall through to the keyboard path
        }
        try {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        } catch {
          // nothing else to try
        }
      }

      async function act() {
        setState('busy')
        try {
          if (state === 'bound') {
            const res = await fetch('/team-api/zones', {
              method: 'DELETE',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ cwd: zone && zone.cwd }),
            })
            if (!res.ok) throw new Error('HTTP ' + res.status)
            setZone(null)
            setState('idle')
          } else {
            const res = await fetch('/team-api/zones', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ sessionId: props && props.sessionId }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error((data && data.error) || 'HTTP ' + res.status)
            setZone({ cwd: data.cwd, project: data.project, bound: true })
            setState('bound')
          }
          dismiss()
        } catch {
          setState('error')
        }
      }

      const label =
        state === 'loading'
          ? '读取合作区…'
          : state === 'busy'
            ? '处理中…'
            : state === 'bound'
              ? '移出合作区：' + ((zone && zone.project) || '')
              : state === 'error'
                ? '操作失败，点此重试'
                : '加入团队合作区'

      return h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          onClick: act,
          disabled: state === 'busy' || state === 'loading',
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          style: {
            display: 'block',
            width: '100%',
            boxSizing: 'border-box',
            textAlign: 'left',
            padding: '6px 10px',
            margin: 0,
            border: 'none',
            borderRadius: '6px',
            cursor: state === 'busy' || state === 'loading' ? 'default' : 'pointer',
            fontSize: '12px',
            background: hover ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
            color: 'var(--dsw-alias-label-primary)',
            opacity: state === 'busy' || state === 'loading' ? 0.6 : 1,
          },
        },
        label,
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
        ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
          ctx.slots.register(
            {
              name: 'sidebar.workspaces.session.menu.item',
              id: 'team-zone',
              order: 500,
              label: '加入团队合作区',
            },
            ZoneMenu,
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

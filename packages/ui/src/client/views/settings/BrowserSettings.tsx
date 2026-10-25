import { useState } from 'react'
import { DEFAULT_SITE_RULES, SITE_MODE_LABELS, type PodSettings, type SiteMode, type SiteRule } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { Badge, Button, IconButton } from '../../components/common.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

const MODES = Object.keys(SITE_MODE_LABELS) as SiteMode[]

/** 站点规则：每个网站可以设为禁止、只读、写操作需审批、免审批；改完点保存才生效。 */
function SiteRules(props: { readonly rules: readonly SiteRule[]; readonly onSave: (rules: readonly SiteRule[]) => void }) {
  const [draft, setDraft] = useState<readonly SiteRule[]>(props.rules)
  const dirty = JSON.stringify(draft) !== JSON.stringify(props.rules)
  const change = (index: number, patch: Partial<SiteRule>): void => setDraft((rules) => rules.map((rule, at) => (at === index ? { ...rule, ...patch } : rule)))
  return (
    <div className="pod-site-rules">
      {draft.map((rule, index) => (
        <div key={index} className="pod-site-rule">
          <input className="pod-input" value={rule.pattern} placeholder="example.com 或 *.example.com" onChange={(event) => change(index, { pattern: event.target.value })} />
          <select className="pod-input" value={rule.mode} onChange={(event) => change(index, { mode: event.target.value as SiteMode })}>
            {MODES.map((mode) => (
              <option key={mode} value={mode}>
                {SITE_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
          <input className="pod-input" value={rule.note} placeholder="备注" onChange={(event) => change(index, { note: event.target.value })} />
          <IconButton icon="close" label="删除这条" onClick={() => setDraft((rules) => rules.filter((_, at) => at !== index))} />
        </div>
      ))}
      <div className="pod-row">
        <Button small icon="plus" onClick={() => setDraft((rules) => [...rules, { pattern: '', mode: 'free', note: '' }])}>
          加一条
        </Button>
        <Button small kind="primary" disabled={!dirty} onClick={() => props.onSave(draft.filter((rule) => rule.pattern.trim() !== ''))}>
          保存
        </Button>
        <Button small kind="quiet" disabled={!dirty} onClick={() => setDraft(props.rules)}>
          撤销修改
        </Button>
        <Button small kind="quiet" onClick={() => setDraft(DEFAULT_SITE_RULES)}>
          恢复默认清单
        </Button>
      </div>
    </div>
  )
}

/** 本机或局域网地址白名单：本地开发服务按地址加进来，bot 才能打开。 */
function AllowedHosts(props: { readonly hosts: readonly string[]; readonly onSave: (hosts: readonly string[]) => void }) {
  const [value, setValue] = useState('')
  return (
    <div className="pod-stack">
      <div className="pod-row">
        {props.hosts.length === 0 ? <span className="pod-muted-inline">没有白名单</span> : null}
        {props.hosts.map((host) => (
          <span key={host} className="pod-row">
            <Badge tone="info">{host}</Badge>
            <IconButton icon="close" label={`移除 ${host}`} onClick={() => props.onSave(props.hosts.filter((item) => item !== host))} />
          </span>
        ))}
      </div>
      <div className="pod-row">
        <input className="pod-input" value={value} placeholder="localhost:5173" onChange={(event) => setValue(event.target.value)} />
        <Button
          small
          disabled={value.trim() === ''}
          onClick={() => {
            props.onSave([...props.hosts, value.trim()])
            setValue('')
          }}
        >
          加入白名单
        </Button>
      </div>
    </div>
  )
}

/** 设置里的共用浏览器：状态、Chrome 路径、站点规则和本机地址白名单。 */
export function BrowserSettings(props: { readonly settings: PodSettings; readonly update: (patch: Partial<PodSettings>) => void }) {
  const app = useApp()
  const { data } = useResource(app.cache, 'browser', () => api.browser())
  const [chrome, setChrome] = useState(props.settings.chromePath)
  const status = data?.status
  return (
    <div className="pod-stack">
      <div className="pod-settings-row">
        <div>
          <div>状态</div>
          <div className="pod-hint">无头运行，用 Pod 自己的 profile，不碰你日常 Chrome 的数据；第一次用到时才启动</div>
        </div>
        <div className="pod-settings-control">
          {status === undefined ? null : !status.available ? <Badge tone="danger">没找到 Chrome</Badge> : status.running ? <Badge tone="ok">运行中 · {status.tabs} 个标签页</Badge> : <Badge tone="muted">未启动</Badge>}
          {status?.version ? <span className="pod-muted-inline">{status.version}</span> : null}
        </div>
      </div>
      <div className="pod-settings-row">
        <div>
          <div>Chrome 路径</div>
          <div className="pod-hint">留空自动查找本机的 Chrome、Edge 或 Chromium</div>
        </div>
        <div className="pod-settings-control">
          <input className="pod-input" value={chrome} placeholder="自动查找" onChange={(event) => setChrome(event.target.value)} onBlur={() => chrome !== props.settings.chromePath && props.update({ chromePath: chrome.trim() })} />
        </div>
      </div>
      <div className="pod-section-title">站点规则（没有匹配的网站：写操作需审批）</div>
      <SiteRules key={JSON.stringify(props.settings.siteRules)} rules={props.settings.siteRules} onSave={(siteRules) => props.update({ siteRules })} />
      <div className="pod-section-title">本机和局域网地址白名单（默认一律不能访问，防止被网页诱导调用本机服务）</div>
      <AllowedHosts hosts={props.settings.allowedHosts} onSave={(allowedHosts) => props.update({ allowedHosts })} />
    </div>
  )
}

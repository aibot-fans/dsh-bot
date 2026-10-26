import { useState } from 'react'
import type { ModelChoice, PodSettings } from 'pod-domain'
import { api, type ModelCatalog } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Badge, Button, RelativeTime, Segmented, Switch } from '../../components/common.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { AibotRows } from '../aibot/AibotSettings.tsx'
import { MemoryChanges } from '../memory/MemoryView.tsx'
import { BrowserSettings } from './BrowserSettings.tsx'
import { Row, type Update } from './Row.tsx'

function modelValue(model: ModelChoice | null): string {
  return model === null ? '' : `${model.provider}::${model.model}`
}

function ModelSelect(props: { readonly value: ModelChoice | null; readonly catalog: ModelCatalog | undefined; readonly follow: string; readonly onChange: (model: ModelChoice | null) => void; readonly label: string }) {
  return (
    <select
      className="pod-input"
      aria-label={props.label}
      value={modelValue(props.value)}
      onChange={(event) => {
        const [provider, model] = event.target.value.split('::')
        props.onChange(provider === undefined || model === undefined || event.target.value === '' ? null : { provider, model })
      }}
    >
      <option value="">{props.follow}</option>
      {(props.catalog?.groups ?? []).map((group) => (
        <optgroup key={group.id} label={group.name}>
          {group.models.map((model) => (
            <option key={model.id} value={`${group.id}::${model.id}`}>
              {model.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

function Time(props: { readonly value: string; readonly onChange: (value: string) => void; readonly label: string }) {
  return <input className="pod-input pod-input-time" type="time" aria-label={props.label} value={props.value} onChange={(event) => props.onChange(event.target.value)} />
}

/** 通用：放手程度、通知、勿扰、自动记住要点、X 数据和监控（aibot）。 */
export function GeneralPage(props: { readonly settings: PodSettings; readonly update: Update }) {
  const app = useApp()
  const { settings, update } = props
  return (
    <div className="pod-settings-body">
      <Row label="放手程度" hint="谨慎：bot 组队开工前，先把计划发给你看">
        <Segmented
          value={settings.autonomy}
          options={[
            ['hands-off', '放手'],
            ['careful', '谨慎'],
          ]}
          onChange={(autonomy) => update({ autonomy })}
          label="放手程度"
        />
      </Row>
      <Row label="浏览器通知" hint="dsh 标签页不在前台时，任务完成和需要你的事会弹系统通知">
        <Switch
          checked={settings.browserNotifications}
          label="浏览器通知"
          onChange={(enabled) => {
            if (enabled && typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission()
            update({ browserNotifications: enabled })
          }}
        />
      </Row>
      <Row label="勿扰时段" hint="这段时间只记下来，不弹提醒">
        <Time value={settings.quietHours.start} label="开始时间" onChange={(start) => update({ quietHours: { ...settings.quietHours, start } })} />
        <span>到</span>
        <Time value={settings.quietHours.end} label="结束时间" onChange={(end) => update({ quietHours: { ...settings.quietHours, end } })} />
        <Switch checked={settings.quietHours.enabled} label="勿扰时段" onChange={(enabled) => update({ quietHours: { ...settings.quietHours, enabled } })} />
      </Row>
      <Row label="自动记住要点" hint="从对话里提取值得记的事，存进对应 bot 的记忆；无痕对话不提取">
        <Switch checked={settings.memoryExtraction} label="自动记住要点" onChange={(memoryExtraction) => update({ memoryExtraction })} />
      </Row>
      <AibotRows settings={settings} update={update} />
      <Row label="首次引导">
        <Button
          small
          kind="quiet"
          onClick={() => {
            // 引导盖在设置下面，先把设置关掉才看得见。
            update({ onboarded: false })
            app.navigate({ settings: null })
          }}
        >
          再看一遍
        </Button>
      </Row>
    </div>
  )
}

/** 模型：默认模型、轻量调用、闲时运行、并发。 */
export function ModelsPage(props: { readonly settings: PodSettings; readonly update: Update }) {
  const app = useApp()
  const { settings, update } = props
  const { data: catalog } = useResource(app.cache, 'models', () => api.models())
  const follow = catalog === undefined ? '跟随 dsh' : `跟随 dsh（${catalog.default.model}）`
  return (
    <div className="pod-settings-body">
      <Row label="默认模型" hint="每个 bot 也可以在自己的详情里单独选">
        <ModelSelect value={settings.defaultModel} catalog={catalog} follow={follow} label="默认模型" onChange={(defaultModel) => update({ defaultModel })} />
      </Row>
      <Row label="轻量调用" hint="摘要、提取记忆、交接笔记、写操作复核用，选便宜的就行">
        <ModelSelect value={settings.liteModel} catalog={catalog} follow="跟随默认模型" label="轻量调用的模型" onChange={(liteModel) => update({ liteModel })} />
      </Row>
      <Row label="闲时运行" hint="用 DeepSeek 模型时，不急的自动化、夜间整理和复盘放到闲时跑，更便宜">
        <Switch checked={settings.offPeak} label="闲时运行" onChange={(offPeak) => update({ offPeak })} />
      </Row>
      <Row label="同时进行的任务" hint="超出的排队，不拒绝">
        <input className="pod-input pod-input-number" type="number" min={1} max={32} aria-label="同时进行的任务数" value={settings.taskConcurrency} onChange={(event) => update({ taskConcurrency: Number(event.target.value) })} />
      </Row>
      <Row label="给你说话留的通道" hint="任务再多，你说话也不用排队">
        <input className="pod-input pod-input-number" type="number" min={1} max={32} aria-label="聊天通道数" value={settings.chatConcurrency} onChange={(event) => update({ chatConcurrency: Number(event.target.value) })} />
      </Row>
    </div>
  )
}

/** 浏览器：网站规则、放行的本机地址、标签页数、Chrome 位置。 */
export function BrowserPage(props: { readonly settings: PodSettings; readonly update: Update }) {
  const app = useApp()
  const { settings, update } = props
  return (
    <div className="pod-settings-body">
      <Row label="打开浏览器" hint="先自己登录好常用的网站，所有 bot 共用登录状态">
        <Button
          small
          onClick={() => {
            app.navigate({ settings: null })
            app.openBrowserTab(null)
          }}
        >
          打开
        </Button>
      </Row>
      <Row label="同时打开的标签页" hint="所有 bot 共用一个浏览器">
        <input className="pod-input pod-input-number" type="number" min={1} max={32} aria-label="同时打开的标签页数" value={settings.browserTabs} onChange={(event) => update({ browserTabs: Number(event.target.value) })} />
      </Row>
      <BrowserSettings settings={settings} update={update} />
    </div>
  )
}

/** 高级：时区、休眠、换段长度、你的档案、记忆变更、版本和备份。回收站单独一页。 */
export function AdvancedPage(props: { readonly settings: PodSettings; readonly update: Update }) {
  const app = useApp()
  const { settings, update } = props
  const { data: status } = useResource(app.cache, 'status', () => api.status())
  const [backup, setBackup] = useState<string | undefined>(undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  return (
    <div className="pod-settings-body">
      <Row label="时区" hint="自动化，以及“明天”“下周”这类说法按它算">
        <input className="pod-input" aria-label="时区" value={settings.timezone} onChange={(event) => update({ timezone: event.target.value })} onBlur={() => app.cache.invalidate('settings')} />
      </Row>
      <Row label="有任务时不让电脑休眠" hint="任务跑完就恢复">
        <Switch checked={settings.preventSleep} label="有任务时不让电脑休眠" onChange={(preventSleep) => update({ preventSleep })} />
      </Row>
      <Row label="换段长度（token）" hint="一段对话超过这个长度，就整理成摘要换一段继续">
        <input className="pod-input pod-input-number" type="number" min={16000} step={1000} aria-label="换段长度" value={settings.softContextTokens} onChange={(event) => update({ softContextTokens: Number(event.target.value) })} />
      </Row>
      <Row label="你的档案" hint="主管记下的关于你的事：偏好、习惯、约定">
        <Button small onClick={() => app.openDrawer({ kind: 'memory', scope: 'owner', scopeId: '', label: '你的档案' })}>
          打开
        </Button>
      </Row>
      <details className="pod-settings-group">
        <summary>记忆变更日志</summary>
        <MemoryChanges />
      </details>
      {status === undefined ? null : (
        <>
          <Row label="版本">
            <span>
              dsh-bot {status.version} · dsh {status.dshVersion}
            </span>
            {status.readOnly ? <Badge tone="danger">只读模式</Badge> : null}
          </Row>
          {status.exposure?.note === null || status.exposure?.note === undefined ? null : (
            <Row label="对外访问">
              <span className="pod-muted-inline">{status.exposure.note}</span>
            </Row>
          )}
          {status.degraded.length === 0 ? null : (
            <Row label="不可用的功能">
              <span className="pod-muted-inline">{status.degraded.join('、')}</span>
            </Row>
          )}
          <Row label="数据目录">
            <code>{status.dataRoot}</code>
          </Row>
          <Row label="工作区">
            <code>{status.workspaceRoot}</code>
          </Row>
          <Row label="每日备份" hint="保留 7 份">
            <span className="pod-muted-inline">{status.lastBackupAt === null ? '还没备份过' : <>上次 <RelativeTime time={status.lastBackupAt} /></>}</span>
            <Button
              small
              onClick={() => {
                api
                  .backupNow()
                  .then((result) => {
                    setBackup(result.file)
                    app.cache.invalidate('status')
                  })
                  .catch((reason: unknown) => setProblem(errorText(reason)))
              }}
            >
              立即备份
            </Button>
          </Row>
          {backup === undefined ? null : <p className="pod-hint">已备份到 {backup}</p>}
          {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
        </>
      )}
    </div>
  )
}

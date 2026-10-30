import { useState } from 'react'
import { LANGUAGE_NAMES, t, type ModelChoice, type PodSettings } from 'pod-domain'
import { api, type ModelCatalog } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Badge, Button, RelativeTime, Segmented, Switch } from '../../components/common.tsx'
import { useApp } from '../../state/app.ts'
import { setChatWidth, useChatWidth } from '../../state/chatWidth.ts'
import { useResource } from '../../state/resource.ts'
import { AibotRows } from '../aibot/AibotSettings.tsx'
import { MemoryChanges } from '../memory/MemoryView.tsx'
import { UpdateRow } from '../update/UpdateRow.tsx'
import { BrowserSettings } from './BrowserSettings.tsx'
import { Row, type Update } from './Row.tsx'
import { XAccountRows } from './XAccountRows.tsx'

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

/** 通用：语言、聊天区宽度、放手程度、通知、勿扰、自动记住要点、X 数据和监控（aibot）、x_ 工具用的 X 账号。 */
export function GeneralPage(props: { readonly settings: PodSettings; readonly update: Update }) {
  const app = useApp()
  const width = useChatWidth()
  const { settings, update } = props
  return (
    <div className="pod-settings-body">
      <Row label={t('语言')} hint={t('跟随 dsh：和 dsh 设置里的界面语言一致。系统消息和 bot 的回答也用这个语言')}>
        <Segmented
          value={settings.language}
          options={[
            ['auto', t('跟随 dsh')],
            ['zh', LANGUAGE_NAMES.zh],
            ['en', LANGUAGE_NAMES.en],
          ]}
          onChange={(language) => update({ language })}
          label={t('语言')}
        />
      </Row>
      <Row label={t('聊天区宽度')} hint={t('宽屏上中间对话区多宽；只存在这台设备上，手机上总是铺满')}>
        <Segmented
          value={width}
          options={[
            ['narrow', t('窄')],
            ['wide', t('宽')],
            ['full', t('铺满')],
          ]}
          onChange={setChatWidth}
          label={t('聊天区宽度')}
        />
      </Row>
      <Row label={t('放手程度')} hint={t('谨慎：bot 组队开工前，先把计划发给你看')}>
        <Segmented
          value={settings.autonomy}
          options={[
            ['hands-off', t('放手')],
            ['careful', t('谨慎')],
          ]}
          onChange={(autonomy) => update({ autonomy })}
          label={t('放手程度')}
        />
      </Row>
      <Row label={t('浏览器通知')} hint={t('dsh 标签页不在前台时，任务完成和需要你的事会弹系统通知')}>
        <Switch
          checked={settings.browserNotifications}
          label={t('浏览器通知')}
          onChange={(enabled) => {
            if (enabled && typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission()
            update({ browserNotifications: enabled })
          }}
        />
      </Row>
      <Row label={t('勿扰时段')} hint={t('这段时间只记下来，不弹提醒')}>
        <Time value={settings.quietHours.start} label={t('开始时间')} onChange={(start) => update({ quietHours: { ...settings.quietHours, start } })} />
        <span>{t('到')}</span>
        <Time value={settings.quietHours.end} label={t('结束时间')} onChange={(end) => update({ quietHours: { ...settings.quietHours, end } })} />
        <Switch checked={settings.quietHours.enabled} label={t('勿扰时段')} onChange={(enabled) => update({ quietHours: { ...settings.quietHours, enabled } })} />
      </Row>
      <Row label={t('自动记住要点')} hint={t('从对话里提取值得记的事，存进对应 bot 的记忆；无痕对话不提取')}>
        <Switch checked={settings.memoryExtraction} label={t('自动记住要点')} onChange={(memoryExtraction) => update({ memoryExtraction })} />
      </Row>
      <AibotRows settings={settings} update={update} />
      <XAccountRows settings={settings} update={update} />
      <Row label={t('首次引导')}>
        <Button
          small
          kind="quiet"
          onClick={() => {
            // 引导盖在设置下面，先把设置关掉才看得见。
            update({ onboarded: false })
            app.navigate({ settings: null })
          }}
        >
          {t('再看一遍')}
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
  const follow = catalog === undefined ? t('跟随 dsh') : t('跟随 dsh（{model}）', { model: catalog.default.model })
  return (
    <div className="pod-settings-body">
      <Row label={t('默认模型')} hint={t('每个 bot 也可以在自己的详情里单独选')}>
        <ModelSelect value={settings.defaultModel} catalog={catalog} follow={follow} label={t('默认模型')} onChange={(defaultModel) => update({ defaultModel })} />
      </Row>
      <Row label={t('轻量调用')} hint={t('摘要、提取记忆、交接笔记、写操作复核用，选便宜的就行')}>
        <ModelSelect value={settings.liteModel} catalog={catalog} follow={t('跟随默认模型')} label={t('轻量调用的模型')} onChange={(liteModel) => update({ liteModel })} />
      </Row>
      <Row label={t('闲时运行')} hint={t('用 DeepSeek 模型时，不急的自动化、夜间整理和复盘放到闲时跑，更便宜')}>
        <Switch checked={settings.offPeak} label={t('闲时运行')} onChange={(offPeak) => update({ offPeak })} />
      </Row>
      <Row label={t('同时进行的任务')} hint={t('超出的排队，不拒绝')}>
        <input className="pod-input pod-input-number" type="number" min={1} max={32} aria-label={t('同时进行的任务数')} value={settings.taskConcurrency} onChange={(event) => update({ taskConcurrency: Number(event.target.value) })} />
      </Row>
      <Row label={t('给你说话留的通道')} hint={t('任务再多，你说话也不用排队')}>
        <input className="pod-input pod-input-number" type="number" min={1} max={32} aria-label={t('聊天通道数')} value={settings.chatConcurrency} onChange={(event) => update({ chatConcurrency: Number(event.target.value) })} />
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
      <Row label={t('打开浏览器')} hint={t('先自己登录好常用的网站，所有 bot 共用登录状态')}>
        <Button
          small
          onClick={() => {
            app.navigate({ settings: null })
            app.openBrowserTab(null)
          }}
        >
          {t('打开')}
        </Button>
      </Row>
      <Row label={t('同时打开的标签页')} hint={t('所有 bot 共用一个浏览器')}>
        <input className="pod-input pod-input-number" type="number" min={1} max={32} aria-label={t('同时打开的标签页数')} value={settings.browserTabs} onChange={(event) => update({ browserTabs: Number(event.target.value) })} />
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
      <Row label={t('时区')} hint={t('自动化，以及“明天”“下周”这类说法按它算')}>
        <input className="pod-input" aria-label={t('时区')} value={settings.timezone} onChange={(event) => update({ timezone: event.target.value })} onBlur={() => app.cache.invalidate('settings')} />
      </Row>
      <Row label={t('有任务时不让电脑休眠')} hint={t('任务跑完就恢复')}>
        <Switch checked={settings.preventSleep} label={t('有任务时不让电脑休眠')} onChange={(preventSleep) => update({ preventSleep })} />
      </Row>
      <Row label={t('换段长度（token）')} hint={t('一段对话超过这个长度，就整理成摘要换一段继续')}>
        <input className="pod-input pod-input-number" type="number" min={16000} step={1000} aria-label={t('换段长度')} value={settings.softContextTokens} onChange={(event) => update({ softContextTokens: Number(event.target.value) })} />
      </Row>
      <Row label={t('你的档案')} hint={t('主管记下的关于你的事：偏好、习惯、约定')}>
        <Button small onClick={() => app.openDrawer({ kind: 'memory', scope: 'owner', scopeId: '', label: t('你的档案') })}>
          {t('打开')}
        </Button>
      </Row>
      <details className="pod-settings-group">
        <summary>{t('记忆变更日志')}</summary>
        <MemoryChanges />
      </details>
      {status === undefined ? null : (
        <>
          <Row label={t('版本')}>
            <span>
              dsh-bot {status.version} · dsh {status.dshVersion}
            </span>
            {status.readOnly ? <Badge tone="danger">{t('只读模式')}</Badge> : null}
          </Row>
          <UpdateRow settings={settings} update={update} />
          {status.exposure?.note === null || status.exposure?.note === undefined ? null : (
            <Row label={t('对外访问')}>
              <span className="pod-muted-inline">{status.exposure.note}</span>
            </Row>
          )}
          {status.degraded.length === 0 ? null : (
            <Row label={t('不可用的功能')}>
              <span className="pod-muted-inline">{status.degraded.join(t('、'))}</span>
            </Row>
          )}
          <Row label={t('数据目录')}>
            <code>{status.dataRoot}</code>
          </Row>
          <Row label={t('工作区')}>
            <code>{status.workspaceRoot}</code>
          </Row>
          <Row label={t('每日备份')} hint={t('保留 7 份')}>
            <span className="pod-muted-inline">{status.lastBackupAt === null ? t('还没备份过') : <>{t('上次')} <RelativeTime time={status.lastBackupAt} /></>}</span>
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
              {t('立即备份')}
            </Button>
          </Row>
          {backup === undefined ? null : <p className="pod-hint">{t('已备份到 {backup}', { backup })}</p>}
          {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
        </>
      )}
    </div>
  )
}

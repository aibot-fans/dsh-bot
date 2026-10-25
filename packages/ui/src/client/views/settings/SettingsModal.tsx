import { useEffect, useState } from 'react'
import type { PodSettings } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { IconButton, Segmented, Switch } from '../../components/common.tsx'
import { Icon } from '../../components/Icon.tsx'
import { useApp, useNav, type SettingsTab } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { ArchivePage } from './ArchivePage.tsx'
import { RecycleBin } from './RecycleBin.tsx'
import { Automations, type RoutineView } from './Routines.tsx'
import { Row, type Update } from './Row.tsx'
import { AdvancedPage, BrowserPage, GeneralPage, ModelsPage } from './SettingsPages.tsx'
import { UsagePage } from './UsagePage.tsx'

const TABS: readonly (readonly [SettingsTab, string])[] = [
  ['general', '通用'],
  ['usage', '用量'],
  ['automations', '自动化'],
  ['models', '模型'],
  ['browser', '浏览器'],
  ['archive', '归档'],
  ['recycle', '回收站'],
  ['advanced', '高级'],
]

type AutoFilter = 'all' | 'on' | 'off'

/** 全部自动化：每日简报加所有 bot 和群聊的自动化，一个列表里开关、筛选、新建。 */
function AutomationsPage(props: { readonly settings: PodSettings; readonly update: Update }) {
  const app = useApp()
  const { settings, update } = props
  const [filter, setFilter] = useState<AutoFilter>('all')
  const { data: routines } = useResource(app.cache, 'routines', () => api.routines())
  const on = (routines ?? []).filter((routine) => routine.enabled).length + (settings.dailyBrief.enabled ? 1 : 0)
  const total = (routines?.length ?? 0) + 1
  const match = (routine: RoutineView): boolean => filter === 'all' || (filter === 'on' ? routine.enabled : !routine.enabled)
  const briefShown = filter === 'all' || (filter === 'on') === settings.dailyBrief.enabled
  return (
    <div className="pod-stack">
      <Segmented
        value={filter}
        options={[
          ['all', `全部 ${total}`],
          ['on', `开着 ${on}`],
          ['off', `暂停 ${total - on}`],
        ]}
        onChange={setFilter}
        label="筛选自动化"
      />
      {briefShown ? (
        <div className="pod-settings-body">
          <Row label="每日简报" hint="主管每天把进展、需要你的事和花费发到和主管的单聊">
            <input
              className="pod-input pod-input-time"
              type="time"
              aria-label="简报时间"
              value={settings.dailyBrief.time}
              onChange={(event) => update({ dailyBrief: { ...settings.dailyBrief, time: event.target.value } })}
            />
            <Switch checked={settings.dailyBrief.enabled} label="每日简报" onChange={(enabled) => update({ dailyBrief: { ...settings.dailyBrief, enabled } })} />
          </Row>
        </div>
      ) : null}
      <Automations match={match} empty={filter === 'off' ? '没有暂停的自动化' : undefined} />
      <p className="pod-hint">dsh web 没开时错过的，下次打开后补跑一次；勿扰时段里照常运行，只是不弹提醒。</p>
    </div>
  )
}

/** 设置弹窗：从侧栏底部打开，分八页（含归档和回收站）；左栏最下面是“停止所有任务”。改动立即生效。 */
export function SettingsModal() {
  const app = useApp()
  const nav = useNav()
  const { data: settings, error } = useResource(app.cache, 'settings', () => api.settings())
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const tab = nav.settings
  useEffect(() => {
    if (tab === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') app.navigate({ settings: null })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [app, tab])
  if (tab === null) return null
  const close = (): void => app.navigate({ settings: null })
  const update: Update = (patch) => {
    setProblem(undefined)
    api
      .updateSettings(patch)
      .then((next) => app.cache.update<PodSettings>('settings', () => next))
      .catch((reason: unknown) => setProblem(errorText(reason)))
  }
  const stopAll = (): void => {
    if (!window.confirm('停止所有任务：停掉所有任务和回答。已完成的部分和产物都保留，之后可以逐个继续或取消。')) return
    api
      .stopAll()
      .then((result) => window.alert(`已停止 ${result.stopped} 个任务`))
      .catch((reason: unknown) => setProblem(errorText(reason)))
  }
  const title = TABS.find(([value]) => value === tab)?.[1] ?? '设置'
  return (
    <div className="pod-modal-backdrop" onClick={close}>
      <section className="pod-settings" role="dialog" aria-label="设置" onClick={(event) => event.stopPropagation()}>
        <nav className="pod-settings-nav" aria-label="设置分类">
          <strong className="pod-settings-title">设置</strong>
          {TABS.map(([value, label]) => (
            <button key={value} type="button" className={value === tab ? 'pod-settings-tab-on' : undefined} aria-current={value === tab ? 'page' : undefined} onClick={() => app.openSettings(value)}>
              {label}
            </button>
          ))}
          <span className="pod-grow" />
          <button type="button" className="pod-settings-stop" onClick={stopAll}>
            <Icon name="stop" size={13} /> 停止所有任务
          </button>
        </nav>
        <div className="pod-settings-content">
          <header className="pod-settings-head">
            <h2>{title}</h2>
            <IconButton icon="close" label="关闭设置" onClick={close} />
          </header>
          {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
          {settings === undefined ? (
            <p className="pod-muted">{error ?? '正在读取设置…'}</p>
          ) : (
            <>
              {tab === 'general' ? <GeneralPage settings={settings} update={update} /> : null}
              {tab === 'usage' ? <UsagePage /> : null}
              {tab === 'automations' ? <AutomationsPage settings={settings} update={update} /> : null}
              {tab === 'models' ? <ModelsPage settings={settings} update={update} /> : null}
              {tab === 'browser' ? <BrowserPage settings={settings} update={update} /> : null}
              {tab === 'archive' ? <ArchivePage /> : null}
              {tab === 'recycle' ? <RecycleBin /> : null}
              {tab === 'advanced' ? <AdvancedPage settings={settings} update={update} /> : null}
            </>
          )}
        </div>
      </section>
    </div>
  )
}

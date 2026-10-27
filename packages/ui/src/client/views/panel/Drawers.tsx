import { useMemo } from 'react'
import { t, type Bot } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { Drawer } from '../../components/common.tsx'
import { useApp, useNav } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { EvolutionPanel, ScorecardStrip, SkillsPanel } from '../bots/GrowthPanels.tsx'
import { MemoryPanel } from '../memory/MemoryView.tsx'
import { TaskDetail } from '../tasks/TasksView.tsx'
import { NewBotFlow, NewGroup } from './NewItems.tsx'
import { Versions } from './Versions.tsx'

function Growth(props: { readonly bot: Bot }) {
  const app = useApp()
  const { data: cards } = useResource(app.cache, 'scorecards', () => api.scorecards())
  const card = cards?.find((item) => item.botId === props.bot.id)?.card
  return (
    <div className="pod-stack">
      {card === undefined ? null : (
        <section className="pod-stack">
          <div className="pod-section-title">{t('评分卡')}</div>
          <ScorecardStrip card={card} />
        </section>
      )}
      <div className="pod-section-title">{t('自我优化做过的调整')}</div>
      <EvolutionPanel botId={props.bot.id} />
    </div>
  )
}

/** 盖在面板上的抽屉：记忆、技能、成长记录、历史版本、新建 bot、新建群聊，以及任务详情。 */
export function Drawers() {
  const app = useApp()
  const nav = useNav()
  const { data: botList } = useResource(app.cache, 'bots', () => api.bots())
  const bots = useMemo(() => new Map((botList ?? []).map((bot) => [bot.id, bot])), [botList])
  const close = (): void => app.navigate({ drawer: null })
  const drawer = nav.drawer
  const botOf = (id: string): Bot | undefined => bots.get(id)
  return (
    <>
      {drawer?.kind === 'memory' ? (
        <Drawer title={drawer.label} onClose={close} wide>
          <MemoryPanel scope={{ kind: drawer.scope, id: drawer.scopeId, label: drawer.label }} />
        </Drawer>
      ) : null}
      {drawer?.kind === 'skills' ? (
        <Drawer title={t('{value}的技能', { value: botOf(drawer.botId)?.name ?? 'bot' })} onClose={close} wide>
          <SkillsPanel botId={drawer.botId} />
        </Drawer>
      ) : null}
      {drawer?.kind === 'growth' && botOf(drawer.botId) !== undefined ? (
        <Drawer title={t('{value}的成长记录', { value: botOf(drawer.botId)?.name ?? 'bot' })} onClose={close} wide>
          <Growth bot={botOf(drawer.botId) as Bot} />
        </Drawer>
      ) : null}
      {drawer?.kind === 'versions' && botOf(drawer.botId) !== undefined ? <Versions bot={botOf(drawer.botId) as Bot} onClose={close} /> : null}
      {drawer?.kind === 'new-bot' ? <NewBotFlow bots={(botList ?? []).filter((bot) => bot.archivedAt === null)} onClose={close} /> : null}
      {drawer?.kind === 'new-group' ? <NewGroup bots={(botList ?? []).filter((bot) => bot.archivedAt === null)} onClose={close} /> : null}
      {nav.taskId === null ? null : <TaskDetail taskId={nav.taskId} bots={bots} onClose={() => app.navigate({ taskId: null })} />}
    </>
  )
}

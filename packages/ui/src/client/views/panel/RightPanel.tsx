import { useNav } from '../../state/app.ts'
import { BotPanel } from './BotPanel.tsx'
import { BrowserPanel } from './BrowserPanel.tsx'
import { ComputerPanel } from './ComputerPanel.tsx'
import { GroupPanel } from './GroupPanel.tsx'
import { TaskPanel } from './TaskPanel.tsx'
import { TaskWindow } from './TaskWindow.tsx'
import { PageLibraryPanel } from '../pages/PageLibrary.tsx'

/** 右侧面板：bot 详情（或群里的成员卡片）、群聊详情、bot 的浏览器、电脑、页面库、任务小窗、任务详情，同一时间只开一个。 */
export function RightPanel() {
  const { panel } = useNav()
  if (panel === null) return null
  switch (panel.kind) {
    case 'bot':
      return <BotPanel botId={panel.botId} tab={panel.tab} from={panel.from} back={panel.back} />
    case 'group':
      return <GroupPanel roomId={panel.roomId} tab={panel.tab} />
    case 'browser':
      return <BrowserPanel tabId={panel.tabId} botId={panel.botId} roomId={panel.roomId} back={panel.back} />
    case 'computer':
      return <ComputerPanel />
    case 'pages':
      return <PageLibraryPanel />
    case 'tasks':
      return <TaskWindow taskIds={panel.taskIds} active={panel.active} />
    case 'task':
      return <TaskPanel taskId={panel.taskId} back={panel.back} />
  }
}

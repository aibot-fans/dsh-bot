import { useNav } from '../../state/app.ts'
import { BotPanel } from './BotPanel.tsx'
import { BrowserPanel } from './BrowserPanel.tsx'
import { GroupPanel } from './GroupPanel.tsx'
import { PageLibraryPanel } from '../pages/PageLibrary.tsx'

/** 右侧面板：bot 详情（或群里的成员卡片）、群聊详情、bot 的浏览器、页面库，同一时间只开一个。 */
export function RightPanel() {
  const { panel } = useNav()
  if (panel === null) return null
  switch (panel.kind) {
    case 'bot':
      return <BotPanel botId={panel.botId} tab={panel.tab} from={panel.from} back={panel.back} />
    case 'group':
      return <GroupPanel roomId={panel.roomId} tab={panel.tab} />
    case 'browser':
      return <BrowserPanel tabId={panel.tabId} botId={panel.botId} roomId={panel.roomId} />
    case 'pages':
      return <PageLibraryPanel />
  }
}

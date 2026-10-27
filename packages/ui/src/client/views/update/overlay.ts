import { t, type UpdateJob, type UpdateStatus } from 'pod-domain'
import { updateApi } from '../../api/update.ts'
import { markReopen } from './reopen.ts'
import { RESTART_TEXT, STEP_TEXT } from './text.ts'

const ID = 'pod-update-overlay'
const POLL_MS = 1500
/** 宿主那边一次更新最多做 15 分钟，再多等一会儿就不等了。 */
const GIVE_UP_MS = 16 * 60_000

/** 样式跟着框走，不靠 dsh-bot 的样式表：卸旧版时 dsh 会把那份样式表连同页面一起拿掉。颜色取 dsh 的主题变量。 */
const CSS = `
#${ID} { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center; padding: 24px; background: color-mix(in srgb, #000 32%, transparent); font: 14px/1.6 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
#${ID} .card { box-sizing: border-box; width: min(420px, 100%); padding: 20px 22px 18px; border-radius: 16px; background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary, #1f1f1f); box-shadow: 0 24px 64px color-mix(in srgb, #000 22%, transparent); }
#${ID} h2 { margin: 0 0 8px; font-size: 16px; font-weight: 600; }
#${ID} h2.ok { color: var(--dsw-alias-state-success-primary, #067647); }
#${ID} h2.bad { color: var(--dsw-alias-state-error-primary, #b42318); }
#${ID} p { margin: 0; color: var(--dsw-alias-label-secondary, #555); white-space: pre-line; }
#${ID} .bar { height: 4px; margin: 16px 0 2px; border-radius: 2px; overflow: hidden; background: color-mix(in srgb, currentColor 10%, transparent); }
#${ID} .bar span { display: block; width: 40%; height: 100%; border-radius: 2px; background: var(--dsw-alias-brand-primary, #3b5bdb); animation: pod-update-slide 1.2s ease-in-out infinite; }
@keyframes pod-update-slide { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
#${ID} .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
#${ID} button { appearance: none; font: inherit; font-size: 13px; font-weight: 500; padding: 6px 14px; border: 0; border-radius: 9px; cursor: pointer; background: color-mix(in srgb, var(--dsw-alias-label-primary, #1f1f1f) 7%, transparent); color: var(--dsw-alias-label-primary, #1f1f1f); }
#${ID} button.primary { background: var(--dsw-alias-label-primary, #1f1f1f); color: var(--dsw-alias-bg-layer-1, #fff); }
#${ID} button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #3b5bdb); outline-offset: 1px; }
`

interface Action {
  readonly label: string
  readonly primary?: boolean
  readonly run: () => void
}

interface View {
  readonly title: string
  readonly text: string
  readonly tone?: 'ok' | 'bad'
  readonly busy?: boolean
  readonly actions: readonly Action[]
}

function render(root: HTMLElement, style: HTMLStyleElement, view: View): void {
  const card = document.createElement('div')
  card.className = 'card'
  card.setAttribute('role', 'alertdialog')
  card.setAttribute('aria-label', view.title)
  const title = document.createElement('h2')
  title.textContent = view.title
  if (view.tone !== undefined) title.className = view.tone
  const text = document.createElement('p')
  text.textContent = view.text
  text.setAttribute('aria-live', 'polite')
  card.append(title, text)
  if (view.busy === true) {
    const bar = document.createElement('div')
    bar.className = 'bar'
    bar.append(document.createElement('span'))
    card.append(bar)
  }
  const row = document.createElement('div')
  row.className = 'actions'
  for (const action of view.actions) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = action.label
    if (action.primary === true) button.className = 'primary'
    button.addEventListener('click', action.run)
    row.append(button)
  }
  card.append(row)
  root.replaceChildren(style, card)
}

/**
 * 一键更新的进度框：直接挂在 document.body 上，不在 dsh-bot 的页面里。卸旧版时 dsh 会拿掉 dsh-bot 的页面，
 * 这个框还在，一直问到新版起来、要重启或者出错为止。新版的页面加载后自己回到 dsh-bot（见 reopen.ts）；
 * 页面刷新后 dsh-bot 发现更新还没做完，会重新打开这个框。
 */
export function showUpdateOverlay(to: string): void {
  if (typeof document === 'undefined' || document.getElementById(ID) !== null) return
  markReopen()
  const root = document.createElement('div')
  root.id = ID
  const style = document.createElement('style')
  style.textContent = CSS
  document.body.append(root)
  const started = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  const close = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    root.remove()
  }
  // 看过结果了：清掉宿主那边的记录，侧栏和横幅就不再提。
  const dismissThen =
    (next: () => void): (() => void) =>
    () =>
      void updateApi
        .dismiss()
        .catch(() => undefined)
        .finally(next)
  const show = (view: View): void => render(root, style, view)
  const title = t('更新 dsh-bot 到 {to}', { to })
  const hide: Action = { label: t('收起'), run: close }

  const finish = (job: UpdateJob): void => {
    if (job.outcome === 'done') {
      show({
        title: t('已更新到 {to}', { to }),
        tone: 'ok',
        text: t('新版已经在跑了，不用重启 dsh web。页面显示得不对的话，刷新一下。'),
        actions: [
          {
            label: t('刷新页面'),
            run: dismissThen(() => {
              markReopen()
              window.location.reload()
            }),
          },
          { label: t('好的'), primary: true, run: dismissThen(close) },
        ],
      })
    } else if (job.outcome === 'restart') {
      // 装好时 dsh 已经换上新版的页面、用掉了记号；重启后刷新页面时再回到 dsh-bot。
      markReopen()
      show({ title: t('{to} 装好了，重启 dsh web 后生效', { to }), text: t(RESTART_TEXT), actions: [{ label: t('知道了'), primary: true, run: close }] })
    } else {
      show({ title: t('这次没更新成'), tone: 'bad', text: job.message === '' ? t('原因见 dsh 的日志。') : job.message, actions: [{ label: t('知道了'), primary: true, run: dismissThen(close) }] })
    }
  }

  const tick = async (): Promise<void> => {
    const status: UpdateStatus | undefined = await updateApi.status().catch(() => undefined)
    const job = status?.job ?? null
    if (status === undefined) {
      // 旧版卸下、新版还没起来的这段时间，dsh-bot 的接口都不在。
      show({ title, text: t('dsh-bot 暂时不在，正在换成新版…'), busy: true, actions: [hide] })
    } else if (job?.outcome !== null && job?.to === to) {
      finish(job)
      return
    } else if (job === null || job.to !== to) {
      finish({ from: '', to, startedAt: started, step: null, outcome: status.current === to ? 'done' : 'failed', message: t('找不到这次更新的记录了：在设置 → 高级里看一下现在的版本。'), finishedAt: null })
      return
    } else {
      show({ title, text: job.step === null ? t('准备更新…') : t(STEP_TEXT[job.step]), busy: true, actions: [hide] })
    }
    if (Date.now() - started > GIVE_UP_MS) {
      show({
        title: t('还没有结果'),
        tone: 'bad',
        text: t('等了很久还没装好。去 dsh 的插件页看看 dsh-bot 还在不在；不在的话在那里重新装上，数据都还在。'),
        actions: [{ label: t('关闭'), run: close }],
      })
      return
    }
    timer = setTimeout(() => void tick(), POLL_MS)
  }

  show({ title, text: t('准备更新…'), busy: true, actions: [hide] })
  void tick()
}

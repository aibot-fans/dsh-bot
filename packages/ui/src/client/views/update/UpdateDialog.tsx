import { useState } from 'react'
import { PACKAGE_NAME, compareVersions, t, type ReleaseNote, type UpdateJob, type UpdateStatus } from 'pod-domain'
import { errorText } from '../../api/http.ts'
import { updateApi } from '../../api/update.ts'
import { Badge, Button, Modal, RelativeTime, clock } from '../../components/common.tsx'
import { Markdown } from '../../components/Markdown.tsx'
import { useApp, useNav } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { showUpdateOverlay } from './overlay.ts'
import { HMR_TEXT, MANUAL_TEXT, RESTART_TEXT, SOURCE_STEPS, STEP_TEXT, releaseUrl } from './text.ts'

function when(time: number): string {
  const date = new Date(time)
  return t('{month}月{date}日 {clock}', { month: date.getMonth() + 1, date: date.getDate(), clock: clock(time) })
}

function titleOf(status: UpdateStatus): string {
  const { job } = status
  if (job?.outcome === null) return t('正在更新到 {to}', { to: job.to })
  if (job?.outcome === 'done') return t('已更新到 {to}', { to: job.to })
  if (job?.outcome === 'restart') return t('{to} 装好了，重启后生效', { to: job.to })
  if (job?.outcome === 'failed') return t('这次没更新成')
  return status.target !== null || status.waiting !== null ? t('dsh-bot 有新版本') : t('检查更新')
}

function Release(props: { readonly release: ReleaseNote; readonly waiting: boolean }) {
  const { release } = props
  return (
    <li className="pod-update-release">
      <div className="pod-update-release-head">
        <span>{release.version}</span>
        {props.waiting ? <Badge tone="warn">{t('还不能装')}</Badge> : null}
        {release.publishedAt === null ? null : (
          <span className="pod-hint">
            {t('发布于')} <RelativeTime time={release.publishedAt} />
          </span>
        )}
        <a className="pod-link pod-update-link" href={releaseUrl(release.version)} target="_blank" rel="noreferrer">
          {t('GitHub 上看')}
        </a>
      </div>
      {release.notes === null ? <p className="pod-update-note">{t('这一版发包时没带更新说明，去 GitHub 上看。')}</p> : <Markdown text={release.notes} />}
    </li>
  )
}

/** 上一次一键更新的结果，或者还在做的那一步。 */
function JobResult(props: { readonly job: UpdateJob; readonly installed: ReleaseNote | null; readonly working: boolean; readonly onDismiss: () => void; readonly onClose: () => void }) {
  const { job } = props
  if (job.outcome === null) {
    return (
      <div className="pod-update-result pod-update-result-info">
        <p>{job.step === null ? t('准备更新…') : t(STEP_TEXT[job.step])}</p>
        <div className="pod-update-actions">
          <Button small onClick={() => showUpdateOverlay(job.to)}>
            {t('看进度')}
          </Button>
        </div>
      </div>
    )
  }
  if (job.outcome === 'restart') {
    return (
      <div className="pod-update-result pod-update-result-warn">
        <p>{t('新版已经装好，dsh web 重启以后才换过来。{RESTART_TEXT}', { RESTART_TEXT: t(RESTART_TEXT) })}</p>
        <div className="pod-update-actions">
          <Button small kind="primary" onClick={props.onClose}>
            {t('知道了')}
          </Button>
        </div>
      </div>
    )
  }
  const done = job.outcome === 'done'
  return (
    <div className={`pod-update-result pod-update-result-${done ? 'ok' : 'danger'}`}>
      <p>{done ? t('从 {from} 更新到了 {to}，新版已经在跑了。', { from: job.from, to: job.to }) : job.message === '' ? t('原因见 dsh 的日志。') : job.message}</p>
      {done && props.installed?.notes !== null && props.installed?.notes !== undefined ? <Markdown text={props.installed.notes} className="pod-update-installed" /> : null}
      <div className="pod-update-actions">
        <Button small kind="primary" disabled={props.working} onClick={props.onDismiss}>
          {t('知道了')}
        </Button>
      </div>
    </div>
  )
}

/** 怎么更新：能一键更新就是按钮，源码装的和没有插件管理的写清楚自己怎么做；发布还不满一天的说什么时候能装。 */
function UpdateAction(props: { readonly status: UpdateStatus; readonly working: boolean; readonly onApply: (version: string) => void }) {
  const { status } = props
  const { target, waiting } = status
  const wait =
    waiting === null ? null : (
      <p className="pod-update-note">
        {t('{version} 发布还不满 pnpm 要求的时间（默认一天，防止装到刚发布就被投毒的包），{when} 以后能装。', { version: waiting.version, when: when(waiting.installableAt) })}
      </p>
    )
  if (status.install === 'source') {
    return (
      <div className="pod-update-how">
        <p>{t('这份 dsh-bot 是从源码装的（link: 到仓库），不能一键更新。在仓库目录里运行：')}</p>
        <pre className="pod-update-steps">{SOURCE_STEPS.join('\n')}</pre>
        <p className="pod-update-note">{t('然后重启 dsh web：{RESTART_TEXT}', { RESTART_TEXT: t(RESTART_TEXT) })}</p>
      </div>
    )
  }
  if (status.install === 'manual') return <p className="pod-update-note">{t(MANUAL_TEXT, { PACKAGE_NAME })}</p>
  return (
    <>
      {target === null ? null : (
        <>
          {status.busy > 0 ? <p className="pod-update-warn-text">{t('有 {busy} 个 bot 正在干活：更新会打断它们，新版起来后任务会接着做。', { busy: status.busy })}</p> : null}
          <p className="pod-update-note">{t(HMR_TEXT)}</p>
          <div className="pod-update-actions">
            <Button kind="primary" icon="update" disabled={props.working} onClick={() => props.onApply(target)}>
              {t('一键更新到 {target}', { target })}
            </Button>
          </div>
        </>
      )}
      {wait}
    </>
  )
}

function UpdateModal() {
  const app = useApp()
  const { data: status, error } = useResource(app.cache, 'update', () => updateApi.status())
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [working, setWorking] = useState(false)
  const close = (): void => app.navigate({ update: false })
  const run = (work: () => Promise<unknown>): void => {
    setProblem(undefined)
    setWorking(true)
    work()
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => {
        setWorking(false)
        app.cache.invalidate('update')
      })
  }
  if (status === undefined) {
    return (
      <Modal title={t('检查更新')} onClose={close}>
        <p>{error ?? t('正在读取…')}</p>
      </Modal>
    )
  }
  const { job } = status
  const apply = (version: string): void => {
    if (status.busy > 0 && !window.confirm(t('有 {busy} 个 bot 正在干活，更新会打断它们，新版起来后任务会接着做。现在更新吗？', { busy: status.busy }))) return
    run(async () => {
      await updateApi.apply(version)
      close()
      showUpdateOverlay(version)
    })
  }
  // 正在更新、等着重启的时候只说这件事；没更新成的可以再试。
  const pending = job !== null && (job.outcome === null || job.outcome === 'restart')
  const releases = pending ? [] : status.releases
  return (
    <Modal title={titleOf(status)} onClose={close} wide>
      {job === null ? null : <JobResult job={job} installed={status.installed} working={working} onDismiss={() => run(() => updateApi.dismiss())} onClose={close} />}
      {releases.length > 0 ? (
        <>
          <p className="pod-update-summary pod-hint">
            {t('现在是 {current}{value}', { current: status.current, value: status.latest === null ? '' : t('，最新是 {latest}', { latest: status.latest }) })}
          </p>
          <ol className="pod-update-list">
            {releases.map((release) => (
              <Release
                key={release.version}
                release={release}
                waiting={status.install === 'npm' && status.waiting !== null && (status.target === null || compareVersions(release.version, status.target) > 0)}
              />
            ))}
          </ol>
          <UpdateAction status={status} working={working} onApply={apply} />
        </>
      ) : job === null ? (
        <p>{status.checkedAt === null ? t('还没检查过新版本。') : t('已经是最新版（{current}）。', { current: status.current })}</p>
      ) : null}
      {problem === undefined ? null : (
        <p className="pod-form-error" role="alert">
          {problem}
        </p>
      )}
      <div className="pod-update-foot">
        {status.checking ? <span>{t('正在检查…')}</span> : status.checkedAt === null ? <span>{t('还没检查过')}</span> : <span>{t('上次检查：')}<RelativeTime time={status.checkedAt} /></span>}
        {status.error === null ? null : <span className="pod-update-error">{status.error}</span>}
        <Button small disabled={working || status.checking} onClick={() => run(() => updateApi.check())}>
          {t('重新检查')}
        </Button>
      </div>
    </Modal>
  )
}

/** 更新弹窗：新版本的更新内容、一键更新，以及上一次更新的结果。 */
export function UpdateDialog() {
  const nav = useNav()
  return nav.update ? <UpdateModal /> : null
}

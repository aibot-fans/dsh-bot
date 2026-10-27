import { useState } from 'react'
import { compareVersions, type ReleaseNote, type UpdateJob, type UpdateStatus } from 'pod-domain'
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
  return `${date.getMonth() + 1}月${date.getDate()}日 ${clock(time)}`
}

function titleOf(status: UpdateStatus): string {
  const { job } = status
  if (job?.outcome === null) return `正在更新到 ${job.to}`
  if (job?.outcome === 'done') return `已更新到 ${job.to}`
  if (job?.outcome === 'restart') return `${job.to} 装好了，重启后生效`
  if (job?.outcome === 'failed') return '这次没更新成'
  return status.target !== null || status.waiting !== null ? 'dsh-bot 有新版本' : '检查更新'
}

function Release(props: { readonly release: ReleaseNote; readonly waiting: boolean }) {
  const { release } = props
  return (
    <li className="pod-update-release">
      <div className="pod-update-release-head">
        <span>{release.version}</span>
        {props.waiting ? <Badge tone="warn">还不能装</Badge> : null}
        {release.publishedAt === null ? null : (
          <span className="pod-hint">
            <RelativeTime time={release.publishedAt} /> 发布
          </span>
        )}
        <a className="pod-link pod-update-link" href={releaseUrl(release.version)} target="_blank" rel="noreferrer">
          GitHub 上看
        </a>
      </div>
      {release.notes === null ? <p className="pod-update-note">这一版发包时没带更新说明，去 GitHub 上看。</p> : <Markdown text={release.notes} />}
    </li>
  )
}

/** 上一次一键更新的结果，或者还在做的那一步。 */
function JobResult(props: { readonly job: UpdateJob; readonly installed: ReleaseNote | null; readonly working: boolean; readonly onDismiss: () => void; readonly onClose: () => void }) {
  const { job } = props
  if (job.outcome === null) {
    return (
      <div className="pod-update-result pod-update-result-info">
        <p>{job.step === null ? '准备更新…' : STEP_TEXT[job.step]}</p>
        <div className="pod-update-actions">
          <Button small onClick={() => showUpdateOverlay(job.to)}>
            看进度
          </Button>
        </div>
      </div>
    )
  }
  if (job.outcome === 'restart') {
    return (
      <div className="pod-update-result pod-update-result-warn">
        <p>新版已经装好，dsh web 重启以后才换过来。{RESTART_TEXT}</p>
        <div className="pod-update-actions">
          <Button small kind="primary" onClick={props.onClose}>
            知道了
          </Button>
        </div>
      </div>
    )
  }
  const done = job.outcome === 'done'
  return (
    <div className={`pod-update-result pod-update-result-${done ? 'ok' : 'danger'}`}>
      <p>{done ? `从 ${job.from} 更新到了 ${job.to}，新版已经在跑了。` : job.message === '' ? '原因见 dsh 的日志。' : job.message}</p>
      {done && props.installed?.notes !== null && props.installed?.notes !== undefined ? <Markdown text={props.installed.notes} className="pod-update-installed" /> : null}
      <div className="pod-update-actions">
        <Button small kind="primary" disabled={props.working} onClick={props.onDismiss}>
          知道了
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
        {waiting.version} 发布还不满 pnpm 要求的时间（默认一天，防止装到刚发布就被投毒的包），{when(waiting.installableAt)} 以后能装。
      </p>
    )
  if (status.install === 'source') {
    return (
      <div className="pod-update-how">
        <p>这份 dsh-bot 是从源码装的（link: 到仓库），不能一键更新。在仓库目录里运行：</p>
        <pre className="pod-update-steps">{SOURCE_STEPS.join('\n')}</pre>
        <p className="pod-update-note">然后重启 dsh web：{RESTART_TEXT}</p>
      </div>
    )
  }
  if (status.install === 'manual') return <p className="pod-update-note">{MANUAL_TEXT}</p>
  return (
    <>
      {target === null ? null : (
        <>
          {status.busy > 0 ? <p className="pod-update-warn-text">有 {status.busy} 个 bot 正在干活：更新会打断它们，新版起来后任务会接着做。</p> : null}
          <p className="pod-update-note">{HMR_TEXT}</p>
          <div className="pod-update-actions">
            <Button kind="primary" icon="update" disabled={props.working} onClick={() => props.onApply(target)}>
              一键更新到 {target}
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
      <Modal title="检查更新" onClose={close}>
        <p>{error ?? '正在读取…'}</p>
      </Modal>
    )
  }
  const { job } = status
  const apply = (version: string): void => {
    if (status.busy > 0 && !window.confirm(`有 ${status.busy} 个 bot 正在干活，更新会打断它们，新版起来后任务会接着做。现在更新吗？`)) return
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
            现在是 {status.current}
            {status.latest === null ? '' : `，最新是 ${status.latest}`}
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
        <p>{status.checkedAt === null ? '还没检查过新版本。' : `已经是最新版（${status.current}）。`}</p>
      ) : null}
      {problem === undefined ? null : (
        <p className="pod-form-error" role="alert">
          {problem}
        </p>
      )}
      <div className="pod-update-foot">
        {status.checking ? <span>正在检查…</span> : status.checkedAt === null ? <span>还没检查过</span> : <span>上次检查：<RelativeTime time={status.checkedAt} /></span>}
        {status.error === null ? null : <span className="pod-update-error">{status.error}</span>}
        <Button small disabled={working || status.checking} onClick={() => run(() => updateApi.check())}>
          重新检查
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

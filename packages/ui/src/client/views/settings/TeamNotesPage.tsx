import { useState } from 'react'
import { TEAM_NOTE_KEYS, TEAM_NOTE_LABELS, TEAM_NOTE_MAX, inputLimit, t, teamNoteDefault, teamNoteStale, teamNoteText, teamNoteVersion, type PodSettings, type TeamNoteKey } from 'pod-domain'
import { Badge, Button } from '../../components/common.tsx'
import { LineDiff } from '../../components/LineDiff.tsx'
import type { Update } from './Row.tsx'

const HINTS: Readonly<Record<TeamNoteKey, string>> = {
  communication: '所有 bot 在对话里怎么跟你说话：前台的回复、任务发到聊天里的结果都按这块来。',
  scope: '任务里哪些事 bot 自己定、直接推进，什么时候停下来找你。',
  delivery: '任务交付时写什么、完整报告怎么写、产出放哪。',
}

/** 文本框跟着内容长高（一行按 40 个字估算折行），最少 5 行、最多 16 行。 */
function rowsFor(text: string): number {
  const lines = text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 40)), 0)
  return Math.min(16, Math.max(5, lines + 1))
}

/** 团队说明的一块：直接改、保存，改过的能恢复默认；默认出了新版时先看差异，再选保留你的还是换成新默认。 */
function NoteBlock(props: { readonly name: TeamNoteKey; readonly settings: PodSettings; readonly update: Update }) {
  const { name, settings, update } = props
  const notes = settings.teamNotes
  const override = notes[name]
  const latest = teamNoteVersion(name)
  const current = teamNoteText(notes, name)
  const [draft, setDraft] = useState(current)
  const [diff, setDiff] = useState(false)
  const changed = draft.trim() !== current.trim()
  const write = (value: PodSettings['teamNotes'][TeamNoteKey]): void => update({ teamNotes: { ...notes, [name]: value } })
  const label = t(TEAM_NOTE_LABELS[name])
  return (
    <section className="pod-box pod-team-note">
      <div className="pod-box-head">
        <strong>{label}</strong>
        <Badge tone={override === null ? 'muted' : 'info'}>{override === null ? t('默认') : t('改过')}</Badge>
      </div>
      <div className="pod-stack pod-box-pad">
        <p className="pod-hint">{t(HINTS[name])}</p>
        {override !== null && teamNoteStale(notes, name) ? (
          <div className="pod-seed-update">
            <div className="pod-row">
              <Badge tone="warn">{t('默认已更新')}</Badge>
              <span className="pod-muted-inline">{t('你改过这块以后，默认出了新版（第 {base} 版 → 第 {latest} 版）', { base: override.base, latest })}</span>
            </div>
            {diff ? <LineDiff before={teamNoteDefault(name, undefined, override.base) ?? ''} after={teamNoteDefault(name) ?? ''} /> : null}
            <div className="pod-row">
              <Button small kind="quiet" onClick={() => setDiff(!diff)}>
                {diff ? t('收起差异') : t('看差异')}
              </Button>
              <Button small kind="quiet" onClick={() => write({ text: override.text, base: latest })}>
                {t('保留我的')}
              </Button>
              <Button small kind="primary" onClick={() => write(null)}>
                {t('换成新默认')}
              </Button>
            </div>
          </div>
        ) : null}
        <textarea className="pod-textarea" aria-label={label} rows={rowsFor(draft)} value={draft} maxLength={inputLimit(TEAM_NOTE_MAX)} onChange={(event) => setDraft(event.target.value)} />
        <div className="pod-row">
          <Button small kind="primary" disabled={!changed} onClick={() => write({ text: draft, base: override === null ? latest : override.base })}>
            {t('保存')}
          </Button>
          {changed ? (
            <Button small kind="quiet" onClick={() => setDraft(current)}>
              {t('取消')}
            </Button>
          ) : null}
          {override === null ? null : (
            <Button small kind="quiet" onClick={() => write(null)}>
              {t('恢复默认')}
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}

/** 设置里的“团队说明”：提示词里你能改的三块，所有 bot 都照着做。 */
export function TeamNotesPage(props: { readonly settings: PodSettings; readonly update: Update }) {
  return (
    <div className="pod-stack">
      <p className="pod-hint">{t('团队说明是提示词里你能改的部分，所有 bot 都照着做，从下一段对话开始生效。工具怎么用、哪些事不能做写在 dsh-bot 的规矩和会话协议里，不能改；和团队说明冲突时按规矩来。')}</p>
      {TEAM_NOTE_KEYS.map((name) => (
        // 存下的正文变了（保存、恢复默认、换语言）就重新装上，草稿跟着换。
        <NoteBlock key={`${name}:${teamNoteText(props.settings.teamNotes, name)}`} name={name} settings={props.settings} update={props.update} />
      ))}
    </div>
  )
}

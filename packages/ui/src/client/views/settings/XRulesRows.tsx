import { useState } from 'react'
import { X_EVENT_LABELS, t, tc, type PodSettings, type XRules } from 'pod-domain'
import { Switch } from '../../components/common.tsx'
import { Row, type Update } from './Row.tsx'

function words(value: string): readonly string[] {
  return value
    .split(/[,，、\s]+/)
    .map((word) => word.trim())
    .filter((word) => word !== '')
}

/** 一行逗号或空格分开的词：离开输入框或按回车时存。 */
function WordsInput(props: { readonly value: readonly string[]; readonly label: string; readonly placeholder: string; readonly onSave: (words: readonly string[]) => void }) {
  const joined = props.value.join(', ')
  const [draft, setDraft] = useState<string | undefined>(undefined)
  const save = (): void => {
    if (draft === undefined) return
    const next = words(draft)
    setDraft(undefined)
    if (next.join(', ') !== joined) props.onSave(next)
  }
  return (
    <input
      className="pod-input"
      aria-label={props.label}
      placeholder={props.placeholder}
      value={draft ?? joined}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') save()
      }}
    />
  )
}

/**
 * X 监控的规则（自动来源的两段过滤）：事件先按这里的类型、账号、关键词筛，过了的再让轻量模型判断值不值得做，
 * 值得的在后台开任务。改一次版本加 1，开出来的任务在来由里记下用的哪版。
 */
export function XRulesRows(props: { readonly settings: PodSettings; readonly update: Update }) {
  const rules = props.settings.xRules
  const change = (patch: Partial<Omit<XRules, 'version'>>): void => props.update({ xRules: { ...rules, ...patch, version: rules.version + 1 } })
  const toggleType = (type: string): void => change({ types: rules.types.includes(type) ? rules.types.filter((item) => item !== type) : [...rules.types, type] })
  return (
    <>
      <Row
        label={t('X 监控开任务')}
        hint={t('X 监控群里的事件先按下面的规则筛，过了的再让轻量模型判断值不值得做；值得的在后台开任务，做出东西才回在那条事件下面。三项都空时不开任务。现在是第 {version} 版。', {
          version: rules.version,
        })}
      >
        <Switch checked={rules.enabled} label={t('X 监控开任务')} onChange={(enabled) => change({ enabled })} />
      </Row>
      <Row label={t('关注的事件类型')} hint={t('不选就不按类型筛')}>
        <div className="pod-row pod-wrap">
          {Object.entries(X_EVENT_LABELS).map(([type, label]) => (
            <button key={type} type="button" className={`pod-chip${rules.types.includes(type) ? ' pod-chip-active' : ''}`} aria-pressed={rules.types.includes(type)} onClick={() => toggleType(type)}>
              {tc(label, 'X')}
            </button>
          ))}
        </div>
      </Row>
      <Row label={t('关注的账号')} hint={t('不带 @，逗号或空格分开；空着就不按账号筛')}>
        <WordsInput value={rules.accounts} label={t('关注的账号')} placeholder="elonmusk, openai" onSave={(accounts) => change({ accounts })} />
      </Row>
      <Row label={t('关键词')} hint={t('标题、摘要、推文里出现任何一个就算；空着就不按关键词筛')}>
        <WordsInput value={rules.keywords} label={t('关键词')} placeholder={t('融资, 发布')} onSave={(keywords) => change({ keywords })} />
      </Row>
      <Row label={t('先起草回复')} hint={t('有人回复、引用时，后台任务先看上下文起草好回复，发到 X 监控群；你回一句“发”它才发')}>
        <Switch checked={rules.draft} label={t('先起草回复')} onChange={(draft) => change({ draft })} />
      </Row>
    </>
  )
}

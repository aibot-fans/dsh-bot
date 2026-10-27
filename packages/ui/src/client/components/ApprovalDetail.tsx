import { t, type Wait } from 'pod-domain'
import { mediaUrl } from '../api/http.ts'

interface FormField {
  readonly label: string
  readonly value: string
}

function fields(wait: Wait): readonly FormField[] {
  const raw = wait.data.form
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is FormField => typeof item === 'object' && item !== null && typeof (item as FormField).label === 'string')
}

/** 浏览器写操作的审批卡：截图、网址、目标元素、表单内容和执行前复核的结论。 */
export function ApprovalDetail(props: { readonly wait: Wait }) {
  const { wait } = props
  const form = fields(wait)
  const check = wait.data.check as { readonly fits?: boolean; readonly reason?: string } | null | undefined
  return (
    <div className="pod-stack">
      {typeof wait.data.shot === 'string' ? <img className="pod-approval-shot" src={mediaUrl('/browser/approval-shot', { waitId: wait.id })} alt={t('提交审批时的页面截图')} /> : null}
      <div className="pod-hint">{t('网址：{String}', { String: String(wait.data.url ?? '') })}</div>
      {typeof wait.data.reason === 'string' ? <div className="pod-hint">{t('为什么要审批：{reason}', { reason: wait.data.reason })}</div> : null}
      {check === null || check === undefined ? null : (
        <div className={check.fits === false ? 'pod-form-error' : 'pod-hint'}>
          {t('执行前复核：{value}{value2}', { value: check.fits === false ? t('可能不符合任务说明') : t('符合任务说明'), value2: check.reason ? t('（{reason}）', { reason: check.reason }) : '' })}
        </div>
      )}
      {form.length === 0 ? null : (
        <table className="pod-approval-form">
          <tbody>
            {form.map((field) => (
              <tr key={`${field.label}-${field.value}`}>
                <th>{field.label}</th>
                <td>{field.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="pod-hint">{t('批准后 dsh-bot 先确认页面没变，再按原样执行；页面变了这个动作就作废。')}</div>
    </div>
  )
}

import { useState } from 'react'
import { t, type PodSettings } from 'pod-domain'
import { api } from '../api/endpoints.ts'
import { errorText } from '../api/http.ts'
import { Button } from '../components/common.tsx'
import { useApp } from '../state/app.ts'
import { useResource } from '../state/resource.ts'
import { AibotIntro } from './aibot/AibotIntro.tsx'

const STEPS = ['认识 dsh-bot', '建一个团队', '先登录常用网站', '通知'] as const

/** 首次引导：讲清主管和团队怎么用、X 数据和监控开通了没有，可选按模板建团队、先登录网站、打开通知。点“开始使用”后不再出现。 */
export function Onboarding(props: { readonly settings: PodSettings }) {
  const app = useApp()
  const [step, setStep] = useState(0)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [created, setCreated] = useState<readonly string[]>([])
  const { data: templates } = useResource(app.cache, 'team-templates', () => api.teamTemplates())
  const finish = (): void => {
    api
      .updateSettings({ onboarded: true })
      .then((next) => {
        app.cache.update<PodSettings>('settings', () => next)
        app.navigate({ roomId: null, panel: null })
      })
      .catch((reason: unknown) => setProblem(errorText(reason)))
  }
  return (
    <div className="pod-onboarding-backdrop">
      <section className="pod-onboarding" aria-label={t('首次引导')}>
        <ol className="pod-onboarding-steps">
          {STEPS.map((label, index) => (
            <li key={label} className={index === step ? 'pod-onboarding-current' : index < step ? 'pod-onboarding-done' : ''}>
              {t(label)}
            </li>
          ))}
        </ol>
        {step === 0 ? (
          <div className="pod-stack">
            <h2>{t('欢迎使用 dsh-bot')}</h2>
            <p>{t('dsh-bot 是你的一群 bot。你只需要跟“主管”说要做的事：简单的它自己做，复杂的它交给合适的 bot，或者临时组个小组、交给正式团队。')}</p>
            <p>{t('默认自治：bot 自己判断、直接推进，只在四种情况找你——需要登录或验证码、要做不可撤回的对外操作、被安全规则拦下、遇到没有默认值的歧义。')}</p>
            <p>{t('做的过程都在“任务”里，可以随时暂停、停止，或直接对任务说话。自我优化的改动都记在“进化日志”里，可以一键回滚。')}</p>
            <AibotIntro />
          </div>
        ) : null}
        {step === 1 ? (
          <div className="pod-stack">
            <h2>{t('建一个团队（可选）')}</h2>
            <p>{t('经常做的同类事情可以组成正式团队。也可以先跳过，让主管按需要临时组队。')}</p>
            <div className="pod-grid">
              {(templates ?? []).map((template) => (
                <article key={template.id} className="pod-card">
                  <strong>{template.name}</strong>
                  <p className="pod-muted">{template.description}</p>
                  <Button
                    small
                    disabled={created.includes(template.id)}
                    onClick={() => {
                      api
                        .teamFromTemplate(template.id)
                        .then(() => setCreated((list) => [...list, template.id]))
                        .catch((reason: unknown) => setProblem(errorText(reason)))
                    }}
                  >
                    {created.includes(template.id) ? t('已建好') : t('按这个建')}
                  </Button>
                </article>
              ))}
            </div>
          </div>
        ) : null}
        {step === 2 ? (
          <div className="pod-stack">
            <h2>{t('先登录常用网站（可选）')}</h2>
            <p>{t('所有 bot 共用一个无头浏览器和一份登录状态。在“浏览器”里开个标签页，自己登录一次，之后 bot 都能用。bot 永远不填密码、验证码和银行卡号；提交、发送、删除、购买这类写操作都会先问你。')}</p>
            <div>
              <Button small icon="browser" onClick={() => app.openBrowserTab(null)}>
                {t('打开浏览器视图')}
              </Button>
            </div>
          </div>
        ) : null}
        {step === 3 ? (
          <div className="pod-stack">
            <h2>{t('通知')}</h2>
            <p>{t('任务完成、失败、等你处理、例程结果和“本周变化”都会进通知中心。dsh web 的标签页不在前台时，也可以弹浏览器系统通知。')}</p>
            <div>
              <Button
                small
                onClick={() => {
                  if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission()
                  api
                    .updateSettings({ browserNotifications: true })
                    .then((next) => app.cache.update<PodSettings>('settings', () => next))
                    .catch((reason: unknown) => setProblem(errorText(reason)))
                }}
              >
                {props.settings.browserNotifications ? t('已打开浏览器通知') : t('打开浏览器通知')}
              </Button>
            </div>
            <p className="pod-hint">{t('勿扰时段、每日简报、例程都在“设置”里。')}</p>
          </div>
        ) : null}
        {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
        <div className="pod-row pod-onboarding-actions">
          {step > 0 ? (
            <Button kind="quiet" onClick={() => setStep((value) => value - 1)}>
              {t('上一步')}
            </Button>
          ) : (
            <Button kind="quiet" onClick={finish}>
              {t('跳过')}
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button kind="primary" onClick={() => setStep((value) => value + 1)}>
              {t('下一步')}
            </Button>
          ) : (
            <Button kind="primary" onClick={finish}>
              {t('开始使用')}
            </Button>
          )}
        </div>
      </section>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { t, type TabDialog } from 'pod-domain'
import { api, type BrowserOverlay } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Button } from '../../components/common.tsx'

/** 下拉框：无头浏览器不画弹出层，Pod 用自己的列表显示选项。 */
export function SelectOverlay(props: { readonly tabId: string; readonly overlay: Extract<BrowserOverlay, { readonly kind: 'select' }>; readonly onClose: () => void }) {
  const [problem, setProblem] = useState<string | undefined>(undefined)
  return (
    <div className="pod-live-overlay" onClick={props.onClose}>
      <div className="pod-live-card" onClick={(event) => event.stopPropagation()}>
        <strong>{t('选择一项')}</strong>
        <ul className="pod-live-options">
          {props.overlay.options.map((option) => (
            <li key={`${option.value}-${option.text}`}>
              <button
                type="button"
                className={option.selected ? 'pod-live-option-selected' : ''}
                onClick={() => {
                  api
                    .selectOption(props.tabId, props.overlay.ref, option.value)
                    .then(props.onClose)
                    .catch((reason: unknown) => setProblem(errorText(reason)))
                }}
              >
                {option.text || t('（空）')}
              </button>
            </li>
          ))}
        </ul>
        {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
        <Button small kind="quiet" onClick={props.onClose}>
          {t('取消')}
        </Button>
      </div>
    </div>
  )
}

/** 网页弹出的 alert、confirm、prompt：你接管时由你点；bot 操作时只提示。 */
export function DialogOverlay(props: { readonly tabId: string; readonly dialog: TabDialog; readonly controlled: boolean }) {
  const [text, setText] = useState(props.dialog.defaultPrompt)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const answer = (accept: boolean): void => {
    api.answerDialog(props.tabId, accept, text).catch((reason: unknown) => setProblem(errorText(reason)))
  }
  return (
    <div className="pod-live-overlay">
      <div className="pod-live-card">
        <strong>{t('页面弹出了对话框')}</strong>
        <p className="pod-live-message">{props.dialog.message || t('（没有文字）')}</p>
        {props.dialog.type === 'prompt' && props.controlled ? <input className="pod-input" value={text} onChange={(event) => setText(event.target.value)} /> : null}
        {props.controlled ? (
          <div className="pod-row">
            <Button kind="primary" small onClick={() => answer(true)}>
              {t('确定')}
            </Button>
            {props.dialog.type === 'alert' ? null : (
              <Button small onClick={() => answer(false)}>
                {t('取消')}
              </Button>
            )}
          </div>
        ) : (
          <p className="pod-hint">{t('bot 会处理这个对话框；要自己处理就先接管。')}</p>
        )}
        {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
      </div>
    </div>
  )
}

/** 选择文件：只能从工作区里选（这个标签页对应的任务文件夹）。 */
export function FileOverlay(props: { readonly tabId: string }) {
  const [files, setFiles] = useState<readonly string[] | undefined>(undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  useEffect(() => {
    api
      .tabFiles(props.tabId)
      .then(setFiles)
      .catch((reason: unknown) => setProblem(errorText(reason)))
  }, [props.tabId])
  return (
    <div className="pod-live-overlay">
      <div className="pod-live-card">
        <strong>{t('页面要你选文件')}</strong>
        <p className="pod-hint">{t('只能选工作区里的文件；要传电脑上别的文件，先放进工作区。')}</p>
        {files === undefined ? <p className="pod-hint">{t('正在读取文件…')}</p> : null}
        {files !== undefined && files.length === 0 ? <p className="pod-hint">{t('这个任务的文件夹里还没有文件。')}</p> : null}
        <ul className="pod-live-options">
          {(files ?? []).map((file) => (
            <li key={file}>
              <button type="button" onClick={() => void api.chooseFile(props.tabId, file).catch((reason: unknown) => setProblem(errorText(reason)))}>
                {file}
              </button>
            </li>
          ))}
        </ul>
        {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
      </div>
    </div>
  )
}

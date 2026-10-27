import { useState } from 'react'
import { t } from 'pod-domain'
import { mediaUrl } from '../../api/http.ts'
import { FilePreview } from '../../components/FilePreview.tsx'
import { fileKind } from '../../components/fileKinds.ts'

interface TextVersion {
  readonly path: string
  readonly summary: string
  readonly warning: string | undefined
}

/** 消息里记的文字版（上传时运行时转好的）：路径、概况和要提醒的事。 */
function textVersion(value: unknown): TextVersion | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Readonly<Record<string, unknown>>
  if (typeof record.path !== 'string') return undefined
  return {
    path: record.path,
    summary: typeof record.summary === 'string' ? record.summary : '',
    warning: typeof record.warning === 'string' ? record.warning : undefined,
  }
}

function sizeLabel(size: number): string {
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`
}

/** 上传的文件：图片直接显示缩略图，其他文件点开预览；PDF、Word、Excel、PPT 旁边多一个「文字版」，就是交给 bot 读的那份。 */
export function Attachment(props: { readonly attachment: Readonly<Record<string, unknown>> }) {
  const [open, setOpen] = useState<string | undefined>(undefined)
  const path = typeof props.attachment.path === 'string' ? props.attachment.path : ''
  if (path === '') return null
  const size = typeof props.attachment.size === 'number' ? props.attachment.size : 0
  const name = String(props.attachment.name ?? path)
  const text = textVersion(props.attachment.text)
  const textError = typeof props.attachment.textError === 'string' ? props.attachment.textError : undefined
  return (
    <>
      {fileKind(path) === 'image' ? (
        <button type="button" className="pod-attachment-image" onClick={() => setOpen(path)} aria-label={t('查看图片 {name}', { name })}>
          <img src={mediaUrl('/file', { path })} alt={name} loading="lazy" />
        </button>
      ) : (
        <div className="pod-attachment-row">
          <button type="button" className="pod-attachment" onClick={() => setOpen(path)}>
            {name} · {sizeLabel(size)}
          </button>
          {text === undefined ? null : (
            <button type="button" className="pod-attachment" onClick={() => setOpen(text.path)} title={t('bot 读的是这份文字版{value}', { value: text.summary === '' ? '' : t('（{summary}）', { summary: text.summary }) })}>
              {t('文字版')}
            </button>
          )}
        </div>
      )}
      {text?.warning === undefined ? null : <div className="pod-hint pod-attachment-note">{text.warning}</div>}
      {textError === undefined ? null : <div className="pod-hint pod-attachment-note">{t('没有文字版：{textError}', { textError })}</div>}
      {open === undefined ? null : <FilePreview path={open} onClose={() => setOpen(undefined)} />}
    </>
  )
}

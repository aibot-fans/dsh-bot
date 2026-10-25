import { useEffect, useState } from 'react'
import { mediaUrl } from '../api/http.ts'
import { Drawer } from './common.tsx'
import { fileKind, isTextual, type FileKind } from './fileKinds.ts'
import { Markdown } from './Markdown.tsx'

/** 简单的 CSV：支持双引号包起来的逗号。 */
function parseCsv(text: string, separator: string): readonly (readonly string[])[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .slice(0, 200)
    .map((line) => {
      const cells: string[] = []
      let cell = ''
      let quoted = false
      for (let index = 0; index < line.length; index += 1) {
        const char = line[index] as string
        if (char === '"' && line[index + 1] === '"' && quoted) {
          cell += '"'
          index += 1
        } else if (char === '"') quoted = !quoted
        else if (char === separator && !quoted) {
          cells.push(cell)
          cell = ''
        } else cell += char
      }
      return [...cells, cell]
    })
}

/** 页面里最多显示 20 万字（截在换行处）：大表格的文字版整个画出来浏览器会卡。 */
const PREVIEW_CHARS = 200_000

function clip(text: string): { readonly text: string; readonly clipped: boolean } {
  if (text.length <= PREVIEW_CHARS) return { text, clipped: false }
  const cut = text.lastIndexOf('\n', PREVIEW_CHARS)
  return { text: text.slice(0, cut > 0 ? cut : PREVIEW_CHARS), clipped: true }
}

/** JSON 排好缩进再显示；不是合法的 JSON 就原样显示。 */
function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function TextPreview(props: { readonly kind: FileKind; readonly text: string; readonly path: string }) {
  switch (props.kind) {
    case 'markdown':
      return <Markdown text={props.text} />
    case 'table':
      return (
        <div className="pod-preview-table">
          <table>
            <tbody>
              {parseCsv(props.text, props.path.toLowerCase().endsWith('.tsv') ? '\t' : ',').map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (rowIndex === 0 ? <th key={cellIndex}>{cell}</th> : <td key={cellIndex}>{cell}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'html':
      return <iframe className="pod-preview-frame" sandbox="" srcDoc={props.text} title={props.path} />
    case 'json':
      return <pre className="pod-preview-text pod-preview-code">{prettyJson(props.text)}</pre>
    default:
      return <pre className="pod-preview-text">{props.text}</pre>
  }
}

/** 浏览器自己会显示的格式直接交给它；Office、压缩包这类给下载。 */
function MediaPreview(props: { readonly kind: FileKind; readonly url: string; readonly name: string }) {
  switch (props.kind) {
    case 'image':
      return <img className="pod-preview-image" src={props.url} alt={props.name} />
    case 'pdf':
      return <iframe className="pod-preview-frame pod-preview-pdf" src={props.url} title={props.name} />
    case 'audio':
      return <audio className="pod-preview-audio" controls preload="metadata" src={props.url} />
    case 'video':
      return <video className="pod-preview-video" controls preload="metadata" src={props.url} />
    default:
      return (
        <div className="pod-preview-none">
          <strong>这种格式没法在页面里直接预览</strong>
          <span className="pod-muted">点上面的“下载”，用本机的软件打开。你上传的 Word、Excel、PPT 会自动转一份文字版，点消息里的「文字版」就能看。</span>
        </div>
      )
  }
}

/** 产物预览：Markdown、表格、图片、PDF、音视频、JSON、HTML（放进沙箱，不执行脚本）、其他文本；都能下载。 */
export function FilePreview(props: { readonly path: string; readonly taskId?: string; readonly onClose: () => void }) {
  const query = { path: props.path, ...(props.taskId === undefined ? {} : { taskId: props.taskId }) }
  const url = mediaUrl('/file', query)
  const kind = fileKind(props.path)
  const textual = isTextual(kind)
  const name = props.path.split('/').at(-1) ?? props.path
  const [text, setText] = useState<{ readonly body: string; readonly partial: boolean } | undefined>(undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!textual) return
    let alive = true
    fetch(url, { credentials: 'same-origin' })
      .then(async (response) => {
        const body = await response.text()
        if (!alive) return
        if (!response.ok) setProblem(body)
        else setText({ body, partial: response.headers.has('x-pod-partial') })
      })
      .catch((reason: unknown) => alive && setProblem(reason instanceof Error ? reason.message : String(reason)))
    return () => {
      alive = false
    }
  }, [url, textual])
  const shown = text === undefined ? undefined : clip(text.body)
  return (
    <Drawer title={name} onClose={props.onClose} wide>
      <div className="pod-preview-head">
        <span className="pod-hint pod-ellipsis" title={props.path}>
          {props.path}
        </span>
        <a className="pod-button pod-button-small" href={mediaUrl('/file', { ...query, download: '1' })} download={name}>
          下载
        </a>
      </div>
      {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
      {shown === undefined || !(shown.clipped || text?.partial === true) ? null : <p className="pod-hint">文件比较大，这里只显示开头一部分；完整内容点“下载”。</p>}
      {textual ? shown === undefined ? null : <TextPreview kind={kind} text={shown.text} path={props.path} /> : <MediaPreview kind={kind} url={url} name={name} />}
    </Drawer>
  )
}

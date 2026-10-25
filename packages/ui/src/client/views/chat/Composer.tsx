import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { OWNER, QUICK_COMMANDS, parseQuickCommand, type Bot, type Room, type RoomMessage } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Avatar, IconButton } from '../../components/common.tsx'
import { BotName } from '../../components/GroupMark.tsx'
import { Icon } from '../../components/Icon.tsx'
import { buildMentions } from '../../components/mentions.tsx'
import { useApp } from '../../state/app.ts'

export interface ComposerProps {
  readonly room: Room
  readonly responder: Bot | undefined
  /** 群成员，@ 的候选。 */
  readonly members: readonly Bot[]
  readonly replyTo: RoomMessage | undefined
  readonly onClearReply: () => void
  readonly onSent: () => void
  readonly bots: ReadonlyMap<string, Bot>
  /** 有 bot 正在回答：输入框是空的时候按钮变成停止。 */
  readonly replying: boolean
}

interface Pending {
  readonly id: string
  readonly file: File
  readonly preview: string | undefined
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('读不了这个文件'))
    reader.readAsDataURL(file)
  })
}

/** 粘贴的截图没有文件名：按时间起一个。 */
function nameOf(file: File): string {
  if (file.name !== '' && file.name !== 'image.png') return file.name
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')
  return `截图-${stamp}.${file.type.split('/')[1] ?? 'png'}`
}

/** 光标前面正在输入的 @ 词：返回词的起点和已经打的字。 */
function mentionAt(text: string, caret: number): { readonly start: number; readonly query: string } | undefined {
  const before = text.slice(0, caret)
  const match = /(^|\s)@([^\s@]{0,24})$/.exec(before)
  if (match === null) return undefined
  return { start: before.length - (match[2]?.length ?? 0) - 1, query: match[2] ?? '' }
}

/** 输入框底下那层：和输入框一样排版，把 @成员 标成彩色；输入框本身的字是透明的，看到的是这一层。 */
function highlight(text: string, pattern: RegExp | null): ReactNode {
  if (pattern === null || !text.includes('@')) return text
  const parts: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0
    if (start > last) parts.push(text.slice(last, start))
    parts.push(
      <mark key={start} className="pod-composer-mention">
        {match[0]}
      </mark>,
    )
    last = start + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

/**
 * 输入框：Enter 发送、Shift+Enter 换行，中文输入法组字时不会误发；群聊里 @ 到的成员标成彩色。
 * 可以直接粘贴或拖入图片和文件；群聊里输入 @ 选成员；以 / 开头是快捷指令；bot 回答时可以停止。
 */
export function Composer(props: ComposerProps) {
  const app = useApp()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [pending, setPending] = useState<readonly Pending[]>([])
  const [mention, setMention] = useState<{ readonly start: number; readonly query: string; readonly index: number } | undefined>(undefined)
  const composing = useRef(false)
  const [ime, setIme] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const mentionPattern = useMemo(() => buildMentions(props.members.map((bot) => ({ name: bot.name, bot, onOpen: () => undefined }))).pattern, [props.members])
  const name = props.responder?.name ?? 'bot'
  const group = props.room.kind !== 'direct'
  const placeholder = group ? '在群里说点什么，输入 @ 点名成员' : `给 ${name} 发消息`
  const showCommands = text.startsWith('/') && !text.includes(' ') && !text.includes('\n')
  const commands = showCommands ? QUICK_COMMANDS.filter((command) => `/${command.name}`.startsWith(text.trim()) || text.trim() === '/') : []
  const candidates = mention === undefined ? [] : props.members.filter((bot) => bot.name.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 8)

  useEffect(() => () => pending.forEach((item) => item.preview !== undefined && URL.revokeObjectURL(item.preview)), [])
  useEffect(() => {
    setText('')
    setPending([])
    setError(undefined)
  }, [props.room.id])
  useEffect(
    () =>
      app.onInsert((roomId, inserted) => {
        if (roomId !== props.room.id) return
        setText((current) => (current === '' || /\s$/.test(current) ? `${current}${inserted}` : `${current} ${inserted}`))
        requestAnimationFrame(() => {
          const element = area.current
          if (element === null) return
          element.focus()
          element.setSelectionRange(element.value.length, element.value.length)
        })
      }),
    [app, props.room.id],
  )

  const addFiles = (files: readonly File[]): void => {
    const added = files.slice(0, 8).map((file) => ({ id: `${Date.now()}-${Math.random()}`, file, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined }))
    if (added.length > 0) setPending((current) => [...current, ...added].slice(0, 8))
  }

  const removePending = (id: string): void => {
    setPending((current) => {
      const target = current.find((item) => item.id === id)
      if (target?.preview !== undefined) URL.revokeObjectURL(target.preview)
      return current.filter((item) => item.id !== id)
    })
  }

  /** 文件逐个上传：第一个带上你写的话，bot 收到文件路径，图片在时间线里显示缩略图。 */
  const sendFiles = async (note: string): Promise<void> => {
    let first = true
    for (const item of pending) {
      const data = await readBase64(item.file)
      await api.uploadFile(props.room.id, nameOf(item.file), data, first ? note : '')
      first = false
    }
    pending.forEach((item) => item.preview !== undefined && URL.revokeObjectURL(item.preview))
    setPending([])
  }

  const send = (): void => {
    const value = text.trim()
    if (busy || (value === '' && pending.length === 0)) return
    // /停止 直接停掉这个对话里的任务和回答，不用经过 bot。
    if (pending.length === 0 && parseQuickCommand(value)?.name === '停止') {
      const work = props.room.taskId === null ? api.stopReply(props.room.id) : api.controlTask(props.room.taskId, 'stop')
      work.then(() => setText('')).catch((reason: unknown) => setError(errorText(reason)))
      return
    }
    setBusy(true)
    setError(undefined)
    const work = pending.length > 0 ? sendFiles(value) : api.send(props.room.id, value, props.replyTo?.id)
    work
      .then(() => {
        setText('')
        props.onClearReply()
        props.onSent()
        area.current?.focus()
      })
      .catch((reason: unknown) => setError(errorText(reason)))
      .finally(() => setBusy(false))
  }

  const stop = (): void => {
    api.stopReply(props.room.id).catch((reason: unknown) => setError(errorText(reason)))
  }

  const pick = (bot: Bot): void => {
    if (mention === undefined) return
    const caret = area.current?.selectionStart ?? text.length
    const next = `${text.slice(0, mention.start)}@${bot.name} ${text.slice(caret)}`
    setText(next)
    setMention(undefined)
    requestAnimationFrame(() => {
      const position = mention.start + bot.name.length + 2
      area.current?.focus()
      area.current?.setSelectionRange(position, position)
    })
  }

  const onChange = (value: string, caret: number): void => {
    setText(value)
    const found = group ? mentionAt(value, caret) : undefined
    setMention(found === undefined ? undefined : { ...found, index: 0 })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (mention !== undefined && candidates.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setMention({ ...mention, index: (mention.index + step + candidates.length) % candidates.length })
        return
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && !event.nativeEvent.isComposing) {
        event.preventDefault()
        const chosen = candidates[mention.index] ?? candidates[0]
        if (chosen !== undefined) pick(chosen)
        return
      }
      if (event.key === 'Escape') {
        setMention(undefined)
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !composing.current && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    }
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = [...event.clipboardData.files]
    if (files.length === 0) return
    event.preventDefault()
    addFiles(files)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    const files = [...event.dataTransfer.files]
    if (files.length === 0) return
    event.preventDefault()
    addFiles(files)
  }

  const quoted = props.replyTo
  const empty = text.trim() === '' && pending.length === 0
  const archived = props.room.archivedAt !== null
  return (
    <div className="pod-composer" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      {quoted === undefined ? null : (
        <div className="pod-composer-reply">
          <Icon name="reply" size={13} />
          <span className="pod-ellipsis">
            引用 {quoted.author === OWNER ? '你' : <BotName bot={props.bots.get(quoted.author)} size={14} />}：{quoted.body.slice(0, 80)}
          </span>
          <IconButton icon="close" label="取消引用" onClick={props.onClearReply} />
        </div>
      )}
      {commands.length === 0 ? null : (
        <ul className="pod-commands">
          {commands.map((command) => (
            <li key={command.name}>
              <button
                type="button"
                onClick={() => {
                  setText(command.name === '停止' || command.name === '总结' ? `/${command.name}` : `/${command.name} `)
                  area.current?.focus()
                }}
              >
                <code>{command.usage}</code>
                <span className="pod-muted-inline">{command.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {candidates.length === 0 || mention === undefined ? null : (
        <ul className="pod-mentions" role="listbox" aria-label="选一个成员">
          {candidates.map((bot, index) => (
            <li key={bot.id}>
              <button type="button" role="option" aria-selected={index === mention.index} className={index === mention.index ? 'pod-mention-active' : undefined} onMouseDown={(event) => event.preventDefault()} onClick={() => pick(bot)}>
                <Avatar bot={bot} size={22} />
                <span>{bot.name}</span>
                {bot.title === '' || bot.title === bot.name ? null : <span className="pod-muted-inline">{bot.title}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="pod-composer-box">
        {pending.length === 0 ? null : (
          <div className="pod-pending">
            {pending.map((item) => (
              <span key={item.id} className="pod-pending-item">
                {item.preview === undefined ? <Icon name="file" size={16} /> : <img src={item.preview} alt="" />}
                <span className="pod-ellipsis">{nameOf(item.file)}</span>
                <button type="button" className="pod-pending-remove" aria-label={`去掉 ${nameOf(item.file)}`} onClick={() => removePending(item.id)}>
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="pod-composer-row">
          <input ref={fileInput} type="file" multiple hidden onChange={(event) => addFiles([...(event.target.files ?? [])])} />
          <IconButton icon="plus" label="添加图片或文件" disabled={busy || archived} onClick={() => fileInput.current?.click()} />
          <div className={`pod-composer-field${ime ? ' pod-composer-field-ime' : ''}`}>
            <div ref={mirror} className="pod-composer-mirror" aria-hidden>
              {highlight(text, mentionPattern)}
              {'​'}
            </div>
            <textarea
              ref={area}
              className="pod-composer-input"
              value={text}
              placeholder={archived ? '这个对话已经删除' : placeholder}
              rows={1}
              onChange={(event) => onChange(event.target.value, event.target.selectionStart)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onScroll={(event) => {
                if (mirror.current !== null) mirror.current.scrollTop = event.currentTarget.scrollTop
              }}
              onBlur={() => setTimeout(() => setMention(undefined), 120)}
              onCompositionStart={() => {
                composing.current = true
                setIme(true)
              }}
              onCompositionEnd={() => {
                composing.current = false
                setIme(false)
              }}
              disabled={archived}
              aria-label={placeholder}
            />
          </div>
          {props.replying && empty ? (
            <button type="button" className="pod-send pod-send-stop" onClick={stop} aria-label="停止回答" title="停止回答">
              <Icon name="stop" size={14} />
            </button>
          ) : (
            <button type="button" className="pod-send" onClick={send} disabled={busy || empty} aria-label="发送">
              <Icon name="send" size={16} />
            </button>
          )}
        </div>
      </div>
      {error === undefined ? null : <p className="pod-form-error">{error}</p>}
    </div>
  )
}

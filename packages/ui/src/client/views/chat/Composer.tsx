import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { OWNER, parseQuickCommand, quickCommands, t, type Bot, type Room, type RoomMessage } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Avatar, IconButton } from '../../components/common.tsx'
import { BotName } from '../../components/GroupMark.tsx'
import { Icon } from '../../components/Icon.tsx'
import { useNarrow, useTouch } from '../../components/media.ts'
import { buildMentions } from '../../components/mentions.tsx'
import { RichInput, type MentionQuery, type RichInputHandle } from '../../editor/RichInput.tsx'
import { useApp, useNav } from '../../state/app.ts'
import { readDraft, readDraftFiles, saveDraftFiles, saveDraftText } from '../../state/drafts.ts'

export interface ComposerProps {
  readonly room: Room
  readonly responder: Bot | undefined
  /** 群成员，@ 的候选。 */
  readonly members: readonly Bot[]
  readonly replyTo: RoomMessage | undefined
  readonly onClearReply: () => void
  /** 按下发送、开始发的那一刻（时间线据此回到最新）。 */
  readonly onSubmit: () => void
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

function toPending(file: File): Pending {
  return { id: `${Date.now()}-${Math.random()}`, file, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined }
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error(t('读不了这个文件')))
    reader.readAsDataURL(file)
  })
}

/** 粘贴的截图没有文件名：按时间起一个。 */
function nameOf(file: File): string {
  if (file.name !== '' && file.name !== 'image.png') return file.name
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')
  return t('截图-{stamp}.{value}', { stamp, value: file.type.split('/')[1] ?? 'png' })
}

/**
 * 输入框里的提示；手机上窄，换短的说法。
 * bot 正在回答时也能说话：单聊里它下一步就看到；群里没点名会按分工交给别人，所以提示 @ 它。
 */
function placeholderOf(name: string, group: boolean, replying: boolean, narrow: boolean): string {
  if (replying && group) return narrow ? t('要补充或纠正，@ 它直接说') : t('成员正在回答：要补充或纠正，@ 它直接说')
  if (replying) return narrow ? t('{name} 正在回答，可以直接补充', { name }) : t('{name} 正在回答：可以直接补充或纠正，它下一步就会看到', { name })
  if (group) return narrow ? t('说点什么，@ 点名成员') : t('在群里说点什么，输入 @ 点名成员')
  return t('给 {name} 发消息', { name })
}

/**
 * 输入框：可以写列表、引用、代码块和粗体这些格式（见 editor/），发出去是 Markdown。
 * Enter 发送（列表里接下一项，代码块里换行），Shift+Enter 换行（列表里也是接下一项），中文输入法组字时不会误发；群聊里输入 @ 选成员，@ 到的成员标成彩色。
 * 可以直接粘贴或拖入图片和文件；以 / 开头是快捷指令；bot 回答时可以停止。
 * 没发出去的字和附件按对话存成草稿（换对话时外面用 key 换一个新的输入框），回来接着写。
 */
export function Composer(props: ComposerProps) {
  const app = useApp()
  const nav = useNav()
  const narrow = useNarrow()
  const touch = useTouch()
  const covered = nav.settings !== null || nav.search !== null || nav.drawer !== null || nav.taskId !== null || nav.update
  const roomId = props.room.id
  const [text, setText] = useState(() => readDraft(roomId).text)
  const initial = useRef(text).current
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [pending, setPending] = useState<readonly Pending[]>([])
  const pendingNow = useRef(pending)
  /** 草稿里的附件读回来以前不存，免得把存着的覆盖掉。 */
  const filesRestored = useRef(false)
  const [mention, setMention] = useState<(MentionQuery & { readonly index: number }) | undefined>(undefined)
  const editor = useRef<RichInputHandle>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const mentionPattern = useMemo(() => buildMentions(props.members.map((bot) => ({ name: bot.name, bot, onOpen: () => undefined }))).pattern, [props.members])
  const name = props.responder?.name ?? 'bot'
  const group = props.room.kind !== 'direct'
  const archived = props.room.archivedAt !== null
  const placeholder = archived ? t('这个对话已经删除') : placeholderOf(name, group, props.replying, narrow)
  const showCommands = text.startsWith('/') && !text.includes(' ') && !text.includes('\n')
  const commands = showCommands ? quickCommands().filter((command) => `/${command.name}`.startsWith(text.trim()) || text.trim() === '/') : []
  const candidates = mention === undefined ? [] : props.members.filter((bot) => bot.name.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 8)

  useEffect(() => {
    let alive = true
    void readDraftFiles(roomId).then((files) => {
      if (!alive) return
      filesRestored.current = true
      const restored = files.map(toPending)
      setPending((current) => [...restored, ...current].slice(0, 8))
    })
    return () => {
      alive = false
      pendingNow.current.forEach((item) => item.preview !== undefined && URL.revokeObjectURL(item.preview))
    }
  }, [roomId])
  useEffect(() => saveDraftText(roomId, text), [roomId, text])
  useEffect(() => {
    pendingNow.current = pending
    if (filesRestored.current) saveDraftFiles(roomId, pending.map((item) => item.file))
  }, [roomId, pending])
  useEffect(
    () =>
      app.onInsert((target, inserted) => {
        if (target === props.room.id) editor.current?.append(inserted)
      }),
    [app, props.room.id],
  )
  // 换到这个对话、关掉盖在上面的设置搜索这些回来、在侧栏里再点一下它：光标直接进输入框。触屏上不抢，免得一进对话就弹出键盘。
  useEffect(() => {
    if (!covered && !touch) editor.current?.focus()
  }, [covered, touch])
  useEffect(
    () =>
      app.onFocusComposer((target) => {
        if (target === props.room.id && !touch) editor.current?.focus()
      }),
    [app, props.room.id, touch],
  )

  const addFiles = (files: readonly File[]): void => {
    const added = files.slice(0, 8).map(toPending)
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
    const value = (editor.current?.value() ?? text).trim()
    if (busy || (value === '' && pending.length === 0)) return
    // /停止 直接停掉这个对话里的任务和回答，不用经过 bot。
    if (pending.length === 0 && parseQuickCommand(value)?.id === 'stop') {
      const work = props.room.taskId === null ? api.stopReply(props.room.id) : api.controlTask(props.room.taskId, 'stop')
      work.then(() => editor.current?.reset('')).catch((reason: unknown) => setError(errorText(reason)))
      return
    }
    setBusy(true)
    setError(undefined)
    props.onSubmit()
    const work = pending.length > 0 ? sendFiles(value) : api.send(props.room.id, value, props.replyTo?.id)
    work
      .then(() => {
        editor.current?.reset('')
        props.onClearReply()
        props.onSent()
        editor.current?.focus()
      })
      .catch((reason: unknown) => setError(errorText(reason)))
      .finally(() => setBusy(false))
  }

  const stop = (): void => {
    api.stopReply(props.room.id).catch((reason: unknown) => setError(errorText(reason)))
  }

  const pick = (bot: Bot): void => {
    if (mention === undefined) return
    setMention(undefined)
    editor.current?.replace(mention.from, mention.to, `@${bot.name} `)
  }

  const onMention = (found: MentionQuery | undefined): void => {
    setMention((current) => (found === undefined ? undefined : { ...found, index: current?.query === found.query ? current.index : 0 }))
  }

  /** 候选列表开着时：上下键选、Enter 或 Tab 填进去、Esc 关上。 */
  const onKeyDown = (event: KeyboardEvent): boolean => {
    if (mention === undefined || candidates.length === 0 || event.isComposing) return false
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowDown' ? 1 : -1
      setMention({ ...mention, index: (mention.index + step + candidates.length) % candidates.length })
      return true
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const chosen = candidates[mention.index] ?? candidates[0]
      if (chosen !== undefined) pick(chosen)
      return true
    }
    if (event.key === 'Escape') {
      setMention(undefined)
      return true
    }
    return false
  }

  // 拖到输入框外面、附件那一圈上也收；拖到输入框里的编辑器自己收了（defaultPrevented）。
  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    const files = [...event.dataTransfer.files]
    if (event.defaultPrevented || files.length === 0) return
    event.preventDefault()
    addFiles(files)
  }

  const quoted = props.replyTo
  const empty = text.trim() === '' && pending.length === 0
  return (
    <div className="pod-composer" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      {quoted === undefined ? null : (
        <div className="pod-composer-reply">
          <Icon name="reply" size={13} />
          <span className="pod-ellipsis">
            {t('引用')} {quoted.author === OWNER ? t('你') : <BotName bot={props.bots.get(quoted.author)} size={14} />}{t('：{body}', { body: quoted.body.slice(0, 80) })}
          </span>
          <IconButton icon="close" label={t('取消引用')} onClick={props.onClearReply} />
        </div>
      )}
      {commands.length === 0 ? null : (
        <ul className="pod-commands">
          {commands.map((command) => (
            <li key={command.id}>
              <button
                type="button"
                onClick={() => {
                  editor.current?.reset(command.bare ? `/${command.name}` : `/${command.name} `)
                  editor.current?.focus()
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
        <ul className="pod-mentions" role="listbox" aria-label={t('选一个成员')}>
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
                <button type="button" className="pod-pending-remove" aria-label={t('去掉 {nameOf}', { nameOf: nameOf(item.file) })} onClick={() => removePending(item.id)}>
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="pod-composer-row">
          <input ref={fileInput} type="file" multiple hidden onChange={(event) => addFiles([...(event.target.files ?? [])])} />
          <IconButton icon="plus" label={t('添加图片或文件')} disabled={busy || archived} onClick={() => fileInput.current?.click()} />
          <div className="pod-composer-field">
            <RichInput
              ref={editor}
              initial={initial}
              placeholder={placeholder}
              label={placeholder}
              disabled={archived}
              mentions={mentionPattern}
              mentionable={group}
              onChange={setText}
              onMention={onMention}
              onKeyDown={onKeyDown}
              onSend={send}
              onFiles={addFiles}
              onBlur={() => setTimeout(() => setMention(undefined), 120)}
            />
          </div>
          {props.replying && empty ? (
            <button type="button" className="pod-send pod-send-stop" onClick={stop} aria-label={t('停止回答')} title={t('停止回答')}>
              <Icon name="stop" size={14} />
            </button>
          ) : (
            <button type="button" className="pod-send" onClick={send} disabled={busy || empty} aria-label={t('发送')}>
              <Icon name="send" size={16} />
            </button>
          )}
        </div>
      </div>
      {error === undefined ? null : <p className="pod-form-error">{error}</p>}
    </div>
  )
}

/**
 * 记忆的整理：记忆页最上面一条说上次整理了什么；主题笔记一页一行，点开是正文，每句话能看出处；
 * 整理记录一晚一行，点开是这一晚的每一处改动（新加的句子左边一道线，去掉的划掉），等你看的前面有勾。
 * 抽屉盖在设置窗口上面：从设置里打开“你的档案”“整理记录”时不会被挡在后面，关掉抽屉回到设置。
 */
export const V20_CSS = `
.pod-drawer-backdrop { z-index: 62; }
.pod-dream-bar { border: 1px solid var(--pod-line); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.pod-dream-bar-text { flex: 1; min-width: 180px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.pod-dream-guide summary { cursor: pointer; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.pod-dream-guide .pod-row { margin-top: 6px; }
.pod-notes, .pod-dreams, .pod-dream-ops { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
.pod-note, .pod-dream { border: 1px solid var(--pod-line); border-radius: 10px; padding: 8px 12px; display: flex; flex-direction: column; gap: 8px; }
.pod-note-archived { opacity: .6; }
.pod-note-head, .pod-dream-head { appearance: none; border: 0; background: none; padding: 2px 0; font: inherit; color: inherit; cursor: pointer; display: flex; align-items: baseline; gap: 8px; text-align: left; width: 100%; min-width: 0; }
.pod-note-title { font-weight: 600; font-size: 14px; flex: none; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pod-note-about, .pod-dream-summary { flex: 1; min-width: 0; font-size: 13px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pod-dream-head[aria-expanded="true"] .pod-dream-summary { white-space: normal; }
.pod-dream-head time { flex: none; font-size: 12px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.pod-note-lines, .pod-dream-lines { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
.pod-note-lines > li, .pod-dream-lines > li { padding-left: 10px; border-left: 2px solid transparent; }
.pod-note-line { flex: 1; min-width: 0; }
.pod-note-trace { flex: none; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.pod-dream-evidence { margin: 2px 0 4px; padding: 0 0 0 14px; list-style: none; font-size: 12px; color: var(--dsw-alias-label-tertiary); display: flex; flex-direction: column; gap: 2px; }
.pod-dream-evidence .pod-link { font-size: 12px; }
.pod-dream-detail { display: flex; flex-direction: column; gap: 12px; border-top: 1px solid var(--pod-line); padding-top: 10px; }
.pod-dream-held { margin: 0; font-size: 13px; color: var(--pod-warn); }
.pod-dream-op, .pod-dream-question { border: 1px solid var(--pod-line); border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
.pod-dream-op-off { opacity: .55; }
.pod-dream-note-title { font-weight: 600; }
.pod-dream-lines > li.pod-dream-line-new { border-left-color: var(--pod-ok); }
.pod-dream-lines > li.pod-dream-line-gone { text-decoration: line-through; color: var(--dsw-alias-label-tertiary); border-left-color: var(--pod-warn); }
.pod-dream-core pre { margin: 0; white-space: pre-wrap; font: inherit; font-size: 13px; }
.pod-dream-core-old { text-decoration: line-through; color: var(--dsw-alias-label-tertiary); margin-bottom: 6px !important; }
.pod-dream-rejected summary { cursor: pointer; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.pod-dream-rejected ul { margin: 6px 0 0; padding-left: 18px; font-size: 13px; display: flex; flex-direction: column; gap: 2px; }
`

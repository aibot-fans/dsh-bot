// 开发用：浏览器截图用的「示例公司 OA」，只有一个会议室预订页，开在本机 8125 端口。
// 演示环境的共用浏览器要把 oa.example.com 指到这里，做法见 docs/DEVELOPMENT.md。
import { createServer } from 'node:http'

const style = `
  body { margin: 0; font: 17px/1.6 -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; color: #1d2433; background: #f3f5f9; }
  header { height: 60px; background: #1f4fd8; color: #fff; display: flex; align-items: center; gap: 28px; padding: 0 36px; }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 18px; }
  .logo { width: 30px; height: 30px; border-radius: 8px; background: #fff; color: #1f4fd8; display: grid; place-items: center; font-weight: 700; }
  nav { display: flex; gap: 22px; opacity: .82; }
  nav .on { opacity: 1; font-weight: 600; border-bottom: 2px solid #fff; padding-bottom: 2px; }
  main { max-width: 820px; margin: 34px auto; background: #fff; border-radius: 14px; padding: 30px 38px 34px; box-shadow: 0 1px 4px rgba(16, 24, 40, .08); }
  h1 { font-size: 26px; margin: 0 0 4px; }
  .sub { color: #5d6b82; margin: 0 0 24px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 22px; }
  .full { grid-column: 1 / -1; }
  label { display: block; font-size: 15px; color: #45526a; margin-bottom: 6px; }
  input, select, textarea { width: 100%; box-sizing: border-box; border: 1px solid #cfd6e2; border-radius: 9px; padding: 9px 12px; font: inherit; color: inherit; background: #fff; }
  textarea { resize: none; }
  .actions { margin-top: 24px; display: flex; gap: 12px; align-items: center; }
  button { background: #1f4fd8; color: #fff; border: 0; border-radius: 9px; padding: 11px 28px; font: inherit; font-weight: 600; }
  .muted { color: #5d6b82; font-size: 15px; }
  table { border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; color: #5d6b82; font-weight: 400; padding: 6px 28px 6px 0; }
  .ok { color: #157f3b; }
`

function page(title, body) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title} · 示例公司办公平台</title><style>${style}</style></head><body>
<header><div class="brand"><span class="logo">示</span>示例公司 · 办公平台</div><nav><span>工作台</span><span class="on">会议室</span><span>审批</span><span>通讯录</span></nav></header>
<main>${body}</main></body></html>`
}

const FORM = page('预订会议室', `
<h1>预订会议室</h1>
<p class="sub">10 月 30 日（周五）下午空闲：3F 大会议室、5F 小会议室</p>
<form method="post" action="/rooms/book">
  <div class="grid">
    <div><label for="room">会议室</label><select id="room" name="room"><option value="">请选择</option><option>3F 大会议室（12 人）</option><option>5F 小会议室（6 人）</option><option>7F 洽谈室（4 人）</option></select></div>
    <div><label for="date">日期</label><input id="date" name="date" placeholder="例如 2026-10-30"></div>
    <div><label for="start">开始时间</label><input id="start" name="start" placeholder="例如 14:00"></div>
    <div><label for="end">结束时间</label><input id="end" name="end" placeholder="例如 15:30"></div>
    <div><label for="people">参会人数</label><input id="people" name="people" inputmode="numeric"></div>
    <div><label for="topic">会议主题</label><input id="topic" name="topic"></div>
    <div class="full"><label for="note">备注</label><textarea id="note" name="note" rows="2"></textarea></div>
  </div>
  <div class="actions"><button type="submit">提交预订</button><span class="muted">提交后会议室门口的屏幕会显示这场会议</span></div>
</form>`)

const escape = (text) => text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char])

function booked(fields) {
  const rows = [['会议室', 'room'], ['日期', 'date'], ['时间', 'time'], ['参会人数', 'people'], ['会议主题', 'topic'], ['备注', 'note']]
  const values = { ...fields, time: `${fields.start ?? ''}–${fields.end ?? ''}` }
  return page('预订成功', `<h1 class="ok">预订成功</h1><p class="sub">会议室门口的屏幕会显示这场会议。</p><table>${rows.map(([label, key]) => `<tr><th>${label}</th><td>${escape(values[key] ?? '')}</td></tr>`).join('')}</table>`)
}

createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/rooms/book') {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(booked(Object.fromEntries(new URLSearchParams(body))))
    })
    return
  }
  if (request.url === '/rooms/book' || request.url === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(FORM)
    return
  }
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  response.end('没有这个页面')
}).listen(8125, '127.0.0.1', () => console.log('demo site on 8125'))

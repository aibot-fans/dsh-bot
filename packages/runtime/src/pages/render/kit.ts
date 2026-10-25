import { createHash } from 'node:crypto'

/**
 * Pod 自带的组件脚本：只管交互（悬停看数值、表格排序、幻灯片翻页和缩放、原型跳屏、跟着外面切换深浅色、
 * 把链接交给外层打开）。页面内容都是在宿主里渲染好的，脚本不跑也能看。
 * CSP 按这段脚本的哈希放行，别的脚本一律不执行；脚本里不用模板字符串，免得和这里的写法冲突。
 */
export const KIT_SCRIPT = String.raw`(function () {
  var doc = document, root = doc.documentElement, body = doc.body
  var framed = window.parent !== window
  var exporting = body.classList.contains('mode-export')
  root.classList.add('js')
  function each(list, fn) { Array.prototype.forEach.call(list, fn) }
  function closest(target, selector) { return target && target.closest ? target.closest(selector) : null }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return
    var data = event.data || {}
    if (data.type === 'pod-page-theme' && (data.theme === 'light' || data.theme === 'dark')) root.setAttribute('data-theme', data.theme)
  })

  doc.addEventListener('click', function (event) {
    var anchor = closest(event.target, 'a[href]')
    if (!anchor) return
    var href = anchor.getAttribute('href') || ''
    if (!/^(https?:|mailto:)/i.test(href)) { event.preventDefault(); return }
    if (framed) { event.preventDefault(); window.parent.postMessage({ type: 'pod-page-link', href: href }, '*') }
  })

  var tip = null
  function place(x, y) {
    var width = tip.offsetWidth, height = tip.offsetHeight
    var left = x + 14, top = y + 14
    if (left + width > window.innerWidth - 8) left = x - width - 14
    if (top + height > window.innerHeight - 8) top = y - height - 14
    tip.style.left = Math.max(8, left) + 'px'
    tip.style.top = Math.max(8, top) + 'px'
  }
  function showTip(x, y, build) {
    if (!tip) { tip = doc.createElement('div'); tip.className = 'tip'; tip.setAttribute('role', 'tooltip'); body.appendChild(tip) }
    tip.textContent = ''
    build(tip)
    tip.style.display = 'block'
    place(x, y)
  }
  function hideTip() { if (tip) tip.style.display = 'none' }
  function textTip(text) {
    return function (box) {
      var lines = String(text).split('\n')
      var head = doc.createElement('div'); head.className = 'tip-head'; head.textContent = lines[0]; box.appendChild(head)
      for (var i = 1; i < lines.length; i += 1) { var row = doc.createElement('div'); row.textContent = lines[i]; box.appendChild(row) }
    }
  }
  doc.addEventListener('pointermove', function (event) {
    var holder = closest(event.target, '[data-tip]')
    if (holder) { showTip(event.clientX, event.clientY, textTip(holder.getAttribute('data-tip'))); return }
    if (!closest(event.target, 'svg.xy')) hideTip()
  })
  root.addEventListener('pointerleave', hideTip)

  each(doc.querySelectorAll('svg.xy'), function (svg) {
    var data
    try { data = JSON.parse(svg.getAttribute('data-xy')) } catch (error) { return }
    var line = svg.querySelector('.xhair'), current = -1
    function nearest(x) {
      var best = 0, distance = Infinity
      data.x.forEach(function (value, index) { var gap = Math.abs(value - x); if (gap < distance) { distance = gap; best = index } })
      return best
    }
    function show(index, x, y) {
      current = index
      line.setAttribute('x1', data.x[index]); line.setAttribute('x2', data.x[index])
      svg.classList.add('hover')
      showTip(x, y, function (box) {
        var head = doc.createElement('div'); head.className = 'tip-head'; head.textContent = data.labels[index]; box.appendChild(head)
        data.series.forEach(function (series, position) {
          var row = doc.createElement('div'); row.className = 'tip-row'
          var key = doc.createElement('i'); key.className = 'tip-key'; key.style.setProperty('--k', 'var(--c' + ((position % 8) + 1) + ')')
          var value = doc.createElement('b'), raw = series.values[index]
          value.textContent = raw === null || raw === undefined ? '—' : Number(raw).toLocaleString('zh-CN', { maximumFractionDigits: 2 }) + (data.unit || '')
          var name = doc.createElement('span'); name.textContent = series.name || ('第 ' + (position + 1) + ' 组')
          row.appendChild(key); row.appendChild(value); row.appendChild(name); box.appendChild(row)
        })
      })
    }
    svg.addEventListener('pointermove', function (event) {
      var matrix = svg.getScreenCTM()
      if (!matrix) return
      var point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY
      show(nearest(point.matrixTransform(matrix.inverse()).x), event.clientX, event.clientY)
    })
    svg.addEventListener('pointerleave', function () { svg.classList.remove('hover'); hideTip() })
    svg.addEventListener('blur', function () { svg.classList.remove('hover'); hideTip() })
    svg.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      var next = current < 0 ? 0 : Math.max(0, Math.min(data.x.length - 1, current + (event.key === 'ArrowRight' ? 1 : -1)))
      var matrix = svg.getScreenCTM(), point = svg.createSVGPoint()
      point.x = data.x[next]; point.y = data.top
      var screen = matrix ? point.matrixTransform(matrix) : { x: 0, y: 0 }
      show(next, screen.x, screen.y)
    })
  })

  each(doc.querySelectorAll('table.sortable'), function (table) {
    var heads = table.querySelectorAll('th[data-col]')
    each(heads, function (th) {
      th.querySelector('button').addEventListener('click', function () {
        var column = Number(th.getAttribute('data-col'))
        var direction = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending'
        each(heads, function (other) { other.setAttribute('aria-sort', 'none') })
        th.setAttribute('aria-sort', direction)
        var tbody = table.tBodies[0], rows = Array.prototype.slice.call(tbody.rows)
        var values = rows.map(function (row) { var cell = row.cells[column]; return cell ? cell.getAttribute('data-v') || '' : '' })
        var numeric = values.every(function (value) { return value === '' || !isNaN(Number(value)) })
        rows.map(function (row, index) { return { row: row, value: values[index], index: index } })
          .sort(function (a, b) {
            if (a.value === '' && b.value !== '') return 1
            if (b.value === '' && a.value !== '') return -1
            var order = numeric ? Number(a.value) - Number(b.value) : a.value.localeCompare(b.value, 'zh-CN')
            return (direction === 'ascending' ? order : -order) || a.index - b.index
          })
          .forEach(function (item) { tbody.appendChild(item.row) })
      })
    })
  })

  if (exporting) return

  var deck = doc.querySelector('.deck')
  if (deck) {
    var slides = deck.querySelectorAll('.slide'), stage = deck.querySelector('.deck-stage'), holder = deck.querySelector('.slides')
    var counter = deck.querySelector('.deck-count'), panel = deck.querySelector('.notes-panel')
    var prev = deck.querySelector('[data-deck="prev"]'), next = deck.querySelector('[data-deck="next"]')
    var index = 0
    var go = function (target) {
      index = Math.max(0, Math.min(slides.length - 1, target))
      each(slides, function (slide, position) { slide.classList.toggle('on', position === index) })
      if (counter) counter.textContent = (index + 1) + ' / ' + slides.length
      var notes = slides[index] ? slides[index].querySelector('.notes') : null
      if (panel) panel.textContent = notes ? notes.textContent : '这一页没有备注'
      if (prev) prev.disabled = index === 0
      if (next) next.disabled = index === slides.length - 1
    }
    var scale = function () {
      var ratio = Math.min((stage.clientWidth - 32) / 1280, (stage.clientHeight - 32) / 720)
      holder.style.transform = 'scale(' + Math.max(0.1, ratio) + ')'
    }
    deck.addEventListener('click', function (event) {
      var button = closest(event.target, '[data-deck]')
      if (!button) return
      var action = button.getAttribute('data-deck')
      if (action === 'prev') go(index - 1)
      else if (action === 'next') go(index + 1)
      else { deck.classList.toggle('show-notes'); scale() }
    })
    doc.addEventListener('keydown', function (event) {
      var key = event.key
      if (key === 'ArrowRight' || key === 'PageDown' || key === ' ') { event.preventDefault(); go(index + 1) }
      else if (key === 'ArrowLeft' || key === 'PageUp') { event.preventDefault(); go(index - 1) }
      else if (key === 'Home') go(0)
      else if (key === 'End') go(slides.length - 1)
    })
    window.addEventListener('resize', scale)
    scale()
    go(0)
  }

  var posterBox = doc.querySelector('.poster-scale')
  if (posterBox) {
    var poster = posterBox.querySelector('.poster')
    var fitPoster = function () {
      var width = Number(posterBox.getAttribute('data-w')), height = Number(posterBox.getAttribute('data-h'))
      var ratio = Math.min((window.innerWidth - 48) / width, 1)
      posterBox.style.width = width * ratio + 'px'
      posterBox.style.height = height * ratio + 'px'
      poster.style.transformOrigin = '0 0'
      poster.style.transform = 'scale(' + ratio + ')'
    }
    window.addEventListener('resize', fitPoster)
    fitPoster()
  }

  var proto = doc.querySelector('.proto')
  if (proto) {
    var frame = proto.querySelector('.frame'), protoStage = proto.querySelector('.proto-stage')
    var screens = proto.querySelectorAll('.screen'), links = proto.querySelectorAll('[data-screen-link]')
    var showScreen = function (id) {
      var found = false
      each(screens, function (screen) { if (screen.getAttribute('data-screen') === id) found = true })
      if (!found) return
      each(screens, function (screen) {
        var on = screen.getAttribute('data-screen') === id
        screen.classList.toggle('on', on)
        var scroller = screen.querySelector('.screen-body')
        if (on && scroller) scroller.scrollTop = 0
      })
      each(links, function (link) { link.classList.toggle('on', link.getAttribute('data-screen-link') === id) })
    }
    var activate = function (target) {
      var link = closest(target, '[data-screen-link]')
      if (link) { showScreen(link.getAttribute('data-screen-link')); return true }
      var jump = closest(target, '[data-goto]')
      if (jump) { showScreen(jump.getAttribute('data-goto')); return true }
      var toggle = closest(target, '.ui-switch')
      if (toggle) { toggle.classList.toggle('on'); toggle.setAttribute('aria-checked', String(toggle.classList.contains('on'))); return true }
      var segment = closest(target, '.ui-seg-item')
      if (segment) { each(segment.parentNode.children, function (child) { child.classList.toggle('on', child === segment) }); return true }
      return false
    }
    proto.addEventListener('click', function (event) { activate(event.target) })
    proto.addEventListener('keydown', function (event) {
      if ((event.key === 'Enter' || event.key === ' ') && !closest(event.target, 'input,textarea') && activate(event.target)) event.preventDefault()
    })
    var fitFrame = function () {
      frame.style.transform = 'none'
      var ratio = Math.min((protoStage.clientWidth - 32) / frame.offsetWidth, (protoStage.clientHeight - 32) / frame.offsetHeight, 1)
      frame.style.transform = 'scale(' + Math.max(0.1, ratio) + ')'
    }
    window.addEventListener('resize', fitFrame)
    fitFrame()
  }
})()`

/** CSP 里放行组件脚本用的哈希。 */
export const KIT_HASH = `sha256-${createHash('sha256').update(KIT_SCRIPT, 'utf8').digest('base64')}`

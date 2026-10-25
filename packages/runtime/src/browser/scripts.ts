/**
 * 注入页面执行的脚本。写成普通 JS 字符串（不用打包后的函数源码），用 String.raw 保住正则里的反斜杠。
 * 元素引用存在页面的 window.__pod 里：同一个元素在同一个文档里引用不变，页面跳转后失效。
 */

import { SECRET_AUTOCOMPLETE, SECRET_FIELD_PATTERNS } from 'pod-domain'

const STATE = String.raw`var state = window.__pod || (window.__pod = { refs: new Map(), of: new WeakMap(), next: 1 });
function refOf(el) { var r = state.of.get(el); if (!r) { r = 'e' + state.next++; state.of.set(el, r); } state.refs.set(r, el); return r; }
function clean(t, n) { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; }
function visible(el) {
  if (el.checkVisibility) return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  var r = el.getBoundingClientRect(); return r.width > 0 || r.height > 0;
}
function labelText(label) {
  var text = '';
  for (var node = label.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 3) text += node.nodeValue;
    else if (node.nodeType === 1 && !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(node.tagName)) text += node.innerText;
  }
  return text.trim() || label.innerText;
}
function labelOf(el) {
  var aria = el.getAttribute('aria-label'); if (aria) return aria;
  var by = el.getAttribute('aria-labelledby');
  if (by) { var target = document.getElementById(by.split(' ')[0]); if (target) return target.innerText; }
  if (el.labels && el.labels.length) return labelText(el.labels[0]);
  return el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('alt') || '';
}`

/** 认密码、验证码、银行卡这类字段（规则和 bot 不填的字段一样）：快照和审批卡里只说填没填，不给值，免得进模型和数据库。 */
const SECRET = String.raw`var SECRET_FIELDS = [${SECRET_FIELD_PATTERNS.map((pattern) => `/${pattern.source}/${pattern.flags}`).join(', ')}];
function secretField(el) {
  if (el.type === 'password') return true;
  if (/${SECRET_AUTOCOMPLETE.source}/.test(String(el.getAttribute('autocomplete') || '').toLowerCase())) return true;
  var field = [el.getAttribute('name'), el.id, el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.labels && el.labels.length ? labelText(el.labels[0]) : ''].filter(Boolean).join(' ');
  return SECRET_FIELDS.some(function (pattern) { return pattern.test(field); });
}`

/** 页面快照：标题、可操作元素（带引用）和正文，按字数分页。 */
export const SNAPSHOT = String.raw`(function (maxChars, page) {
${STATE}
${SECRET}
var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, CANVAS: 1, OBJECT: 1, EMBED: 1, HEAD: 1, META: 1, LINK: 1 };
var BLOCK = /^(P|DIV|SECTION|ARTICLE|MAIN|ASIDE|HEADER|FOOTER|NAV|UL|OL|LI|TABLE|THEAD|TBODY|TR|FORM|FIELDSET|DL|DT|DD|BLOCKQUOTE|PRE|FIGURE|FIGCAPTION|ADDRESS|DETAILS|DIALOG|LABEL)$/;
var ROLE = { A: 'link', BUTTON: 'button', SELECT: 'select', TEXTAREA: 'textbox', SUMMARY: 'button' };
var INPUT_ROLE = { checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button', reset: 'button', image: 'button', range: 'slider', file: 'file', search: 'searchbox' };
var lines = []; var buffer = ''; var total = 0;
function flush() { var t = buffer.replace(/\s+/g, ' ').trim(); if (t) { t = t.length > 500 ? t.slice(0, 500) + '…' : t; lines.push(t); total += t.length; } buffer = ''; }
function interactive(el) {
  var tag = el.tagName;
  if (tag === 'A') return el.hasAttribute('href');
  if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'SUMMARY') return true;
  if (tag === 'INPUT') return el.type !== 'hidden';
  var role = el.getAttribute('role');
  if (role && /^(button|link|checkbox|radio|tab|menuitem|option|switch|combobox|textbox|searchbox|slider)$/.test(role)) return true;
  if (el.isContentEditable && !(el.parentElement && el.parentElement.isContentEditable)) return true;
  return el.hasAttribute('onclick');
}
function describe(el) {
  var tag = el.tagName; var ref = refOf(el);
  var role = el.getAttribute('role') || ROLE[tag] || (tag === 'INPUT' ? (INPUT_ROLE[el.type] || 'textbox') : el.isContentEditable ? 'textbox' : 'clickable');
  var own = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ? '' : el.innerText;
  var name = clean(labelOf(el) || own || (tag === 'INPUT' && (el.type === 'submit' || el.type === 'button') ? el.value : ''), 80);
  var line = '[' + ref + '] ' + role + (name ? ' "' + name + '"' : '');
  if (tag === 'A') { var href = el.getAttribute('href') || ''; if (href && href.indexOf('javascript:') !== 0) line += ' -> ' + clean(href, 90); }
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    var type = tag === 'TEXTAREA' ? 'textarea' : el.type;
    if (type === 'checkbox' || type === 'radio') line += el.checked ? ' (已选)' : ' (未选)';
    else if (secretField(el)) line += el.value ? ' (已填)' : ' (空)';
    else if (type !== 'submit' && type !== 'button' && type !== 'image' && type !== 'file') line += ' 值="' + clean(el.value, 60) + '"';
  }
  if (tag === 'SELECT') {
    var options = Array.prototype.slice.call(el.options, 0, 12).map(function (o) { return (o.selected ? '*' : '') + clean(o.text, 30); });
    line += ' 选项：' + options.join(' | ') + (el.options.length > 12 ? ' …共 ' + el.options.length + ' 项' : '');
  }
  if (el.disabled) line += ' (不可用)';
  var expanded = el.getAttribute('aria-expanded'); if (expanded) line += expanded === 'true' ? ' (展开)' : ' (收起)';
  return line;
}
function walk(node, quiet) {
  for (var child = node.firstChild; child && total < 400000; child = child.nextSibling) {
    if (child.nodeType === 3) { if (!quiet) buffer += child.nodeValue; continue; }
    if (child.nodeType !== 1) continue;
    var el = child; var tag = el.tagName;
    if (SKIP[tag]) continue;
    if (tag === 'IFRAME') { flush(); lines.push('[内嵌页面] ' + clean(el.getAttribute('title') || el.getAttribute('src'), 60)); continue; }
    if (!visible(el)) { if (getComputedStyle(el).display === 'contents') walk(el, quiet); continue; }
    if (/^H[1-6]$/.test(tag)) { flush(); var heading = clean(el.innerText, 160); if (heading) lines.push('#'.repeat(Number(tag[1])) + ' ' + heading); continue; }
    if (interactive(el)) {
      flush(); lines.push(describe(el));
      if (tag === 'A' || tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SUMMARY' || el.getAttribute('role')) continue;
    }
    if (tag === 'IMG') { var alt = clean(el.getAttribute('alt'), 60); if (alt) buffer += ' [图：' + alt + '] '; continue; }
    if (tag === 'BR') { flush(); continue; }
    if (tag === 'TD' || tag === 'TH') buffer += ' | ';
    var block = BLOCK.test(tag);
    if (block) flush();
    if (tag === 'LI') buffer += '- ';
    if (el.shadowRoot) walk(el.shadowRoot, false);
    // 包着输入框的 label：文字已经是输入框的名字，不再单独占一行。
    walk(el, tag === 'LABEL' && !!el.querySelector('input,select,textarea'));
    if (block) flush();
  }
}
walk(document.body || document.documentElement);
flush();
var text = lines.join('\n');
var pages = Math.max(1, Math.ceil(text.length / maxChars));
var current = Math.min(Math.max(1, page), pages);
return {
  title: document.title, url: location.href, text: text.slice((current - 1) * maxChars, current * maxChars), page: current, pages: pages,
  scroll: { y: Math.round(scrollY), height: document.documentElement.scrollHeight, viewport: innerHeight }
};
})`

/** 按引用取一个元素的描述和中心点（可以先滚到可见处）。 */
export const ELEMENT = String.raw`(function (ref, scroll) {
${STATE}
var el = ref === '' ? document.activeElement : state.refs.get(ref);
if (!el || !el.isConnected || el === document.body) return { error: 'stale' };
if (ref === '') ref = refOf(el);
if (scroll) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
var rect = el.getBoundingClientRect();
var form = el.form || (el.closest ? el.closest('form') : null);
var tag = el.tagName.toLowerCase();
var type = tag === 'input' ? el.type : tag === 'button' ? (el.getAttribute('type') || 'submit').toLowerCase() : (el.getAttribute('type') || '').toLowerCase();
var method = form ? (el.getAttribute('formmethod') || form.getAttribute('method') || 'get').toLowerCase() : '';
var isSubmit = !!form && ((tag === 'button' && type === 'submit') || (tag === 'input' && (type === 'submit' || type === 'image')));
var labelValue = el.labels && el.labels.length ? labelText(el.labels[0]) : '';
var own = tag === 'input' || tag === 'textarea' || tag === 'select' ? '' : el.innerText;
var name = clean(el.getAttribute('aria-label') || labelValue || own || (tag === 'input' && (type === 'submit' || type === 'button') ? el.value : '') || el.getAttribute('title') || el.getAttribute('placeholder') || '', 80);
return {
  info: {
    ref: ref, tag: tag, role: el.getAttribute('role') || tag, type: type, name: name, href: tag === 'a' ? el.href : '',
    formMethod: method, formAction: form ? String(form.action || '') : '', isSubmit: isSubmit,
    autocomplete: (el.getAttribute('autocomplete') || '').toLowerCase(),
    fieldName: [el.getAttribute('name'), el.id, el.getAttribute('placeholder'), labelValue, el.getAttribute('aria-label')].filter(Boolean).join(' ').slice(0, 160)
  },
  x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height,
  html: el.outerHTML.slice(0, 1500), url: location.href
};
})`

/** 聚焦一个输入框，需要时先清空。 */
export const FOCUS = String.raw`(function (ref, clear) {
${STATE}
var el = state.refs.get(ref);
if (!el || !el.isConnected) return { error: 'stale' };
el.scrollIntoView({ block: 'center', behavior: 'instant' });
el.focus();
if (clear) {
  if (typeof el.select === 'function') el.select();
  else if (el.isContentEditable) { var range = document.createRange(); range.selectNodeContents(el); var sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); }
}
return { focused: document.activeElement === el || el.contains(document.activeElement) };
})`

/** 下拉框选一项：按值、按完整文字、按包含的文字依次匹配。 */
export const SELECT = String.raw`(function (ref, value) {
${STATE}
var el = state.refs.get(ref);
if (!el || !el.isConnected || el.tagName !== 'SELECT') return { error: 'not-select' };
var options = Array.prototype.slice.call(el.options);
var match = options.find(function (o) { return o.value === value; }) || options.find(function (o) { return o.text.trim() === value.trim(); }) || options.find(function (o) { return o.text.indexOf(value) !== -1; });
if (!match) return { error: 'no-option', options: options.slice(0, 30).map(function (o) { return o.text.trim(); }) };
el.value = match.value;
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
return { selected: match.text.trim() };
})`

/** 你在画面上点的位置是什么：下拉框要用 Pod 自己的浮层显示选项。 */
export const HIT = String.raw`(function (x, y) {
${STATE}
var el = document.elementFromPoint(x, y);
if (!el) return { kind: 'none' };
var select = el.closest ? el.closest('select') : null;
if (select && !select.disabled) {
  return { kind: 'select', ref: refOf(select), multiple: select.multiple, options: Array.prototype.slice.call(select.options, 0, 300).map(function (o) { return { value: o.value, text: o.text.trim(), selected: o.selected }; }) };
}
return { kind: 'other' };
})`

/** 表单里要提交的内容，给审批卡看；密码只显示有没有填。 */
export const FORM = String.raw`(function (ref) {
${STATE}
${SECRET}
var el = state.refs.get(ref);
var form = el && (el.form || (el.closest ? el.closest('form') : null));
if (!form) return [];
return Array.prototype.slice.call(form.elements, 0, 40).filter(function (f) {
  return f.name && f.type !== 'hidden' && f.type !== 'submit' && f.type !== 'button';
}).map(function (f) {
  var label = (f.labels && f.labels.length ? labelText(f.labels[0]) : '') || f.getAttribute('aria-label') || f.name;
  var value = secretField(f) ? (f.value ? '（已填）' : '') : f.type === 'checkbox' || f.type === 'radio' ? (f.checked ? '已选' : '未选') : f.tagName === 'SELECT' ? (f.options[f.selectedIndex] ? f.options[f.selectedIndex].text : '') : String(f.value || '');
  return { label: clean(label, 40), value: clean(value, 200) };
});
})`

/** 提取正文，转成 Markdown：标题、段落、列表、链接、表格、代码块。 */
export const EXTRACT = String.raw`(function (selector, maxChars) {
${STATE}
var root = selector ? document.querySelector(selector) : (document.querySelector('main, article, [role=main]') || document.body);
if (!root) return { error: 'no-match' };
var BT = String.fromCharCode(96);
var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, CANVAS: 1, IFRAME: 1, BUTTON: 1, SELECT: 1, INPUT: 1, TEXTAREA: 1, NAV: 1, FORM: 1 };
var BLOCK = /^(P|DIV|SECTION|ARTICLE|MAIN|ASIDE|HEADER|FOOTER|UL|OL|DL|DT|DD|FIGURE|FIGCAPTION|ADDRESS|DETAILS|SUMMARY)$/;
var out = []; var line = ''; var size = 0;
function flush() { var t = line.replace(/[ \t\n]+/g, ' ').trim(); if (t) { out.push(t); size += t.length; } line = ''; }
function text(el) { return clean(el.innerText, 2000); }
function table(el) {
  var rows = Array.prototype.slice.call(el.rows, 0, 60).map(function (row) {
    return '| ' + Array.prototype.slice.call(row.cells, 0, 12).map(function (cell) { return clean(cell.innerText, 80).replace(/\|/g, '/'); }).join(' | ') + ' |';
  });
  if (rows.length > 1) rows.splice(1, 0, rows[0].replace(/[^|]+/g, ' --- '));
  return rows.join('\n');
}
function walk(node) {
  for (var child = node.firstChild; child && size < maxChars * 2; child = child.nextSibling) {
    if (child.nodeType === 3) { line += child.nodeValue; continue; }
    if (child.nodeType !== 1) continue;
    var el = child; var tag = el.tagName;
    if (SKIP[tag]) continue;
    if (!visible(el)) { if (getComputedStyle(el).display === 'contents') walk(el); continue; }
    if (/^H[1-6]$/.test(tag)) { flush(); var heading = text(el); if (heading) out.push('#'.repeat(Number(tag[1])) + ' ' + heading); continue; }
    if (tag === 'A') { var label = text(el); if (label) line += el.href && el.href.indexOf('javascript:') !== 0 ? '[' + label + '](' + el.href + ')' : label; continue; }
    if (tag === 'IMG') { var alt = clean(el.getAttribute('alt'), 80); if (alt) line += '[图：' + alt + ']'; continue; }
    if (tag === 'BR') { flush(); continue; }
    if (tag === 'PRE') { flush(); out.push(BT + BT + BT + '\n' + el.innerText.slice(0, 4000) + '\n' + BT + BT + BT); continue; }
    if (tag === 'CODE') { line += BT + clean(el.innerText, 200) + BT; continue; }
    if (tag === 'STRONG' || tag === 'B') { line += '**' + text(el) + '**'; continue; }
    if (tag === 'TABLE') { flush(); out.push(table(el)); continue; }
    if (tag === 'BLOCKQUOTE') { flush(); out.push('> ' + text(el)); continue; }
    if (tag === 'LI') { flush(); line = '- '; walk(el); flush(); continue; }
    var block = BLOCK.test(tag);
    if (block) flush();
    if (el.shadowRoot) walk(el.shadowRoot);
    walk(el);
    if (block) flush();
  }
}
walk(root);
flush();
var markdown = out.join('\n\n');
return { title: document.title, url: location.href, markdown: markdown.slice(0, maxChars), length: markdown.length };
})`

/** 纯文本：盯网页用，可以只取选择器匹配的那一部分。 */
export const TEXT = String.raw`(function (selector) {
var root = selector ? document.querySelector(selector) : document.body;
if (!root) return { error: 'no-match', title: document.title };
return { title: document.title, text: String(root.innerText || '').slice(0, 100000) };
})`

export const SCROLL = String.raw`(function (dx, dy) {
window.scrollBy({ left: dx, top: dy, behavior: 'instant' });
return { y: Math.round(scrollY), height: document.documentElement.scrollHeight, viewport: innerHeight };
})`

export const SELECTION = String.raw`(function () { return String(getSelection ? getSelection().toString() : '').slice(0, 20000); })`

/** 拼成一次调用：参数用 JSON 写进表达式。 */
export function invoke(script: string, ...args: readonly unknown[]): string {
  return `(${script})(${args.map((arg) => JSON.stringify(arg)).join(', ')})`
}

/** 取引用对应元素的远程对象，用来设置文件输入框。 */
export function refExpression(ref: string): string {
  return `(window.__pod && window.__pod.refs.get(${JSON.stringify(ref)})) || null`
}

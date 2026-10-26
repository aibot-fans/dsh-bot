/**
 * 复制文字，成功返回 true。navigator.clipboard 只在 https 或 localhost 下能用；
 * 手机用局域网地址（http）打开 dsh 时退回老办法：放一个看不见的文本框，选中里面的字再复制。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 没给权限之类的：用下面的老办法再试一次。
  }
  const area = document.createElement('textarea')
  area.value = text
  area.readOnly = true
  // 16px：iOS 上更小的字选中时会放大页面。
  area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;'
  document.body.appendChild(area)
  area.select()
  area.setSelectionRange(0, text.length)
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
  }
}

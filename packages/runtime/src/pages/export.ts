import { POSTER_DIMENSIONS, type PageDoc, type PageKind } from 'pod-domain'
import type { SharedBrowser } from '../browser/browser.ts'

export type CaptureFormat = 'pdf' | 'png'

/** 长图最多多高（CSS 像素），再长就截到这里。 */
const MAX_HEIGHT = 20_000

/** 等字体和图片都好了再打印或截图。在开发者协议里执行，不受页面 CSP 限制。 */
const READY =
  'Promise.all([document.fonts ? document.fonts.ready : null].concat(Array.prototype.map.call(document.images, function (image) { return image.complete ? null : new Promise(function (done) { image.onload = done; image.onerror = done }) }))).then(function () { return true })'

/** 截图时的视口宽度（CSS 像素）：和页面正文的宽度对上。 */
export function captureWidth(kind: PageKind, doc: PageDoc): number {
  switch (kind) {
    case 'report':
      return 960
    case 'dashboard':
    case 'tracker':
      return 1344
    case 'diagram':
      return 1264
    case 'slides':
      return 1328
    case 'poster':
      return POSTER_DIMENSIONS[doc.poster?.size ?? 'portrait'].width
    case 'prototype':
      return doc.device === 'desktop' ? 1440 : 1400
  }
}

/**
 * 用共用浏览器导出：开一个临时的无痕标签页，把页面 HTML 直接写进去（不经过网络，页面的 CSP 也不让它联网），
 * 打印成 PDF（按页面自己的纸张大小）或截成整页长图，然后关掉标签页。
 */
export async function capture(browser: SharedBrowser, html: string, format: CaptureFormat, width: number): Promise<Uint8Array> {
  const tab = await browser.open({ url: 'about:blank', owner: { kind: 'pod', hidden: true }, incognito: true })
  try {
    await tab.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
    const tree = await tab.send<{ readonly frameTree: { readonly frame: { readonly id: string } } }>('Page.getFrameTree')
    await tab.send('Page.setDocumentContent', { frameId: tree.frameTree.frame.id, html })
    await tab.send('Runtime.evaluate', { expression: READY, awaitPromise: true, returnByValue: true }, 20_000)
    if (format === 'pdf') {
      const pdf = await tab.send<{ readonly data: string }>('Page.printToPDF', { printBackground: true, preferCSSPageSize: true }, 120_000)
      return new Uint8Array(Buffer.from(pdf.data, 'base64'))
    }
    const metrics = await tab.send<{ readonly cssContentSize?: { readonly height: number }; readonly contentSize: { readonly height: number } }>('Page.getLayoutMetrics')
    const height = Math.max(1, Math.min(MAX_HEIGHT, Math.ceil(metrics.cssContentSize?.height ?? metrics.contentSize.height)))
    // 两倍像素更清楚；太长的图用一倍，免得超出浏览器能截的尺寸。
    const scale = height * 2 <= 16_000 ? 2 : 1
    await tab.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false })
    const shot = await tab.send<{ readonly data: string }>('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } }, 120_000)
    return new Uint8Array(Buffer.from(shot.data, 'base64'))
  } finally {
    await browser.close(tab.id)
  }
}

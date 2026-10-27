import { readFile } from 'node:fs/promises'
import { t } from 'pod-domain'
import { extractDocx } from './docx.ts'
import { ConvertError, type DocumentFormat, type Extracted } from './formats.ts'
import { extractPdf, extractWithTextutil } from './native.ts'
import { extractPptx } from './pptx.ts'
import { extractXlsx } from './xlsx.ts'
import { openZip } from './zip.ts'

/** 老版 Office 文件和加了密码的新版文件都是这种 OLE 容器，不是 ZIP。 */
const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0])

/** 按格式抽出文字。只在 worker 线程里调用：大表格要解析好几秒，不能卡住 dsh 的主线程。 */
export async function extractDocument(path: string, format: DocumentFormat): Promise<Extracted> {
  switch (format) {
    case 'pdf':
      return extractPdf(path)
    case 'textutil':
      return extractWithTextutil(path)
    case 'old-excel':
      throw new ConvertError(t('老版的 Excel（.xls）转不了，用 Excel 或 WPS 另存为 .xlsx 再上传就行'))
    case 'old-ppt':
      throw new ConvertError(t('老版的 PPT（.ppt）转不了，另存为 .pptx 再上传就行'))
    default: {
      const data = await readFile(path)
      if (data.subarray(0, 4).equals(OLE_SIGNATURE)) throw new ConvertError(t('文件加了密码，或者其实是老版格式，转不了'))
      const zip = openZip(data)
      if (format === 'docx') return extractDocx(zip)
      return format === 'xlsx' ? extractXlsx(zip) : extractPptx(zip)
    }
  }
}

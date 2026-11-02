import { t } from 'pod-domain'

type DiffKind = 'same' | 'add' | 'del'

interface DiffLine {
  readonly kind: DiffKind
  readonly text: string
}

const MARKS: Readonly<Record<DiffKind, string>> = { same: ' ', add: '+', del: '-' }

/** 按行比两段文字：最长公共子序列里的行没变，其余是旧版去掉的和新版加上的。 */
export function diffLines(before: string, after: string): readonly DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const width = b.length + 1
  // common[i * width + j]：a 从第 i 行、b 从第 j 行起，最多有几行对得上。
  const common = new Uint32Array((a.length + 1) * width)
  const at = (i: number, j: number): number => common[i * width + j] ?? 0
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      common[i * width + j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
    }
  }
  const lines: DiffLine[] = []
  let x = 0
  let y = 0
  while (x < a.length || y < b.length) {
    const left = a[x]
    const right = b[y]
    if (left !== undefined && left === right) {
      lines.push({ kind: 'same', text: left })
      x += 1
      y += 1
    } else if (left !== undefined && (right === undefined || at(x + 1, y) >= at(x, y + 1))) {
      lines.push({ kind: 'del', text: left })
      x += 1
    } else {
      lines.push({ kind: 'add', text: right ?? '' })
      y += 1
    }
  }
  return lines
}

/** 两版文字的差异：去掉的行标红、加上的行标绿，没变的照常显示。 */
export function LineDiff(props: { readonly before: string; readonly after: string }) {
  const lines = diffLines(props.before, props.after)
  return (
    <div className="pod-diff" role="group" aria-label={t('差异：- 是旧版去掉的，+ 是新版加上的')}>
      {lines.map((line, index) => (
        <div key={index} className={`pod-diff-line pod-diff-${line.kind}`}>
          <span className="pod-diff-mark">{MARKS[line.kind]}</span>
          <span>{line.text === '' ? ' ' : line.text}</span>
        </div>
      ))}
    </div>
  )
}

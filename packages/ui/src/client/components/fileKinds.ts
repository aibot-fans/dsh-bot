/** 文件在页面里怎么显示，按扩展名分。 */
export type FileKind = 'image' | 'pdf' | 'audio' | 'video' | 'markdown' | 'table' | 'html' | 'json' | 'binary' | 'text'

const KINDS: readonly (readonly [FileKind, RegExp])[] = [
  ['image', /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i],
  ['pdf', /\.pdf$/i],
  ['audio', /\.(mp3|wav|m4a|aac|ogg|flac)$/i],
  ['video', /\.(mp4|m4v|webm|mov)$/i],
  ['markdown', /\.(md|markdown)$/i],
  ['table', /\.(csv|tsv)$/i],
  ['html', /\.html?$/i],
  ['json', /\.json$/i],
  ['binary', /\.(docx?|xlsx?|pptx?|key|numbers|pages|odt|ods|odp|rtf|epub|zip|rar|7z|tar|gz|tgz|bz2|xz|dmg|pkg|iso|exe|bin|so|dylib|dll|jar|class|sqlite3?|db|psd|ai|sketch|fig|heic|tiff?|mkv|avi|wmv|flv|ttf|otf|woff2?)$/i],
]

export function fileKind(path: string): FileKind {
  return KINDS.find(([, pattern]) => pattern.test(path))?.[0] ?? 'text'
}

/** 要先把内容读成文字再显示的几种。 */
export function isTextual(kind: FileKind): boolean {
  return kind === 'markdown' || kind === 'table' || kind === 'html' || kind === 'json' || kind === 'text'
}

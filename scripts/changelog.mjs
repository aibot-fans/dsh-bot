/**
 * CHANGELOG.md 里「## <版本> - <日期>」那一节的正文，不含标题；没有这一节返回 undefined。
 * GitHub Release 的正文和 npm 包里的更新说明（package.json 的 releaseNotes）都取它。
 */
export function changelogSection(text, version) {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line === `## ${version}` || line.startsWith(`## ${version} `))
  if (start === -1) return undefined
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith('## '))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()
}

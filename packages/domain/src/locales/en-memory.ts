/** 记忆整理里页面和宿主共用的文字的英文译文，键是代码里的中文原文。 */
export const DOMAIN_EN_MEMORY: Readonly<Record<string, string>> = {
  '写了 {notes} 页笔记': 'wrote {notes} {notes:note|notes}',
  '并进 {merged} 条': 'merged {merged} {merged:entry|entries}',
  '替掉、归档、挪走 {changed} 条': 'replaced, archived or moved {changed} {changed:entry|entries}',
  '新记 {added} 条': 'added {added} {added:entry|entries}',
  '有 {questions} 件想跟你确认': '{questions} {questions:question|questions} for you',
  '，': ', ',
  '，拿不准': ', unverified',
  '头 {nights} 次整理先给你看，点了才生效': 'The first {nights} tidy-ups are shown to you first and only apply when you click',
  '「{label}」这一次要动 {touched} 处，超过三成，先给你看': '“{label}” would change {touched} items this time, more than 30%, so it is shown to you first',
}

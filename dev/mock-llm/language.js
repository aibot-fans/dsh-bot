/** dsh-bot 设成英文时，每个会话的系统提示最后都有这句英文说明（pod-domain 的 withLanguage）。 */
export function isEnglish(system) {
  return system.includes('the user has set dsh-bot to English')
}

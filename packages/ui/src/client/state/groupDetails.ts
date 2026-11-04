/**
 * 群聊详情在宽屏上要不要自动打开：默认打开；你在宽屏上关掉群详情就记住，之后进群不再自动开，再打开一次又记成开着。
 * 只存在这台设备上（大屏和笔记本各用各的）；手机上详情占整屏，从不自动打开，也不记。
 */
const KEY = 'pod-ui/group-details'

export function groupDetailsWanted(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) !== '0'
  } catch {
    // 隐私模式下 localStorage 不可用，照默认打开。
    return true
  }
}

export function setGroupDetailsWanted(value: boolean): void {
  try {
    globalThis.localStorage?.setItem(KEY, value ? '1' : '0')
  } catch {
    // 存不下就只在这次打开时有效。
  }
}

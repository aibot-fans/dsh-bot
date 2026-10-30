import { X_GUIDE as USAGE } from 'aibot-x-post'

/** x_api_request 的用法说明：前面是 dsh-bot 的补充，后面是 aibot-x-post 带的接口用法。 */
const DSH_NOTES = `dsh-bot 的补充：
- 用的是用户在 dsh-bot 浏览器里登录的 X 账号。
- x_api_request、x_chats、x_chat 每访问一次 X，都从 aibot 每天的免费次数里扣（读 1 次，写 4 次，每个文件另加 2 次；X 没做成会退回）。x_list_endpoints、x_get_operation、x_filter_response 不扣：要换个角度看同一个响应，就再过滤一次，别重新请求。
- 写操作（POST，HomeTimeline 这类读除外）只在用户明确要求时做；dsh-bot 会按设置交给用户在审批卡上批准，批准后把结果发给你。下面说的 "Confirm with the user" 就是这一步，不用在聊天里另外确认。
- 带图片、GIF、视频：files 填工作区里的文件，只用在 CreateTweet、CreateNoteTweet 这类 variables 里有 media.media_entities 的请求上；批准后 dsh-bot 先传文件，再把 media_id 按顺序填进去，你不用自己填。
- 加密聊天（XChat）用 x_chats 和 x_chat 读。`

export const X_GUIDE = `${DSH_NOTES}\n\n${USAGE}`

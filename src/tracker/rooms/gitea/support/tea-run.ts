/**
 * src/tracker/rooms/gitea/support/tea-run.ts —— gitea 房读路径共用的 tea 进程收尾与命令词汇表。
 *
 * 为什么住在 support/：capability-register.ts 是纯数据（G5 红线），读路径的共用助手另立一个文件，
 * 不往登记数据里掺函数。八个读操作（票 #11）全部经由这里发起 tea 调用：
 *   · 命令词汇表只有一处出处（本文件），各操作文件只挑词汇、不再自己拼参数——同一含义的命令
 *     写两遍就会漂移（例：一处带 --output json 一处不带，解析就分叉）；
 *   · 执行器从上下文取（opCtx 优先，缺了按 127 如实回，与 GitLab 房 glabClient 同一口径）；
 *   · JSON 解析失败不算崩溃：回包先按 unknown 收，形状不对回 null，由调用方挑错误档位。
 *
 * tea 命令面（本房词汇，票 #3 的口径，真机上以实测修正；写路径的参数形状按本机 tea 0.16.0
 *   的 --help 逐条核对过，票 #12）：
 *   列表页：tea issues ls --repo <refId> --state open|closed|all [--labels a,b] --output json --limit N --page P
 *   单票：  tea issues <编号> --repo <refId> --output json
 *   评论：  tea issues <编号> comments --repo <refId> --output json --limit N --page P
 *   标签：  tea labels ls --repo <refId> --output json --limit N --page P
 *   建票：  tea issues create --repo <refId> --title T --description D [--labels a,b] [--assignees a,b]
 *           （create 不认 --output，回包是含 #编号 的一行文本，用 parseCreatedIssueKey 抠编号）
 *   关/开： tea issues close|reopen <编号> --repo <refId> --output json
 *   改票：  tea issues edit <编号> --repo <refId> [--title T] [--description D] [--add-labels a,b]
 *           [--remove-labels a,b] [--set-assignees a,b] [--milestone M|''] --output json
 *           （tea 没有 --labels 整集替换，setLabels 先读现标签再算 add/remove 差集）
 *   评注：  tea comments add <编号> --repo <refId> --description <正文> --output json
 */

import type { BackendContext, ExecResult, OpContext } from '../../../contract/contexts.js'
import type { ListFilter } from '../../../contract/inputs.js'
import type { RepositoryRef } from '../../../contract/entities.js'

/** 上下文两形都收：调用方有时把执行器放在 ctx、有时放在 opCtx（GitLab 房同一套形状）。 */
export type CtxLike = Partial<OpContext> & Partial<BackendContext>

/** tea 回包先收成键值袋再逐格判：远端字段可缺可空，直接按定型读会把缺字段当成错。 */
export type RawBag = Record<string, unknown>

/**
 * 一趟读等 tea 的时限（毫秒）。探活那趟用 preflight.ts 的短档（3 秒）；真正的读可能要翻页，
 * 给 10 秒整档。现在写死在这里，接中央超时线（config/timeouts.yaml）时搬走——与 GitLab 房
 * 「超时住中央 YAML」同一去向，搬家是一次独立 diff。
 */
export const TEA_READ_TIMEOUT_MS = 10000

/**
 * 发一趟 tea 命令：执行器从上下文取，cwd 用调用上下文里的那一格。
 * 缺执行器不是崩溃：按退出码 127、stderr 说明原因如实回，让上层走统一的错误判档。
 */
export async function runTea(effective: CtxLike | null | undefined, args: string[]): Promise<ExecResult> {
  const exec = effective && effective.exec
  if (!exec) return { code: 127, stderr: 'tea-run: 上下文里没有执行器（exec），读操作发不出去' }
  return exec('tea', args, { cwd: (effective && effective.cwd) || '', timeout: TEA_READ_TIMEOUT_MS })
}

/** 把 stdout 解析成数组：不是合法 JSON、或不是数组，都回 null（调用方按「回包形状不对」挑档位）。 */
export function parseJsonRows(text: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** 把 stdout 解析成单个对象：同理，形状不对回 null。 */
export function parseJsonBag(text: string): RawBag | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as RawBag
  } catch {
    return null
  }
}

/** 异常对象上的 message；不是 Error 的东西就 String() 一下，消息里要有原话。 */
export function errMsg(e: unknown): string {
  const m = (e as { message?: unknown } | null | undefined)?.message
  return typeof m === 'string' && m ? m : String(e)
}

/** 仓库标识只取 refId：tea 的 --repo 认 owner/name；缺了回空串，由调用方按「没有可用目标」如实失败。 */
export function refIdOf(repo: Partial<RepositoryRef> | null | undefined): string {
  const raw = repo && typeof repo.refId === 'string' ? repo.refId.trim() : ''
  return raw
}

/**
 * filter.labels 归一：去掉空白项与重复项，保持原顺序。契约口径 labels 是 AND：
 * 空数组等于不过滤；tea 的 --labels 逗号分隔多个标签，语义正好是「同时命中」。
 */
export function labelsOf(filter: ListFilter | null | undefined): string[] {
  const labels = filter && Array.isArray(filter.labels) ? filter.labels : []
  const out: string[] = []
  for (const label of labels) {
    const name = typeof label === 'string' ? label.trim() : ''
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

/** 列表页的参数（本房词汇表的唯一出处）：state 收窄由调用方给好（open / closed / all）。 */
export function argsIssueListPage(refId: string, state: 'open' | 'closed' | 'all', labels: string[], limitRows: number, page: number): string[] {
  const args = ['issues', 'ls', '--repo', refId, '--state', state, '--output', 'json', '--limit', String(limitRows), '--page', String(page)]
  if (labels.length) args.push('--labels', labels.join(','))
  return args
}

/** 单票的参数。 */
export function argsIssueGet(refId: string, key: string | number): string[] {
  return ['issues', String(key), '--repo', refId, '--output', 'json']
}

/** 评论一页的参数。 */
export function argsCommentsPage(refId: string, key: string | number, limitRows: number, page: number): string[] {
  return ['issues', String(key), 'comments', '--repo', refId, '--output', 'json', '--limit', String(limitRows), '--page', String(page)]
}

/** 标签一页的参数。 */
export function argsLabelsPage(refId: string, limitRows: number, page: number): string[] {
  return ['labels', 'ls', '--repo', refId, '--output', 'json', '--limit', String(limitRows), '--page', String(page)]
}

// ── 写路径的参数（票 #12）：同样只在这一处拼，操作文件只挑词汇 ──────────────────

/** 建票的参数。labels 与 assignees 是已归一的名字列表（空数组就不带这一项）。 */
export function argsIssueCreate(refId: string, title: string, description: string, labels: string[], assignees: string[]): string[] {
  const args = ['issues', 'create', '--repo', refId, '--title', title]
  if (description) args.push('--description', description)
  if (labels.length) args.push('--labels', labels.join(','))
  if (assignees.length) args.push('--assignees', assignees.join(','))
  return args
}

/** 关票的参数（tea 的 close 认 --output json，回包就是关完之后的票面）。 */
export function argsIssueClose(refId: string, key: string | number): string[] {
  return ['issues', 'close', String(key), '--repo', refId, '--output', 'json']
}

/** 重开的参数（tea 0.16.0 的命令面里 reopen 是独立子命令，不是 edit 的一个开关）。 */
export function argsIssueReopen(refId: string, key: string | number): string[] {
  return ['issues', 'reopen', String(key), '--repo', refId, '--output', 'json']
}

/** 改票的编辑项：只把给了的字段拼进命令，没给的不出现（空操作由调用方先判掉，不发命令）。 */
export interface IssueEditFields {
  title?: string
  description?: string
  addLabels?: string[]
  removeLabels?: string[]
  /** 整集替换认领人（tea 的 --set-assignees）；空串表示清空。 */
  setAssignees?: string
  /** 里程碑按名字给；空串表示清空（tea --milestone "" 的口径）。 */
  milestone?: string
}

/** 改票的参数：按编辑项拼一条 tea issues edit。 */
export function argsIssueEdit(refId: string, key: string | number, fields: IssueEditFields): string[] {
  const args = ['issues', 'edit', String(key), '--repo', refId]
  if (typeof fields.title === 'string') args.push('--title', fields.title)
  if (typeof fields.description === 'string') args.push('--description', fields.description)
  if (fields.addLabels && fields.addLabels.length) args.push('--add-labels', fields.addLabels.join(','))
  if (fields.removeLabels && fields.removeLabels.length) args.push('--remove-labels', fields.removeLabels.join(','))
  if (typeof fields.setAssignees === 'string') args.push('--set-assignees', fields.setAssignees)
  if (typeof fields.milestone === 'string') args.push('--milestone', fields.milestone)
  args.push('--output', 'json')
  return args
}

/** 写一条评论的参数（tea 的评论写入挂在 comments 命名空间下，不是 issues <编号> comments）。 */
export function argsCommentAdd(refId: string, key: string | number, body: string): string[] {
  return ['comments', 'add', String(key), '--repo', refId, '--description', body, '--output', 'json']
}

/**
 * 从建票的文本回包里抠出新票编号：tea issues create 不认 --output，回包是含井号编号的一行
 * 说明文字（真机 0.16.0 实测）。抠不出来回 null——调用方拿不到编号时如实失败，
 * 不许拿「可能已建出去」的票猜一个编号。
 */
export function parseCreatedIssueKey(stdout: string): string | null {
  const m = /#(\d+)/.exec(typeof stdout === 'string' ? stdout : '')
  return m ? m[1] : null
}

/**
 * 把「这一趟读没能拿全」落进诊断日志（best-effort：上下文没带 logEvent 就跳过，不拦主流程）。
 * 事件与理由沿用宿主的读降级口径：事件 read.degraded、理由由调用方给（如 list:truncated）。
 */
export function emitReadDegraded(effective: CtxLike | null | undefined, op: string, reason: string, elapsedMs: number): void {
  const logEvent = effective && effective.logEvent
  if (typeof logEvent !== 'function') return
  try {
    // 契约的 logEvent 是 (level, event, fields)：读降级是「结果比预期少」的旁路记录，取 warn 档。
    logEvent('warn', 'read.degraded', { backend: 'gitea', op, reason, elapsedMs })
  } catch {
    // 日志是旁路：写不进去不影响读操作本身的结论。
  }
}

/**
 * src/tracker/rooms/gitea/errors.ts — tea/API 错误 → 契约 ERROR_KIND（本房间的判档出口，#2 起步骨架）。
 *
 * ── 判据不在这里，这里只有「tea 这一家专有的条目」─────────────────────────────
 * 判「失败该归哪一档」的真源是全仓唯一那张有序规则表：`src/tracker/kernel/error-rules.ts`
 * （决策见 `docs/adr/20261014-error-classification-single-source.md`）。本文件仿 GitLab 房的
 * `errors.ts` 起步：先只做「透传 → 本家扩展表 → 通用表」这一趟判定，本家扩展表暂为空 ——
 * 真机上跑出 tea 专有原话（通用表认不出的）之后再逐条补进来，每条自带 `example` 自证。
 *
 * 结构与 GitLab 房逐格对应（classifyGiteaError / hintFor / failGitea），接手的人两份对照着读即可。
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { ErrorKind } from '../../contract/identity.js'
import type { TrackerError } from '../../contract/results.js'
import { HINT_UNRECOGNIZED, HINT_UNSUPPORTED, fail } from '../../kernel/preflight.js'
import type { ClassifyCtx } from '../../kernel/preflight.js'
import { emitPassthrough, factsFromError, judgeFactsDetailed } from '../../kernel/error-rules.js'
import type { ErrorRule } from '../../kernel/error-rules.js'

const KIND_VALUES: ReadonlySet<string> = new Set(Object.values(ERROR_KIND))

/** 判档结果只交档位与是否兜底，是因为调用方挑话只看这两格，层信息留给日志不进返回。 */
export interface GiteaVerdict {
  kind: ErrorKind
  fallback: boolean
}

/**
 * tea 这一家的前置扩展表（判档时先试它，再试通用表）。
 *
 * 起步为空（#2 是房间骨架票）：真机上 tea 的专有原话一条都还没采到，凭记忆编条目只会造出
 * 没有样本支撑的假判据。采到之后按 GitLab 房那两条的写法补进来，每条自带 `example`，
 * 门禁会逐条把样本喂回去验证档位。
 */
export const GITEA_ERROR_RULES: readonly ErrorRule[] = []

/** `err` 已经是规范档位了吗（顶层 `kind` 或 `error.kind` 命中八档取值之一）。 */
function carriedKind(err: unknown): ErrorKind | null {
  if (!err || typeof err !== 'object') return null
  const bag = err as Record<string, unknown>
  const top = bag['kind']
  if (typeof top === 'string' && KIND_VALUES.has(top)) return top as ErrorKind
  const inner = bag['error']
  if (inner !== null && typeof inner === 'object') {
    const innerKind = (inner as Record<string, unknown>)['kind']
    if (typeof innerKind === 'string' && KIND_VALUES.has(innerKind)) return innerKind as ErrorKind
  }
  return null
}

/**
 * 把 tea/API 的任意错误值判成八档之一。
 *
 * 顺序与全仓一致：已经是规范档位的失败原样透传（覆盖后端显式产生的 `conflict` / `unsupported`），
 * 其余走「本家扩展表 → 通用表」。
 *
 * @param err 任意错误值：Error / tea 的 `{stdout,stderr,code}` 进程结果 / 一段文本 /
 *            已是 `{kind,message,raw}` 的 TrackerError
 * @param ctx 判档上下文；给了它才可能留一条 `error.normalize` 轨迹
 * @returns kind 是八档取值之一；fallback 为 true 表示「规则表一条都没认出来，按网络兜底」
 */
export function classifyGiteaError(err: unknown, ctx?: ClassifyCtx): GiteaVerdict {
  const carried = carriedKind(err)
  if (carried) {
    // 已经是规范档位（例如后端显式产生的 conflict/unsupported）：原样透传并留一趟归一轨迹。
    emitPassthrough(ctx, carried)
    return { kind: carried, fallback: false }
  }
  const judged = judgeFactsDetailed(factsFromError(err), GITEA_ERROR_RULES, ctx)
  return { kind: judged.kind, fallback: judged.fallback }
}

/**
 * 挑这次失败给用户看的那句话：兜底判出来的（没认出来）与「没有这项能力」两档用全仓统一的通用提示，
 * 其余用调用方自己那句有上下文的话。与 GitLab 房的 `hintFor` 同一口径。
 */
export function hintFor(verdict: GiteaVerdict | null | undefined, nativeMessage: string): string {
  if (verdict && verdict.fallback) return HINT_UNRECOGNIZED
  if (verdict && verdict.kind === (ERROR_KIND.UNSUPPORTED as ErrorKind)) return HINT_UNSUPPORTED
  return nativeMessage
}

/**
 * tea 这一家统一的失败构造：判档 + 挑话 + 带原文，三步一处做完，
 * 失败站点只要说清「原始错误值是什么」。
 */
export function failGitea(
  err: unknown,
  nativeMessage: string,
  raw?: unknown,
  ctx?: ClassifyCtx,
): { ok: false; error: TrackerError } {
  const verdict = classifyGiteaError(err, ctx)
  return fail(verdict.kind, hintFor(verdict, nativeMessage), arguments.length > 2 ? raw : err)
}

export default classifyGiteaError

/**
 * src/tracker/rooms/gitea/preflight.ts — 探测/登录/仓库可达（三判据骨架，#2 起步）。
 *
 * 契约与 GitLab 房同一条：preflight 只判环境（工具在/登录/可达），不预判能力；
 * 能力由操作/字段零推断。失败形状统一走 `fail()` 的三段式 `{kind, message, raw}`，
 * 有外部原文的那几步原文一律带上，界面/日志才有统一的兜底可展开。
 *
 * 三步的口径：
 *   1. `platform.resolveExecutable('tea')` → 不在归 ENV（这一步没有外部原文可看）；
 *   2. `tea login list` → 非零退出或没有任何登录项归 AUTH（按原文判档，走 classifyGiteaError）；
 *   3. `tea issues ls --limit 1`（在有 cwd 或仓库身份时）→ 仓库可达性，失败按原文判档。
 * 第三步没有仓库身份可问时直接算通过：前两关已经回答了「环境通不通」。
 *
 * 超时先用本文件常量起步：等本房接入 `config/timeouts.yaml` 那条中央超时线时再搬
 * （GitLab 房的两个超时都住在 `shared/time-config`，那是接入中央线之后的事，不在本票范围）。
 */

import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { ErrorKind } from '../../contract/identity.js'
import type { BackendContext, OpContext } from '../../contract/contexts.js'
import type { RepositoryRef } from '../../contract/entities.js'
import type { PreflightResult } from '../../contract/results.js'
import { fail } from '../../kernel/preflight.js'
import { classifyGiteaError } from './errors.js'

/** 探针超时（毫秒）。起步值与 GitHub/GitLab 房的识别探针同量级，接入中央超时线时一并搬走。 */
const TEA_PROBE_TIMEOUT_MS = 3000

// 预检入参两形都收，是因为调用方有时拿仓库身份、有时拿句柄，直接收窄会把另一路挡在门外。
type PreflightHandle = Partial<OpContext> & Partial<BackendContext> & {
  refId?: string
  cwd?: string
  repository?: { refId?: string }
} & Partial<RepositoryRef>

// 上下文缺字段就按本地失败回，是因为预检问的正是环境通不通，抛异常反而让调用方无原文可看。
type PreflightCtx = Partial<OpContext> & Partial<BackendContext>

/** 取抛上来的错误里那句可读的话：tea 进程的 stdout/stderr 挂在错误值身上，没有 message 就整段转字符串。 */
function messageOf(e: unknown): string {
  return e !== null && typeof e === 'object' && 'message' in (e as Record<string, unknown>)
    ? String((e as Record<string, unknown>)['message'] || e)
    : String(e)
}

/**
 * 三步探活：工具在不在、登录了没有、仓库连不连得上，每步失败都带原文回以便界面展开。
 *
 * @param handle 仓库身份或句柄（两种形状都收，只取其中的 refId 与 cwd）
 * @param opCtx 本次调用的上下文（平台与执行器从这里取）
 */
export async function teaPreflight(
  handle: PreflightHandle | null | undefined,
  opCtx: PreflightCtx | null | undefined,
): Promise<PreflightResult> {
  const ctx = (opCtx || handle) as PreflightCtx | null | undefined
  const platform = ctx && ctx.platform
  const exec = ctx && ctx.exec
  const cwd =
    (handle && typeof handle.cwd === 'string' ? (handle.cwd as string) : undefined) ||
    (ctx && typeof ctx.cwd === 'string' ? (ctx.cwd as string) : undefined) ||
    undefined
  // 空信号统一成 undefined，是因为执行器只收 undefined，null 会被当成非法值拦掉。
  const signal = ctx?.signal || undefined

  // 1) resolveExecutable('tea') → ENV
  if (!platform || typeof platform.resolveExecutable !== 'function') {
    // 原文给空串：这条结论来自「本机平台对象缺能力」，没有外部来源的原文可取。
    return fail(ERROR_KIND.ENV as ErrorKind, 'platform unavailable', '')
  }
  const exe = await platform.resolveExecutable('tea')
  if (!exe) {
    // 原文给空串：`resolveExecutable` 回答的是「没有」，没有一个原文可以抄给它。
    return fail(ERROR_KIND.ENV as ErrorKind, 'tea not found', '')
  }

  // 2) tea login list → 登录判据（非零退出按原文判档；列出的登录项为空也归 AUTH）
  if (!exec || typeof exec !== 'function') {
    // 原文给空串：本机没有可用的执行器，这条失败没有任何命令跑过。
    return fail(ERROR_KIND.ENV as ErrorKind, 'exec unavailable', '')
  }
  try {
    const loginRes = await exec('tea', ['login', 'list'], { cwd, signal, timeout: TEA_PROBE_TIMEOUT_MS })
    if (loginRes.code !== 0) {
      const out = String(loginRes.stdout || '') + '\n' + String(loginRes.stderr || '')
      const verdict = classifyGiteaError(loginRes, ctx || undefined)
      const message = verdict.fallback ? out.trim().slice(0, 500) || 'tea login list failed' : out.trim().slice(0, 500) || 'tea login list failed'
      return fail(verdict.kind, message, out)
    }
    // tea 的 login list 没有登录项时退出码是 0、输出为空：有工具没凭据，归 AUTH 而不是算通过。
    const listed = String(loginRes.stdout || '').trim()
    if (!listed) {
      return fail(ERROR_KIND.AUTH as ErrorKind, 'tea has no login configured (run: tea login add)', '')
    }
  } catch (e: unknown) {
    const verdict = classifyGiteaError(e, ctx || undefined)
    return fail(verdict.kind, messageOf(e).slice(0, 500), e)
  }

  // 3) 仓库可达：`tea issues ls --limit 1`（tea 自己按 cwd 的 git remote 找仓库）；
  //    没有 cwd 也没有仓库身份可问时，前两关已经回答了环境问题，直接算通过。
  const hbag = (handle || {}) as Record<string, unknown>
  const repoBag = hbag['repository'] && typeof hbag['repository'] === 'object' ? (hbag['repository'] as Record<string, unknown>) : null
  const probeId =
    (typeof hbag['refId'] === 'string' && hbag['refId']) ||
    (repoBag && typeof repoBag['refId'] === 'string' && repoBag['refId']) ||
    ''
  if (probeId || cwd) {
    try {
      const probe = await exec('tea', ['issues', 'ls', '--limit', '1'], { cwd, signal, timeout: TEA_PROBE_TIMEOUT_MS })
      const out = String(probe.stdout || '') + '\n' + String(probe.stderr || '')
      if (probe.code !== 0) {
        const verdict = classifyGiteaError(probe, ctx || undefined)
        return fail(verdict.kind, out.trim().slice(0, 500) || 'tea issues ls failed', out)
      }
    } catch (e: unknown) {
      return fail(ERROR_KIND.NETWORK as ErrorKind, messageOf(e).slice(0, 500), e)
    }
  }

  return { ok: true }
}

export default teaPreflight

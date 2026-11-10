/**
 * src/tracker/rooms/gitea/graph/write.ts —— gitea 房关系（结构）的写半边：改父归属（setParent）
 * 与改阻塞关系（setBlockedBy），票 #13。
 *
 * 与读半边（./read.ts）同住 graph/ 子树：阻塞与亲缘是一个概念，读在那边、写在这边。
 *
 * 实现口径（票 #3 立下的三层 normalize + 双路径，写侧照搬）：
 *   · setParent 的唯一真相是正文头里的隐藏标记 `<!-- DSH-PARENT: <父票> -->`（写/拆都在
 *     model/description-markers.ts 的 rewriteDescriptionWithHiddenParent 一处，旧 `Part of` 行顺手清掉）；
 *   · setBlockedBy 是成对写：可见 `Blocked by:` 行给人和人读，隐藏机器表 `<!-- DSH-BLOCKED-BY: ... -->`
 *     给程序读（rewriteDescriptionWithBlockedPair 同一处出处）；整集替换，空集两处一起拆。
 *   · tea 没有父子/阻塞的原生命令，两条操作的数据源都是 `tea issues edit --description` 整篇正文替换。
 *
 * 写前写后的纪律与 labels/assign.ts 同一套：expectedUpdatedAt 前置读（对不上回 conflict，不写）、
 * 写后回读核对（读回对不上如实回 conflict，不把「写丢了」包装成成功）。setBlockedBy 的环检是
 * 契约的硬规矩（operations.ts 写明不许省）：邻接表从单页列表读出来（tea 阻塞关系全在正文里），
 * 读不到就放行并落一行读降级——读失败不能当成写失败。
 */
import { ERROR_KIND } from '../../../contract/vocabulary.js'
import type { ErrorKind } from '../../../contract/identity.js'
import type { Issue, RepositoryRef } from '../../../contract/entities.js'
import type { SetOpts } from '../../../contract/inputs.js'
import { TRACKER_ERROR_STAGE, type OpResult } from '../../../contract/results.js'
import { fail } from '../../../kernel/preflight.js'
import { normalizeIssue } from '../model/normalize.js'
// 正文标记的写与读只在 model/description-markers.ts 一处，本文件直接用那个出处。
import {
  parseBlockedByFallback,
  parseHiddenParent,
  rewriteDescriptionWithBlockedPair,
  rewriteDescriptionWithHiddenParent,
} from '../model/description-markers.js'
import { failGitea } from '../errors.js'
// 共享的原始票读取与单页列表（环检邻接的来源）都在 issues/read.ts 一处，不各建一份。
import { fetchRawIssue, listIssues } from '../issues/read.js'
import {
  type CtxLike,
  type RawBag,
  argsIssueEdit,
  emitReadDegraded,
  errMsg,
  refIdOf,
  runTea,
} from '../support/tea-run.js'

type RepoLike = Partial<RepositoryRef> | null | undefined

/** 票面正文只认 body 字段：tea 的回包字段名就是它（假 tea 与真机同一口径），description 不再兜第二层。 */
function bodyOf(raw: RawBag): string {
  return typeof raw['body'] === 'string' ? String(raw['body']) : ''
}

/**
 * 环检（契约的硬规矩）：对 blockedBy 图做 DFS，把本次要写的整集先应用上去再判——
 * 只要应用之后图里有环（含自环之外的任何回路），这次写就不许落盘。GitLab 房 graph/write.ts
 * 同一个算法；跨房不许 import，这里自带本地实现。
 */
function hasCycle(blockMap: Map<string, string[]>, startKey: string, newBlockers: string[]): boolean {
  const graph = new Map<string, string[]>()
  for (const [k, v] of blockMap) graph.set(k, [...v])
  graph.set(startKey, [...newBlockers])
  const visited = new Set<string>()
  const stack = new Set<string>()
  function dfs(node: string): boolean {
    if (stack.has(node)) return true
    if (visited.has(node)) return false
    visited.add(node)
    stack.add(node)
    const neigh = graph.get(node) || []
    for (const nb of neigh) {
      if (dfs(nb)) return true
    }
    stack.delete(node)
    return false
  }
  for (const k of graph.keys()) if (dfs(k)) return true
  return false
}

/**
 * 环检用的阻塞图快照：tea 没有原生阻塞端点，阻塞关系全在各票正文里，
 * 从单页列表（共享分页表 gitea 组的 maxPerPage）读出来逐张解析。取不到（列表失败）回 null，
 * 调用方放行并记读降级——读不到的票当叶子，这个缺口认，与 GitLab 房 buildBlockMap 同一条纪律。
 */
async function blockedBySnapshot(
  effective: CtxLike | null | undefined,
  repo: RepoLike,
): Promise<Map<string, string[]> | null> {
  const map = new Map<string, string[]>()
  try {
    // filter 传空：listIssues 内部把「没给 state」显式归一为 all（tea 不带 --state 默认只回 open，会静默少一半）。
    const res = await listIssues(effective, repo, {}, effective)
    if (!res.ok) return null
    for (const it of res.data) {
      map.set(String(it.key), parseBlockedByFallback(it.body) ?? [])
    }
    return map
  } catch {
    return null
  }
}

/**
 * 改父归属（契约 setParent）：parentKey 非 null 时写进正文头的隐藏标记（写前先确认父票真实存在，
 * 免得读侧被指向一张空票），null 时拆掉——旧 `Part of` 行顺手清，不再新增。正文没变化时不发写命令。
 * expectedUpdatedAt 前置读；写后回读核对（读回的归属对不上要写的就回 conflict）。
 *
 * @param ctx 调用上下文（opCtx 缺时顶上）
 * @param repo 目标仓库（只取 refId）
 * @param key 票号
 * @param parentKey 父票号（null 表示拆掉归属、移到根）
 * @param opts 乐观并发选项（对不上就回 conflict，不写）
 * @param opCtx 本次调用的上下文（优先用它）
 */
export async function setParent(
  ctx: CtxLike | null | undefined,
  repo: RepoLike,
  key: string,
  parentKey: string | null,
  opts: SetOpts | null | undefined,
  opCtx: CtxLike | null | undefined,
): Promise<OpResult<Issue>> {
  const effective = (opCtx || ctx) as CtxLike | undefined
  const refId = refIdOf(repo)
  // 原文给空串：这一条是本地入参不全（远端一个请求都没发），没有外部原文可取。
  if (!refId) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'setParent: repo.refId 缺失，无法向 Gitea 改归属', '')
  const k = String(key).trim()
  if (!k) return fail(ERROR_KIND.PARSE as ErrorKind, 'setParent: 票号缺失', '', TRACKER_ERROR_STAGE.INPUT_REFUSED)
  const wantParent = parentKey === null ? null : String(parentKey).trim().replace(/^#/, '')
  if (wantParent !== null && !/^\d+$/.test(wantParent)) {
    return fail(ERROR_KIND.PARSE as ErrorKind, 'setParent: 父票号要是不带井号的纯数字（收到 ' + wantParent + '）', JSON.stringify({ key: k, parentKey }), TRACKER_ERROR_STAGE.INPUT_REFUSED)
  }
  // 自环先判：入参自己和自己打架，原文给这次入参快照。
  if (wantParent === k) {
    return fail(ERROR_KIND.CONFLICT as ErrorKind, 'conflict: self-parent ' + k, JSON.stringify({ key: k, parentKey: wantParent }), TRACKER_ERROR_STAGE.INPUT_REFUSED)
  }
  try {
    const raw = await fetchRawIssue(effective, refId, k)
    // expectedUpdatedAt 前置读：对不上回 conflict，绝不后写覆盖先写（原文 = 回读到的票面）。
    if (opts && typeof opts.expectedUpdatedAt === 'string' && opts.expectedUpdatedAt !== '') {
      const cur = typeof raw['updated_at'] === 'string' ? String(raw['updated_at']) : ''
      if (cur !== opts.expectedUpdatedAt) {
        return fail(ERROR_KIND.CONFLICT as ErrorKind, 'conflict: expectedUpdatedAt 不一致（期望 ' + opts.expectedUpdatedAt + '，远端 ' + cur + '）', JSON.stringify(raw))
      }
    }
    if (wantParent !== null) {
      // 父票存在性：写一个不存在的父编号会把读侧（listSubIssues / get 的 parentKey）指向空票，
      // 写前先读一次父票，读不到按读同档如实回——这一趟一个写请求都没发。
      try {
        await fetchRawIssue(effective, refId, wantParent)
      } catch (err: unknown) {
        return failGitea(err, 'setParent: 父票 #' + wantParent + ' 读不到，归属没有改动。', err, effective)
      }
    }
    const oldBody = bodyOf(raw)
    const newBody = rewriteDescriptionWithHiddenParent(oldBody, wantParent)
    if (newBody === oldBody) {
      // 本来就是这个归属：一次写都不发，直接把前置读到的票面归一交回。
      return { ok: true, data: normalizeIssue(raw) }
    }
    // tea 没有父子命令：整篇正文替换（换行原样发，读回的解析靠真实换行认行）。
    const res = await runTea(effective, argsIssueEdit(refId, k, { description: newBody }))
    if (res.code !== 0) {
      // 原文 = 写归属那一次 tea 调用的进程结果。
      return failGitea(new Error(res.stderr || res.stdout || 'setParent: tea issues edit 失败'), '改归属失败：tea issues edit 没有跑成。请稍后重试。', res, effective)
    }
    // 写后回读核对：远端最终落在正文里的归属以回读为准（读侧 parseHiddenParent 同一口径）。
    const back = await fetchRawIssue(effective, refId, k)
    const got = parseHiddenParent(bodyOf(back))
    if (got !== wantParent) {
      return fail(ERROR_KIND.CONFLICT as ErrorKind, 'conflict: parent 写后读回对不上（要 ' + (wantParent === null ? '无' : '#' + wantParent) + '，回 ' + (got === null ? '无' : '#' + got) + '）', JSON.stringify(back))
    }
    return { ok: true, data: normalizeIssue(back) }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象本身。kind 为 conflict 时按透传档走，本家那句话原样留着。
    return failGitea(err, errMsg(err), err, effective)
  }
}

/**
 * 改阻塞关系（契约 setBlockedBy）：可见 `Blocked by:` 行与隐藏机器表成对整集替换
 * （rewriteDescriptionWithBlockedPair 一处出处），空集两处一起拆。契约两条硬规矩都在写之前拦下：
 * 自阻塞 → conflict；写完成环 → conflict 且不落盘（环检邻接从单页列表读出，读不到放行并记读降级）。
 * expectedUpdatedAt 前置读；写后回读核对，阻塞整集一个都不能少、也不能多。
 *
 * @param ctx 调用上下文（opCtx 缺时顶上）
 * @param repo 目标仓库（只取 refId）
 * @param key 票号
 * @param blockers 要换成的阻塞者整集（票号数组，裸串与带井号都收，去重保序）
 * @param opts 乐观并发选项（对不上就回 conflict，不写）
 * @param opCtx 本次调用的上下文（优先用它）
 */
export async function setBlockedBy(
  ctx: CtxLike | null | undefined,
  repo: RepoLike,
  key: string,
  blockers: string[],
  opts: SetOpts | null | undefined,
  opCtx: CtxLike | null | undefined,
): Promise<OpResult<Issue>> {
  const startedAt = Date.now()
  const effective = (opCtx || ctx) as CtxLike | undefined
  const refId = refIdOf(repo)
  if (!refId) return fail(ERROR_KIND.NOTFOUND as ErrorKind, 'setBlockedBy: repo.refId 缺失，无法向 Gitea 改阻塞关系', '')
  const k = String(key).trim()
  if (!k) return fail(ERROR_KIND.PARSE as ErrorKind, 'setBlockedBy: 票号缺失', '', TRACKER_ERROR_STAGE.INPUT_REFUSED)
  // 整集归一：裸串与带井号都收，去空白、去重，保持调用方给的顺序。
  const wanted: string[] = []
  for (const b of Array.isArray(blockers) ? blockers : []) {
    const kk = String(b).trim().replace(/^#/, '')
    if (kk && !wanted.includes(kk)) wanted.push(kk)
  }
  // 自阻塞先判：入参自己和自己打架，原文给这次入参快照；这一步在环检之前，一个读请求都可以省。
  if (wanted.includes(k)) {
    return fail(ERROR_KIND.CONFLICT as ErrorKind, 'conflict: self-loop ' + k, JSON.stringify({ key: k, blockers: wanted }), TRACKER_ERROR_STAGE.INPUT_REFUSED)
  }
  try {
    const raw = await fetchRawIssue(effective, refId, k)
    // expectedUpdatedAt 前置读：对不上回 conflict，绝不后写覆盖先写（原文 = 回读到的票面）。
    if (opts && typeof opts.expectedUpdatedAt === 'string' && opts.expectedUpdatedAt !== '') {
      const cur = typeof raw['updated_at'] === 'string' ? String(raw['updated_at']) : ''
      if (cur !== opts.expectedUpdatedAt) {
        return fail(ERROR_KIND.CONFLICT as ErrorKind, 'conflict: expectedUpdatedAt 不一致（期望 ' + opts.expectedUpdatedAt + '，远端 ' + cur + '）', JSON.stringify(raw))
      }
    }
    if (wanted.length > 0) {
      // 环检（契约的硬规矩，不许省）：邻接表从单页列表读出来，把本次要写的整集应用上去再判。
      // 快照拉不到就放行并落一行读降级——读失败不能当成写失败，这个缺口写在 blockedBySnapshot 头上。
      const snapshot = await blockedBySnapshot(effective, repo)
      if (snapshot === null) {
        emitReadDegraded(effective, 'setBlockedBy', 'setBlockedBy:cycle-unchecked', Date.now() - startedAt)
      } else if (hasCycle(snapshot, k, wanted)) {
        // 原文 = 这次看到的阻塞关系快照（人据此自己复算那条环），不是给人看的那句结论。
        return fail(ERROR_KIND.CONFLICT as ErrorKind, 'conflict: cycle detected', JSON.stringify({ key: k, wanted, observed: Array.from(snapshot.entries()) }), TRACKER_ERROR_STAGE.INPUT_REFUSED)
      }
    }
    const oldBody = bodyOf(raw)
    const newBody = rewriteDescriptionWithBlockedPair(oldBody, wanted)
    if (newBody === oldBody) {
      // 本来就是这套阻塞：一次写都不发，直接把前置读到的票面归一交回。
      return { ok: true, data: normalizeIssue(raw) }
    }
    // tea 没有阻塞端点：整篇正文替换，可见行与隐藏机器表成对落正文（换行原样发）。
    const res = await runTea(effective, argsIssueEdit(refId, k, { description: newBody }))
    if (res.code !== 0) {
      // 原文 = 写阻塞那一次 tea 调用的进程结果。
      return failGitea(new Error(res.stderr || res.stdout || 'setBlockedBy: tea issues edit 失败'), '改阻塞关系失败：tea issues edit 没有跑成。请稍后重试。', res, effective)
    }
    // 写后回读核对：缺一个、多一个都算对不上，如实回 conflict——不把「写丢了」包装成成功。
    const back = await fetchRawIssue(effective, refId, k)
    const got = parseBlockedByFallback(bodyOf(back)) ?? []
    const missing = wanted.filter((w) => !got.includes(w))
    const extra = got.filter((g) => !wanted.includes(g))
    if (missing.length > 0 || extra.length > 0) {
      return fail(ERROR_KIND.CONFLICT as ErrorKind, 'conflict: 阻塞写后读回对不上（缺 ' + (missing.join(', ') || '无') + '，多 ' + (extra.join(', ') || '无') + '）', JSON.stringify(back))
    }
    return { ok: true, data: normalizeIssue(back) }
  } catch (err: unknown) {
    // 原文 = 抛上来的那个 Error 对象本身。kind 为 conflict 时按透传档走，本家那句话原样留着。
    return failGitea(err, errMsg(err), err, effective)
  }
}

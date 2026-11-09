/**
 * src/tracker/rooms/gitea/index.ts — Gitea 后端适配器（主缝实现），本文件是这个房间的入口真源。
 *
 * #2 的「最小 room」：入口交出模块对象、工厂与识别（matches / describe），外加 preflight、
 * 错误判档（errors.ts）与命令词汇表（room/prompts.ts，cli 是 tea）。26 条能力名录里起步只接
 * preflight 这一条操作，其余操作**一律不写**——没实现的那些由注册表的 Proxy 补「我不支持」的桩，
 * 房间自己不造布尔能力表，也不交半成品操作。
 *
 * 仿 GitLab 房（src/tracker/rooms/gitlab/index.ts）的形状起骨架；本文件交的成员集合不受
 * `src/tracker/capability-assertions.ts` 的编译期断言钉（那份断言今天只钉 GitHub/GitLab/Markdown
 * 三房），补操作时把断言与登记数据一起接上。
 *
 * 宿主不得直接 import 本文件（规则 rooms-imported-only-by-assembly）：装配口只有
 * `src/tracker/registry/builtins.ts` 的 backendModuleOf 一处。
 */

import type { Tracker } from '../../contract/operations.js'
import type { BackendModule } from '../../contract/backend-module.js'
import type { BackendId } from '../../contract/identity.js'
import type { RepositoryRef } from '../../contract/entities.js'
import type { BackendContext, OpContext, RepoHandle } from '../../contract/contexts.js'
import { teaPreflight } from './preflight.js'
import { remoteUrlsOfGitConfig } from '../../kernel/git-remote.js'
// 声明文件用判定层同一套解析器，只认「声明」不认「正文里提了一句」（#1555 同一口径）。
import { normalizeTrackerText, parseIssueTracker } from '../../kernel/issue-tracker-declaration.js'
import { issueAddress, repoSearchAddress, DEFAULT_GITEA_WEB_ORIGIN } from './room/links.js'
import { prompts } from './room/prompts.js'

/** 识别这一趟要用的文件服务：就用契约上下文里那一格，不另定义形状。 */
type MarkerFs = OpContext['fs']

/** 兜底问一次 git remote 的时间上限（毫秒）：识别用的启发式探针，接入中央超时线时一并搬走。 */
const GITEA_FALLBACK_TIMEOUT_MS = 2000

/**
 * 按文件服务的规矩读一个工作区文件。必须经 `fs.resolve` 再 `fs.readText`（教训与 GitLab 房同一份：
 * 自己拼路径直接喂 readText 抛的是形状错，不是「文件不在」），读不出来一律回 null、不在这里记日志。
 */
async function readWorkspaceFile(fs: MarkerFs, cwd: string, rel: string): Promise<string | null> {
  try {
    const target = await fs.resolve(rel, { cwd })
    const text = await fs.readText(target)
    return typeof text === 'string' ? text : null
  } catch {
    return null
  }
}

/**
 * Gitea matches：启发式 boolean —— 这个工作区是不是 Gitea（含 Forgejo）仓库。
 *
 * 依次看四处，任何一处指向 gitea/forgejo 就认（判据是「指向」，不是「文本里出现过这个词」）：
 *   1. `handle.refId` 显式带 gitea / forgejo；
 *   2. `.git/config` 里记下的远端地址（只看 `[remote ...]` 段的 `url`，GitLab 房同款收窄）；
 *   3. `docs/agents/issue-tracker.md` 里**明写的声明**：与判定层共用 parseIssueTracker，只认
 *      `# Issue tracker: Gitea` 这种高置信标题行；正文里提到 gitea 不算声明；
 *   4. 兜底真问一次 `git remote get-url origin`（best-effort）。
 * 四处都不认，或者线索不够，一律回 false —— 「不确定就当不是」是既定口径，不是故障。
 */
async function matches(
  handle: RepoHandle | null | undefined,
  ctx: OpContext | null | undefined,
): Promise<boolean> {
  try {
    if (!handle || typeof handle !== 'object') return false
    if (typeof handle.refId === 'string' && /gitea|forgejo/i.test(handle.refId)) return true
    const cwd = handle.cwd
    if (!cwd || typeof cwd !== 'string') return false
    const platform = ctx && ctx.platform
    const fs = (ctx && ctx.fs) || (platform && platform.fs)
    const canRead =
      !!fs &&
      typeof (fs as { resolve?: unknown }).resolve === 'function' &&
      typeof (fs as { readText?: unknown }).readText === 'function'
    if (!canRead) return false
    // 1) .git/config 里记下的远端地址是否指向 gitea/forgejo（只看 [remote ...] 段）
    const cfg = await readWorkspaceFile(fs, cwd, '.git/config')
    if (cfg !== null && remoteUrlsOfGitConfig(cfg).some((u) => /gitea|forgejo/i.test(u))) return true
    // 2) issue-tracker.md 声明的是不是 Gitea：只认高置信标题行（#1555 同一口径）。
    const doc = await readWorkspaceFile(fs, cwd, 'docs/agents/issue-tracker.md')
    if (doc !== null) {
      const parsed = parseIssueTracker(normalizeTrackerText(doc))
      if (parsed && parsed.confidence === 'high' && parsed.explicitBackendId === 'gitea') return true
    }
    // 3) exec git remote 兜底（best-effort）
    const exec = ctx && ctx.exec
    if (exec) {
      const res = await exec('git', ['remote', 'get-url', 'origin'], {
        cwd,
        timeout: GITEA_FALLBACK_TIMEOUT_MS,
      })
      const out = (res.stdout || '') + (res.stderr || '')
      if (/gitea|forgejo/i.test(out)) return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * 产出仓库身份：refId 优先用传入的标识，缺了才拿目录名顶上；host 用调用方给的，缺了退回官方站。
 * 起步不做 GitLab 房那套「从 .git/config 学实例地址」的展开，接自托管实例时补。
 */
export function describe(
  handle: RepoHandle | Partial<RepositoryRef> | null | undefined,
  backendId: BackendId,
): RepositoryRef {
  const rawRef = handle && typeof handle.refId === 'string' && handle.refId ? String(handle.refId).trim() : ''
  const maybeCwd = (handle as RepoHandle | null | undefined)?.cwd
  const cwd = typeof maybeCwd === 'string' ? String(maybeCwd) : ''
  const declaredHost =
    handle && typeof (handle as Partial<RepositoryRef>).host === 'string'
      ? String((handle as Partial<RepositoryRef>).host).trim().replace(/\/+$/, '')
      : ''
  const refId = rawRef
  const name = refId || (cwd ? cwd.split(/[\\/]/).pop() || cwd : backendId) || backendId
  const url = refId && refId.includes('/') ? (declaredHost || DEFAULT_GITEA_WEB_ORIGIN) + '/' + refId : ''
  const ref: RepositoryRef = { backend: backendId, refId: refId || '', name, url }
  if (declaredHost && declaredHost !== DEFAULT_GITEA_WEB_ORIGIN) ref.host = declaredHost
  return ref
}

/**
 * 创建 Gitea 后端适配器（#2 起步：只交 preflight 一条操作）。
 *
 * 返回类型故意不标（理由同 GitLab 房）：没实现的那些操作由注册表补「我不支持」的桩。
 * 形状判定（members 集合与 `satisfies` 断言）等操作补齐时按 GitLab 房那份登记数据的方式接上。
 */
export function createGiteaBackend(ctx: BackendContext) {
  return {
    id: 'gitea',
    describe: (handle: RepoHandle | Partial<RepositoryRef> | null | undefined) => describe(handle, 'gitea'),
    preflight: (handle: RepoHandle | null | undefined, opCtx: OpContext | null | undefined) => teaPreflight(handle, opCtx || ctx),
  }
}

/** BackendModule（registry可插拔） */
export const giteaBackend = {
  id: 'gitea',
  label: 'Gitea',
  describe,
  // 链接两件起步先交票地址与搜仓库地址；issueRefPattern（认票的写法）等真机上把链接格式钉下来再补。
  issueAddress,
  repoSearchAddress,
  // 开仓方式：'url' = 界面用浏览器新窗打开 describe().url（与两个远端后端同一契约动作）。
  openRepository: 'url' as const,
  openIssue: 'url' as const,
  openContainer: 'url' as const,
  // 品牌色起步取 Gitea 官网的绿色系，暗色与浅色各给一档；设计定版时再走 GitLab 房 #191 那样的色板票。
  presentation: {
    color: '#609926',
    darkColor: '#8fc76a',
    bg: 'light-dark(rgba(96,153,38,.12), rgba(143,199,106,.14))',
    border: 'light-dark(rgba(96,153,38,.25), rgba(143,199,106,.30))',
  },
  create: createGiteaBackend,
  matches,
  // 预算口径：起步按只计请求声明（tea 每次调用记一条请求的口径在补操作时接入）。
  budget: { kind: 'requests-only' as const, countsRequests: true, countsPoints: false, independentBuckets: false },
  prompts,
} satisfies BackendModule

export default createGiteaBackend

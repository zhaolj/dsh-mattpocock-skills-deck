/**
 * src/tracker/rooms/gitea/index.ts — Gitea 后端适配器（主缝实现），本文件是这个房间的入口真源。
 *
 * #2 的「最小 room」：入口交出模块对象、工厂与识别（matches / describe），外加 preflight、
 * 错误判档（errors.ts）与命令词汇表（room/prompts.ts，cli 是 tea）。能力名录里交的是登记数据
 * 声明为 provided 的那些操作（探活、定位口，票 #11 的 8 条读路径、票 #12 的 7 条写路径、票 #13 的 2 条结构写
 * 与票 #14 的 4 条管理类操作）；票 #14 起那两条明确不支持的（initProject / ensureLabelColorsFile）
 * 也由本实例自己交诚实回「不支持」的桩（登记 stubBy:'backend'），房间自己不造布尔能力表，也不交半成品操作。
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
// 模块检查表由检查目录派生（与 GitHub 房同一口径：目录是唯一真源，这里不再手抄第二份）。
import { backendItemsOf } from '../../../shared/tracker/check-catalog-dirs.js'
// 声明文件用判定层同一套解析器，只认「声明」不认「正文里提了一句」（#1555 同一口径）。
import { normalizeTrackerText, parseIssueTracker } from '../../kernel/issue-tracker-declaration.js'
import { issueAddress, repoSearchAddress, DEFAULT_GITEA_WEB_ORIGIN } from './room/links.js'
// #15：仓库身份（refId 与自托管实例宿主）的「学一次、describe 同步取」缓存，GitLab 房同款形状。
import { learnGiteaIdentity, giteaIdentityOf, refIdOfRemoteUrl } from './repo/identity.js'
import { prompts } from './room/prompts.js'
// 修复契约的解析口（fix-contract.resolvePrompt）要读模块的 prompts 键，按 GitLab 房同一口径把名字导出去。
export { prompts }
import type { ProvidedCapability, StubbedByBackend } from '../../contract/capability-answer.js'
import type { GITEA_CAPABILITY_REGISTER } from './support/capability-register.js'
import type { RoomFixEntry } from '../../contract/backend-module.js'
import { listIssues, getIssue } from './issues/read.js'
// 票 #12 的 7 条写路径：建/关/开/改在 issues/write.ts，标签与认领人在 labels/assign.ts，评论在 comments/write.ts。
import { createIssue, closeIssue, reopenIssue, updateIssue } from './issues/write.js'
import { setLabels, setAssignees } from './labels/assign.js'
import { addComment } from './comments/write.js'
import { counts } from './issues/counts.js'
import { listPage } from './issues/pages.js'
import { listSubIssues } from './issues/sub-issues.js'
import { listMaps } from './issues/maps.js'
import { listLabels } from './labels/list.js'
import { getDependencies } from './graph/read.js'
// 票 #13 的 2 条结构写：归属与阻塞写进正文（隐藏标记优先、可见行兜底），实现见 graph/write.ts。
import { setParent, setBlockedBy } from './graph/write.js'
// 票 #14 的 4 条管理类操作：改色在 labels/colors.ts，当前登录人与权限读在 repo/，读预算在 budget.ts。
import { setLabelColors } from './labels/colors.js'
import { getCurrentUser } from './repo/current-user.js'
import { getRepoPermissions } from './repo/permissions.js'
import { readBudget } from './budget.js'
// 两条诚实桩（stubBy:'backend'）用 fail 落契约的失败形状；理由见 support/capability-register.ts 对应行。
import { fail } from '../../kernel/preflight.js'
import { ERROR_KIND } from '../../contract/vocabulary.js'
import type { ErrorKind } from '../../contract/identity.js'

/** 识别这一趟要用的文件服务：就用契约上下文里那一格，不另定义形状。 */
type MarkerFs = OpContext['fs']

/** 兜底问一次 git remote 的时间上限（毫秒）：识别用的启发式探针；#16 拍板钉死在这，不入中央 YAML。 */
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
    if (cfg !== null) {
      const urls = remoteUrlsOfGitConfig(cfg)
      // #15：认仓库这一趟远端地址就在手里，顺手把身份（owner/name 与实例宿主）学下来，
      // 后面 select 里的 describe（同步纯函数）才能回出权威地址；学到什么不影响本函数的布尔结论。
      for (const u of urls) if (/gitea|forgejo/i.test(u)) learnGiteaIdentity(cwd, u)
      if (urls.some((u) => /gitea|forgejo/i.test(u))) return true
    }
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
      if (/gitea|forgejo/i.test(out)) {
        // #15：兜底这一趟认出的是 Gitea，也把身份学下来（同 .git/config 那一趟的道理）。
        const url = out.split('\n').map((l) => l.trim()).find((l) => /gitea|forgejo/i.test(l))
        if (url) learnGiteaIdentity(cwd, url)
        return true
      }
    }
    return false
  } catch {
    return false
  }
}

/**
 * 产出仓库身份：refId 优先用传入的标识，缺了才用「认仓库时学到的这一份」（getRepoKey / matches
 * 在读远端地址那一趟记下的 owner/name），都缺才拿目录名顶上；宿主同样先用调用方给的，缺了用
 * 学到的这台实例，都没有才退回官方站。
 *
 * #15 之前这一格只信调用方，自托管实例的宿主与 owner/name 都带不进来，describe 回
 * `{ refId:'', url:'' }`，宿主刷新链只能手拼 github.com，自托管 Gitea 拿到错页面。
 * 「从 .git/config 学实例地址」原是源码注释里自己认的待办，本票把待办落地（GitLab 房同款形状）。
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
  const learned = cwd ? giteaIdentityOf(cwd) : null
  const host = declaredHost || (learned ? learned.origin : '')
  // 学到的 refId 只在调用方没给时顶上：调用方显式给的标识是第一真源，不覆盖。
  const refId = rawRef || (learned ? learned.refId : '')
  const name = refId || (cwd ? cwd.split(/[\\/]/).pop() || cwd : backendId) || backendId
  const url = refId && refId.includes('/') ? (host || DEFAULT_GITEA_WEB_ORIGIN) + '/' + refId : ''
  const ref: RepositoryRef = { backend: backendId, refId: refId || '', name, url }
  if (host && host !== DEFAULT_GITEA_WEB_ORIGIN) ref.host = host
  return ref
}

/**
 * 工厂实例上真正存在的成员集合：id 之外的全部名字由登记数据推出来（provided 与 stubBy:'backend' 那几条）。
 * 两档之外的操作不在这里出现——注册表的 Proxy 会按名录给它们补「不支持」的桩。
 * 编译期拿这个类型钉工厂返回值，多交、少交都会当场红（GitLab 房同一套形状判定）。
 */
export type GiteaBackendMembers =
  | 'id'
  | ProvidedCapability<typeof GITEA_CAPABILITY_REGISTER>
  // 票 #14 起 initProject / ensureLabelColorsFile 是本实例自己交的诚实桩（stubBy:'backend'），
  // 成员集合按登记数据把这一档也算进来（markdown 房同一套形状）。
  | StubbedByBackend<typeof GITEA_CAPABILITY_REGISTER>

/** 成员名字映射回契约签名：工厂的返回类型用它，写错参数或返回类型当场编译红（gitlab 房同款两步）。 */
export type GiteaBackendShape = { [K in GiteaBackendMembers]: Tracker[K] }

/**
 * 从 git 远端地址里解析 owner/name（定位口 getRepoKey 的实现）。
 *
 * 地址形状认三类（其余一律回 null，不是异常）：
 *   · https(s)://host/owner/name(.git)；
 *   · git@host:owner/name(.git)（scp 写法）；
 *   · ssh://git@host/owner/name(.git)。
 * owner/name 取路径最后两段，尾巴的 .git 去掉；解析规则只有 repo/identity.ts 里一份，
 * 这里委托过去（#15：describe 也要用同一套解析，两份拷贝迟早对不上）。
 * 解析不出来（没有两段、或者拿不到远端地址）诚实回 null——契约对定位口只有「名字或者空」这一种答案形态。
 */
function repoKeyFromRemoteUrl(url: string): { owner: string; name: string } | null {
  const refId = refIdOfRemoteUrl(url)
  if (!refId) return null
  const slash = refId.indexOf('/')
  return { owner: refId.slice(0, slash), name: refId.slice(slash + 1) }
}

/**
 * 创建 Gitea 后端适配器（票 #3 口径：探活 + 三个定位口；其余操作由注册表补桩）。
 *
 * 返回类型按登记数据推出（见 GiteaBackendShape），多交、少交都编译红；
 * 没实现的那些操作不在这里出现，调用方拿到的会是注册表的规范 unsupported 桩。
 */
export function createGiteaBackend(ctx: BackendContext): GiteaBackendShape {
  return {
    id: 'gitea',
    describe: (handle: RepoHandle | Partial<RepositoryRef> | null | undefined) => describe(handle, 'gitea'),
    issueAddress: (ref: Partial<RepositoryRef> | null | undefined, key: string | number) => issueAddress(ref, key),
    preflight: (handle: RepoHandle | null | undefined, opCtx: OpContext | null | undefined) => teaPreflight(handle, opCtx || ctx),
    /**
     * 定位口：问「这个仓库叫什么」。从 `.git/config` 记下的远端地址解析 owner/name
     * （best-effort 真问一次 git remote，与 matches 的兜底同一档超时）；解析不出来回 null。
     */
    // 票 #11 的 8 条读操作：命令词汇表在 support/tea-run.ts 一处，读实现分别在
    // issues/{read,counts,pages,maps,sub-issues}.ts、labels/list.ts、graph/read.ts。
    list: (repo, filter, opCtx) => listIssues(ctx, repo, filter, opCtx || ctx),
    get: (repo, key, opts, opCtx) => getIssue(ctx, repo, key, opts, opCtx || ctx),
    getDependencies: (repo, key, opts, opCtx) => getDependencies(repo, key, opts, opCtx || ctx),
    counts: (repo, filter, opCtx) => counts(repo, filter, opCtx || ctx),
    listPage: (repo, filter, opts, opCtx) => listPage(repo, filter, opts, opCtx || ctx),
    listLabels: (repo, opCtx) => listLabels(repo, opCtx || ctx),
    listSubIssues: (repo, mapKey, opts, opCtx) => listSubIssues(repo, mapKey, opts, opCtx || ctx),
    listMaps: (repo, opCtx) => listMaps(repo, opCtx || ctx),
    // 票 #12 的 7 条写操作：签名按契约 Tracker 钉（GiteaBackendShape 编译期比对），词汇表在 support/tea-run.ts。
    create: (repo, input, opCtx) => createIssue(ctx, repo, input, opCtx || ctx),
    close: (repo, key, opts, opCtx) => closeIssue(ctx, repo, key, opts, opCtx || ctx),
    reopen: (repo, key, opCtx) => reopenIssue(ctx, repo, key, opCtx || ctx),
    comment: (repo, key, body, opCtx) => addComment(ctx, repo, key, body, opCtx || ctx),
    update: (repo, key, patch, opCtx) => updateIssue(ctx, repo, key, patch, opCtx || ctx),
    setLabels: (repo, key, labels, opts, opCtx) => setLabels(ctx, repo, key, labels, opts, opCtx || ctx),
    setAssignees: (repo, key, assignees, opts, opCtx) => setAssignees(ctx, repo, key, assignees, opts, opCtx || ctx),
    // 票 #13 的 2 条结构写：签名按契约 Tracker 钉，词汇表在 support/tea-run.ts。
    setParent: (repo, key, parentKey, opts, opCtx) => setParent(ctx, repo, key, parentKey, opts, opCtx || ctx),
    setBlockedBy: (repo, key, blockers, opts, opCtx) => setBlockedBy(ctx, repo, key, blockers, opts, opCtx || ctx),
    // 票 #14 的 4 条管理类操作：签名按契约 Tracker 钉，词汇表在 support/tea-run.ts。
    setLabelColors: (repo, changes, opCtx) => setLabelColors(repo, changes, opCtx || ctx),
    getCurrentUser: (repo, opCtx) => getCurrentUser(repo, opCtx || ctx),
    getRepoPermissions: (repo, opCtx) => getRepoPermissions(repo, opCtx || ctx),
    readBudget: (opCtx) => readBudget(opCtx || ctx),
    // 票 #14 的两条诚实桩（登记 stubBy:'backend'）：不是注册表补的桩，是本实例自己如实回「不支持」。
    initProject: () => Promise.resolve(fail(ERROR_KIND.UNSUPPORTED as ErrorKind, 'initProject: gitea 房暂不承接开仓发布——tea repos create 存在，但「建仓＋git init＋首次推送」全链路未经真机验证，硬接只会交半成品；验证通过后改真实现', '')),
    ensureLabelColorsFile: () => Promise.resolve(fail(ERROR_KIND.UNSUPPORTED as ErrorKind, 'ensureLabelColorsFile: 颜色真源在远端仓库标签，工作区配色文件没有任何读者，这个形态在 Gitea 后端上不成立（GitHub / GitLab 同一条理由）', '')),
    getRepoKey: async (cwd: string, opCtx: OpContext | null | undefined) => {
      const exec = opCtx && opCtx.exec
      if (!exec || typeof cwd !== 'string' || !cwd) return null
      try {
        const res = await exec('git', ['remote', 'get-url', 'origin'], {
          cwd,
          timeout: GITEA_FALLBACK_TIMEOUT_MS,
        })
        const url = ((res.stdout || '') + '\n' + (res.stderr || '')).split('\n').map((l) => l.trim()).find(Boolean)
        if (!url) return null
        const key = repoKeyFromRemoteUrl(url)
        // #15：认出仓库的同一趟把身份学下来（owner/name 与实例宿主），describe 同步取这份缓存。
        if (key) learnGiteaIdentity(cwd, url)
        return key
      } catch {
        return null
      }
    },
  }
}

/**
 * 修复契约（2026-11-11）：检查链失败行的修复知识，只挂安装与登录两项（维护者定版 Q3）。
 * 关联仓库与仓库可达两行不挂专项按钮，保持默认的「重查」。文案引用本房 prompts 键
 * cliInstall / cliLogin（双语单源，与 GitHub 房 gh:installed / gh:authed 同构）。
 */
export const fixes: Record<string, RoomFixEntry> = Object.freeze({
  'tea:installed': {
    hint: {
      zh: 'DSH 进程启动时继承的 PATH 中未解析到 tea 可执行文件。可能未安装，也可能已安装但其目录不在该 PATH 中（安装后要重启宿主：宿主只在启动时读 PATH）。',
      en: 'tea was not resolved from the PATH inherited at DSH process startup. It may be not installed, or installed in a directory absent from that PATH (restart the host after installing: the host reads PATH only at startup).',
    },
    actions: [
      { type: 'inject-prompt', prompt: 'cliInstall', label: { zh: '安装指引', en: 'Install guide' } },
      { type: 'refresh', target: 'chain' },
    ],
  },
  'tea:authed': {
    hint: {
      zh: 'Gitea 登录状态不可用，重新登录后即可继续。',
      en: 'The Gitea login is not usable — sign in again to continue.',
    },
    actions: [
      { type: 'inject-prompt', prompt: 'cliLogin', label: { zh: '登录指引', en: 'Login guide' } },
      { type: 'refresh', target: 'chain' },
    ],
  },
})

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
  checks: Object.freeze(backendItemsOf('gitea')),
  fixes,
} satisfies BackendModule

export default createGiteaBackend

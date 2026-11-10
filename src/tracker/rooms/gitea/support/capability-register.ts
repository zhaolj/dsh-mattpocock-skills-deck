/**
 * src/tracker/rooms/gitea/support/capability-register.ts —— gitea 房对 27 条能力的回答（数据）
 *
 * 四类的判据、为什么写成联合、以及「运行时不读它」这条 G5 纪律，都写在
 * `src/tracker/contract/capability-answer.ts` 的文件头，这里不重复。
 *
 * ── 这一家的账（票 #3 的口径）────────────────────────────────────────────────
 * gitea 房目前接了探活（preflight）、三个定位口、8 条读操作（票 #11：list / get / getDependencies /
 * counts / listPage / listLabels / listSubIssues / listMaps）与 9 条写操作（票 #12：create / close /
 * reopen / comment / update / setLabels / setAssignees；票 #13：setParent / setBlockedBy）；其余操作一律不写进工厂，由注册表按名录
 * 补「不支持」的桩（stubBy: "registry"），调用方拿到的是规范的 unsupported 失败，不是方法缺失。
 * 每补一条操作：先在这里把那一行改成 `{ tier: 'provided' }`，再去实现，最后同步
 * `docs/tracker/capability-gitea.md` 的文档表，门禁 `tests/verify-capability-register.ts`
 * 会逐行比对三处。
 *
 * `getRepoKey` 为什么是「提供」而不是「不支持」：契约对定位口只有一种答案形态——名字或者空，
 * 空也是答案、不是失败（`contract/README.md` 定位口那一段）。注册表**不给定位口补桩**，
 * 缺席就是实例上没有这个方法，调用方一调就抛类型错；所以这一房真的实现了一条：
 * 从 `git remote get-url origin` 的地址里解析 owner/name，解析不出来诚实回 null（实现见
 * `rooms/gitea/index.ts` 的 createGiteaBackend）。
 *
 * 本文件只有数据：没有函数、没有分支、没有 import 运行时值（G5 红线：能力只能调用即知，不许查表）。
 */
import type { CapabilityRegister } from '../../../contract/capability-answer.js'

/**
 * gitea 后端：27 条能力里 18 条真提供（探活、两个定位口，加票 #11 的 8 条读操作与票 #12 的 7 条写操作、票 #13 的 2 条结构写），
 * 6 条操作由注册表补桩、明确不支持。
 *
 * 顺序照契约名录（24 条操作在前、3 条定位口在后），读的人可以两边对着看。
 */
export const GITEA_CAPABILITY_REGISTER = {
  // —— 操作 24 条：探活、8 条读操作（票 #11）与 9 条写操作（票 #12、#13）真实现，其余 6 条由注册表补桩、明确不支持 ——
  preflight: { tier: 'provided' },
  list: { tier: 'provided' },
  get: { tier: 'provided' },
  getDependencies: { tier: 'provided' },
  // 票 #12 的 7 条写操作：tea 命令面见 support/tea-run.ts，实现见 issues/write.ts、labels/assign.ts、comments/write.ts。
  create: { tier: 'provided' },
  close: { tier: 'provided' },
  reopen: { tier: 'provided' },
  comment: { tier: 'provided' },
  update: { tier: 'provided' },
  setLabels: { tier: 'provided' },
  setAssignees: { tier: 'provided' },
  // 票 #13 的 2 条结构写：归属与阻塞都写进正文（隐藏标记优先、可见行兜底），实现见 graph/write.ts。
  setParent: { tier: 'provided' },
  setBlockedBy: { tier: 'provided' },
  counts: { tier: 'provided' },
  listPage: { tier: 'provided' },
  listLabels: { tier: 'provided' },
  setLabelColors: { tier: 'unsupported-by-design', stubBy: 'registry' },
  getCurrentUser: { tier: 'unsupported-by-design', stubBy: 'registry' },
  getRepoPermissions: { tier: 'unsupported-by-design', stubBy: 'registry' },
  listSubIssues: { tier: 'provided' },
  initProject: { tier: 'unsupported-by-design', stubBy: 'registry' },
  ensureLabelColorsFile: { tier: 'unsupported-by-design', stubBy: 'registry' },
  // 读预算：tea 这一房还没有量请求桶水位的实现，注册表补桩。补实现时把这一行改回 provided 并建 md 表。
  readBudget: { tier: 'unsupported-by-design', stubBy: 'registry' },
  listMaps: { tier: 'provided' },

  // —— 定位口 3 条：getRepoKey 实现为「名字或空」，describe 与 issueAddress 真提供 ——
  getRepoKey: { tier: 'provided' },
  describe: { tier: 'provided' },
  issueAddress: { tier: 'provided' },
} as const satisfies CapabilityRegister

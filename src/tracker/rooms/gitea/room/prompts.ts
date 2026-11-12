/**
 * src/tracker/rooms/gitea/room/prompts.ts — 这一房交给契约注入与修复指引的提示文案。
 *
 * 为什么独立成文件：与 GitLab 房同一理由 —— 提示文案改动频繁，入口只负责装配；
 * 改一句话不该打开入口。
 *
 * 两类文案：
 *   · 命令词汇表与安装/登录指引（commandVocabulary / cliInstall / cliLogin）；
 *   · 错误三档的修复指引（cliAuthFix / cliRepoFix / cliNetworkFix）与 tea 命令映射（commandMap）：
 *     错误判档给出「这一档该怎么走」之后，把可操作的 tea 命令原样交给人——
 *     只写 tea 实测有的命令面（tea issues create/list/<编号>/comments/close、
 *     tea issues edit --add-labels/--add-assignees、tea labels create/list），不编不存在的命令。
 */

const teaInstallCopy = {
  zh: '请为 DSH 安装 Gitea CLI（tea）。官方安装说明只有一处：https://gitea.com/gitea/tea，按那一页的指引做，不要凭记忆写安装命令。\n1. 先检查：终端执行 tea --version；有版本号就直接汇报已装版本，不要重复安装；\n2. 没有 tea 时，打开上面那一页，按你的系统对应的那一节装；那一页打不开就如实说打不开，不要编命令；\n3. 装完请用户点「重查」；如果重查仍说找不到，请用户重启宿主（宿主只在启动时读 PATH）。',
  en: 'Install the Gitea CLI (tea) for DSH. The only official source is https://gitea.com/gitea/tea — follow that page, do not write install commands from memory.\n1. Check first: tea --version; if a version is reported, report it and do not reinstall;\n2. If missing, open the page above and follow the section for your OS; if the page cannot be opened, say so plainly and do not invent commands;\n3. After install, ask the user to re-check; if it still reports missing, ask the user to restart the host (the host reads PATH only at startup).',
}

const teaLoginCopy = {
  zh: '请完成 tea 登录：终端执行 tea login add，按向导填入 Gitea 实例地址与访问令牌；完成后用 tea login list 验证至少有一个登录项，然后请用户点「重查」。',
  en: 'Complete tea login: run tea login add and follow the wizard with your Gitea instance URL and access token; verify with tea login list that at least one login exists, then ask the user to re-check.',
}

// 错误三档的修复指引：文案与 errors.ts 的判档一一对应（AUTH 两句原话 → cliAuthFix，
// NOT-FOUND 的「仓库不存在」→ cliRepoFix，NETWORK 兜底 → cliNetworkFix）。
const teaAuthFixCopy = {
  zh: 'tea 没有可用的登录凭据：终端执行 tea login add，按向导填入 Gitea 实例地址与访问令牌；完成后用 tea login list 确认登录项在列（自托管实例要确认地址写的是同一个实例），然后请用户点「重查」。',
  en: 'tea has no usable credentials: run tea login add and follow the wizard with your Gitea instance URL and access token; confirm with tea login list that a login exists (for a self-hosted instance, make sure the URL points at the same instance), then ask the user to re-check.',
}

const teaRepoFixCopy = {
  zh: 'tea 找不到这个仓库：先核对 owner/repo 的写法与实例地址是否正确（tea login list 看当前登录的是哪个实例）；用 tea issues ls 验证这个仓库确实列得出票——列不出说明仓库名写错、仓库不存在，或当前账号没有这个仓库的读权限。',
  en: 'tea cannot find this repository: verify the owner/repo spelling and the instance URL (tea login list shows which instance you are logged in to); run tea issues ls to confirm the repository actually lists issues — if it does not, the repo name is wrong, the repository does not exist, or the current account lacks read access.',
}

const teaNetworkFixCopy = {
  zh: '连不上 Gitea 实例：先用浏览器或 curl 确认实例地址现在可达（自托管实例常见是内网地址、VPN 没连或服务停了）；确认可达之后再重试一次，还是失败就把原始报错原文贴出来，不要凭记忆猜原因。',
  en: 'Cannot reach the Gitea instance: first confirm the instance URL is reachable right now with a browser or curl (self-hosted instances are commonly behind an intranet, a disconnected VPN, or a stopped service); retry once after confirming reachability, and if it still fails, paste the original error text instead of guessing the cause.',
}

// tea 命令映射：把契约操作名对到 tea 实测存在的命令面上，注入提示词用它，出错指引也引用同一批命令。
const teaCommandMapCopy = {
  zh: '本项目的票务通过 Gitea CLI（tea）操作，命令映射如下——建票：tea issues create；列票：tea issues ls（即 tea issues list）；看单张票：tea issues <编号>；看评论：tea issues <编号> comments；关票：tea issues close <编号>；给票加标签或认领：tea issues edit <编号> --add-labels/--add-assignees；标签管理：tea labels create / tea labels ls（即 tea labels list）。没有的命令（例如拆分父子、设置阻塞）tea 不提供，不要编造写法。',
  en: 'Issue tracking in this project goes through the Gitea CLI (tea); the command map: create an issue with tea issues create; list issues with tea issues ls (aka tea issues list); view one issue with tea issues <number>; view comments with tea issues <number> comments; close an issue with tea issues close <number>; add labels or assignees with tea issues edit <number> --add-labels/--add-assignees; manage labels with tea labels create / tea labels ls (aka tea labels list). tea offers no commands for parent/child splitting or blocking — do not invent syntax.',
}

/**
 * preflight 选中的执行器（票 #21）：'gt' 或 'tea'，缺省 'tea'。
 * 为什么放模块级变量而不是构造期传参：prompts 是静态导出的常量对象，
 * 客户端投影（ui-description）在读属性时才求值，getter 注入是唯一的活口——
 * preflight 探测完写进来，注入提示词时读出去，键名与取值类型不变。
 * 这里只存「选了谁」；gt/tea 两套完整文案（#24）会各自成表，与本状态解耦。
 */
export type GiteaExecutorCli = 'gt' | 'tea'
let selectedExecutorCli: GiteaExecutorCli = 'tea'

/** preflight 探测结束后写入选中结果；只收 'gt' | 'tea'，写别的值编译不过。 */
export function setSelectedExecutor(cli: GiteaExecutorCli): void {
  selectedExecutorCli = cli
}

/** 读当前选中的执行器（测试与诊断用；提示词注入经 commandVocabulary.cli 的 getter 走这里）。 */
export function selectedExecutor(): GiteaExecutorCli {
  return selectedExecutorCli
}

/** 这一房交给契约注入与修复指引的全部提示文案；commandVocabulary 的键名是对外契约，不能改名。 */
export const prompts = {
  // cli 是 getter：每次投影/注入时读 preflight 刚写进来的选中值（#21）。
  // 什么都没探测过时维持 'tea'，与旧行为一致（老会话没跑过新 preflight 也不变味）。
  commandVocabulary: {
    get cli(): GiteaExecutorCli { return selectedExecutorCli },
    cliBrand: 'Gitea',
  },
  cliInstall: { ...teaInstallCopy },
  cliLogin: { ...teaLoginCopy },
  cliAuthFix: { ...teaAuthFixCopy },
  cliRepoFix: { ...teaRepoFixCopy },
  cliNetworkFix: { ...teaNetworkFixCopy },
  commandMap: { ...teaCommandMapCopy },
}

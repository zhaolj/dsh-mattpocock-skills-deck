/**
 * src/tracker/rooms/gitea/room/prompts.ts — 这一房交给契约注入与修复指引的提示文案（#2 起步骨架）。
 *
 * 为什么独立成文件：与 GitLab 房同一理由 —— 提示文案改动频繁，入口只负责装配；
 * 改一句话不该打开入口。起步只挂命令词汇表与安装/登录两段修复指引（cliInstall / cliLogin），
 * 房间能力补齐时再按 GitLab 房的键名单补齐其余文案。
 */

const teaInstallCopy = {
  zh: '请为 DSH 安装 Gitea CLI（tea）。官方安装说明只有一处：https://gitea.com/gitea/tea，按那一页的指引做，不要凭记忆写安装命令。\n1. 先检查：终端执行 tea --version；有版本号就直接汇报已装版本，不要重复安装；\n2. 没有 tea 时，打开上面那一页，按你的系统对应的那一节装；那一页打不开就如实说打不开，不要编命令；\n3. 装完请用户点「重查」；如果重查仍说找不到，请用户重启宿主（宿主只在启动时读 PATH）。',
  en: 'Install the Gitea CLI (tea) for DSH. The only official source is https://gitea.com/gitea/tea — follow that page, do not write install commands from memory.\n1. Check first: tea --version; if a version is reported, report it and do not reinstall;\n2. If missing, open the page above and follow the section for your OS; if the page cannot be opened, say so plainly and do not invent commands;\n3. After install, ask the user to re-check; if it still reports missing, ask the user to restart the host (the host reads PATH only at startup).',
}

const teaLoginCopy = {
  zh: '请完成 tea 登录：终端执行 tea login add，按向导填入 Gitea 实例地址与访问令牌；完成后用 tea login list 验证至少有一个登录项，然后请用户点「重查」。',
  en: 'Complete tea login: run tea login add and follow the wizard with your Gitea instance URL and access token; verify with tea login list that at least one login exists, then ask the user to re-check.',
}

/** 这一房交给契约注入与修复指引的全部提示文案；commandVocabulary 的键名是对外契约，不能改名。 */
export const prompts = {
  commandVocabulary: { cli: 'tea', cliBrand: 'Gitea' },
  cliInstall: { ...teaInstallCopy },
  cliLogin: { ...teaLoginCopy },
}

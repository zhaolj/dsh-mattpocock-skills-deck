# Gitea 后端能力登记表

票 #3 的交付物（2026-11-10）。登记口径同 GitHub / GitLab / Markdown 那三份，一条一条对照实现落笔，不估。

四类的判据写在 `src/tracker/contract/capability-answer.ts` 的文件头。gitea 房目前的账：探活（preflight）、三个定位口与 8 条读操作已经落地（票 #2 起骨架、票 #3 补齐定位口、票 #11 补读路径），其余 15 条操作全部**明确不支持**、由注册表按名录补桩——调用这些操作得到的是规范的「不支持」失败，不是方法缺失。归一层（normalizeIssue 的完整映射、labels 与 blocked_by / Blocked-by 双路径）本票已按契约对齐，等操作逐条补实现时直接复用。

实现真源：`src/tracker/rooms/gitea/index.ts`（工厂交 preflight + describe / issueAddress / getRepoKey 三条定位口，加票 #11 的 8 条读操作）。命令面是 Gitea CLI（tea），词汇表与错误修复指引在 `rooms/gitea/room/prompts.ts`，错误判档的 tea 专有条目在 `rooms/gitea/errors.ts`。

## 操作（24 条中：9 条明确提供功能、15 条明确不支持）

| 能力 | 登记 | 依据 |
|---|---|---|
| preflight | 明确提供功能 | `preflight.ts` 三步探活：找得到 tea 可执行文件 → `tea login list` 至少一个登录项 → `tea issues ls --limit 1` 能列票；每一步失败都判到具体档位并给可操作提示（未登录指向 `tea login add`） |
| list | 明确提供功能 | `issues/read.ts`：`tea issues ls --output json` 取一页（每页上限见共享分页表 `contract/pagination.ts` 的 gitea 组），state 与 labels 交给远端筛、keys 内存滤；满页置 `truncated`（契约 `list:truncated` 口径） |
| get | 明确提供功能 | `issues/read.ts`：`tea issues <编号> --output json` 读主票面，`tea issues <编号> comments --output json` 按 `comments.first` 取评论正文（first=0 只取票面上的总数），归一层 `model/normalize.ts` 出契约形状 |
| getDependencies | 明确提供功能 | `graph/read.ts`：读票面正文后按 `model/description-markers.ts` 的回退读解析阻塞（隐藏机器表优先、可见 `Blocked by:` 行兜底），逐张取对端落实标题与开关，取不到按开着记（保守方向）；tea 无原生阻塞端点，`blocking` 反向聚合由宿主投影 |
| create | 明确不支持 | 注册表补桩；补实现时走 `tea issues create` |
| close | 明确不支持 | 注册表补桩；补实现时走 `tea issues close <编号>` |
| reopen | 明确不支持 | 注册表补桩；tea 的命令面里 reopen 走 `tea issues edit`，补实现时以实测为准 |
| comment | 明确不支持 | 注册表补桩；补实现时走 `tea issues <编号> comments` |
| update | 明确不支持 | 注册表补桩；补实现时走 `tea issues edit`（`--add-labels` / `--add-assignees` 等） |
| setLabels | 明确不支持 | 注册表补桩；补实现时走 `tea issues edit --add-labels` |
| setAssignees | 明确不支持 | 注册表补桩；补实现时走 `tea issues edit --add-assignees` |
| setParent | 明确不支持 | 注册表补桩；tea 没有父子拆分命令，写方向将来按隐藏标记 `<!-- DSH-PARENT: n -->` 落正文 |
| setBlockedBy | 明确不支持 | 注册表补桩；写方向将来按成对写法落隐藏机器表与可见行（gitlab 房同一套标记） |
| counts | 明确提供功能 | `issues/counts.ts`：tea 没有统计端点，翻页扫仓数出打开/关闭两数（每页上限与最多扫几页见共享分页表 gitea 组），扫不满如实失败不许猜数；filter.state 本地收窄，与 GitHub / GitLab 房同一口径 |
| listPage | 明确提供功能 | `issues/pages.ts`：游标是页码，`--limit`／`--page` 翻页；缺省 50、上限 200（共享分页表），total 用同一筛选口径扫出来；创建时间倒序、无下一页 nextCursor=null |
| listLabels | 明确提供功能 | `labels/list.ts`：`tea labels ls --output json` 翻页拉全量，颜色过 `normalizeColor` 归一成不带井号的六位小写十六进制；取不全整体失败，不交残缺清单 |
| setLabelColors | 明确不支持 | 注册表补桩 |
| getCurrentUser | 明确不支持 | 注册表补桩 |
| getRepoPermissions | 明确不支持 | 注册表补桩 |
| listSubIssues | 明确提供功能 | `issues/sub-issues.ts`：翻页扫仓按归一层读出的 parentKey（隐藏标记优先）认子票，1000 张硬上限置 capped；缺编号/归一失败的行计入 dropped，全是坏行时整体失败 |
| initProject | 明确不支持 | 注册表补桩 |
| ensureLabelColorsFile | 明确不支持 | 注册表补桩 |
| readBudget | 明确不支持 | 注册表补桩；模块预算口径已按「只计请求」声明（`budget: { kind: 'requests-only' }`），读响应头量水位的实现随操作一起补 |
| listMaps | 明确提供功能 | `issues/maps.ts`：`tea issues ls --labels wayfinder:map` 两态一起扫，按创建时间倒序翻页、交前按更新时间重排；撞页数上限置 truncated，单页失败整趟失败 |

## 定位口（3 条全部提供）

| 能力 | 登记 | 依据 |
|---|---|---|
| getRepoKey | 明确提供功能 | **位置在工厂实例上**：从 `git remote get-url origin` 的地址解析 owner/name（https / scp / ssh 三类写法都认，尾巴 `.git` 去掉），解析不出来诚实回 null。注册表**不给定位口补桩**，所以这一条必须真实现、不能写「由注册表补桩」（markdown 房同一条教训） |
| describe | 明确提供功能 | `index.ts` 的 `describe`：refId 与声明 host 产出仓库身份，host 缺失退回官方站；注册表识别链在用 |
| issueAddress | 明确提供功能 | `room/links.ts`：`<host>/<owner>/<repo>/issues/<编号>`；refId 不带 `/` 或 host 缺失时给空串 / 官方站，不猜 |

## 变更

- 2026-11-10（票 #3 落地）：首份登记表。归一层补齐（评论、里程碑、作者、blocked_by / Blocked-by 双路径、隐藏父标记），错误判档补三条 tea 专有条目，定位口 `getRepoKey` 真实现；23 条操作明确不支持、由注册表补桩。
- 2026-11-11（票 #11 落地）：8 条读操作改为明确提供功能（list / get / getDependencies / counts / listPage / listLabels / listSubIssues / listMaps），数据源是 tea 的读命令（`tea issues ls` / `tea issues <编号>` / `tea issues <编号> comments` / `tea labels ls`），分页额度收进共享分页表的 gitea 组；其余 15 条操作仍明确不支持。

## 交接

本表与 `src/tracker/rooms/gitea/support/capability-register.ts`（登记数据）由门禁 `tests/verify-capability-register.ts` 逐行比对；每补一条操作，先改登记数据、再改实现、最后回来改这张表。错误判档的规矩与 tea 专有条目见 `rooms/gitea/errors.ts` 文件头。

# Gitea 后端能力登记表

票 #3 的交付物（2026-11-10）。登记口径同 GitHub / GitLab / Markdown 那三份，一条一条对照实现落笔，不估。

四类的判据写在 `src/tracker/contract/capability-answer.ts` 的文件头。gitea 房目前的账：探活（preflight）、三个定位口、8 条读操作与 9 条写操作已经落地（票 #2 起骨架、票 #3 补齐定位口、票 #11 补读路径、票 #12 补写路径、票 #13 补结构写），其余 6 条操作全部**明确不支持**、由注册表按名录补桩——调用这些操作得到的是规范的「不支持」失败，不是方法缺失。归一层（normalizeIssue 的完整映射、labels 与 blocked_by / Blocked-by 双路径）已按契约对齐，补实现的操作直接复用。

实现真源：`src/tracker/rooms/gitea/index.ts`（工厂交 preflight + describe / issueAddress / getRepoKey 三条定位口，加票 #11 的 8 条读操作、票 #12 的 7 条写操作与票 #13 的 2 条结构写）。命令面是 Gitea CLI（tea），词汇表与错误修复指引在 `rooms/gitea/room/prompts.ts`，错误判档的 tea 专有条目在 `rooms/gitea/errors.ts`。

## 操作（24 条中：18 条明确提供功能、6 条明确不支持）

| 能力 | 登记 | 依据 |
|---|---|---|
| preflight | 明确提供功能 | `preflight.ts` 三步探活：找得到 tea 可执行文件 → `tea login list` 至少一个登录项 → `tea issues ls --limit 1` 能列票；每一步失败都判到具体档位并给可操作提示（未登录指向 `tea login add`） |
| list | 明确提供功能 | `issues/read.ts`：`tea issues ls --output json` 取一页（每页上限见共享分页表 `contract/pagination.ts` 的 gitea 组），state 与 labels 交给远端筛、keys 内存滤；满页置 `truncated`（契约 `list:truncated` 口径） |
| get | 明确提供功能 | `issues/read.ts`：`tea issues <编号> --output json` 读主票面，`tea issues <编号> comments --output json` 按 `comments.first` 取评论正文（first=0 只取票面上的总数），归一层 `model/normalize.ts` 出契约形状 |
| getDependencies | 明确提供功能 | `graph/read.ts`：读票面正文后按 `model/description-markers.ts` 的回退读解析阻塞（隐藏机器表优先、可见 `Blocked by:` 行兜底），逐张取对端落实标题与开关，取不到按开着记（保守方向）；tea 无原生阻塞端点，`blocking` 反向聚合由宿主投影 |
| create | 明确提供功能 | `issues/write.ts`：`tea issues create --repo <refId> --title --description [--labels a,b] [--assignees a,b]`（本机 tea 0.16.0 实测，create 不认 `--output`），从回包文本抠出新票编号后回查一次票面交契约形状；parentKey 经 `model/description-markers.ts` 写进正文头的隐藏归属标记；幂等键只做入参校验（锚回查待共享写法后接入） |
| close | 明确提供功能 | `issues/write.ts`：`tea issues close <编号> --repo <refId> --output json`，回包就是关完之后的票面；回包不成形状时按编号兜最小票面（写已成功，不因回包难读判失败） |
| reopen | 明确提供功能 | `issues/write.ts`：`tea issues reopen <编号> --repo <refId> --output json`（tea 0.16.0 里 reopen 是独立子命令，不走 edit）；回包处理与 close 同一套 |
| comment | 明确提供功能 | `comments/write.ts`：`tea comments add <编号> --repo <refId> --description <正文> --output json`（评论写入挂在 comments 命名空间下，不是 issues <编号> comments）；回包归一回契约 Comment，正文以调用方入参为准 |
| update | 明确提供功能 | `issues/write.ts`：`tea issues edit <编号> --repo <refId> [--title] [--description] [--milestone 名字或空串] --output json`；空补丁不发写命令、回读当前票面；customFields 明确不支持；写后回包难读时回查票面兜底 |
| setLabels | 明确提供功能 | `labels/assign.ts`：tea 没有整集替换标签的参数，先读现标签算差集再发 `--add-labels` / `--remove-labels`（gitlab 房同一条纪律：expectedUpdatedAt 前置读，对不上回 conflict）；目标集合与现状一致时不发写命令 |
| setAssignees | 明确提供功能 | `labels/assign.ts`：`tea issues edit <编号> --set-assignees a,b` 本来就是整集替换（空串清空），一步到位；expectedUpdatedAt 前置读与 setLabels 同一套，写后回读以远端为准 |
| setParent | 明确提供功能 | `graph/write.ts`：归属的真相写进正文头的隐藏标记 `<!-- DSH-PARENT: n -->`（`model/description-markers.ts` 一处出处，拆归属顺带清旧 `Part of` 行）；写前 `expectedUpdatedAt` 前置读、父票存在性回查，写后回读核对（读侧同一解析口径）；自挂回 conflict |
| setBlockedBy | 明确提供功能 | `graph/write.ts`：可见 `Blocked by:` 行与隐藏机器表成对整集替换（`model/description-markers.ts` 一处出处），数据源 `tea issues edit --description`；自阻塞回 conflict，写前从单页列表读邻接做环检（成环 conflict 不落盘，快照拉不到记读降级放行），写后回读深比对 |
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
- 2026-11-11（票 #13 落地）：2 条结构写改为明确提供功能（setParent / setBlockedBy），数据源是 `tea issues edit --description` 整篇正文替换（tea 没有父子与阻塞端点）：归属写隐藏标记 `<!-- DSH-PARENT: n -->`，阻塞按可见行与隐藏机器表成对写；写前 `expectedUpdatedAt` 前置读与环检、写后回读核对，与读侧票 #11 的解析同一口径；其余 6 条操作仍明确不支持。
- 2026-11-11（票 #12 落地）：7 条写操作改为明确提供功能（create / close / reopen / comment / update / setLabels / setAssignees），数据源是 tea 的写命令（`tea issues create` / `tea issues close` / `tea issues reopen` / `tea issues edit` / `tea comments add`，参数按本机 tea 0.16.0 的 help 逐条核对）；setLabels 因 tea 无整集替换参数改为「先读现标签算差集再 add/remove」；其余 8 条操作仍明确不支持。

## 交接

本表与 `src/tracker/rooms/gitea/support/capability-register.ts`（登记数据）由门禁 `tests/verify-capability-register.ts` 逐行比对；每补一条操作，先改登记数据、再改实现、最后回来改这张表。错误判档的规矩与 tea 专有条目见 `rooms/gitea/errors.ts` 文件头。

/**
 * src/tracker/rooms/gitea/model/normalize.ts — tea/Gitea 原始形状 → 契约形状（#2 起步骨架）。
 *
 * 定版依据：#2 票面「最小 room」——本文件今天只归一最小可用的那几格，写法逐格仿 GitLab 房的
 * `normalize.ts`，接手的人两份对照着补：
 *   - key 取 tea 回包的 `index`（Gitea 票号），缺了回退 `number` / `id`；永不产出 `number` 字段；
 *   - state 只归一成 open | closed（tea 用 open/closed 两态，与契约同构）；
 *   - labels 恒产出（能力字段 EMPTY 口径），每项 `{name, color}`，color 缺了写 `''`；
 *   - assignees / comments / blockedBy / reason 恒产出为空（起步房还没有对应读写操作，
 *     交 EMPTY 而不是 MISSING 是在说「这类能力位留着，操作没接」）；
 *   - milestone / customFields / author 一律省略（MISSING）：起步房拿不到这些形状，
 *     交不出「确实为空」的证据就不许交。
 *
 * Gitea 正文没有父子 / 阻塞标记约定（`parentKey` 恒 null 是起步的诚实口径）——
 * 真机上把父子、阻塞边的写侧口径定下来之后在这里补解析，别提前猜。
 */

import { STATE, ISSUE_TYPE } from '../../../contract/vocabulary.js'
import type { Actor, IssueType, State } from '../../../contract/identity.js'
import type { Issue, Label } from '../../../contract/entities.js'

// tea 回包是外部形状，先收成键值袋再逐格判是因为远端字段可缺可空，直接按定型读会把缺字段当成错。
type RawBag = Record<string, unknown>

function asBag(raw: unknown): RawBag | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return raw as RawBag
}

function normalizeLabel(rawLabel: unknown): Label | null {
  if (typeof rawLabel === 'string') {
    const name = rawLabel.trim()
    if (!name) return null
    return { name, color: '' }
  }
  const bag = asBag(rawLabel)
  if (!bag) return null
  const name = typeof bag['name'] === 'string' ? (bag['name'] as string).trim() : ''
  if (!name) return null
  const color = typeof bag['color'] === 'string' ? (bag['color'] as string) : ''
  return { name, color }
}

function normalizeLabels(raw: unknown): Label[] {
  const bag = asBag(raw)
  const nodes = bag && Array.isArray(bag['labels']) ? bag['labels'] : Array.isArray(raw) ? raw : []
  const out: Label[] = []
  for (const n of nodes as unknown[]) {
    const l = normalizeLabel(n)
    if (l) out.push(l)
  }
  return out
}

function normalizeActor(rawActor: unknown): Actor | null {
  const bag = asBag(rawActor)
  if (!bag) return null
  const loginRaw = typeof bag['login'] === 'string' && bag['login'] !== '' ? bag['login'] : typeof bag['username'] === 'string' ? bag['username'] : ''
  const login = loginRaw.trim()
  if (!login) return null
  const out: Actor = { login }
  if (typeof bag['full_name'] === 'string' && (bag['full_name'] as string).trim() !== '') out.name = (bag['full_name'] as string).trim()
  else if (typeof bag['name'] === 'string' && (bag['name'] as string).trim() !== '') out.name = (bag['name'] as string).trim()
  return out
}

function normalizeAssignees(raw: unknown): Actor[] {
  const bag = asBag(raw)
  const arr = bag && Array.isArray(bag['assignees']) ? bag['assignees'] : []
  const out: Actor[] = []
  for (const a of arr as unknown[]) {
    const actor = normalizeActor(a)
    if (actor) out.push(actor)
  }
  return out
}

function deriveKey(raw: unknown): string {
  if (raw == null) return '0'
  const bag = asBag(raw)
  if (!bag) return '0'
  if (typeof bag['key'] === 'string' && (bag['key'] as string) !== '') return bag['key'] as string
  // Gitea 的票号叫 index（tea CLI 用它；REST 兼容层也叫 index），缺了回退 number / id。
  if (bag['index'] != null) return String(bag['index'])
  if (bag['number'] != null) return String(bag['number'])
  if (bag['id'] != null) return String(bag['id'])
  return '0'
}

function bodyOf(raw: unknown): string {
  const bag = asBag(raw)
  if (!bag) return ''
  if (typeof bag['body'] === 'string') return bag['body'] as string
  if (typeof bag['description'] === 'string') return bag['description'] as string
  return ''
}

function deriveState(raw: unknown): State {
  const bag = asBag(raw)
  const s = bag && bag['state'] != null ? String(bag['state']).toLowerCase() : 'open'
  if (s === 'closed' || s === 'close') return STATE.CLOSED as State
  return STATE.OPEN as State
}

function deriveType(raw: unknown): IssueType {
  // 起步只按 labels 里的地图标签分流（与 GitLab 房同一判据顺序的简化版）：
  // 文件头标记的判据等父子写侧口径定了再补，提前写就等于猜。
  if (normalizeLabels(raw).some((l) => l.name === 'wayfinder:map')) return ISSUE_TYPE.MAP as IssueType
  return ISSUE_TYPE.ISSUE as IssueType
}

/**
 * tea/Gitea 原始票面归一成契约 Issue：单 key 取 index、状态压成两态、缺的能力字段按 EMPTY/MISSING 分流。
 *
 * @param raw tea 回包的 issue 原始对象
 */
export function normalizeIssue(raw: unknown): Issue {
  const key = deriveKey(raw)
  const type = deriveType(raw)
  const state = deriveState(raw)
  const labels = normalizeLabels(raw)
  const assignees = normalizeAssignees(raw)
  const bag = asBag(raw)

  const title = bag && typeof bag['title'] === 'string' ? (bag['title'] as string) : ''
  const body = bodyOf(raw)
  const url = bag && typeof bag['html_url'] === 'string' ? (bag['html_url'] as string) : ''
  const createdAt =
    bag && typeof bag['created_at'] === 'string'
      ? (bag['created_at'] as string)
      : bag && typeof bag['createdAt'] === 'string'
        ? (bag['createdAt'] as string)
        : ''
  const updatedAt =
    bag && typeof bag['updated_at'] === 'string'
      ? (bag['updated_at'] as string)
      : bag && typeof bag['updatedAt'] === 'string'
        ? (bag['updatedAt'] as string)
        : ''
  const closedAtRaw = bag ? (bag['closed_at'] != null ? bag['closed_at'] : bag['closedAt']) : undefined
  const closedAt = typeof closedAtRaw === 'string' ? closedAtRaw : null

  const issue: Issue = {
    key,
    // effortId：Gitea 一个仓库只有一个隐含 effort，核心字段填 ''（EMPTY，不是 MISSING）
    effortId: '',
    type,
    title,
    state,
    body,
    url,
    createdAt,
    updatedAt,
    closedAt,
    // 起步口径：Gitea 房还没有父子标记约定，恒 null（明确没有，不是未知——核心字段不许省略）。
    parentKey: null,
    labels,
    assignees,
    // 起步房还没有评论与阻塞边的读写操作：交 EMPTY（字段在、值是空）留住能力位。
    comments: [],
    blockedBy: [],
    reason: bag && typeof bag['reason'] === 'string' ? (bag['reason'] as string) : '',
  }

  // milestone / customFields / author 恒省略（MISSING）：起步房拿不到这些形状，
  // 交不出「确实为空」的证据就不许交（EMPTY 与 MISSING 不可混用）。
  return issue
}

export default normalizeIssue

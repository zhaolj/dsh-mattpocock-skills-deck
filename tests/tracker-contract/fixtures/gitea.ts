/**
 * tests/tracker-contract/fixtures/gitea.ts — Gitea 最小适配器夹具（G4，#2 起步）。
 *
 * 仿 gitlab.ts 的形状：normalize 直接连 rooms/gitea 的 `normalizeIssue`，
 * 跑既有 contract runner（tests/verify-tracker-contract.ts）。起步房的能力口径：
 * labels / assignees / comments / blockedBy / reason 恒 EMPTY（字段在、值是空），
 * milestone / customFields / author 恒 MISSING（省略）。import 写 .js 后缀
 * （真实文件是 normalize.ts，全靠钩子改指），与 gitlab.ts 同一写法。
 */

import { normalizeIssue } from '../../../src/tracker/rooms/gitea/model/normalize.js'

interface GiteaSource {
  index?: number
  title?: string
  state?: string
  body?: string
  html_url?: string
  created_at?: string
  updated_at?: string
  closed_at?: string | null
  labels?: Array<{ name: string, color?: string }>
  assignees?: Array<{ login?: string, username?: string, full_name?: string }>
  [key: string]: unknown
}

function baseWith(labels: Array<{ name: string, color?: string }> | null, extra: Record<string, unknown> = {}): GiteaSource {
  return {
    index: 3,
    title: 'hello',
    state: 'open',
    body: 'hello body',
    html_url: 'http://gitea.example/group/proj/issues/3',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    closed_at: null,
    labels: labels || [{ name: 'bug', color: 'red' }],
    assignees: [],
    ...extra,
  }
}

export const giteaMinimalFixture = {
  name: 'gitea-minimal',
  normalize: normalizeIssue,
  withData: baseWith([{ name: 'bug', color: 'red' }]),
  emptyData: {
    index: 1,
    title: 'empty',
    state: 'open',
    body: '',
    html_url: '',
    created_at: '',
    updated_at: '',
    closed_at: null,
    labels: [],
    assignees: [],
  } as GiteaSource,
  mappings: [
    { from: 'title', to: 'title' },
  ],
  implementedFields: ['labels', 'assignees', 'comments', 'blockedBy', 'reason'],
  missingFields: ['milestone', 'customFields', 'author'],
  deckCases: [],
}

export default giteaMinimalFixture

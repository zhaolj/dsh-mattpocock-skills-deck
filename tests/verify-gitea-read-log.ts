// verify-gitea-read-log.ts —— 双轴评审收编门禁：Gitea 房的 read.degraded 出口收进登记清单。
// 用法：node --import ./scripts/ts-hook.mts tests/verify-gitea-read-log.ts（verify:parallel 的
// behavior 段按 verify-stages.json 的目录约定自动跑这一扇）。
// 断言三件事：
//   1. src/tracker/rooms/gitea/support/read-log.ts 里两张登记表非空、冻结、值形状是「操作名」与「操作名:这一步」；
//   2. Gitea 房源码里 emitReadDegraded 的每个调用点都从登记表取值：字面量 op ∈ READ_DEGRADED_OPS、
//      字面量 reason ∈ READ_DEGRADED_REASONS，出现自由串即红；
//   3. 房里不再有别的 read.degraded 手写出口（backend:'gitea' 的字段对象只允许出现在 read-log.ts 一处）。
import { READ_DEGRADED_OPS, READ_DEGRADED_REASONS } from '../src/tracker/rooms/gitea/support/read-log.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { fileURLToPath } from 'node:url'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GITEA = path.join(ROOT, 'src', 'tracker', 'rooms', 'gitea')
let failed = false
let total = 0
const check = (ok, msg) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

console.log('Gitea 房 read.degraded 登记清单门禁（双轴评审收编：op/reason 只许取登记值）')

// 1. 登记表本身
check(Object.isFrozen(READ_DEGRADED_OPS), 'READ_DEGRADED_OPS 冻结（Object.freeze），防止运行时被塞进自由值')
check(Object.isFrozen(READ_DEGRADED_REASONS), 'READ_DEGRADED_REASONS 冻结（Object.freeze），防止运行时被塞进自由值')
check(READ_DEGRADED_OPS.length > 0, 'READ_DEGRADED_OPS 非空：' + READ_DEGRADED_OPS.join(' / '))
check(READ_DEGRADED_REASONS.length > 0, 'READ_DEGRADED_REASONS 非空：' + READ_DEGRADED_REASONS.join(' / '))
check(READ_DEGRADED_REASONS.every((r) => /^[a-zA-Z]+(:[a-zA-Z-]+)?$/.test(r)), 'READ_DEGRADED_REASONS 每条都是「操作名:这一步」形状')

// 2. 调用点取值全部在表内
function walk(dir) {
  const out = []
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) out.push(...walk(p))
    else if (name.endsWith('.ts')) out.push(p)
  }
  return out
}
const files = walk(GITEA).filter((p) => path.basename(p) !== 'read-log.ts')
let calls = 0
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  const rel = path.relative(ROOT, file)
  const re = /emitReadDegraded\s*\(([^)]*)\)/g
  let m
  while ((m = re.exec(text)) !== null) {
    calls += 1
    const args = m[1]
    // 取前两个实参（effective 之后是 op、reason）：按顶层逗号切分。
    const parts = []
    let depth = 0
    let cur = ''
    for (const ch of args) {
      if (ch === '(' || ch === '[' || ch === '{') depth += 1
      if (ch === ')' || ch === ']' || ch === '}') depth -= 1
      if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = '' } else cur += ch
    }
    parts.push(cur.trim())
    const op = parts[1]
    const reason = parts[2]
    const opLit = /^'([^']+)'$/.exec(op || '')
    const reasonLit = /^'([^']+)'$/.exec(reason || '')
    if (opLit) check(READ_DEGRADED_OPS.includes(opLit[1]), rel + ' 的 op 字面量 ' + opLit[1] + ' 在登记表内')
    if (reasonLit) check(READ_DEGRADED_REASONS.includes(reasonLit[1]), rel + ' 的 reason 字面量 ' + reasonLit[1] + ' 在登记表内')
    // 非字面量时只认登记常量本体：READ_DEGRADED_* 两表，或本身就是表内取值的 LIST_TRUNCATED_REASON。
    const isRegisteredIdent = (x) => /^(READ_DEGRADED_OPS|READ_DEGRADED_REASONS|LIST_TRUNCATED_REASON)/.test(x || '')
    if (!opLit) check(isRegisteredIdent(op), rel + ' 的 op 取自登记常量（' + op + '）')
    if (!reasonLit) check(isRegisteredIdent(reason), rel + ' 的 reason 取自登记常量（' + reason + '）')
  }
}
check(calls >= 3, 'Gitea 房共找到 ' + calls + ' 个 emitReadDegraded 调用点（至少 3 个：list 截断 / listSubIssues 截断 / setBlockedBy 环检放行）')

// 3. 手写出口只许一处：backend:'gitea' 只出现在 read-log.ts
const offenders = files.filter((f) => fs.readFileSync(f, 'utf8').includes("backend: 'gitea'"))
check(offenders.length === 0, "backend:'gitea' 的手写字段对象只在 support/read-log.ts 一处" + (offenders.length ? '（越界：' + offenders.map((f) => path.relative(ROOT, f)).join(', ') + '）' : ''))

if (failed) { console.log('FAIL：' + total + ' 项里有失败项'); process.exit(1) }
console.log('PASS：' + total + ' 项全过')

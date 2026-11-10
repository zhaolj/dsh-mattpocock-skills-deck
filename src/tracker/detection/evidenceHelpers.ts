// src/tracker/detection/evidenceHelpers.ts —— 证据的小工具（从 backendDecision.ts 拆出，票 #6 收口）
//
// 为什么单开这一层：backendDecision.ts 在零增长基线上（verify-file-granularity，只许减不许增，
// 超 500 有效行阻断发布），票 #5 加档位后越过基线。这里搬走的是与「判定主流程」无关的三样：
// 三层优先级常量、证据的四个构造函数（kind 与 outcome 只在这里配对，别处不许手写）、
// 覆盖度的计算与日志文本。类型仍以 backendDecision 为唯一声明处，这里只按类型导入
// （编译后擦除，两个文件之间没有运行时的循环依赖）。
import type { EvidenceKind, EvidenceOutcomeWord, EvidenceScope, EvidenceTier, DecisionCoverage, TierEvidence } from './backendDecision.js';

/**
 * 三层证据的优先级，**唯一的声明处**：人选 > 声明文件 > 各房认领。
 * 它是一条全序，判断因此可以「取第一条结论」而不必两两比较，也无所谓谁先谁后地问。
 */
export const EVIDENCE_PRIORITY: readonly EvidenceTier[] = ['workspace-file', 'declaration', 'autodetect'];

/** 这一层给出了可用结论：kind=verdict，日志用词 hit。 */
export function verdictEvidence(tier: EvidenceTier, backendId: string, reason: string, extra: Partial<TierEvidence> = {}): TierEvidence {
  return Object.assign({ tier: tier, kind: 'verdict' as EvidenceKind, outcome: 'hit' as EvidenceOutcomeWord, reason: String(reason), backendId: String(backendId || '') }, extra);
}

/** 看过了，这一层没有可用的记录：kind=abstain，日志用词 miss。 */
export function abstainEvidence(tier: EvidenceTier, reason: string): TierEvidence {
  return { tier: tier, kind: 'abstain', outcome: 'miss', reason: String(reason), backendId: '' };
}

/** 没看成 / 问不成 / 认了个没装的后端：这一层拿不到结论。 */
export function unavailableEvidence(tier: EvidenceTier, outcome: EvidenceOutcomeWord, reason: string, backendId = ''): TierEvidence {
  return { tier: tier, kind: 'unavailable', outcome: outcome, reason: String(reason), backendId: String(backendId || '') };
}

/** 有意没看这一层：why 是原因（写进覆盖度），reason 是步骤行里的原因用词。 */
export function skippedEvidence(tier: EvidenceTier, reason: string): TierEvidence {
  return { tier: tier, kind: 'skipped', outcome: 'skipped', reason: String(reason), backendId: '' };
}

/** 覆盖度：哪些层真看了、哪些层有意没看、为什么。 */
export function coverageOf(evidence: readonly TierEvidence[], scope: EvidenceScope): DecisionCoverage {
  const checked: EvidenceTier[] = [];
  const skipped: { tier: EvidenceTier; why: string }[] = [];
  const rows = evidence || [];
  for (const tier of EVIDENCE_PRIORITY) {
    const row = rows.find((e) => e.tier === tier);
    if (!row) continue;
    if (row.kind === 'skipped') skipped.push({ tier: tier, why: row.reason });
    else checked.push(tier);
  }
  return { scope: scope, checked: checked, skipped: skipped };
}

/**
 * 覆盖度的日志用文本（一个字段、逗号分号分隔，方便 grep）：
 * `checked=workspace-file,declaration;skipped=autodetect:skipped-stronger-evidence`。
 * 没有跳过的层就省略后半段。
 */
export function formatCoverage(c: DecisionCoverage | null | undefined): string {
  if (!c) return '';
  const head = 'checked=' + c.checked.join(',');
  if (!c.skipped.length) return head;
  return head + ';skipped=' + c.skipped.map((s) => s.tier + ':' + s.why).join(',');
}

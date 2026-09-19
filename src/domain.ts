// ============================================================
// License Lens · 发行前依赖门禁 —— 领域逻辑（纯函数，无 UI 依赖）
// ============================================================

export type Channel = 'internal' | 'saas' | 'closed' | 'oss';
export type Usage = 'runtime' | 'dev' | 'build';
/** 基础裁决（规则引擎原始结论） */
export type BaseVerdict = 'pass' | 'review' | 'blocked';
/** 生效裁决：在商业授权 / 人工豁免覆盖之后的结论 */
export type Verdict = BaseVerdict | 'licensed' | 'exempted';

export const CHANNELS: { id: Channel; label: string; short: string }[] = [
  { id: 'internal', label: '内部使用', short: '内部' },
  { id: 'saas', label: 'SaaS 服务', short: 'SaaS' },
  { id: 'closed', label: '闭源分发', short: '闭源' },
  { id: 'oss', label: '开源发布', short: '开源' },
];

export const USAGE_LABEL: Record<Usage, string> = {
  runtime: '运行时',
  dev: '开发依赖',
  build: '构建工具',
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  pass: '放行',
  review: '待复核',
  blocked: '阻断',
  licensed: '授权放行',
  exempted: '豁免放行',
};

export interface DepItem {
  id: string;
  name: string;
  version: string;
  license: string;
  usage: Usage;
}

export interface Batch {
  id: string;
  seq: number;
  importedAt: string; // 展示用时间串
  status: 'pending' | 'approved';
  items: DepItem[];
  reviewedBy?: string;
  reviewedAt?: string;
}

export interface CommercialLicense {
  id: string;
  packageName: string;
  vendor: string;
  channels: Channel[];
  validUntil: string; // YYYY-MM-DD
  note?: string;
}

export interface Exemption {
  id: string;
  packageName: string;
  scope: Channel[]; // 适用渠道
  approver: string; // 审批人
  expiresOn: string; // 失效日 YYYY-MM-DD
  reason: string;
  createdAt: string;
}

export interface ChannelEval {
  channel: Channel;
  base: BaseVerdict;
  verdict: Verdict;
  reason: string;
  licenseId?: string;
  exemptionId?: string;
  expiredLicense?: CommercialLicense;
  expiredExemption?: Exemption;
}

export interface DepEval {
  dep: DepItem;
  channels: ChannelEval[];
  overall: BaseVerdict; // 聚合后的门禁结论（授权/豁免视为放行）
  licensed: number;
  exempted: number;
}

// ------------------------------------------------------------
// 工具
// ------------------------------------------------------------

export function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function nowStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function isExpired(date: string, today = todayStr()): boolean {
  return date < today;
}

const normName = (s: string) => s.trim().toLowerCase();
export const samePackage = (a: string, b: string) => normName(a) === normName(b);

// ------------------------------------------------------------
// 许可证规则库
// ------------------------------------------------------------

const PERMISSIVE = new Set([
  'MIT', 'MIT-0', 'APACHE-2.0', 'BSD-2-CLAUSE', 'BSD-3-CLAUSE', 'ISC',
  'ZLIB', '0BSD', 'UNLICENSE', 'CC0-1.0', 'PYTHON-2.0', 'POSTGRESQL',
  'WTFPL', 'BSL-1.0', 'X11',
]);
const WEAK_COPYLEFT = new Set([
  'LGPL-2.1', 'LGPL-3.0', 'MPL-2.0', 'EPL-1.0', 'EPL-2.0', 'CDDL-1.0', 'EUPL-1.2',
]);
const STRONG_COPYLEFT = new Set(['GPL-2.0', 'GPL-3.0']);
const NETWORK_COPYLEFT = new Set(['AGPL-1.0', 'AGPL-3.0', 'SSPL-1.0', 'OSL-3.0']);
const PROPRIETARY = new Set(['PROPRIETARY', 'COMMERCIAL', 'UNLICENSED', 'CONFIDENTIAL']);
const NON_SOFTWARE = new Set(['CC-BY-4.0', 'CC-BY-3.0', 'CC-BY-SA-4.0', 'OFL-1.1', 'CC-BY-NC-4.0']);

const ALIASES: Record<string, string> = {
  'GPL2': 'GPL-2.0', 'GPL3': 'GPL-3.0', 'GPLV2': 'GPL-2.0', 'GPLV3': 'GPL-3.0',
  'LGPL2.1': 'LGPL-2.1', 'LGPL3': 'LGPL-3.0', 'AGPL3': 'AGPL-3.0',
  'APACHE': 'APACHE-2.0', 'APACHE2': 'APACHE-2.0', 'BSD': 'BSD-3-CLAUSE',
  'MPL2': 'MPL-2.0', 'CC-BY': 'CC-BY-4.0',
};

export function normalizeLicense(raw: string): string {
  let s = raw.trim().replace(/^\(|\)$/g, '').replace(/\s+/g, ' ');
  if (/ OR /i.test(s)) {
    return s.split(/\s+OR\s+/i).map(normalizeLicense).join(' OR ');
  }
  if (/ AND /i.test(s)) {
    return s.split(/\s+AND\s+/i).map(normalizeLicense).join(' AND ');
  }
  s = s.toUpperCase().replace(/-(ONLY|OR-LATER)$/, '').replace(/\+$/, '');
  return ALIASES[s] ?? s;
}

/** 单个许可证标识在单个渠道下的基础裁决 */
function baseRule(lic: string, channel: Channel): { v: BaseVerdict; reason: string } {
  if (PERMISSIVE.has(lic)) {
    return { v: 'pass', reason: `${lic} 为宽松许可证，保留版权声明即可在${channelName(channel)}使用` };
  }
  if (WEAK_COPYLEFT.has(lic)) {
    if (channel === 'closed') {
      return { v: 'review', reason: `${lic} 为弱 Copyleft，闭源分发需确认链接/隔离方式满足条款` };
    }
    return { v: 'pass', reason: `${lic} 弱 Copyleft 条款在${channelName(channel)}场景可满足` };
  }
  if (STRONG_COPYLEFT.has(lic)) {
    if (channel === 'closed') {
      return { v: 'blocked', reason: `${lic} 要求衍生作品整体以相同条款开源，与闭源分发冲突` };
    }
    if (channel === 'oss') {
      return { v: 'review', reason: `${lic} 组件随开源发布时需确认项目发布许可证与其兼容` };
    }
    return { v: 'pass', reason: `${lic} 的 Copyleft 义务不在${channelName(channel)}场景触发` };
  }
  if (NETWORK_COPYLEFT.has(lic)) {
    if (channel === 'saas') {
      return { v: 'blocked', reason: `${lic} 网络交互即触发开源义务，SaaS 服务不得直接使用` };
    }
    if (channel === 'closed') {
      return { v: 'blocked', reason: `${lic} 要求衍生作品开源，与闭源分发冲突` };
    }
    if (channel === 'oss') {
      return { v: 'review', reason: `${lic} 组件随开源发布时需确认项目发布许可证与其兼容` };
    }
    return { v: 'pass', reason: `${lic} 的网络 Copyleft 义务不在内部使用场景触发` };
  }
  if (PROPRIETARY.has(lic)) {
    if (channel === 'internal') {
      return { v: 'pass', reason: '专有组件，内部使用通常被许可协议覆盖' };
    }
    return { v: 'review', reason: '专有许可证，对外提供需确认商业授权范围' };
  }
  if (NON_SOFTWARE.has(lic)) {
    if (channel === 'internal') {
      return { v: 'pass', reason: `${lic} 为内容/字体类许可证，内部使用风险低` };
    }
    return { v: 'review', reason: `${lic} 非软件许可证，需确认署名方式与适用条款` };
  }
  return { v: 'review', reason: `未识别的许可证「${lic}」，需人工确认条款` };
}

function channelName(c: Channel): string {
  return CHANNELS.find(x => x.id === c)!.label;
}

const rank = (v: BaseVerdict) => (v === 'blocked' ? 2 : v === 'review' ? 1 : 0);

/** 组合许可证表达式：OR 取最优，AND 取最严 */
function baseForExpression(lic: string, channel: Channel): { v: BaseVerdict; reason: string } {
  if (lic.includes(' OR ')) {
    const parts = lic.split(' OR ').map(p => baseForExpression(p, channel));
    return parts.sort((a, b) => rank(a.v) - rank(b.v))[0];
  }
  if (lic.includes(' AND ')) {
    const parts = lic.split(' AND ').map(p => baseForExpression(p, channel));
    return parts.sort((a, b) => rank(b.v) - rank(a.v))[0];
  }
  return baseRule(lic, channel);
}

// ------------------------------------------------------------
// 门禁评估：基础规则 → 商业授权 → 人工豁免
// ------------------------------------------------------------

export function evaluateDep(
  dep: DepItem,
  licenses: CommercialLicense[],
  exemptions: Exemption[],
  today = todayStr(),
): DepEval {
  const lic = normalizeLicense(dep.license);
  const channels: ChannelEval[] = CHANNELS.map(({ id: channel }) => {
    // 用途裁决：开发/构建用途不随制品分发，全渠道放行
    if (dep.usage !== 'runtime') {
      return {
        channel, base: 'pass' as BaseVerdict, verdict: 'pass' as Verdict,
        reason: `${USAGE_LABEL[dep.usage]}不随制品分发，不构成分发义务`,
      };
    }
    const base = baseForExpression(lic, channel);
    if (base.v === 'pass') {
      return { channel, base: base.v, verdict: base.v, reason: base.reason };
    }
    // 商业授权：须覆盖该渠道且在有效期内
    const licHit = licenses.find(l => samePackage(l.packageName, dep.name) && l.channels.includes(channel));
    if (licHit && !isExpired(licHit.validUntil, today)) {
      return {
        channel, base: base.v, verdict: 'licensed' as Verdict, licenseId: licHit.id,
        reason: `凭商业授权放行（${licHit.vendor}，覆盖${channelName(channel)}，有效期至 ${licHit.validUntil}）`,
      };
    }
    // 人工豁免：须在适用范围内、有审批人且未失效
    const exHit = exemptions.find(
      e => samePackage(e.packageName, dep.name) && e.scope.includes(channel) && e.approver.trim(),
    );
    if (exHit && !isExpired(exHit.expiresOn, today)) {
      return {
        channel, base: base.v, verdict: 'exempted' as Verdict, exemptionId: exHit.id,
        reason: `人工豁免放行（审批人 ${exHit.approver}，失效日 ${exHit.expiresOn}）`,
      };
    }
    // 无有效覆盖：维持基础结论；授权/豁免一旦过期立即恢复
    let reason = base.reason;
    const expiredLicense = licHit && isExpired(licHit.validUntil, today) ? licHit : undefined;
    const expiredExemption = exHit && isExpired(exHit.expiresOn, today) ? exHit : undefined;
    if (expiredLicense) {
      reason += `；商业授权已于 ${expiredLicense.validUntil} 过期，已恢复${base.v === 'blocked' ? '阻断' : '复核'}`;
    }
    if (expiredExemption) {
      reason += `；豁免已于 ${expiredExemption.expiresOn} 失效`;
    }
    return { channel, base: base.v, verdict: base.v, reason, expiredLicense, expiredExemption };
  });
  const effective: BaseVerdict[] = channels.map(c =>
    c.verdict === 'licensed' || c.verdict === 'exempted' ? 'pass' : c.verdict,
  );
  const overall: BaseVerdict = effective.includes('blocked')
    ? 'blocked'
    : effective.includes('review')
      ? 'review'
      : 'pass';
  return {
    dep, channels, overall,
    licensed: channels.filter(c => c.verdict === 'licensed').length,
    exempted: channels.filter(c => c.verdict === 'exempted').length,
  };
}

// ------------------------------------------------------------
// 清单解析
// ------------------------------------------------------------

const USAGE_ALIASES: Record<string, Usage> = {
  runtime: 'runtime', '运行时': 'runtime', prod: 'runtime',
  dev: 'dev', '开发': 'dev', '开发依赖': 'dev', development: 'dev',
  build: 'build', '构建': 'build', '构建工具': 'build',
};

let seq = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
export const newId = uid;

/** 解析依赖清单：支持 `名称@版本 许可证 [用途]` 逐行格式与 package.json */
export function parseManifest(text: string): DepItem[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('{')) {
    const pkg = JSON.parse(trimmed) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const items: DepItem[] = [];
    const push = (deps: Record<string, string> | undefined, usage: Usage) => {
      for (const [name, range] of Object.entries(deps ?? {})) {
        items.push({
          id: uid('d'), name,
          version: String(range).replace(/^[\^~>=\s]+/, '') || '—',
          license: 'Unknown', usage,
        });
      }
    };
    push(pkg.dependencies, 'runtime');
    push(pkg.devDependencies, 'dev');
    return items;
  }
  return trimmed
    .split(/\n|,/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(line => {
      const m = line.match(/^(\S+?)@([\w.\-]+)\s+(.+)$/);
      let name = line, version = '—', rest = 'Unknown';
      if (m) {
        name = m[1];
        version = m[2];
        rest = m[3].trim();
      }
      // 行尾可带用途关键字
      let usage: Usage = 'runtime';
      const tail = rest.split(/\s+/);
      const last = tail[tail.length - 1].toLowerCase();
      if (tail.length > 1 && USAGE_ALIASES[last]) {
        usage = USAGE_ALIASES[last];
        tail.pop();
      }
      return { id: uid('d'), name, version, license: tail.join(' ') || 'Unknown', usage };
    });
}

// ------------------------------------------------------------
// 批次 diff：新增 / 移除 / 结论变化
// ------------------------------------------------------------

export interface DiffEntry {
  name: string;
  from?: DepEval;
  to?: DepEval;
  note?: string;
}

export interface BatchDiff {
  added: DiffEntry[];
  removed: DiffEntry[];
  changed: DiffEntry[];
}

export function diffBatches(
  prev: Batch | null,
  next: Batch,
  licenses: CommercialLicense[],
  exemptions: Exemption[],
  today = todayStr(),
): BatchDiff {
  const ev = (d: DepItem) => evaluateDep(d, licenses, exemptions, today);
  const prevMap = new Map((prev?.items ?? []).map(d => [normName(d.name), d]));
  const nextMap = new Map(next.items.map(d => [normName(d.name), d]));
  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];
  const changed: DiffEntry[] = [];
  for (const [key, dep] of nextMap) {
    const old = prevMap.get(key);
    if (!old) {
      added.push({ name: dep.name, to: ev(dep) });
      continue;
    }
    const from = ev(old);
    const to = ev(dep);
    const meta: string[] = [];
    if (old.version !== dep.version) meta.push(`版本 ${old.version} → ${dep.version}`);
    if (normalizeLicense(old.license) !== normalizeLicense(dep.license)) {
      meta.push(`许可证 ${old.license} → ${dep.license}`);
    }
    if (old.usage !== dep.usage) meta.push(`用途 ${USAGE_LABEL[old.usage]} → ${USAGE_LABEL[dep.usage]}`);
    if (from.overall !== to.overall || meta.length > 0) {
      changed.push({ name: dep.name, from, to, note: meta.join('；') });
    }
  }
  for (const [key, dep] of prevMap) {
    if (!nextMap.has(key)) removed.push({ name: dep.name, from: ev(dep) });
  }
  return { added, removed, changed };
}

// ------------------------------------------------------------
// 汇总与导出
// ------------------------------------------------------------

export function summarize(evals: DepEval[]) {
  return {
    total: evals.length,
    pass: evals.filter(e => e.overall === 'pass').length,
    review: evals.filter(e => e.overall === 'review').length,
    blocked: evals.filter(e => e.overall === 'blocked').length,
    licensed: evals.reduce((n, e) => n + e.licensed, 0),
    exempted: evals.reduce((n, e) => n + e.exempted, 0),
  };
}

export function exportMarkdown(
  batch: Batch,
  prev: Batch | null,
  licenses: CommercialLicense[],
  exemptions: Exemption[],
  today = todayStr(),
): string {
  const evals = batch.items.map(d => evaluateDep(d, licenses, exemptions, today));
  const sum = summarize(evals);
  const diff = diffBatches(prev, batch, licenses, exemptions, today);
  const cell = (e: DepEval, c: Channel) => {
    const r = e.channels.find(x => x.channel === c)!;
    return VERDICT_LABEL[r.verdict];
  };
  const lines: string[] = [
    '# 发行前依赖门禁报告',
    '',
    `- 批次：#${batch.seq}（${batch.status === 'approved' ? '已审核' : '待审核'}）`,
    `- 导入时间：${batch.importedAt}`,
    `- 审核：${batch.reviewedBy ?? '—'} ${batch.reviewedAt ?? ''}`,
    `- 报告生成日：${today}`,
    `- 统计：共 ${sum.total} 项 · 放行 ${sum.pass} · 待复核 ${sum.review} · 阻断 ${sum.blocked} · 授权放行 ${sum.licensed} 渠道次 · 豁免放行 ${sum.exempted} 渠道次`,
    '',
    '## 依赖门禁明细',
    '',
    `| 依赖 | 版本 | 用途 | 许可证 | ${CHANNELS.map(c => c.short).join(' | ')} | 总结论 |`,
    `|---|---|---|---|${'---|'.repeat(CHANNELS.length)}---|`,
    ...evals.map(e =>
      `| ${e.dep.name} | ${e.dep.version} | ${USAGE_LABEL[e.dep.usage]} | ${e.dep.license} | ${CHANNELS.map(c => cell(e, c.id)).join(' | ')} | ${VERDICT_LABEL[e.overall]} |`,
    ),
    '',
    '## 裁决依据',
    '',
    ...evals.flatMap(e =>
      e.channels
        .filter(c => c.verdict !== 'pass')
        .map(c => `- **${e.dep.name}** · ${channelName(c.channel)}：${VERDICT_LABEL[c.verdict]} — ${c.reason}`),
    ),
    '',
    '## 商业授权',
    '',
    '| 依赖 | 供应商 | 覆盖渠道 | 有效期至 | 状态 |',
    '|---|---|---|---|---|',
    ...licenses.map(l =>
      `| ${l.packageName} | ${l.vendor} | ${l.channels.map(channelName).join('、')} | ${l.validUntil} | ${isExpired(l.validUntil, today) ? '已过期（已恢复阻断）' : '有效'} |`,
    ),
    '',
    '## 人工豁免',
    '',
    '| 依赖 | 适用范围 | 审批人 | 失效日 | 状态 | 事由 |',
    '|---|---|---|---|---|---|',
    ...exemptions.map(x =>
      `| ${x.packageName} | ${x.scope.map(channelName).join('、')} | ${x.approver} | ${x.expiresOn} | ${isExpired(x.expiresOn, today) ? '已失效' : '有效'} | ${x.reason} |`,
    ),
    '',
    `## 与上一批次差异（对比批次 ${prev ? `#${prev.seq}` : '无'}）`,
    '',
    `- 新增（${diff.added.length}）：${diff.added.map(d => d.name).join('、') || '无'}`,
    `- 移除（${diff.removed.length}）：${diff.removed.map(d => d.name).join('、') || '无'}`,
    `- 结论变化（${diff.changed.length}）：${diff.changed.map(d => `${d.name}${d.from && d.to ? `（${VERDICT_LABEL[d.from.overall]} → ${VERDICT_LABEL[d.to.overall]}）` : ''}`).join('、') || '无'}`,
    '',
  ];
  return lines.join('\n');
}

// ------------------------------------------------------------
// 种子数据
// ------------------------------------------------------------

export const IMPORT_EXAMPLE = `react@19.1.0 MIT runtime
lodash@4.17.21 MIT runtime
axios@1.7.2 MIT runtime
zod@3.23.8 MIT runtime
legacy-gpl@2.4.0 GPL-3.0 runtime
agpl-pdf@1.2.0 AGPL-3.0 runtime
some-proprietary@1.0.0 Apache-2.0 runtime
font-awesome@6.5.2 CC-BY-4.0 runtime
eslint@9.9.0 MIT dev
unknown-lib@0.9.1 Unknown runtime
ui-kit-internal@3.0.0 GPL-3.0 runtime
new-analytics@2.0.0 BSD-3-Clause runtime
video-core@5.1.0 LGPL-3.0 runtime`;

export function seedState(): { batches: Batch[]; licenses: CommercialLicense[]; exemptions: Exemption[] } {
  const mk = (name: string, version: string, license: string, usage: Usage): DepItem => ({
    id: uid('d'), name, version, license, usage,
  });
  const batch1: Batch = {
    id: uid('b'),
    seq: 1,
    importedAt: '2026-09-10 14:32',
    status: 'approved',
    reviewedBy: '李雷（发布经理）',
    reviewedAt: '2026-09-11 09:15',
    items: [
      mk('react', '18.3.1', 'MIT', 'runtime'),
      mk('lodash', '4.17.21', 'MIT', 'runtime'),
      mk('axios', '1.7.2', 'MIT', 'runtime'),
      mk('sharp', '0.33.4', 'Apache-2.0', 'runtime'),
      mk('zod', '3.23.8', 'MIT', 'runtime'),
      mk('legacy-gpl', '2.4.0', 'GPL-3.0', 'runtime'),
      mk('agpl-pdf', '1.2.0', 'AGPL-3.0', 'runtime'),
      mk('some-proprietary', '1.0.0', 'Proprietary', 'runtime'),
      mk('font-awesome', '6.5.2', 'CC-BY-4.0', 'runtime'),
      mk('eslint', '9.9.0', 'MIT', 'dev'),
      mk('unknown-lib', '0.9.1', 'Unknown', 'runtime'),
      mk('ui-kit-internal', '3.0.0', 'GPL-3.0', 'runtime'),
    ],
  };
  const licenses: CommercialLicense[] = [
    {
      id: uid('l'), packageName: 'agpl-pdf', vendor: 'PdfWorks Inc.',
      channels: ['saas', 'closed'], validUntil: '2027-03-31',
      note: 'OEM 协议 OW-2026-118，覆盖 SaaS 提供与闭源分发',
    },
    {
      id: uid('l'), packageName: 'legacy-gpl', vendor: 'LegacySoft',
      channels: ['closed'], validUntil: '2026-08-31',
      note: '旧版商业授权，到期未续',
    },
  ];
  const exemptions: Exemption[] = [
    {
      id: uid('e'), packageName: 'ui-kit-internal', scope: ['closed'],
      approver: '王敏（法务）', expiresOn: '2026-12-31',
      reason: '仅用于内部管理后台的过渡版本，Q4 完成替换后移除',
      createdAt: '2026-09-02 10:05',
    },
    {
      id: uid('e'), packageName: 'unknown-lib', scope: ['closed', 'saas'],
      approver: '李雷（发布经理）', expiresOn: '2026-06-30',
      reason: '上个发行周期的临时豁免，已失效',
      createdAt: '2026-05-18 16:40',
    },
  ];
  return { batches: [batch1], licenses, exemptions };
}

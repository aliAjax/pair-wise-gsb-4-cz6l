// 发行前依赖门禁台 · 领域层
// 裁决规则：按「分发渠道 × 用途」对每个依赖分别给出结论；
// 结论一律在渲染时由规则 + 授权 + 豁免实时推导（不落库），
// 因此授权/豁免一到期，刷新或重渲染后立即恢复阻断。

export type Channel = 'internal' | 'saas' | 'proprietary' | 'opensource';
export type Usage = 'runtime' | 'dev';
export type Level = 'pass' | 'released' | 'warn' | 'blocked';

export interface DepItem {
  name: string;
  version: string;
  license: string;
  usage: Usage;
}

export interface BatchDiff {
  added: string[];
  removed: string[];
  changed: { name: string; detail: string }[];
}

export interface Batch {
  id: string;
  label: string;
  importedAt: string;
  status: 'pending' | 'reviewed';
  reviewer?: string;
  reviewedAt?: string;
  items: DepItem[];
  diff: BatchDiff;
}

export interface CommercialLicense {
  id: string;
  pkg: string;
  vendor: string;
  channels: Channel[];
  expiresAt: string; // YYYY-MM-DD
  note?: string;
  createdAt: string;
}

export interface Exemption {
  id: string;
  pkg: string;
  approver: string;
  channels: Channel[];
  expiresAt: string; // YYYY-MM-DD
  reason: string;
  createdAt: string;
}

export interface GateState {
  batches: Batch[];
  licenses: CommercialLicense[];
  exemptions: Exemption[];
}

export interface Verdict {
  level: Level;
  basis: string;
  via?: '商业授权' | '人工豁免';
}

export const CHANNELS: { id: Channel; label: string; short: string }[] = [
  { id: 'internal', label: '内部使用', short: '内部' },
  { id: 'saas', label: 'SaaS 服务', short: 'SaaS' },
  { id: 'proprietary', label: '闭源分发', short: '闭源' },
  { id: 'opensource', label: '开源分发', short: '开源' },
];

export const USAGES: { id: Usage; label: string }[] = [
  { id: 'runtime', label: '运行时依赖' },
  { id: 'dev', label: '开发依赖' },
];

export const LEVELS: Record<Level, { label: string; rank: number }> = {
  pass: { label: '通过', rank: 0 },
  released: { label: '放行', rank: 1 },
  warn: { label: '待复核', rank: 2 },
  blocked: { label: '阻断', rank: 3 },
};

export const channelLabel = (c: Channel) => CHANNELS.find(x => x.id === c)!.label;
export const usageLabel = (u: Usage) => USAGES.find(x => x.id === u)!.label;

// ---------- 工具 ----------

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function nowStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${todayStr()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function addDays(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const isValidOn = (expiresAt: string, today: string) => expiresAt >= today;

// ---------- 许可证分类与基础规则 ----------

type LicClass = 'permissive' | 'lgpl' | 'mpl' | 'gpl' | 'agpl' | 'cc' | 'proprietary' | 'unknown';

export function classify(license: string): LicClass {
  const s = license.trim().toLowerCase();
  if (s.includes('agpl')) return 'agpl';
  if (s.includes('lgpl')) return 'lgpl';
  if (/(^|[^a-z])gpl/.test(s)) return 'gpl';
  if (s.includes('mpl')) return 'mpl';
  if (/(mit|apache|bsd|isc|zlib|unlicense|0bsd|bsl-1|boost)/.test(s)) return 'permissive';
  if (s.includes('cc-') || s.includes('cc0') || s.includes('creative commons')) return 'cc';
  if (/(proprietary|commercial|专有|闭源|付费)/.test(s)) return 'proprietary';
  return 'unknown';
}

/** 不考虑授权/豁免的规则层结论 */
function baseVerdict(dep: DepItem, channel: Channel): Verdict {
  if (dep.usage === 'dev') {
    return { level: 'pass', basis: '开发用途，不随产品分发，各分发渠道的限制均不触发' };
  }
  const lic = dep.license;
  switch (classify(lic)) {
    case 'permissive':
      return { level: 'pass', basis: `${lic} 为宽松许可证，保留版权与许可声明即可分发` };
    case 'gpl':
      if (channel === 'proprietary')
        return { level: 'blocked', basis: 'GPL 强 Copyleft：衍生作品须以相同条款公开源码，闭源分发不得通过' };
      if (channel === 'saas') return { level: 'pass', basis: 'GPL 不约束网络服务的提供，SaaS 场景可用' };
      if (channel === 'opensource') return { level: 'pass', basis: '开源分发可满足 GPL 的源码公开义务' };
      return { level: 'pass', basis: '内部使用不构成分发，GPL 义务未触发' };
    case 'agpl':
      if (channel === 'proprietary')
        return { level: 'blocked', basis: 'AGPL 强 Copyleft：闭源分发不得通过' };
      if (channel === 'saas')
        return { level: 'blocked', basis: 'AGPL 网络交互条款：通过网络提供服务即触发源码公开义务' };
      if (channel === 'opensource') return { level: 'pass', basis: '开源分发可满足 AGPL 的源码公开义务' };
      return { level: 'pass', basis: '内部使用不构成分发，AGPL 义务未触发' };
    case 'lgpl':
      if (channel === 'proprietary')
        return { level: 'warn', basis: 'LGPL 需确认动态链接且用户可替换库文件，待法务复核' };
      return { level: 'pass', basis: 'LGPL 弱 Copyleft，当前渠道风险可控' };
    case 'mpl':
      if (channel === 'proprietary')
        return { level: 'warn', basis: 'MPL-2.0 为文件级 Copyleft，需确认被修改文件已开源，待复核' };
      return { level: 'pass', basis: 'MPL-2.0 文件级 Copyleft，当前渠道风险可控' };
    case 'cc':
      return { level: 'warn', basis: 'CC 系列并非软件许可证，用于代码需法务复核' };
    case 'proprietary':
      if (channel === 'opensource') return { level: 'blocked', basis: '专有许可证与开源分发直接冲突' };
      return { level: 'warn', basis: '专有/商业条款需逐案确认分发权利' };
    default:
      if (channel === 'proprietary')
        return { level: 'blocked', basis: '许可证未识别，闭源分发前必须取得法务确认' };
      return { level: 'warn', basis: '许可证未识别，需人工确认条款后再放行' };
  }
}

// ---------- 裁决（规则 + 商业授权 + 人工豁免） ----------

export function verdictFor(
  dep: DepItem,
  channel: Channel,
  licenses: CommercialLicense[],
  exemptions: Exemption[],
  today: string,
): Verdict {
  const base = baseVerdict(dep, channel);
  if (base.level === 'pass') return base;

  const licHits = licenses.filter(l => l.pkg === dep.name && l.channels.includes(channel));
  const validLic = licHits.filter(l => isValidOn(l.expiresAt, today));
  if (validLic.length) {
    const l = validLic.sort((a, b) => b.expiresAt.localeCompare(a.expiresAt))[0];
    return {
      level: 'released',
      via: '商业授权',
      basis: `${base.basis}；凭商业授权放行：${l.vendor}，覆盖${channelLabel(channel)}，有效期至 ${l.expiresAt}`,
    };
  }

  const exHits = exemptions.filter(e => e.pkg === dep.name && e.channels.includes(channel));
  const validEx = exHits.filter(e => isValidOn(e.expiresAt, today));
  if (validEx.length) {
    const e = validEx.sort((a, b) => b.expiresAt.localeCompare(a.expiresAt))[0];
    return {
      level: 'released',
      via: '人工豁免',
      basis: `${base.basis}；人工豁免放行：审批人 ${e.approver}，失效日 ${e.expiresAt}`,
    };
  }

  const expired = [
    ...licHits.map(l => `商业授权（${l.vendor}）已于 ${l.expiresAt} 过期`),
    ...exHits.map(e => `豁免（${e.approver}）已于 ${e.expiresAt} 失效`),
  ];
  if (expired.length) {
    return { ...base, basis: `${base.basis}；${expired.join('；')}，已恢复${LEVELS[base.level].label}` };
  }
  return base;
}

/** 依赖总体结论 = 各渠道中最严重的一档 */
export function overallVerdict(
  dep: DepItem,
  licenses: CommercialLicense[],
  exemptions: Exemption[],
  today: string,
): Verdict {
  let worst: Verdict = { level: 'pass', basis: '全部分发渠道均通过' };
  for (const c of CHANNELS) {
    const v = verdictFor(dep, c.id, licenses, exemptions, today);
    if (LEVELS[v.level].rank > LEVELS[worst.level].rank) worst = v;
  }
  return worst;
}

export function summarize(
  items: DepItem[],
  licenses: CommercialLicense[],
  exemptions: Exemption[],
  today: string,
): Record<Level, number> {
  const sum: Record<Level, number> = { pass: 0, released: 0, warn: 0, blocked: 0 };
  for (const d of items) sum[overallVerdict(d, licenses, exemptions, today).level] += 1;
  return sum;
}

export function blockedByChannel(
  items: DepItem[],
  channel: Channel,
  licenses: CommercialLicense[],
  exemptions: Exemption[],
  today: string,
): number {
  return items.filter(d => verdictFor(d, channel, licenses, exemptions, today).level === 'blocked').length;
}

// ---------- 清单解析 ----------

function dedupeDeps(items: DepItem[]): DepItem[] {
  const m = new Map<string, DepItem>();
  for (const d of items) m.set(d.name, d);
  return [...m.values()];
}

const DEV_WORDS = ['dev', '开发', '开发依赖'];

/**
 * 支持两种输入：
 * 1) package.json（取 dependencies / devDependencies，许可证记为 Unknown）
 * 2) 每行一条：`名称@版本 许可证 [runtime|dev]`
 */
export function parseManifest(text: string): DepItem[] {
  const t = text.trim();
  if (!t) return [];
  if (t.startsWith('{')) {
    try {
      const j = JSON.parse(t);
      const out: DepItem[] = [];
      const push = (deps: unknown, usage: Usage) => {
        if (!deps || typeof deps !== 'object') return;
        for (const [name, raw] of Object.entries(deps as Record<string, unknown>)) {
          out.push({ name, version: String(raw).replace(/^[\^~>=\s]*/, '') || '—', license: 'Unknown', usage });
        }
      };
      push(j.dependencies, 'runtime');
      push(j.devDependencies, 'dev');
      if (out.length) return dedupeDeps(out);
    } catch {
      // 落回逐行解析
    }
  }
  const out: DepItem[] = [];
  for (const rawLine of t.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const tokens = line.split(/\s+/);
    const head = tokens[0];
    let license = (tokens[1] ?? 'Unknown').replace(/[()]/g, '');
    let usage: Usage = 'runtime';
    if (DEV_WORDS.includes(license.toLowerCase())) {
      usage = 'dev';
      license = 'Unknown';
    } else if (tokens[2] && DEV_WORDS.includes(tokens[2].toLowerCase())) {
      usage = 'dev';
    }
    const at = head.lastIndexOf('@');
    let name = head;
    let version = '—';
    if (at > 0) {
      name = head.slice(0, at);
      version = head.slice(at + 1) || '—';
    }
    out.push({ name, version, license, usage });
  }
  return dedupeDeps(out);
}

// ---------- 批次 diff ----------

export function diffBatches(
  prev: DepItem[],
  next: DepItem[],
  licenses: CommercialLicense[],
  exemptions: Exemption[],
  today: string,
): BatchDiff {
  const pm = new Map(prev.map(d => [d.name, d]));
  const nm = new Map(next.map(d => [d.name, d]));
  const added = [...nm.keys()].filter(k => !pm.has(k));
  const removed = [...pm.keys()].filter(k => !nm.has(k));
  const changed: BatchDiff['changed'] = [];
  for (const [name, nd] of nm) {
    const pd = pm.get(name);
    if (!pd) continue;
    const bits: string[] = [];
    if (pd.version !== nd.version) bits.push(`版本 ${pd.version} → ${nd.version}`);
    if (pd.license !== nd.license) bits.push(`许可证 ${pd.license} → ${nd.license}`);
    if (pd.usage !== nd.usage) bits.push(`用途 ${usageLabel(pd.usage)} → ${usageLabel(nd.usage)}`);
    const po = overallVerdict(pd, licenses, exemptions, today).level;
    const no = overallVerdict(nd, licenses, exemptions, today).level;
    if (po !== no) bits.push(`结论 ${LEVELS[po].label} → ${LEVELS[no].label}`);
    if (bits.length) changed.push({ name, detail: bits.join(' · ') });
  }
  return { added, removed, changed };
}

export const currentBatch = (s: GateState): Batch | undefined => s.batches[s.batches.length - 1];
export const nextBatchLabel = (s: GateState) => `B-${String(s.batches.length + 1).padStart(3, '0')}`;

// ---------- 报告导出 ----------

export function buildReport(state: GateState, today: string): string {
  const batch = currentBatch(state);
  if (!batch) return '';
  const { licenses, exemptions } = state;
  const sum = summarize(batch.items, licenses, exemptions, today);
  const L: string[] = [];
  L.push('# 发行前依赖门禁报告', '');
  L.push(`- 批次：${batch.label}（已审核 · ${batch.reviewer ?? '—'} · ${batch.reviewedAt ?? '—'}）`);
  L.push(`- 导入时间：${batch.importedAt}`);
  L.push(`- 生成时间：${today}`);
  L.push(`- 汇总：通过 ${sum.pass} · 放行 ${sum.released} · 待复核 ${sum.warn} · 阻断 ${sum.blocked}`, '');
  L.push(`| 依赖 | 版本 | 许可证 | 用途 | ${CHANNELS.map(c => c.short).join(' | ')} | 总体 |`);
  L.push('|---|---|---|---|---|---|---|---|');
  for (const d of batch.items) {
    const cells = CHANNELS.map(c => LEVELS[verdictFor(d, c.id, licenses, exemptions, today).level].label);
    const overall = LEVELS[overallVerdict(d, licenses, exemptions, today).level].label;
    L.push(`| ${d.name} | ${d.version} | ${d.license} | ${usageLabel(d.usage)} | ${cells.join(' | ')} | ${overall} |`);
  }
  L.push('', '## 与上一批次差异', '');
  L.push(`- 新增（${batch.diff.added.length}）：${batch.diff.added.join('、') || '无'}`);
  L.push(`- 移除（${batch.diff.removed.length}）：${batch.diff.removed.join('、') || '无'}`);
  L.push(`- 结论变化（${batch.diff.changed.length}）：`);
  for (const c of batch.diff.changed) L.push(`  - ${c.name}：${c.detail}`);
  if (!batch.diff.changed.length) L.push('  - 无');
  L.push('', '## 裁决依据（非通过项）', '');
  let anyBasis = false;
  for (const d of batch.items) {
    for (const c of CHANNELS) {
      const v = verdictFor(d, c.id, licenses, exemptions, today);
      if (v.level !== 'pass') {
        anyBasis = true;
        L.push(`- **${d.name}@${d.version}** · ${c.label} · ${LEVELS[v.level].label}：${v.basis}`);
      }
    }
  }
  if (!anyBasis) L.push('- 无');
  const names = new Set(batch.items.map(d => d.name));
  const relLic = licenses.filter(l => names.has(l.pkg));
  const relEx = exemptions.filter(e => names.has(e.pkg));
  L.push('', '## 本批次涉及的商业授权', '');
  if (!relLic.length) L.push('- 无');
  for (const l of relLic)
    L.push(`- ${l.pkg}：${l.vendor}，覆盖 ${l.channels.map(channelLabel).join('、')}，有效期至 ${l.expiresAt}${isValidOn(l.expiresAt, today) ? '' : '（已过期）'}`);
  L.push('', '## 本批次涉及的人工豁免', '');
  if (!relEx.length) L.push('- 无');
  for (const e of relEx)
    L.push(`- ${e.pkg}：审批人 ${e.approver}，范围 ${e.channels.map(channelLabel).join('、')}，失效日 ${e.expiresAt}${isValidOn(e.expiresAt, today) ? '' : '（已失效）'}，事由：${e.reason}`);
  L.push('');
  return L.join('\n');
}

// ---------- 持久化（刷新后保持一致） ----------

const STORAGE_KEY = 'license-gate-state-v1';

function asChannels(v: unknown): Channel[] {
  const all = CHANNELS.map(c => c.id) as string[];
  if (!Array.isArray(v)) return [];
  return v.filter((c): c is Channel => typeof c === 'string' && all.includes(c));
}

const isDateStr = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

function dedupeById<T extends { id: string }>(arr: T[]): T[] {
  const seen = new Set<string>();
  return arr.filter(x => !seen.has(x.id) && (seen.add(x.id), true));
}

/** 校验并修复外部数据，保证依赖、授权、豁免、批次之间的引用关系一致 */
export function sanitizeState(raw: unknown, today: string): GateState {
  const r = (raw ?? {}) as Record<string, unknown>;
  const batches: Batch[] = (Array.isArray(r.batches) ? r.batches : [])
    .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
    .map(b => ({
      id: String(b.id ?? uid('b')),
      label: String(b.label ?? '批次'),
      importedAt: String(b.importedAt ?? ''),
      status: b.status === 'reviewed' ? ('reviewed' as const) : ('pending' as const),
      reviewer: typeof b.reviewer === 'string' ? b.reviewer : undefined,
      reviewedAt: typeof b.reviewedAt === 'string' ? b.reviewedAt : undefined,
      items: (Array.isArray(b.items) ? b.items : [])
        .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object' && typeof d.name === 'string')
        .map(d => ({
          name: String(d.name),
          version: String(d.version ?? '—'),
          license: String(d.license ?? 'Unknown'),
          usage: d.usage === 'dev' ? ('dev' as const) : ('runtime' as const),
        })),
      diff: {
        added: Array.isArray((b.diff as BatchDiff)?.added) ? (b.diff as BatchDiff).added.map(String) : [],
        removed: Array.isArray((b.diff as BatchDiff)?.removed) ? (b.diff as BatchDiff).removed.map(String) : [],
        changed: Array.isArray((b.diff as BatchDiff)?.changed)
          ? (b.diff as BatchDiff).changed
              .filter(c => c && typeof c.name === 'string')
              .map(c => ({ name: String(c.name), detail: String(c.detail ?? '') }))
          : [],
      },
    }))
    .filter(b => b.items.length > 0);
  const licenses: CommercialLicense[] = (Array.isArray(r.licenses) ? r.licenses : [])
    .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object' && typeof l.pkg === 'string')
    .map(l => ({
      id: String(l.id ?? uid('lic')),
      pkg: String(l.pkg),
      vendor: String(l.vendor ?? '未命名授权'),
      channels: asChannels(l.channels),
      expiresAt: isDateStr(l.expiresAt) ? l.expiresAt : today,
      note: typeof l.note === 'string' ? l.note : undefined,
      createdAt: String(l.createdAt ?? today),
    }))
    .filter(l => l.channels.length > 0);
  const exemptions: Exemption[] = (Array.isArray(r.exemptions) ? r.exemptions : [])
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && typeof e.pkg === 'string')
    .map(e => ({
      id: String(e.id ?? uid('ex')),
      pkg: String(e.pkg),
      approver: String(e.approver ?? '未登记审批人'),
      channels: asChannels(e.channels),
      expiresAt: isDateStr(e.expiresAt) ? e.expiresAt : today,
      reason: String(e.reason ?? ''),
      createdAt: String(e.createdAt ?? today),
    }))
    .filter(e => e.channels.length > 0);
  if (!batches.length) return seedState(today);
  return {
    batches: dedupeById(batches),
    licenses: dedupeById(licenses),
    exemptions: dedupeById(exemptions),
  };
}

export function loadState(): GateState {
  const today = todayStr();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedState(today);
    return sanitizeState(JSON.parse(raw), today);
  } catch {
    return seedState(today);
  }
}

export function saveState(s: GateState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // 存储不可用时静默降级（隐私模式等）
  }
}

export function resetState(): GateState {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  return seedState(todayStr());
}

// ---------- 示例数据 ----------

export function seedState(today = todayStr()): GateState {
  const b1items: DepItem[] = [
    { name: 'react', version: '18.3.1', license: 'MIT', usage: 'runtime' },
    { name: 'lodash', version: '4.17.21', license: 'MIT', usage: 'runtime' },
    { name: 'sharp', version: '0.33.4', license: 'Apache-2.0', usage: 'runtime' },
    { name: 'legacy-gpl', version: '2.4.0', license: 'GPL-3.0', usage: 'runtime' },
    { name: 'axios', version: '1.7.2', license: 'MIT', usage: 'runtime' },
    { name: 'zod', version: '3.23.8', license: 'MIT', usage: 'runtime' },
    { name: 'font-awesome', version: '6.5.2', license: 'CC-BY-4.0', usage: 'runtime' },
    { name: 'eslint', version: '9.9.0', license: 'MIT', usage: 'dev' },
  ];
  const b2items: DepItem[] = [
    { name: 'react', version: '18.3.1', license: 'MIT', usage: 'runtime' },
    { name: 'lodash', version: '4.17.21', license: 'MIT', usage: 'runtime' },
    { name: 'sharp', version: '0.34.0', license: 'LGPL-2.1', usage: 'runtime' },
    { name: 'legacy-gpl', version: '3.0.1', license: 'GPL-3.0', usage: 'runtime' },
    { name: 'axios', version: '1.7.2', license: 'MIT', usage: 'runtime' },
    { name: 'zod', version: '3.23.8', license: 'MIT', usage: 'runtime' },
    { name: 'eslint', version: '9.9.0', license: 'MIT', usage: 'dev' },
    { name: 'chart-lib', version: '3.1.0', license: 'AGPL-3.0', usage: 'runtime' },
    { name: 'ui-kit', version: '5.0.2', license: 'Unknown', usage: 'runtime' },
  ];
  const licenses: CommercialLicense[] = [
    {
      id: 'lic-1',
      pkg: 'legacy-gpl',
      vendor: 'ACME 商业授权 · 合同 A-2201',
      channels: ['proprietary'],
      expiresAt: addDays(today, 150),
      note: '覆盖闭源分发渠道，按年续签',
      createdAt: addDays(today, -90),
    },
    {
      id: 'lic-2',
      pkg: 'chart-lib',
      vendor: 'ChartSoft 商业授权 · 合同 C-0917',
      channels: ['saas', 'proprietary'],
      expiresAt: addDays(today, -20),
      note: '到期未续，已自动恢复阻断',
      createdAt: addDays(today, -200),
    },
  ];
  const exemptions: Exemption[] = [
    {
      id: 'ex-1',
      pkg: 'ui-kit',
      approver: '王芳（法务）',
      channels: ['internal', 'saas'],
      expiresAt: addDays(today, 60),
      reason: '内部灰度阶段暂不对外分发，供应商承诺两周内补交许可证文本',
      createdAt: addDays(today, -10),
    },
    {
      id: 'ex-2',
      pkg: 'font-awesome',
      approver: '王芳（法务）',
      channels: ['proprietary'],
      expiresAt: addDays(today, -45),
      reason: '历史版本临时豁免，依赖移除后已失效',
      createdAt: addDays(today, -160),
    },
  ];
  const b1: Batch = {
    id: 'b-001',
    label: 'B-001',
    importedAt: `${addDays(today, -12)} 10:24`,
    status: 'reviewed',
    reviewer: '陈晨',
    reviewedAt: `${addDays(today, -11)} 15:02`,
    items: b1items,
    diff: { added: b1items.map(d => d.name), removed: [], changed: [] },
  };
  const b2: Batch = {
    id: 'b-002',
    label: 'B-002',
    importedAt: `${addDays(today, -1)} 09:41`,
    status: 'pending',
    items: b2items,
    diff: diffBatches(b1items, b2items, licenses, exemptions, today),
  };
  return { batches: [b1, b2], licenses, exemptions };
}

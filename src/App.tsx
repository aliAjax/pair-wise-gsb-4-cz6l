import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronRight, Clock3, FileDown, History, KeyRound,
  Package, Plus, RotateCcw, Scale, Search, ShieldCheck, Stamp, Trash2, Upload, XCircle,
} from 'lucide-react';
import {
  Batch, CHANNELS, Channel, CommercialLicense, DepItem, Exemption, GateState, LEVELS, Level,
  Usage, Verdict, blockedByChannel, buildReport, channelLabel, currentBatch, diffBatches,
  isValidOn, loadState, nextBatchLabel, nowStr, overallVerdict, parseManifest, resetState,
  saveState, summarize, todayStr, uid, usageLabel, verdictFor,
} from './lib/gate';

type View = 'overview' | 'deps' | 'licenses' | 'exemptions' | 'batches';
type Modal =
  | { kind: 'license'; pkg?: string }
  | { kind: 'exemption'; pkg?: string }
  | { kind: 'review' }
  | { kind: 'dep' }
  | null;

const SAMPLE_MANIFEST = [
  '# 每行一条：名称@版本 许可证 [runtime|dev]',
  'react@18.3.1 MIT',
  'table-engine@2.0.4 AGPL-3.0',
  'pdf-kit@1.6.0 GPL-3.0',
  'eslint@9.9.0 MIT dev',
].join('\n');

export default function App() {
  const [state, setState] = useState<GateState>(loadState);
  const [view, setView] = useState<View>('overview');
  const [modal, setModal] = useState<Modal>(null);
  const [query, setQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState<'all' | Level>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const today = useMemo(todayStr, []);

  useEffect(() => saveState(state), [state]);

  const batch = currentBatch(state)!;
  const items = batch.items;
  const vFor = (d: DepItem, c: Channel): Verdict => verdictFor(d, c, state.licenses, state.exemptions, today);
  const oFor = (d: DepItem): Verdict => overallVerdict(d, state.licenses, state.exemptions, today);
  const sum = summarize(items, state.licenses, state.exemptions, today);
  const canExport = batch.status === 'reviewed';

  // ---------- 操作 ----------

  const createBatch = (nextItems: DepItem[]) => {
    const nb: Batch = {
      id: uid('b'),
      label: nextBatchLabel(state),
      importedAt: nowStr(),
      status: 'pending',
      items: nextItems,
      diff: diffBatches(items, nextItems, state.licenses, state.exemptions, today),
    };
    setState(s => ({ ...s, batches: [...s.batches, nb] }));
    setSelected(null);
    setLevelFilter('all');
  };

  const reviewBatch = (reviewer: string) => {
    setState(s => ({
      ...s,
      batches: s.batches.map((b, i) =>
        i === s.batches.length - 1 ? { ...b, status: 'reviewed', reviewer, reviewedAt: nowStr() } : b,
      ),
    }));
  };

  const addLicense = (l: Omit<CommercialLicense, 'id' | 'createdAt'>) =>
    setState(s => ({ ...s, licenses: [...s.licenses, { ...l, id: uid('lic'), createdAt: today }] }));
  const removeLicense = (id: string) => setState(s => ({ ...s, licenses: s.licenses.filter(l => l.id !== id) }));
  const addExemption = (e: Omit<Exemption, 'id' | 'createdAt'>) =>
    setState(s => ({ ...s, exemptions: [...s.exemptions, { ...e, id: uid('ex'), createdAt: today }] }));
  const removeExemption = (id: string) => setState(s => ({ ...s, exemptions: s.exemptions.filter(e => e.id !== id) }));

  const exportReport = () => {
    if (!canExport) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buildReport(state, today)], { type: 'text/markdown' }));
    a.download = `license-gate-${batch.label}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ---------- 视图 ----------

  const titles: Record<View, { eyebrow: string; title: string }> = {
    overview: { eyebrow: 'RELEASE GATE', title: '门禁总览' },
    deps: { eyebrow: 'DEPENDENCY VERDICTS', title: '依赖裁决' },
    licenses: { eyebrow: 'COMMERCIAL LICENSES', title: '商业授权' },
    exemptions: { eyebrow: 'WAIVERS', title: '豁免登记' },
    batches: { eyebrow: 'BATCHES & IMPORT', title: '批次与导入' },
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><ShieldCheck size={19} /></div>
          <div><strong>发行门禁台</strong><span>License Gate</span></div>
        </div>
        <div className="side-label">门禁管理</div>
        <nav>
          <NavBtn icon={<ShieldCheck size={17} />} label="门禁总览" active={view === 'overview'} onClick={() => setView('overview')} />
          <NavBtn icon={<Scale size={17} />} label="依赖裁决" count={items.length} active={view === 'deps'} onClick={() => setView('deps')} />
          <NavBtn icon={<KeyRound size={17} />} label="商业授权" count={state.licenses.length} active={view === 'licenses'} onClick={() => setView('licenses')} />
          <NavBtn icon={<Stamp size={17} />} label="豁免登记" count={state.exemptions.length} active={view === 'exemptions'} onClick={() => setView('exemptions')} />
          <NavBtn icon={<History size={17} />} label="批次与导入" count={state.batches.length} active={view === 'batches'} onClick={() => setView('batches')} />
        </nav>
        <div className="sidebar-foot">
          <div className={`gate-pill ${sum.blocked > 0 ? 'blocked' : 'clear'}`}>
            <span>当前批次 {batch.label}</span>
            <strong>{sum.blocked > 0 ? `阻断 ${sum.blocked} 项` : '门禁通过'}</strong>
            <i>{batch.status === 'reviewed' ? `已审核 · ${batch.reviewer}` : '待审核，暂不可导出'}</i>
          </div>
          <button className="ghost reset" onClick={() => { if (confirm('重置为示例数据？当前修改将丢失。')) setState(resetState()); }}>
            <RotateCcw size={13} /> 重置示例数据
          </button>
          <div className="profile">
            <div className="avatar">LC</div>
            <div><strong>李澈</strong><span>发布经理</span></div>
            <ChevronRight size={16} />
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">{titles[view].eyebrow}</p>
            <h1>{titles[view].title}</h1>
          </div>
          <div className="top-actions">
            {view === 'deps' && (
              <div className="search"><Search size={16} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索依赖" /></div>
            )}
            {view === 'deps' && <button className="secondary" onClick={() => setModal({ kind: 'dep' })}><Plus size={16} />添加依赖</button>}
            {view === 'licenses' && <button className="primary" onClick={() => setModal({ kind: 'license' })}><Plus size={16} />登记商业授权</button>}
            {view === 'exemptions' && <button className="primary" onClick={() => setModal({ kind: 'exemption' })}><Plus size={16} />登记豁免</button>}
            {(view === 'overview' || view === 'batches') && (
              <button className="primary" disabled={!canExport} title={canExport ? '' : '仅当前已审核批次可导出'} onClick={exportReport}>
                <FileDown size={16} />导出报告
              </button>
            )}
          </div>
        </header>

        {view === 'overview' && (
          <Overview
            state={state} batch={batch} sum={sum} today={today}
            onGoto={setView} onReview={() => setModal({ kind: 'review' })} onExport={exportReport} canExport={canExport}
          />
        )}
        {view === 'deps' && (
          <DepsView
            items={items} query={query} levelFilter={levelFilter} setLevelFilter={setLevelFilter}
            selected={selected} setSelected={setSelected} vFor={vFor} oFor={oFor}
            licenses={state.licenses} exemptions={state.exemptions} today={today}
            onAddLicense={(pkg) => setModal({ kind: 'license', pkg })}
            onAddExemption={(pkg) => setModal({ kind: 'exemption', pkg })}
          />
        )}
        {view === 'licenses' && (
          <LicensesView licenses={state.licenses} items={items} today={today} onRemove={removeLicense} />
        )}
        {view === 'exemptions' && (
          <ExemptionsView exemptions={state.exemptions} items={items} today={today} onRemove={removeExemption} />
        )}
        {view === 'batches' && (
          <BatchesView
            state={state} batch={batch} canExport={canExport}
            onImport={createBatch} onReview={() => setModal({ kind: 'review' })} onExport={exportReport}
          />
        )}
      </main>

      {modal?.kind === 'license' && (
        <LicenseModal pkg={modal.pkg} items={items} onClose={() => setModal(null)} onSubmit={l => { addLicense(l); setModal(null); }} />
      )}
      {modal?.kind === 'exemption' && (
        <ExemptionModal pkg={modal.pkg} items={items} onClose={() => setModal(null)} onSubmit={e => { addExemption(e); setModal(null); }} />
      )}
      {modal?.kind === 'review' && (
        <ReviewModal batch={batch} onClose={() => setModal(null)} onSubmit={r => { reviewBatch(r); setModal(null); }} />
      )}
      {modal?.kind === 'dep' && (
        <DepModal onClose={() => setModal(null)} onSubmit={d => { createBatch([...items.filter(x => x.name !== d.name), d]); setModal(null); }} />
      )}
    </div>
  );
}

// ---------- 通用小组件 ----------

function NavBtn({ icon, label, count, active, onClick }: { icon: React.ReactNode; label: string; count?: number; active: boolean; onClick: () => void }) {
  return (
    <button className={active ? 'side-link active' : 'side-link'} onClick={onClick}>
      {icon}{label}{count !== undefined && <b>{count}</b>}
    </button>
  );
}

function Badge({ level, via }: { level: Level; via?: string }) {
  return <span className={`badge b-${level}`}>{LEVELS[level].label}{via ? ` · ${via}` : ''}</span>;
}

function ChanMinis({ dep, vFor }: { dep: DepItem; vFor: (d: DepItem, c: Channel) => Verdict }) {
  return (
    <div className="chan-minis">
      {CHANNELS.map(c => {
        const v = vFor(dep, c.id);
        return <span key={c.id} className={`mini m-${v.level}`} title={`${c.label}：${LEVELS[v.level].label}`}>{c.short}</span>;
      })}
    </div>
  );
}

function ChannelPicker({ value, onChange }: { value: Channel[]; onChange: (v: Channel[]) => void }) {
  return (
    <div className="check-chips">
      {CHANNELS.map(c => (
        <button
          type="button" key={c.id}
          className={value.includes(c.id) ? 'chip active' : 'chip'}
          onClick={() => onChange(value.includes(c.id) ? value.filter(x => x !== c.id) : [...value, c.id])}
        >{c.label}</button>
      ))}
    </div>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose}>×</button></div>
        {children}
      </div>
    </div>
  );
}

function PkgSelect({ value, onChange, items }: { value: string; onChange: (v: string) => void; items: DepItem[] }) {
  return (
    <>
      <input list="pkg-options" value={value} onChange={e => onChange(e.target.value)} placeholder="选择或输入依赖名" />
      <datalist id="pkg-options">{items.map(d => <option key={d.name} value={d.name} />)}</datalist>
    </>
  );
}

// ---------- 总览 ----------

function Overview({ state, batch, sum, today, onGoto, onReview, onExport, canExport }: {
  state: GateState; batch: Batch; sum: Record<Level, number>; today: string;
  onGoto: (v: View) => void; onReview: () => void; onExport: () => void; canExport: boolean;
}) {
  const { items } = batch;
  return (
    <>
      <section className="stats five">
        <div><span>批次依赖</span><strong>{items.length}</strong><small>{batch.label} · {batch.importedAt}</small></div>
        <div><span>通过</span><strong className="c-pass">{sum.pass}</strong><small>全渠道合规</small></div>
        <div><span>放行</span><strong className="c-released">{sum.released}</strong><small>凭授权 / 豁免</small></div>
        <div><span>待复核</span><strong className="c-warn">{sum.warn}</strong><small>需法务确认</small></div>
        <div><span>阻断</span><strong className="c-blocked">{sum.blocked}</strong><small>不得进入发行</small></div>
      </section>

      <div className="section-head"><div><h2>分发渠道门禁</h2><p>按渠道统计当前批次的阻断项，任一阻断即不得发布该渠道</p></div></div>
      <section className="chan-grid">
        {CHANNELS.map(c => {
          const n = blockedByChannel(items, c.id, state.licenses, state.exemptions, today);
          return (
            <div key={c.id} className={`chan-card ${n > 0 ? 'bad' : 'ok'}`}>
              <div className="chan-card-top">
                {n > 0 ? <XCircle size={18} /> : <CheckCircle2 size={18} />}
                <strong>{c.label}</strong>
              </div>
              <b>{n > 0 ? `${n} 项阻断` : '可放行'}</b>
              <span>{n > 0 ? '存在未覆盖的 copyleft / 未识别许可证' : '无阻断项'}</span>
            </div>
          );
        })}
      </section>

      <div className="overview-grid">
        <section className="panel">
          <div className="section-head">
            <div><h2>当前批次 · {batch.label}</h2><p>导入于 {batch.importedAt}</p></div>
            <span className={`badge ${batch.status === 'reviewed' ? 'b-pass' : 'b-warn'}`}>
              {batch.status === 'reviewed' ? '已审核' : '待审核'}
            </span>
          </div>
          <div className="diff-nums">
            <span>新增 <b>{batch.diff.added.length}</b></span>
            <span>移除 <b>{batch.diff.removed.length}</b></span>
            <span>结论变化 <b>{batch.diff.changed.length}</b></span>
          </div>
          {batch.status === 'reviewed'
            ? <p className="muted-line">审核人 {batch.reviewer} · {batch.reviewedAt}</p>
            : <p className="muted-line"><Clock3 size={13} /> 审核通过前，报告导出保持锁定。</p>}
          <div className="row-actions">
            {batch.status !== 'reviewed' && <button className="primary" onClick={onReview}><CheckCircle2 size={15} />审核通过</button>}
            <button className="secondary" disabled={!canExport} title={canExport ? '' : '仅当前已审核批次可导出'} onClick={onExport}>
              <FileDown size={15} />导出 Markdown 报告
            </button>
            <button className="ghost" onClick={() => onGoto('batches')}>查看全部批次<ChevronRight size={14} /></button>
          </div>
        </section>
        <section className="panel notice-panel">
          <h2><AlertTriangle size={16} /> 门禁规则</h2>
          <ul className="rule-list">
            <li>GPL / AGPL 用于<strong>闭源分发</strong>一律阻断，须凭覆盖该渠道的商业授权放行。</li>
            <li>AGPL 用于 <strong>SaaS 服务</strong>同样触发源码公开义务，按阻断处理。</li>
            <li>商业授权或人工豁免<strong>到期当日即失效</strong>，结论自动恢复阻断 / 待复核。</li>
            <li>豁免须登记适用范围（渠道）、审批人与失效日，缺一不可提交。</li>
            <li>每次导入生成新的待审核批次，旧批次保留可追溯；仅当前已审核批次可导出。</li>
          </ul>
        </section>
      </div>
    </>
  );
}

// ---------- 依赖裁决 ----------

function DepsView({ items, query, levelFilter, setLevelFilter, selected, setSelected, vFor, oFor, licenses, exemptions, today, onAddLicense, onAddExemption }: {
  items: DepItem[]; query: string; levelFilter: 'all' | Level; setLevelFilter: (f: 'all' | Level) => void;
  selected: string | null; setSelected: (n: string) => void;
  vFor: (d: DepItem, c: Channel) => Verdict; oFor: (d: DepItem) => Verdict;
  licenses: CommercialLicense[]; exemptions: Exemption[]; today: string;
  onAddLicense: (pkg: string) => void; onAddExemption: (pkg: string) => void;
}) {
  const withOverall = items.map(d => ({ d, o: oFor(d) }));
  const counts: Record<'all' | Level, number> = {
    all: items.length,
    pass: withOverall.filter(x => x.o.level === 'pass').length,
    released: withOverall.filter(x => x.o.level === 'released').length,
    warn: withOverall.filter(x => x.o.level === 'warn').length,
    blocked: withOverall.filter(x => x.o.level === 'blocked').length,
  };
  const filtered = withOverall.filter(x =>
    (levelFilter === 'all' || x.o.level === levelFilter) &&
    x.d.name.toLowerCase().includes(query.toLowerCase()),
  );
  const sel = items.find(d => d.name === selected) ?? filtered[0]?.d ?? items[0];
  const chips: { id: 'all' | Level; label: string }[] = [
    { id: 'all', label: '全部' }, { id: 'pass', label: '通过' }, { id: 'released', label: '放行' },
    { id: 'warn', label: '待复核' }, { id: 'blocked', label: '阻断' },
  ];
  return (
    <div className="content-grid">
      <section className="library">
        <div className="section-head"><div><h2>依赖清单</h2><p>每个依赖按分发渠道与用途分别裁决</p></div></div>
        <div className="filters">
          {chips.map(c => (
            <button key={c.id} className={levelFilter === c.id ? 'chip active' : 'chip'} onClick={() => setLevelFilter(c.id)}>
              {c.label} {counts[c.id]}
            </button>
          ))}
        </div>
        <div className="phrase-list">
          {filtered.map(({ d, o }) => (
            <button key={d.name} onClick={() => setSelected(d.name)} className={sel && d.name === sel.name ? 'phrase selected' : 'phrase'}>
              <div className="phrase-icon"><Package size={15} /></div>
              <div className="phrase-copy">
                <strong>{d.name}<span className="ver">@{d.version}</span></strong>
                <span className="mono">{d.license}</span>
                <div className="phrase-meta">
                  <i>{usageLabel(d.usage)}</i>
                  <ChanMinis dep={d} vFor={vFor} />
                </div>
              </div>
              <Badge level={o.level} via={o.via} />
            </button>
          ))}
          {filtered.length === 0 && <div className="empty">没有匹配的依赖</div>}
        </div>
      </section>

      {sel && (
        <section className="practice">
          <div className="practice-head">
            <div><span className="label">VERDICT DETAIL</span><h2>{sel.name}<span className="ver">@{sel.version}</span></h2></div>
            <Badge level={oFor(sel).level} via={oFor(sel).via} />
          </div>
          <div className="detail-card">
            <div className="kv"><span>许可证</span><b className="mono">{sel.license}</b></div>
            <div className="kv"><span>用途</span><b>{usageLabel(sel.usage)}</b></div>
          </div>
          <div className="verdict-rows">
            {CHANNELS.map(c => {
              const v = vFor(sel, c.id);
              return (
                <div key={c.id} className="verdict-row">
                  <div className="verdict-row-head">
                    <strong>{c.label}</strong>
                    <Badge level={v.level} via={v.via} />
                  </div>
                  <p>{v.basis}</p>
                </div>
              );
            })}
          </div>
          <RelatedRecords pkg={sel.name} licenses={licenses} exemptions={exemptions} today={today} />
          <div className="row-actions">
            <button className="secondary" onClick={() => onAddLicense(sel.name)}><KeyRound size={14} />登记商业授权</button>
            <button className="secondary" onClick={() => onAddExemption(sel.name)}><Stamp size={14} />登记豁免</button>
          </div>
        </section>
      )}
    </div>
  );
}

function RelatedRecords({ pkg, licenses, exemptions, today }: {
  pkg: string; licenses: CommercialLicense[]; exemptions: Exemption[]; today: string;
}) {
  const ls = licenses.filter(l => l.pkg === pkg);
  const es = exemptions.filter(e => e.pkg === pkg);
  if (!ls.length && !es.length) return null;
  return (
    <div className="related">
      {ls.map(l => (
        <div key={l.id} className="related-row">
          <KeyRound size={14} />
          <div><strong>{l.vendor}</strong><span>覆盖 {l.channels.map(channelLabel).join('、')} · 有效期至 {l.expiresAt}</span></div>
          <span className={`badge ${isValidOn(l.expiresAt, today) ? 'b-released' : 'b-blocked'}`}>{isValidOn(l.expiresAt, today) ? '有效' : '已过期'}</span>
        </div>
      ))}
      {es.map(e => (
        <div key={e.id} className="related-row">
          <Stamp size={14} />
          <div><strong>豁免 · {e.approver}</strong><span>范围 {e.channels.map(channelLabel).join('、')} · 失效日 {e.expiresAt}</span></div>
          <span className={`badge ${isValidOn(e.expiresAt, today) ? 'b-released' : 'b-blocked'}`}>{isValidOn(e.expiresAt, today) ? '生效中' : '已失效'}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- 商业授权 ----------

function LicensesView({ licenses, items, today, onRemove }: {
  licenses: CommercialLicense[]; items: DepItem[]; today: string; onRemove: (id: string) => void;
}) {
  const names = new Set(items.map(d => d.name));
  return (
    <section className="panel wide">
      <div className="section-head"><div><h2>商业授权台账</h2><p>授权须覆盖对应分发渠道方可放行；到期后相关渠道立即恢复阻断</p></div></div>
      <div className="table">
        <div className="tr head">
          <span>依赖包</span><span>授权方 / 合同</span><span>覆盖渠道</span><span>有效期至</span><span>状态</span><span></span>
        </div>
        {licenses.map(l => {
          const valid = isValidOn(l.expiresAt, today);
          return (
            <div className="tr" key={l.id}>
              <span className="mono strong">{l.pkg}{!names.has(l.pkg) && <i className="tag-off">不在当前批次</i>}</span>
              <span>{l.vendor}{l.note && <small className="sub">{l.note}</small>}</span>
              <span className="chan-cells">{l.channels.map(c => <i key={c}>{channelLabel(c)}</i>)}</span>
              <span className="mono">{l.expiresAt}</span>
              <span><span className={`badge ${valid ? 'b-released' : 'b-blocked'}`}>{valid ? '有效' : '已过期'}</span></span>
              <span><button className="icon-btn" title="删除授权" onClick={() => onRemove(l.id)}><Trash2 size={15} /></button></span>
            </div>
          );
        })}
        {licenses.length === 0 && <div className="empty">尚未登记商业授权</div>}
      </div>
    </section>
  );
}

// ---------- 豁免登记 ----------

function ExemptionsView({ exemptions, items, today, onRemove }: {
  exemptions: Exemption[]; items: DepItem[]; today: string; onRemove: (id: string) => void;
}) {
  const names = new Set(items.map(d => d.name));
  return (
    <section className="panel wide">
      <div className="section-head"><div><h2>人工豁免登记</h2><p>豁免须登记适用范围、审批人与失效日；到期自动失效并恢复原结论</p></div></div>
      <div className="table">
        <div className="tr head">
          <span>依赖包</span><span>审批人</span><span>适用范围（渠道）</span><span>失效日</span><span>状态</span><span></span>
        </div>
        {exemptions.map(e => {
          const valid = isValidOn(e.expiresAt, today);
          return (
            <div className="tr" key={e.id}>
              <span className="mono strong">{e.pkg}{!names.has(e.pkg) && <i className="tag-off">不在当前批次</i>}</span>
              <span>{e.approver}{e.reason && <small className="sub">{e.reason}</small>}</span>
              <span className="chan-cells">{e.channels.map(c => <i key={c}>{channelLabel(c)}</i>)}</span>
              <span className="mono">{e.expiresAt}</span>
              <span><span className={`badge ${valid ? 'b-released' : 'b-blocked'}`}>{valid ? '生效中' : '已失效'}</span></span>
              <span><button className="icon-btn" title="删除豁免" onClick={() => onRemove(e.id)}><Trash2 size={15} /></button></span>
            </div>
          );
        })}
        {exemptions.length === 0 && <div className="empty">尚未登记豁免</div>}
      </div>
    </section>
  );
}

// ---------- 批次与导入 ----------

function BatchesView({ state, batch, canExport, onImport, onReview, onExport }: {
  state: GateState; batch: Batch; canExport: boolean;
  onImport: (items: DepItem[]) => void; onReview: () => void; onExport: () => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const doImport = (raw: string) => {
    const items = parseManifest(raw);
    if (!items.length) {
      setError('未解析到任何依赖，请检查格式（每行：名称@版本 许可证 [runtime|dev]，或粘贴 package.json）');
      return;
    }
    setError('');
    setText('');
    onImport(items);
  };

  return (
    <div className="content-grid batches-grid">
      <section className="panel">
        <div className="section-head"><div><h2>导入新清单</h2><p>每次导入生成一个待审核批次，旧批次全部保留</p></div></div>
        <textarea
          className="textarea" spellCheck={false} value={text} onChange={e => setText(e.target.value)}
          placeholder={SAMPLE_MANIFEST}
        />
        <div className="row-actions">
          <button className="primary" onClick={() => doImport(text)}><Upload size={15} />导入并生成待审核批次</button>
          <button className="secondary" onClick={() => setText(SAMPLE_MANIFEST)}>填入示例</button>
          <button className="secondary" onClick={() => fileRef.current?.click()}>选择文件</button>
          <input
            ref={fileRef} type="file" accept=".txt,.json,.csv,.lock,.md" style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0];
              if (!f) return;
              const r = new FileReader();
              r.onload = () => doImport(String(r.result ?? ''));
              r.readAsText(f);
              e.target.value = '';
            }}
          />
        </div>
        {error && <p className="error-line"><AlertTriangle size={13} /> {error}</p>}
        <p className="hint">
          支持逐行清单（<code>名称@版本 许可证 [runtime|dev]</code>）或 package.json
          （自动区分 dependencies / devDependencies，许可证记为 Unknown 待补录）。
        </p>
      </section>

      <section className="panel">
        <div className="section-head"><div><h2>批次记录</h2><p>仅当前已审核批次可导出报告</p></div></div>
        <div className="batch-list">
          {[...state.batches].reverse().map((b, ri) => {
            const isCurrent = ri === 0;
            return (
              <div key={b.id} className={`batch-card ${isCurrent ? 'current' : ''}`}>
                <div className="batch-head">
                  <strong>{b.label}</strong>
                  <span className={`badge ${b.status === 'reviewed' ? 'b-pass' : 'b-warn'}`}>{b.status === 'reviewed' ? '已审核' : '待审核'}</span>
                  {isCurrent ? <i className="tag-current">当前批次</i> : <i className="tag-archived">已归档</i>}
                </div>
                <p className="muted-line">导入 {b.importedAt} · {b.items.length} 个依赖{b.status === 'reviewed' && ` · 审核人 ${b.reviewer} · ${b.reviewedAt}`}</p>
                <div className="diff-block">
                  <DiffLine label="新增" items={b.diff.added} />
                  <DiffLine label="移除" items={b.diff.removed} />
                  <div className="diff-line">
                    <span className="diff-label">结论变化 <b>{b.diff.changed.length}</b></span>
                    {b.diff.changed.length > 0 && (
                      <ul>{b.diff.changed.map(c => <li key={c.name}><b className="mono">{c.name}</b>：{c.detail}</li>)}</ul>
                    )}
                  </div>
                </div>
                {isCurrent && (
                  <div className="row-actions">
                    {b.status !== 'reviewed' && <button className="primary" onClick={onReview}><CheckCircle2 size={15} />审核通过</button>}
                    <button className="secondary" disabled={!canExport} title={canExport ? '' : '审核通过后方可导出'} onClick={onExport}>
                      <FileDown size={15} />导出报告
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function DiffLine({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="diff-line">
      <span className="diff-label">{label} <b>{items.length}</b></span>
      {items.length > 0 && <span className="diff-names mono">{items.join('、')}</span>}
    </div>
  );
}

// ---------- 弹窗 ----------

function LicenseModal({ pkg, items, onClose, onSubmit }: {
  pkg?: string; items: DepItem[]; onClose: () => void;
  onSubmit: (l: Omit<CommercialLicense, 'id' | 'createdAt'>) => void;
}) {
  const [form, setForm] = useState({ pkg: pkg ?? '', vendor: '', channels: [] as Channel[], expiresAt: '', note: '' });
  const [err, setErr] = useState('');
  const submit = () => {
    if (!form.pkg.trim()) return setErr('请填写依赖包名');
    if (!form.vendor.trim()) return setErr('请填写授权方 / 合同号');
    if (!form.channels.length) return setErr('至少选择一个覆盖渠道');
    if (!form.expiresAt) return setErr('请选择授权有效期');
    onSubmit({ pkg: form.pkg.trim(), vendor: form.vendor.trim(), channels: form.channels, expiresAt: form.expiresAt, note: form.note.trim() || undefined });
  };
  return (
    <ModalShell title="登记商业授权" onClose={onClose}>
      <label>依赖包<PkgSelect value={form.pkg} onChange={v => setForm({ ...form, pkg: v })} items={items} /></label>
      <label>授权方 / 合同号<input value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} placeholder="例如：ACME 商业授权 · 合同 A-2201" /></label>
      <label>覆盖渠道<ChannelPicker value={form.channels} onChange={v => setForm({ ...form, channels: v })} /></label>
      <label>有效期至<input type="date" value={form.expiresAt} onChange={e => setForm({ ...form, expiresAt: e.target.value })} /></label>
      <label>备注（可选）<input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="续签安排、限制条款等" /></label>
      {err && <p className="error-line"><AlertTriangle size={13} /> {err}</p>}
      <div className="modal-actions">
        <button className="secondary" onClick={onClose}>取消</button>
        <button className="primary" onClick={submit}>登记授权</button>
      </div>
    </ModalShell>
  );
}

function ExemptionModal({ pkg, items, onClose, onSubmit }: {
  pkg?: string; items: DepItem[]; onClose: () => void;
  onSubmit: (e: Omit<Exemption, 'id' | 'createdAt'>) => void;
}) {
  const [form, setForm] = useState({ pkg: pkg ?? '', approver: '', channels: [] as Channel[], expiresAt: '', reason: '' });
  const [err, setErr] = useState('');
  const submit = () => {
    if (!form.pkg.trim()) return setErr('请填写依赖包名');
    if (!form.channels.length) return setErr('请选择适用范围（渠道）');
    if (!form.approver.trim()) return setErr('请填写审批人');
    if (!form.expiresAt) return setErr('请选择失效日');
    if (!form.reason.trim()) return setErr('请填写豁免事由');
    onSubmit({ pkg: form.pkg.trim(), approver: form.approver.trim(), channels: form.channels, expiresAt: form.expiresAt, reason: form.reason.trim() });
  };
  return (
    <ModalShell title="登记人工豁免" onClose={onClose}>
      <label>依赖包<PkgSelect value={form.pkg} onChange={v => setForm({ ...form, pkg: v })} items={items} /></label>
      <label>适用范围（渠道）<ChannelPicker value={form.channels} onChange={v => setForm({ ...form, channels: v })} /></label>
      <label>审批人<input value={form.approver} onChange={e => setForm({ ...form, approver: e.target.value })} placeholder="例如：王芳（法务）" /></label>
      <label>失效日<input type="date" value={form.expiresAt} onChange={e => setForm({ ...form, expiresAt: e.target.value })} /></label>
      <label>豁免事由<textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="说明豁免的业务背景与风险控制措施" /></label>
      {err && <p className="error-line"><AlertTriangle size={13} /> {err}</p>}
      <div className="modal-actions">
        <button className="secondary" onClick={onClose}>取消</button>
        <button className="primary" onClick={submit}>登记豁免</button>
      </div>
    </ModalShell>
  );
}

function ReviewModal({ batch, onClose, onSubmit }: { batch: Batch; onClose: () => void; onSubmit: (reviewer: string) => void }) {
  const [reviewer, setReviewer] = useState('');
  const [err, setErr] = useState('');
  return (
    <ModalShell title={`审核批次 ${batch.label}`} onClose={onClose}>
      <p className="muted-line">
        确认本批次 {batch.items.length} 个依赖的渠道结论均已核对。审核通过后批次标记为「已审核」，报告解锁导出；
        此后若再导入新清单，将生成新的待审核批次并重新锁定导出。
      </p>
      <label>审核人<input autoFocus value={reviewer} onChange={e => setReviewer(e.target.value)} placeholder="例如：陈晨" /></label>
      {err && <p className="error-line"><AlertTriangle size={13} /> {err}</p>}
      <div className="modal-actions">
        <button className="secondary" onClick={onClose}>取消</button>
        <button className="primary" onClick={() => reviewer.trim() ? onSubmit(reviewer.trim()) : setErr('请填写审核人')}>审核通过</button>
      </div>
    </ModalShell>
  );
}

function DepModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (d: DepItem) => void }) {
  const [form, setForm] = useState({ name: '', version: '', license: '', usage: 'runtime' as Usage });
  const [err, setErr] = useState('');
  const submit = () => {
    if (!form.name.trim()) return setErr('请填写依赖名');
    onSubmit({
      name: form.name.trim(),
      version: form.version.trim() || '—',
      license: form.license.trim() || 'Unknown',
      usage: form.usage,
    });
  };
  return (
    <ModalShell title="添加依赖（生成新批次）" onClose={onClose}>
      <p className="muted-line">依赖变更以批次为单位留痕：添加后将基于当前批次生成新的待审核批次。</p>
      <label>依赖名<input autoFocus value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例如：left-pad" /></label>
      <label>版本<input value={form.version} onChange={e => setForm({ ...form, version: e.target.value })} placeholder="例如：1.3.0" /></label>
      <label>许可证
        <input list="lic-options" value={form.license} onChange={e => setForm({ ...form, license: e.target.value })} placeholder="SPDX 标识，留空记为 Unknown" />
        <datalist id="lic-options">
          {['MIT', 'Apache-2.0', 'BSD-3-Clause', 'ISC', 'LGPL-2.1', 'MPL-2.0', 'GPL-3.0', 'AGPL-3.0', 'CC-BY-4.0', 'Proprietary', 'Unknown'].map(l => <option key={l} value={l} />)}
        </datalist>
      </label>
      <label>用途
        <select value={form.usage} onChange={e => setForm({ ...form, usage: e.target.value as Usage })}>
          <option value="runtime">运行时依赖</option>
          <option value="dev">开发依赖</option>
        </select>
      </label>
      {err && <p className="error-line"><AlertTriangle size={13} /> {err}</p>}
      <div className="modal-actions">
        <button className="secondary" onClick={onClose}>取消</button>
        <button className="primary" onClick={submit}>添加并生成批次</button>
      </div>
    </ModalShell>
  );
}

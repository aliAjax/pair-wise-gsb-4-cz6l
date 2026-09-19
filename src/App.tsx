import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  AlertTriangle, BadgeCheck, Ban, BookOpenCheck, Check, ChevronRight, CircleAlert,
  Download, FileUp, History, KeyRound, Plus, Search, ShieldCheck, Stamp, Trash2, X,
} from 'lucide-react';
import {
  Batch, BatchDiff, CHANNELS, Channel, CommercialLicense, DepEval, DepItem, evaluateDep,
  Exemption, diffBatches, exportMarkdown, IMPORT_EXAMPLE, isExpired, newId, normalizeLicense,
  nowStr, parseManifest, seedState, summarize, todayStr, USAGE_LABEL, VERDICT_LABEL, Verdict,
} from './domain';

const STORE_KEY = 'license-gate-v1';

interface Store {
  batches: Batch[];
  licenses: CommercialLicense[];
  exemptions: Exemption[];
}

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Store;
      if (Array.isArray(s.batches) && s.batches.length
        && Array.isArray(s.licenses) && Array.isArray(s.exemptions)) return s;
    }
  } catch { /* 损坏则回退种子数据 */ }
  return seedState();
}

type Tab = 'gate' | 'licenses' | 'exemptions' | 'batches';
type Filter = 'all' | Verdict;

const VERDICT_ICON: Record<Verdict, ReactElement> = {
  pass: <Check size={12} />,
  review: <CircleAlert size={12} />,
  blocked: <Ban size={12} />,
  licensed: <KeyRound size={12} />,
  exempted: <Stamp size={12} />,
};

export default function App() {
  const [store, setStore] = useState<Store>(loadStore);
  const [tab, setTab] = useState<Tab>('gate');
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }, [store]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const today = todayStr();
  const batches = store.batches;
  // 当前工作批次 = 最新批次；当前已审核批次 = 最近一个已审核批次
  const activeBatch = batches[batches.length - 1];
  const currentApproved = [...batches].reverse().find(b => b.status === 'approved') ?? null;
  const viewedBatch = batches.find(b => b.id === selectedBatchId) ?? activeBatch;

  const evals = useMemo(
    () => activeBatch.items.map(d => evaluateDep(d, store.licenses, store.exemptions, today)),
    [activeBatch, store.licenses, store.exemptions, today],
  );
  const sum = useMemo(() => summarize(evals), [evals]);
  const filtered = useMemo(() => evals.filter(e => {
    const hit = filter === 'all'
      || e.overall === filter
      || (filter === 'licensed' && e.licensed > 0)
      || (filter === 'exempted' && e.exempted > 0);
    return hit && e.dep.name.toLowerCase().includes(query.toLowerCase());
  }), [evals, filter, query]);
  const detail = detailId ? evals.find(e => e.dep.id === detailId) ?? null : null;

  const mutate = (fn: (s: Store) => Store) => setStore(s => fn(s));

  const importBatch = (items: DepItem[]) => {
    const batch: Batch = {
      id: newId('b'), seq: (activeBatch?.seq ?? 0) + 1,
      importedAt: nowStr(), status: 'pending', items,
    };
    mutate(s => ({ ...s, batches: [...s.batches, batch] }));
    setSelectedBatchId(batch.id);
    setTab('batches');
    setShowImport(false);
    setToast(`已生成待审核批次 #${batch.seq}（${items.length} 项依赖），旧批次已保留`);
  };

  const approveBatch = (batchId: string, reviewer: string) => {
    mutate(s => ({
      ...s,
      batches: s.batches.map(b => b.id === batchId
        ? { ...b, status: 'approved', reviewedBy: reviewer, reviewedAt: nowStr() }
        : b),
    }));
    setToast(`批次已审核通过，审核人 ${reviewer}`);
  };

  const addLicense = (l: Omit<CommercialLicense, 'id'>) => {
    mutate(s => ({ ...s, licenses: [...s.licenses, { ...l, id: newId('l') }] }));
    setToast(`已登记 ${l.packageName} 的商业授权`);
  };
  const removeLicense = (id: string) => {
    mutate(s => ({ ...s, licenses: s.licenses.filter(l => l.id !== id) }));
    setToast('已删除商业授权，相关渠道结论已重新裁决');
  };
  const addExemption = (e: Omit<Exemption, 'id' | 'createdAt'>) => {
    mutate(s => ({ ...s, exemptions: [...s.exemptions, { ...e, id: newId('e'), createdAt: nowStr() }] }));
    setToast(`已登记 ${e.packageName} 的人工豁免`);
  };
  const removeExemption = (id: string) => {
    mutate(s => ({ ...s, exemptions: s.exemptions.filter(e => e.id !== id) }));
    setToast('已删除豁免，相关渠道结论已重新裁决');
  };

  const doExport = () => {
    if (!currentApproved) return;
    const prev = batches[batches.indexOf(currentApproved) - 1] ?? null;
    const md = exportMarkdown(currentApproved, prev, store.licenses, store.exemptions, today);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = `license-gate-batch-${currentApproved.seq}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    setToast(`已导出当前已审核批次 #${currentApproved.seq} 的门禁报告`);
  };

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <div className="brand-mark"><ShieldCheck size={19} /></div>
          <div><strong>License Lens</strong><span>发行前依赖门禁台</span></div>
        </div>
        <div className="side-label">门禁工作台</div>
        <nav>
          <button className={tab === 'gate' ? 'nav active' : 'nav'} onClick={() => setTab('gate')}>
            <ShieldCheck size={16} />门禁总览
            {sum.blocked > 0 && <b className="pill-bad">{sum.blocked}</b>}
          </button>
          <button className={tab === 'licenses' ? 'nav active' : 'nav'} onClick={() => setTab('licenses')}>
            <KeyRound size={16} />商业授权<b>{store.licenses.length}</b>
          </button>
          <button className={tab === 'exemptions' ? 'nav active' : 'nav'} onClick={() => setTab('exemptions')}>
            <Stamp size={16} />人工豁免<b>{store.exemptions.length}</b>
          </button>
          <button className={tab === 'batches' ? 'nav active' : 'nav'} onClick={() => setTab('batches')}>
            <History size={16} />批次与审核
            {activeBatch.status === 'pending' && <b className="pill-warn">待审</b>}
          </button>
        </nav>
        <div className="side-foot">
          <div className="batch-chip">
            <span>当前工作批次</span>
            <strong>#{activeBatch.seq} · {activeBatch.status === 'approved' ? '已审核' : '待审核'}</strong>
            <small>{activeBatch.importedAt} 导入 · {activeBatch.items.length} 项依赖</small>
          </div>
          <div className="batch-chip">
            <span>可导出版本</span>
            <strong>{currentApproved ? `批次 #${currentApproved.seq}` : '暂无已审核批次'}</strong>
            <small>{currentApproved ? `审核人 ${currentApproved.reviewedBy}` : '审核通过后可导出'}</small>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">PRE-RELEASE LICENSE GATE · {today}</p>
            <h1>发行前依赖门禁</h1>
          </div>
          <div className="top-actions">
            <button className="secondary" onClick={() => setShowImport(true)}><FileUp size={16} />导入清单</button>
            <button
              className="primary"
              disabled={!currentApproved}
              title={currentApproved ? `导出当前已审核批次 #${currentApproved.seq}` : '没有已审核批次，无法导出'}
              onClick={doExport}
            ><Download size={16} />导出报告</button>
          </div>
        </header>

        {activeBatch.status === 'pending' && (
          <div className="banner">
            <AlertTriangle size={16} />
            <span>批次 #{activeBatch.seq} 尚未审核，当前结论为预评估；{currentApproved ? `导出口径仍为已审核批次 #${currentApproved.seq}。` : '审核通过前不可导出。'}</span>
            <button className="link" onClick={() => { setSelectedBatchId(activeBatch.id); setTab('batches'); }}>
              去审核<ChevronRight size={14} />
            </button>
          </div>
        )}

        {tab === 'gate' && (
          <GateTab
            evals={filtered} all={evals} sum={sum} filter={filter} setFilter={setFilter}
            query={query} setQuery={setQuery} onDetail={e => setDetailId(e.dep.id)}
          />
        )}
        {tab === 'licenses' && (
          <LicensesTab
            licenses={store.licenses} today={today} deps={activeBatch.items}
            onAdd={addLicense} onRemove={removeLicense}
          />
        )}
        {tab === 'exemptions' && (
          <ExemptionsTab
            exemptions={store.exemptions} today={today} deps={activeBatch.items}
            onAdd={addExemption} onRemove={removeExemption}
          />
        )}
        {tab === 'batches' && (
          <BatchesTab
            batches={batches} viewed={viewedBatch} onSelect={setSelectedBatchId}
            licenses={store.licenses} exemptions={store.exemptions} today={today}
            currentApproved={currentApproved} onApprove={approveBatch} onExport={doExport}
          />
        )}
      </main>

      {detail && (
        <DetailModal
          e={detail} onClose={() => setDetailId(null)}
          licenses={store.licenses} exemptions={store.exemptions}
          onAddLicense={() => { setTab('licenses'); setDetailId(null); }}
          onAddExemption={() => { setTab('exemptions'); setDetailId(null); }}
        />
      )}
      {showImport && <ImportModal onClose={() => setShowImport(false)} onImport={importBatch} />}
      {toast && <div className="toast"><BadgeCheck size={15} />{toast}</div>}
    </div>
  );
}

// ------------------------------------------------------------
// 门禁总览
// ------------------------------------------------------------

function GateTab({ evals, all, sum, filter, setFilter, query, setQuery, onDetail }: {
  evals: DepEval[]; all: DepEval[];
  sum: ReturnType<typeof summarize>;
  filter: Filter; setFilter: (f: Filter) => void;
  query: string; setQuery: (q: string) => void;
  onDetail: (e: DepEval) => void;
}) {
  const counts: Record<Filter, number> = {
    all: all.length,
    pass: all.filter(e => e.overall === 'pass').length,
    review: all.filter(e => e.overall === 'review').length,
    blocked: all.filter(e => e.overall === 'blocked').length,
    licensed: all.filter(e => e.licensed > 0).length,
    exempted: all.filter(e => e.exempted > 0).length,
  };
  const chips: { id: Filter; label: string }[] = [
    { id: 'all', label: '全部' }, { id: 'blocked', label: '阻断' }, { id: 'review', label: '待复核' },
    { id: 'pass', label: '放行' }, { id: 'licensed', label: '授权放行' }, { id: 'exempted', label: '豁免放行' },
  ];
  return (
    <>
      <section className="metrics">
        <div className="metric"><span>门禁依赖</span><strong>{sum.total}</strong><small>按 4 个分发渠道分别裁决</small></div>
        <div className="metric bad"><span>阻断</span><strong>{sum.blocked}</strong><small>含授权/豁免过期恢复项</small></div>
        <div className="metric warn"><span>待复核</span><strong>{sum.review}</strong><small>需法务或责任人确认</small></div>
        <div className="metric ok"><span>放行</span><strong>{sum.pass}</strong><small>含授权 {sum.licensed} · 豁免 {sum.exempted} 渠道次</small></div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div className="chips">
            {chips.map(c => (
              <button key={c.id} className={filter === c.id ? 'chip active' : 'chip'} onClick={() => setFilter(c.id)}>
                {c.label} <i>{counts[c.id]}</i>
              </button>
            ))}
          </div>
          <div className="search"><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索依赖…" /></div>
        </div>
        <div className="table-head row-grid">
          <span>依赖</span><span>用途</span><span>许可证</span>
          {CHANNELS.map(c => <span key={c.id} className="center">{c.short}</span>)}
          <span>总结论</span><span />
        </div>
        {evals.map(e => <GateRow key={e.dep.id} e={e} onDetail={() => onDetail(e)} />)}
        {evals.length === 0 && <div className="empty">没有匹配的依赖</div>}
      </section>
    </>
  );
}

function GateRow({ e, onDetail }: { e: DepEval; onDetail: () => void }) {
  return (
    <div className="row-grid dep-row" onClick={onDetail}>
      <span className="pkg">
        <span className="pkg-icon">{e.dep.name.slice(0, 1).toUpperCase()}</span>
        <span><b>{e.dep.name}</b><small>{e.dep.version}</small></span>
      </span>
      <span><i className="usage">{USAGE_LABEL[e.dep.usage]}</i></span>
      <span className="mono">{normalizeLicense(e.dep.license)}</span>
      {e.channels.map(c => (
        <span key={c.channel} className="center">
          <em className={`dot ${c.verdict}`} title={`${VERDICT_LABEL[c.verdict]} — ${c.reason}`}>
            {VERDICT_ICON[c.verdict]}
          </em>
        </span>
      ))}
      <span><em className={`badge ${e.overall}`}>{VERDICT_LABEL[e.overall]}</em></span>
      <span className="chev"><ChevronRight size={15} /></span>
    </div>
  );
}

// ------------------------------------------------------------
// 依赖详情：逐渠道裁决依据
// ------------------------------------------------------------

function DetailModal({ e, licenses, exemptions, onClose, onAddLicense, onAddExemption }: {
  e: DepEval; licenses: CommercialLicense[]; exemptions: Exemption[];
  onClose: () => void; onAddLicense: () => void; onAddExemption: () => void;
}) {
  const relatedLicenses = licenses.filter(l => l.packageName.trim().toLowerCase() === e.dep.name.toLowerCase());
  const relatedExemptions = exemptions.filter(x => x.packageName.trim().toLowerCase() === e.dep.name.toLowerCase());
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal wide" onClick={ev => ev.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{e.dep.name} <small className="mono">{e.dep.version} · {normalizeLicense(e.dep.license)}</small></h2>
            <p className="sub">{USAGE_LABEL[e.dep.usage]} · 总结论 <em className={`badge ${e.overall}`}>{VERDICT_LABEL[e.overall]}</em></p>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="channel-grid">
          {e.channels.map(c => (
            <div key={c.channel} className={`channel-card ${c.verdict}`}>
              <div className="channel-top">
                <strong>{CHANNELS.find(x => x.id === c.channel)!.label}</strong>
                <em className={`badge ${c.verdict}`}>{VERDICT_ICON[c.verdict]}{VERDICT_LABEL[c.verdict]}</em>
              </div>
              <p>{c.reason}</p>
              {c.base !== 'pass' && c.verdict !== 'licensed' && c.verdict !== 'exempted' && (
                <div className="channel-actions">
                  <button className="mini" onClick={onAddLicense}><KeyRound size={12} />登记商业授权</button>
                  <button className="mini" onClick={onAddExemption}><Stamp size={12} />申请豁免</button>
                </div>
              )}
            </div>
          ))}
        </div>
        {(relatedLicenses.length > 0 || relatedExemptions.length > 0) && (
          <div className="related">
            {relatedLicenses.map(l => (
              <div key={l.id} className="related-row">
                <KeyRound size={14} />
                <span>商业授权 · {l.vendor} · 覆盖 {l.channels.map(c => CHANNELS.find(x => x.id === c)!.label).join('、')} · 有效期至 {l.validUntil}</span>
              </div>
            ))}
            {relatedExemptions.map(x => (
              <div key={x.id} className="related-row">
                <Stamp size={14} />
                <span>豁免 · 审批人 {x.approver} · 失效日 {x.expiresOn} · {x.reason}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// 商业授权
// ------------------------------------------------------------

function LicensesTab({ licenses, today, deps, onAdd, onRemove }: {
  licenses: CommercialLicense[]; today: string; deps: DepItem[];
  onAdd: (l: Omit<CommercialLicense, 'id'>) => void;
  onRemove: (id: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>商业授权</h2>
          <p className="sub">GPL / AGPL 等 Copyleft 组件用于闭源分发或 SaaS 时，须凭覆盖该渠道的有效商业授权放行；授权过期立即恢复阻断。</p>
        </div>
        <button className="primary" onClick={() => setShowForm(!showForm)}><Plus size={15} />登记授权</button>
      </div>
      {showForm && <LicenseForm deps={deps} onSubmit={l => { onAdd(l); setShowForm(false); }} onCancel={() => setShowForm(false)} />}
      <div className="table-head lic-grid">
        <span>依赖</span><span>供应商</span><span>覆盖渠道</span><span>有效期至</span><span>状态</span><span />
      </div>
      {licenses.map(l => {
        const expired = isExpired(l.validUntil, today);
        return (
          <div key={l.id} className="lic-grid row-line">
            <span className="pkg"><span className="pkg-icon key"><KeyRound size={14} /></span><span><b>{l.packageName}</b>{l.note && <small>{l.note}</small>}</span></span>
            <span>{l.vendor}</span>
            <span className="chans">{l.channels.map(c => <i key={c} className="usage">{CHANNELS.find(x => x.id === c)!.short}</i>)}</span>
            <span className="mono">{l.validUntil}</span>
            <span>{expired
              ? <em className="badge blocked"><Ban size={12} />已过期 · 恢复阻断</em>
              : <em className="badge pass"><Check size={12} />有效</em>}</span>
            <span className="chev"><button className="icon-btn" title="删除授权" onClick={() => onRemove(l.id)}><Trash2 size={15} /></button></span>
          </div>
        );
      })}
      {licenses.length === 0 && <div className="empty">尚未登记商业授权</div>}
    </section>
  );
}

function LicenseForm({ deps, onSubmit, onCancel }: {
  deps: DepItem[];
  onSubmit: (l: Omit<CommercialLicense, 'id'>) => void;
  onCancel: () => void;
}) {
  const [packageName, setPackageName] = useState('');
  const [vendor, setVendor] = useState('');
  const [channels, setChannels] = useState<Channel[]>(['closed']);
  const [validUntil, setValidUntil] = useState('');
  const [note, setNote] = useState('');
  const ok = packageName.trim() && vendor.trim() && channels.length > 0 && validUntil;
  const toggle = (c: Channel) => setChannels(cs => cs.includes(c) ? cs.filter(x => x !== c) : [...cs, c]);
  return (
    <div className="form-card">
      <div className="form-grid">
        <label>依赖名称
          <input list="dep-names" value={packageName} onChange={e => setPackageName(e.target.value)} placeholder="如 legacy-gpl" />
          <datalist id="dep-names">{deps.map(d => <option key={d.id} value={d.name} />)}</datalist>
        </label>
        <label>供应商 / 授权方
          <input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="如 LegacySoft" />
        </label>
        <label>有效期至
          <input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} />
        </label>
        <label>备注（协议号等）
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="可选" />
        </label>
      </div>
      <div className="chan-pick">
        <span>覆盖渠道</span>
        {CHANNELS.map(c => (
          <button key={c.id} className={channels.includes(c.id) ? 'chip active' : 'chip'} onClick={() => toggle(c.id)}>{c.label}</button>
        ))}
      </div>
      <div className="form-actions">
        <button className="secondary" onClick={onCancel}>取消</button>
        <button className="primary" disabled={!ok} onClick={() => onSubmit({ packageName: packageName.trim(), vendor: vendor.trim(), channels, validUntil, note: note.trim() || undefined })}>保存授权</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// 人工豁免
// ------------------------------------------------------------

function ExemptionsTab({ exemptions, today, deps, onAdd, onRemove }: {
  exemptions: Exemption[]; today: string; deps: DepItem[];
  onAdd: (e: Omit<Exemption, 'id' | 'createdAt'>) => void;
  onRemove: (id: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>人工豁免</h2>
          <p className="sub">豁免须登记适用范围、审批人和失效日；到期自动失效并恢复原始裁决。</p>
        </div>
        <button className="primary" onClick={() => setShowForm(!showForm)}><Plus size={15} />登记豁免</button>
      </div>
      {showForm && <ExemptionForm deps={deps} onSubmit={e => { onAdd(e); setShowForm(false); }} onCancel={() => setShowForm(false)} />}
      <div className="table-head ex-grid">
        <span>依赖</span><span>适用范围</span><span>审批人</span><span>失效日</span><span>状态</span><span />
      </div>
      {exemptions.map(x => {
        const expired = isExpired(x.expiresOn, today);
        return (
          <div key={x.id} className="ex-grid row-line">
            <span className="pkg">
              <span className="pkg-icon stamp"><Stamp size={14} /></span>
              <span><b>{x.packageName}</b><small>{x.reason} · 登记于 {x.createdAt}</small></span>
            </span>
            <span className="chans">{x.scope.map(c => <i key={c} className="usage">{CHANNELS.find(y => y.id === c)!.short}</i>)}</span>
            <span>{x.approver}</span>
            <span className="mono">{x.expiresOn}</span>
            <span>{expired
              ? <em className="badge blocked"><Ban size={12} />已失效</em>
              : <em className="badge exempted"><Stamp size={12} />有效</em>}</span>
            <span className="chev"><button className="icon-btn" title="删除豁免" onClick={() => onRemove(x.id)}><Trash2 size={15} /></button></span>
          </div>
        );
      })}
      {exemptions.length === 0 && <div className="empty">尚未登记人工豁免</div>}
    </section>
  );
}

function ExemptionForm({ deps, onSubmit, onCancel }: {
  deps: DepItem[];
  onSubmit: (e: Omit<Exemption, 'id' | 'createdAt'>) => void;
  onCancel: () => void;
}) {
  const [packageName, setPackageName] = useState('');
  const [scope, setScope] = useState<Channel[]>(['closed']);
  const [approver, setApprover] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [reason, setReason] = useState('');
  const ok = packageName.trim() && scope.length > 0 && approver.trim() && expiresOn && reason.trim();
  const toggle = (c: Channel) => setScope(cs => cs.includes(c) ? cs.filter(x => x !== c) : [...cs, c]);
  return (
    <div className="form-card">
      <div className="form-grid">
        <label>依赖名称
          <input list="dep-names-ex" value={packageName} onChange={e => setPackageName(e.target.value)} placeholder="如 ui-kit-internal" />
          <datalist id="dep-names-ex">{deps.map(d => <option key={d.id} value={d.name} />)}</datalist>
        </label>
        <label>审批人
          <input value={approver} onChange={e => setApprover(e.target.value)} placeholder="如 王敏（法务）" />
        </label>
        <label>失效日
          <input type="date" value={expiresOn} onChange={e => setExpiresOn(e.target.value)} />
        </label>
        <label>豁免事由
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="说明豁免背景与收敛计划" />
        </label>
      </div>
      <div className="chan-pick">
        <span>适用范围</span>
        {CHANNELS.map(c => (
          <button key={c.id} className={scope.includes(c.id) ? 'chip active' : 'chip'} onClick={() => toggle(c.id)}>{c.label}</button>
        ))}
      </div>
      <div className="form-actions">
        <button className="secondary" onClick={onCancel}>取消</button>
        <button className="primary" disabled={!ok} onClick={() => onSubmit({ packageName: packageName.trim(), scope, approver: approver.trim(), expiresOn, reason: reason.trim() })}>保存豁免</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// 批次与审核
// ------------------------------------------------------------

function BatchesTab({ batches, viewed, onSelect, licenses, exemptions, today, currentApproved, onApprove, onExport }: {
  batches: Batch[]; viewed: Batch; onSelect: (id: string) => void;
  licenses: CommercialLicense[]; exemptions: Exemption[]; today: string;
  currentApproved: Batch | null;
  onApprove: (batchId: string, reviewer: string) => void;
  onExport: () => void;
}) {
  const idx = batches.indexOf(viewed);
  const prev = idx > 0 ? batches[idx - 1] : null;
  const diff = useMemo(
    () => diffBatches(prev, viewed, licenses, exemptions, today),
    [prev, viewed, licenses, exemptions, today],
  );
  const evals = useMemo(
    () => viewed.items.map(d => evaluateDep(d, licenses, exemptions, today)),
    [viewed, licenses, exemptions, today],
  );
  const sum = summarize(evals);
  const isCurrentApproved = currentApproved?.id === viewed.id;
  const exportable = viewed.status === 'approved' && isCurrentApproved;
  return (
    <div className="batch-layout">
      <section className="panel batch-list">
        <h2>批次记录</h2>
        <p className="sub">每次导入生成新批次，历史批次保留可回溯。</p>
        {[...batches].reverse().map(b => (
          <button key={b.id} className={b.id === viewed.id ? 'batch-item active' : 'batch-item'} onClick={() => onSelect(b.id)}>
            <div className="batch-line">
              <strong>批次 #{b.seq}</strong>
              <em className={`badge ${b.status === 'approved' ? 'pass' : 'review'}`}>
                {b.status === 'approved' ? <BadgeCheck size={12} /> : <CircleAlert size={12} />}
                {b.status === 'approved' ? '已审核' : '待审核'}
              </em>
            </div>
            <small>{b.importedAt} · {b.items.length} 项依赖</small>
            {b.reviewedBy && <small>审核人 {b.reviewedBy} · {b.reviewedAt}</small>}
            {currentApproved?.id === b.id && <i className="current-tag">当前可导出</i>}
          </button>
        ))}
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>批次 #{viewed.seq} {viewed.status === 'approved' ? '已审核' : '待审核'}</h2>
            <p className="sub">
              {viewed.importedAt} 导入 · {viewed.items.length} 项依赖 ·
              阻断 {sum.blocked} · 待复核 {sum.review} · 放行 {sum.pass}
            </p>
          </div>
          <button
            className="primary" disabled={!exportable}
            title={exportable ? '导出该批次门禁报告' : viewed.status !== 'approved' ? '待审核批次不可导出' : '只有当前已审核批次可导出'}
            onClick={onExport}
          ><Download size={15} />导出该批次</button>
        </div>

        {viewed.status === 'pending' && (
          <ApproveBox blocked={sum.blocked} onApprove={name => onApprove(viewed.id, name)} />
        )}
        {viewed.status === 'approved' && !isCurrentApproved && (
          <div className="note"><BookOpenCheck size={14} />该批次已被更新的已审核批次取代，仅当前已审核批次 #{currentApproved?.seq} 可导出。</div>
        )}

        <h3 className="diff-title">与上一批次差异{prev ? `（对比批次 #${prev.seq}）` : '（首个批次，无对比基线）'}</h3>
        <DiffView diff={diff} />
      </section>
    </div>
  );
}

function ApproveBox({ blocked, onApprove }: { blocked: number; onApprove: (reviewer: string) => void }) {
  const [reviewer, setReviewer] = useState('');
  return (
    <div className="approve-box">
      <div className="approve-head">
        <BookOpenCheck size={16} />
        <div>
          <strong>批次审核</strong>
          <p>审核通过后成为当前已审核批次，方可导出发行门禁报告。</p>
        </div>
      </div>
      {blocked > 0 && (
        <div className="note warn"><AlertTriangle size={14} />仍存在 {blocked} 项阻断结论，请确认已通过商业授权或豁免收敛，再继续审核。</div>
      )}
      <div className="approve-actions">
        <input value={reviewer} onChange={e => setReviewer(e.target.value)} placeholder="审核人（如 李雷（发布经理））" />
        <button className="primary" disabled={!reviewer.trim()} onClick={() => onApprove(reviewer.trim())}>
          <BadgeCheck size={15} />审核通过
        </button>
      </div>
    </div>
  );
}

function DiffView({ diff }: { diff: BatchDiff }) {
  const groups: { title: string; cls: string; entries: { name: string; detail: string }[] }[] = [
    {
      title: `新增依赖（${diff.added.length}）`, cls: 'added',
      entries: diff.added.map(d => ({
        name: d.name,
        detail: `${d.to!.dep.version} · ${normalizeLicense(d.to!.dep.license)} · 结论 ${VERDICT_LABEL[d.to!.overall]}`,
      })),
    },
    {
      title: `移除依赖（${diff.removed.length}）`, cls: 'removed',
      entries: diff.removed.map(d => ({
        name: d.name,
        detail: `${d.from!.dep.version} · ${normalizeLicense(d.from!.dep.license)} · 原结论 ${VERDICT_LABEL[d.from!.overall]}`,
      })),
    },
    {
      title: `结论变化（${diff.changed.length}）`, cls: 'changed',
      entries: diff.changed.map(d => ({
        name: d.name,
        detail: [
          d.from!.overall !== d.to!.overall ? `${VERDICT_LABEL[d.from!.overall]} → ${VERDICT_LABEL[d.to!.overall]}` : '结论不变',
          d.note,
        ].filter(Boolean).join(' · '),
      })),
    },
  ];
  return (
    <div className="diff-grid">
      {groups.map(g => (
        <div key={g.title} className={`diff-col ${g.cls}`}>
          <h4>{g.title}</h4>
          {g.entries.length === 0 && <p className="none">无</p>}
          {g.entries.map(en => (
            <div key={en.name} className="diff-item">
              <strong>{en.name}</strong>
              <small>{en.detail}</small>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------
// 导入清单
// ------------------------------------------------------------

function ImportModal({ onClose, onImport }: { onClose: () => void; onImport: (items: DepItem[]) => void }) {
  const [text, setText] = useState(IMPORT_EXAMPLE);
  const fileRef = useRef<HTMLInputElement>(null);
  const { items: parsed, error } = useMemo(() => {
    try {
      return { items: parseManifest(text), error: '' };
    } catch (err) {
      return { items: [] as DepItem[], error: `解析失败：${err instanceof Error ? err.message : '格式不正确'}` };
    }
  }, [text]);
  const readFile = (f: File | undefined) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setText(String(r.result ?? ''));
    r.readAsText(f);
  };
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>导入依赖清单</h2>
            <p className="sub">导入后生成新的待审核批次，历史批次保留并自动比对差异。</p>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={17} /></button>
        </div>
        <textarea
          className="manifest" spellCheck={false} value={text} onChange={e => setText(e.target.value)}
          placeholder={'每行一个依赖：名称@版本 许可证 [用途]\n例如 react@18.3.1 MIT runtime\n或直接粘贴 package.json 内容'}
        />
        <div className="import-foot">
          <input ref={fileRef} type="file" accept=".txt,.json,.csv,.lock" hidden onChange={e => readFile(e.target.files?.[0])} />
          <button className="secondary" onClick={() => fileRef.current?.click()}><FileUp size={15} />选择文件</button>
          <span className={error ? 'parse-info err' : 'parse-info'}>
            {error || `已识别 ${parsed.length} 项依赖`}
          </span>
          <button className="primary" disabled={parsed.length === 0} onClick={() => onImport(parsed)}>
            生成待审核批次
          </button>
        </div>
      </div>
    </div>
  );
}

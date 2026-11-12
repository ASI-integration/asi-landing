'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { EngineLiveStatus, EnginePrStatus } from '@/lib/engine-progress/live-contract';

type ResponsePayload = { ok: boolean; live?: EngineLiveStatus };
const names: Record<string,string> = {
  'asi-v14-g2-host-error-recovery': 'Host error recovery',
  'asi-v14-g2-json-boundary': 'JSON boundaries',
  'asi-v14-g2-unicode-normalization': 'Unicode validation',
  'asi-v14-g2-patch-safety': 'Patch safety',
  'asi-v14-g2-marker-classification': 'Marker classification',
};
function friendly(state: string): string {
  return ({ RUNNING:'Processing', PENDING:'Queued', CI_PENDING:'CI running',
    CI_PASS:'CI passed', CI_FAILED:'CI failed', MERGED:'Merged to main',
    READY_FOR_MERGE:'Ready to merge', BRANCH_REFRESH_PENDING:'Refreshing branch',
    UNKNOWN_NO_REPLAY:'Needs investigation',
  } as Record<string,string>)[state] ?? state.replace(/_/g,' ').toLowerCase();
}
function stateStyle(state: string) {
  if (state === 'CI_PASS' || state === 'MERGED') return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  if (state === 'RUNNING' || state === 'CI_PENDING') return 'bg-sky-50 text-sky-800 border-sky-200';
  if (state === 'PENDING') return 'bg-slate-100 text-slate-600 border-slate-200';
  return 'bg-amber-50 text-amber-800 border-amber-200';
}
function ciStyle(state: EnginePrStatus['ci']) {
  if (state === 'passed') return 'text-emerald-700';
  if (state === 'failed') return 'text-rose-700';
  if (state === 'pending') return 'text-blue-700';
  return 'text-slate-500';
}
function formatDate(iso: string | null | undefined) {
  return iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleString() : 'Not available';
}
function Stat({title,value,note}:{title:string;value:string;note:string}) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{title}</p>
    <p className="mt-3 text-3xl font-bold tracking-tight text-slate-900">{value}</p>
    <p className="mt-1 text-xs leading-5 text-slate-500">{note}</p>
  </div>;
}

export default function EngineLiveClient() {
  const [data,setData]=useState<EngineLiveStatus|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [checkedAt,setCheckedAt]=useState<string|null>(null);
  const generation=useRef(0);

  const refresh=useCallback(async()=>{
    const request=++generation.current;
    setLoading(true);
    try {
      const res=await fetch('/api/dashboard/engine-progress',
        {method:'GET',credentials:'include',cache:'no-store'});
      if(!res.ok) throw new Error(res.status===401||res.status===403
        ? 'Development-owner login required.' : 'Monitoring endpoint unavailable.');
      const payload=await res.json() as ResponsePayload;
      if(!payload.ok||!payload.live) throw new Error('No Engine live snapshot available.');
      if(request!==generation.current)return;
      setData(payload.live);setError('');setCheckedAt(new Date().toISOString());
    }catch(e){
      if(request===generation.current)setError(e instanceof Error?e.message:'Unable to check engine.');
    }finally{
      if(request===generation.current)setLoading(false);
    }
  },[]);
  useEffect(()=>{
    void refresh();
    const timer=window.setInterval(()=>{
      if(document.visibilityState==='visible')void refresh();
    },15000);
    const onFocus=()=>void refresh();
    window.addEventListener('focus',onFocus);
    return()=>{window.clearInterval(timer);window.removeEventListener('focus',onFocus);++generation.current;};
  },[refresh]);

  const workers=data?.workers??[];
  const healthy=Boolean(data?.available&&!data.stale);
  const failures=workers.filter(w=>/FAILED|UNKNOWN|BLOCKED|REJECTED/.test(w.state)).length;
  const progress=workers.filter(w=>w.state==='RUNNING').length;
  const totalPR=data?.prs.length??0;

  return <main className="mx-auto max-w-[1500px] space-y-6 pb-12 text-slate-900">
    <header className="relative overflow-hidden rounded-3xl bg-slate-950 p-6 text-white shadow-lg md:p-9">
      <div aria-hidden="true" className="absolute -right-28 -top-28 h-80 w-80 rounded-full bg-cyan-500/10 blur-3xl"/>
      <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.23em] text-cyan-300">ASI / Engineering operations</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">Engine live monitor</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">
            {data?.campaign === 'ASI_V15_20261112'
              ? 'ASI V15 · Continuous five-agent queue · Wave ' + (data.wave ?? '?') + '/3 · one.com VPS'
              : 'ASI V14 recovery · Saved Codex edits → Grok review → Draft PR → CI · one.com VPS'}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <span className={'rounded-full border px-3 py-1.5 text-xs font-semibold ' +
              (healthy?'border-emerald-500/40 bg-emerald-400/10 text-emerald-300':
                'border-amber-500/40 bg-amber-400/10 text-amber-200')}>
              {healthy?'FEED CONNECTED':data?.available?'STALE REPORT':'SOURCE UNAVAILABLE'}
            </span>
            <span className="text-xs text-slate-400">Owner access · Refresh every 15s</span>
          </div>
        </div>
        <button type="button" onClick={()=>void refresh()} disabled={loading}
          className="rounded-xl border border-slate-600 bg-slate-800 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60">
          {loading?'Checking…':'Refresh now'}
        </button>
      </div>
    </header>

    {error&&<div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}
    {data&&!data.available&&<div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
      <strong>Private status source not connected.</strong> {data.reason}
      <p className="mt-2">Configure a read-only GitHub token on the Vercel server. No credentials are sent to the browser.</p>
    </div>}
    {data?.available&&data.stale&&<div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      The last VPS report is older than the reporting interval. The states below are historical, not proof of current worker liveness.
    </div>}
    {data?.available&&failures>0&&<div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-900">
      <strong>{failures} of 5 agent tasks need attention.</strong> Their latest reported state is blocked,
      failed or uncertain. A healthy connection to GitHub does not mean these agents are producing code.
      Unknown model outcomes must not be replayed automatically.
    </div>}

    <section aria-label="Fleet summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat title="Workers" value={data?.available?workers.length+'/5':'—'} note={progress+' processing · '+failures+' need attention'}/>
      <Stat title={data?.campaign === "ASI_V15_20261112" ? "Model calls" : "Grok reviews"} value={data?.modelReservations!=null?data.modelReservations+'/'+data.modelLimit:'—'} note={data?.campaign === "ASI_V15_20261112" ? "Capped Codex + Grok reservations; not billed totals" : "New Grok reservations; zero Codex replays"}/>
      <Stat title="GitHub effects" value={data?.githubReservations!=null?data.githubReservations+'/'+data.githubLimit:'—'} note="Push and PR reservations"/>
      <Stat title="Draft PRs" value={data?.available?String(totalPR):'—'} note="Verified against PR head checks"/>
    </section>

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_350px]">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-7">
        <h2 className="text-xl font-bold">Five-agent fleet</h2>
        <p className="mt-1 text-sm text-slate-500">Latest source-reported task state for each independent slot.</p>
        <div className="mt-6 space-y-3">
          {workers.length===0&&<p className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">No verified fleet report yet.</p>}
          {workers.map(w=><div key={w.slot} className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 sm:flex-nowrap">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-900 font-mono text-lg font-bold text-white">
              {String(w.slot).padStart(2,'0')}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold">{names[w.taskId]??(w.taskId.startsWith('asi-v15-w') ? w.taskId.replace(/^asi-v15-w\d{2}-/, '').replace(/-/g, ' ') : w.taskId)}</h3>
              <p className="mt-1 break-all font-mono text-[11px] text-slate-500">{w.taskId}</p>
            </div>
            <span className={'rounded-full border px-3 py-1.5 text-xs font-semibold '+stateStyle(w.state)}>{friendly(w.state)}</span>
          </div>)}
        </div>
      </section>
      <aside className="space-y-5">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold">Source freshness</h2>
          <dl className="mt-5 space-y-4 text-sm">
            <div><dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">Last VPS report</dt><dd className="mt-1 font-semibold">{formatDate(data?.lastReportAt)}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">Last website check</dt><dd className="mt-1">{formatDate(checkedAt)}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">Data channel</dt><dd className="mt-1">Private GitHub Engine receipts</dd></div>
          </dl>
          {data?.reportUrl&&<a href={data.reportUrl} target="_blank" rel="noopener noreferrer"
            className="mt-5 inline-block text-sm font-bold text-blue-700 underline">Open source report</a>}
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold">Release scope</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Current engineering campaign: <strong>S4-G2</strong>.
            G3–G6 are separate future stages and are not release-accepted yet.</p>
          <Link href="/dashboard/strigunov-gps" className="mt-4 block rounded-xl bg-slate-50 px-4 py-3 text-sm font-bold text-blue-700 hover:bg-blue-50">
            Strigunov release GPS
          </Link>
          <Link href="/dashboard/engine-progress" className="mt-2 block rounded-xl bg-slate-50 px-4 py-3 text-sm font-bold text-blue-700 hover:bg-blue-50">
            Engine roadmap
          </Link>
        </div>
      </aside>
    </div>

    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-7">
      <h2 className="text-xl font-bold">Draft PRs & CI results</h2>
      <p className="mt-2 text-sm text-slate-500">All checks refer to the current PR head; missing or failed CI never counts as success.</p>
      {totalPR===0?<div className="mt-6 rounded-2xl border border-dashed border-slate-300 px-5 py-10 text-center text-sm text-slate-500">No V14 Draft PR has been reported yet.</div>:
        <div className="mt-5 overflow-x-auto"><table className="min-w-[580px] w-full text-left text-sm">
          <thead><tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <th className="p-3">Pull request</th><th className="p-3">Release gate</th><th className="p-3">Source validation</th><th className="p-3">CI</th>
          </tr></thead>
          <tbody>{(data?.prs??[]).map((pr:EnginePrStatus)=><tr key={pr.number} className="border-b border-slate-100 last:border-0">
            <td className="p-3"><a href={pr.url} target="_blank" rel="noopener noreferrer" className="font-bold text-blue-700 underline">#{pr.number}</a>
              <div className="mt-1 text-xs text-slate-500">{pr.isMerged?'Merged into main':pr.isDraft?'Draft':'Open (not draft)'}</div>
            </td>
            <td className={'p-3 font-semibold capitalize '+ciStyle(pr.releaseGovernance)}>{pr.releaseGovernance}</td>
            <td className={'p-3 font-semibold capitalize '+ciStyle(pr.sourceValidation)}>{pr.sourceValidation}</td>
            <td className={'p-3 font-semibold capitalize '+ciStyle(pr.ci)}>{pr.ci}</td>
          </tr>)}</tbody>
        </table></div>}
    </section>
    <p className="text-xs leading-5 text-slate-500">Read-only monitor. GitHub task transitions are checked every 15 seconds; this is not a direct one-second VPS stream.
      Model calls are reservations, not confirmed billing. No commands here can start, stop, merge, or deploy software.</p>
  </main>;
}

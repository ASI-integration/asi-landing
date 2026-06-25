'use client';

/**
 * /asi/operator-leads  — Operator lead review page
 *
 * Shows all guest_issue / checkin_ready ops_tasks so the operator can:
 *   - Review lead details (property, chat_id, description, priority)
 *   - Update status: open → in_progress → resolved
 *   - Add operator notes
 *   - Set a follow-up date
 *   - Open linked location analysis (links to home page demo or direct API)
 *
 * Auth: client-side fetch; the API (/api/operator/leads) requires a valid
 * iron-session. If not logged in, the API returns 401 and this page shows
 * a redirect prompt.
 */

import { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Lead {
  leadId:          string;
  property_id:     string;
  reservation_id:  string | null;
  chat_id:         number | null;
  task_type:       string;
  status:          string;
  title:           string;
  description:     string | null;
  priority:        string;
  internalNote:    string | null;
  followUpNeeded:  string | null;
  attachment_refs: AttachmentRef[] | null;
  source_event:    string | null;
  trigger_reason:  string | null;
  created_at:      string;
  updated_at:      string;
}

interface AttachmentRef {
  type:     'photo' | 'document' | 'link' | 'note';
  label:    string;
  url?:     string;
  caption?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_COLOR: Record<string, string> = {
  emergency:    'bg-red-100 text-red-800',
  urgent:       'bg-orange-100 text-orange-800',
  normal:       'bg-blue-100 text-blue-800',
  informational:'bg-gray-100 text-gray-700',
};

const STATUS_COLOR: Record<string, string> = {
  open:        'bg-yellow-100 text-yellow-800',
  in_progress: 'bg-blue-100 text-blue-800',
  resolved:    'bg-green-100 text-green-800',
  canceled:    'bg-gray-100 text-gray-500',
};

const STATUS_LABELS: Record<string, string> = {
  open:        'Открыт',
  in_progress: 'В работе',
  resolved:    'Решён',
  canceled:    'Отменён',
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 2)  return 'только что';
  if (mins < 60) return `${mins} мин. назад`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs} ч назад`;
  return `${Math.floor(hrs / 24)} дн. назад`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OperatorLeadsPage() {
  const [leads, setLeads]             = useState<Lead[]>([]);
  const [loading, setLoading]         = useState(true);
  const [authError, setAuthError]     = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [expandedId, setExpandedId]   = useState<string | null>(null);
  const [editNote, setEditNote]       = useState<Record<string, string>>({});
  const [editFollowUp, setEditFollowUp] = useState<Record<string, string>>({});
  const [saving, setSaving]           = useState<string | null>(null);
  const [analyzeAddress, setAnalyzeAddress] = useState<string>('');
  const [analysisResult, setAnalysisResult] = useState<Record<string, unknown> | null>(null);
  const [analyzing, setAnalyzing]     = useState(false);

  // ── Fetch leads ─────────────────────────────────────────────────────────────
  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const url = statusFilter
        ? `/api/operator/leads?status=${encodeURIComponent(statusFilter)}`
        : '/api/operator/leads';
      const res = await fetch(url);
      if (res.status === 401) { setAuthError(true); return; }
      const data = await res.json() as { ok: boolean; leads?: Lead[] };
      if (data.ok) setLeads(data.leads ?? []);
    } catch {
      // network error — keep existing state
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void fetchLeads(); }, [fetchLeads]);

  // ── Update lead ──────────────────────────────────────────────────────────────
  async function updateLead(
    leadId: string,
    patch: { status?: string; internalNote?: string; followUpNeeded?: string },
  ) {
    setSaving(leadId);
    try {
      const res = await fetch('/api/operator/leads', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ leadId, ...patch }),
      });
      const data = await res.json() as { ok: boolean; lead?: Lead };
      if (data.ok && data.lead) {
        setLeads(prev => prev.map(l => l.leadId === leadId ? data.lead! : l));
      }
    } finally {
      setSaving(null);
    }
  }

  // ── Location analysis ────────────────────────────────────────────────────────
  async function runAnalysis() {
    if (!analyzeAddress.trim()) return;
    setAnalyzing(true);
    setAnalysisResult(null);
    try {
      const res = await fetch('/api/location-analyze', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ address: analyzeAddress }),
      });
      const data = await res.json() as Record<string, unknown>;
      setAnalysisResult(data);
    } catch {
      setAnalysisResult({ error: 'Не удалось запустить анализ' });
    } finally {
      setAnalyzing(false);
    }
  }

  // ── Auth error ────────────────────────────────────────────────────────────────
  if (authError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-slate-700 font-medium">Для доступа необходимо войти в систему.</p>
          <a href="/login" className="inline-block px-5 py-2.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 transition-colors">
            Войти
          </a>
        </div>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 py-10 space-y-8">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Заявки / обращения</h1>
            <p className="text-sm text-slate-500 mt-1">Обращения гостей, требующие внимания оператора</p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700"
            >
              <option value="">Все статусы</option>
              <option value="open">Открытые</option>
              <option value="in_progress">В работе</option>
              <option value="resolved">Решённые</option>
            </select>
            <button
              onClick={() => void fetchLeads()}
              className="text-sm px-3 py-1.5 border border-slate-200 bg-white rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Обновить
            </button>
          </div>
        </div>

        {/* Location analysis panel */}
        <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-700">Локационный анализ</h2>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Введите адрес объекта..."
              value={analyzeAddress}
              onChange={e => setAnalyzeAddress(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void runAnalysis()}
              className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
            <button
              onClick={() => void runAnalysis()}
              disabled={analyzing || !analyzeAddress.trim()}
              className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-700 disabled:opacity-40 transition-colors"
            >
              {analyzing ? 'Анализ...' : 'Рассчитать'}
            </button>
          </div>
          {analysisResult && (
            <div className="bg-slate-50 rounded-lg p-4 text-sm space-y-2">
              {('error' in analysisResult) ? (
                <p className="text-red-600">{String(analysisResult.error)}</p>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">
                      {String(analysisResult.bandLabel ?? analysisResult.band)}
                    </span>
                    <span className="text-2xl font-bold text-slate-900">
                      {String(analysisResult.score)}<span className="text-sm font-normal text-slate-500">/100</span>
                    </span>
                  </div>
                  <p className="text-slate-500 text-xs">
                    Источник: {analysisResult.source === 'cache' ? 'кэш' : 'расчёт'}
                    {' · '}{String(analysisResult.address)}
                  </p>
                  {Array.isArray(analysisResult.metrics) && (
                    <div className="grid grid-cols-2 gap-1.5 mt-2">
                      {(analysisResult.metrics as Array<{ label: string; value: number }>).map(m => (
                        <div key={m.label} className="flex justify-between text-xs">
                          <span className="text-slate-600 truncate">{m.label}</span>
                          <span className="font-medium text-slate-900 ml-2">{m.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </section>

        {/* Leads list */}
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-6 h-6 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin" />
          </div>
        ) : leads.length === 0 ? (
          <div className="text-center py-20 text-slate-400 text-sm">Нет обращений по выбранному фильтру</div>
        ) : (
          <div className="space-y-3">
            {leads.map(lead => (
              <div key={lead.leadId} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                {/* Summary row */}
                <button
                  className="w-full text-left px-5 py-4 flex items-start gap-4 hover:bg-slate-50 transition-colors"
                  onClick={() => setExpandedId(expandedId === lead.leadId ? null : lead.leadId)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PRIORITY_COLOR[lead.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                        {lead.priority}
                      </span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[lead.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABELS[lead.status] ?? lead.status}
                      </span>
                      {lead.attachment_refs && lead.attachment_refs.length > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
                          {lead.attachment_refs.length} вложений
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 font-medium text-slate-900 text-sm leading-snug">{lead.title}</p>
                    {lead.description && (
                      <p className="mt-0.5 text-sm text-slate-500 truncate">{lead.description}</p>
                    )}
                  </div>
                  <div className="text-right text-xs text-slate-400 shrink-0 mt-0.5 space-y-0.5">
                    <div>{relativeTime(lead.created_at)}</div>
                    {lead.chat_id && <div>chat {lead.chat_id}</div>}
                    <div className="text-slate-300">{lead.property_id}</div>
                  </div>
                </button>

                {/* Expanded detail */}
                {expandedId === lead.leadId && (
                  <div className="border-t border-slate-100 px-5 py-4 space-y-4 bg-slate-50/40">

                    {/* Attachments */}
                    {lead.attachment_refs && lead.attachment_refs.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-slate-500 mb-2">Вложения</p>
                        <div className="flex flex-wrap gap-2">
                          {lead.attachment_refs.map((ref, i) => (
                            <div key={i} className="text-xs bg-white border border-slate-200 rounded-lg px-3 py-1.5 flex items-center gap-1.5">
                              <span className="text-slate-400">
                                {ref.type === 'photo' ? '🖼' : ref.type === 'document' ? '📄' : ref.type === 'link' ? '🔗' : '📝'}
                              </span>
                              {ref.url ? (
                                <a href={ref.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                                  {ref.label}
                                </a>
                              ) : (
                                <span className="text-slate-700">{ref.label}</span>
                              )}
                              {ref.caption && <span className="text-slate-400">— {ref.caption}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Status actions */}
                    <div>
                      <p className="text-xs font-semibold text-slate-500 mb-2">Статус</p>
                      <div className="flex gap-2 flex-wrap">
                        {['open', 'in_progress', 'resolved'].map(s => (
                          <button
                            key={s}
                            disabled={lead.status === s || saving === lead.leadId}
                            onClick={() => void updateLead(lead.leadId, { status: s })}
                            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors font-medium ${
                              lead.status === s
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                            } disabled:opacity-40`}
                          >
                            {STATUS_LABELS[s]}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Note */}
                    <div>
                      <p className="text-xs font-semibold text-slate-500 mb-2">Заметка оператора</p>
                      <textarea
                        rows={2}
                        value={editNote[lead.leadId] ?? lead.internalNote ?? ''}
                        onChange={e => setEditNote(prev => ({ ...prev, [lead.leadId]: e.target.value }))}
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
                        placeholder="Добавить заметку..."
                      />
                    </div>

                    {/* Follow-up */}
                    <div>
                      <p className="text-xs font-semibold text-slate-500 mb-2">Follow-up</p>
                      <input
                        type="datetime-local"
                        value={editFollowUp[lead.leadId] ?? (lead.followUpNeeded ? lead.followUpNeeded.slice(0, 16) : '')}
                        onChange={e => setEditFollowUp(prev => ({ ...prev, [lead.leadId]: e.target.value }))}
                        className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
                      />
                    </div>

                    {/* Save */}
                    <div className="flex justify-end">
                      <button
                        disabled={saving === lead.leadId}
                        onClick={() => void updateLead(lead.leadId, {
                          internalNote:  editNote[lead.leadId] ?? lead.internalNote ?? undefined,
                          followUpNeeded: editFollowUp[lead.leadId]
                            ? new Date(editFollowUp[lead.leadId]).toISOString()
                            : undefined,
                        })}
                        className="text-sm px-4 py-2 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-700 disabled:opacity-40 transition-colors"
                      >
                        {saving === lead.leadId ? 'Сохранение...' : 'Сохранить'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

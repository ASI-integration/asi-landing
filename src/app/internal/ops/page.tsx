'use client';

import { useState, useCallback, type FormEvent } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiResult {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function useAdminFetch(secret: string) {
  const call = useCallback(
    async (path: string, options: RequestInit = {}): Promise<ApiResult> => {
      const res = await fetch(path, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': secret,
          ...(options.headers ?? {}),
        },
      });
      try {
        return (await res.json()) as ApiResult;
      } catch {
        return { ok: false, error: `HTTP ${res.status}` };
      }
    },
    [secret],
  );
  return call;
}

function Result({ data }: { data: ApiResult | null }) {
  if (!data) return null;
  const isOk = data.ok !== false && !data.error;
  return (
    <pre
      className={`mt-2 p-3 rounded text-xs whitespace-pre-wrap break-all border ${
        isOk ? 'bg-green-50 border-green-200 text-green-900' : 'bg-red-50 border-red-200 text-red-900'
      }`}
    >
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-gray-200 rounded-lg p-5">
      <h2 className="text-base font-semibold text-gray-800 mb-4 pb-2 border-b border-gray-100">{title}</h2>
      {children}
    </section>
  );
}

function Field({
  label,
  id,
  value,
  onChange,
  type = 'text',
  placeholder,
  rows,
  required,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  rows?: number;
  required?: boolean;
}) {
  const cls = 'block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400';
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {rows ? (
        <textarea
          id={id}
          rows={rows}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={cls}
        />
      ) : (
        <input
          id={id}
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={cls}
        />
      )}
    </div>
  );
}

function Btn({
  children,
  loading,
  type = 'submit',
  onClick,
  variant = 'primary',
}: {
  children: React.ReactNode;
  loading?: boolean;
  type?: 'submit' | 'button';
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const base = 'px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50 transition-colors';
  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700',
    secondary: 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  };
  return (
    <button type={type} onClick={onClick} disabled={loading} className={`${base} ${variants[variant]}`}>
      {loading ? 'Loading…' : children}
    </button>
  );
}

// ─── Section A — Property Setup ───────────────────────────────────────────────

function PropertySetup({ fetch, onPropertyIdChange }: { fetch: ReturnType<typeof useAdminFetch>; onPropertyIdChange?: (id: string) => void }) {
  const [f, setF] = useState({
    property_id: '', property_name: '', location: '', check_in_time: '', check_out_time: '',
    wifi_name: '', wifi_password: '', check_in_instructions: '', check_out_instructions: '',
    house_rules: '', property_policy: '', emergency_contacts: '', active: 'true',
  });
  const [res, setRes] = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [readRes, setReadRes] = useState<ApiResult | null>(null);
  const [readLoading, setReadLoading] = useState(false);

  const set = (k: keyof typeof f) => (v: string) => {
    setF(p => ({ ...p, [k]: v }));
    if (k === 'property_id') onPropertyIdChange?.(v);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const body: Record<string, unknown> = { property_id: f.property_id };
    if (f.property_name)            body.property_name = f.property_name;
    if (f.location)                 body.location = f.location;
    if (f.check_in_time)            body.check_in_time = f.check_in_time;
    if (f.check_out_time)           body.check_out_time = f.check_out_time;
    if (f.wifi_name)                body.wifi_name = f.wifi_name;
    if (f.wifi_password)            body.wifi_password = f.wifi_password;
    if (f.check_in_instructions)    body.check_in_instructions = f.check_in_instructions;
    if (f.check_out_instructions)   body.check_out_instructions = f.check_out_instructions;
    if (f.house_rules)              body.house_rules = f.house_rules;
    if (f.property_policy)          body.property_policy = f.property_policy;
    if (f.emergency_contacts)       body.emergency_contacts = f.emergency_contacts;
    body.active = f.active === 'true';
    const r = await fetch('/api/admin/upsert-property-knowledge', {
      method: 'POST', body: JSON.stringify(body),
    });
    setRes(r);
    setLoading(false);
  };

  const handleRead = async () => {
    if (!f.property_id) return;
    setReadLoading(true);
    const r = await fetch(`/api/admin/property-knowledge?property_id=${encodeURIComponent(f.property_id)}`);
    setReadRes(r);
    setReadLoading(false);
  };

  return (
    <Section title="A. Property Setup">
      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="property_id" id="a-pid" value={f.property_id} onChange={set('property_id')} required placeholder="prop_A" />
        <Field label="property_name" id="a-pname" value={f.property_name} onChange={set('property_name')} placeholder="My Apartment" />
        <Field label="city / location" id="a-loc" value={f.location} onChange={set('location')} placeholder="Moscow" />
        <Field label="check_in_time" id="a-ci" value={f.check_in_time} onChange={set('check_in_time')} placeholder="15:00" />
        <Field label="check_out_time" id="a-co" value={f.check_out_time} onChange={set('check_out_time')} placeholder="11:00" />
        <Field label="wifi_name" id="a-wn" value={f.wifi_name} onChange={set('wifi_name')} />
        <Field label="wifi_password" id="a-wp" value={f.wifi_password} onChange={set('wifi_password')} />
        <div className="sm:col-span-2">
          <Field label="check_in_instructions" id="a-cii" value={f.check_in_instructions} onChange={set('check_in_instructions')} rows={2} />
        </div>
        <div className="sm:col-span-2">
          <Field label="check_out_instructions" id="a-coi" value={f.check_out_instructions} onChange={set('check_out_instructions')} rows={2} />
        </div>
        <div className="sm:col-span-2">
          <Field label="house_rules" id="a-hr" value={f.house_rules} onChange={set('house_rules')} rows={2} />
        </div>
        <div className="sm:col-span-2">
          <Field label="property_policy" id="a-pp" value={f.property_policy} onChange={set('property_policy')} rows={2} />
        </div>
        <div className="sm:col-span-2">
          <Field label="support_contact_text (emergency_contacts)" id="a-ec" value={f.emergency_contacts} onChange={set('emergency_contacts')} rows={2} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">active</label>
          <select
            value={f.active}
            onChange={e => set('active')(e.target.value)}
            className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </div>
        <div className="sm:col-span-2 flex gap-2 mt-1">
          <Btn loading={loading}>Upsert Property</Btn>
          <Btn type="button" variant="secondary" loading={readLoading} onClick={handleRead}>
            Read by property_id
          </Btn>
        </div>
      </form>
      <Result data={res} />
      {readRes && <Result data={readRes} />}
    </Section>
  );
}

// ─── Section B — Reservation Setup ───────────────────────────────────────────

function ReservationSetup({ fetch }: { fetch: ReturnType<typeof useAdminFetch> }) {
  const [f, setF] = useState({
    reservation_ref: '', property_id: '', chat_id: '', guest_name: '',
    guest_count: '', check_in: '', check_out: '', status: 'confirmed', note: '',
  });
  const [res, setRes] = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastPayload, setLastPayload] = useState<Record<string, unknown> | null>(null);
  const [readRes, setReadRes] = useState<ApiResult | null>(null);
  const [readLoading, setReadLoading] = useState(false);

  const set = (k: keyof typeof f) => (v: string) => setF(p => ({ ...p, [k]: v }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const body: Record<string, unknown> = {
      reservation_ref: f.reservation_ref,
      property_id:     f.property_id,
      chat_id:         Number(f.chat_id),
    };
    if (f.guest_name)  body.guest_name  = f.guest_name;
    if (f.guest_count) body.guest_count = Number(f.guest_count);
    if (f.check_in)    body.check_in    = f.check_in;
    if (f.check_out)   body.check_out   = f.check_out;
    if (f.status)      body.status      = f.status;
    if (f.note)        body.note        = f.note;
    setLastPayload(body);
    const r = await fetch('/api/admin/upsert-reservation', {
      method: 'POST', body: JSON.stringify(body),
    });
    setRes(r);
    setLoading(false);
  };

  const handleRead = async () => {
    if (!f.reservation_ref && !f.chat_id) return;
    setReadLoading(true);
    const q = f.reservation_ref
      ? `reservation_ref=${encodeURIComponent(f.reservation_ref)}`
      : `chat_id=${encodeURIComponent(f.chat_id)}`;
    const r = await fetch(`/api/admin/reservation?${q}`);
    setReadRes(r);
    setReadLoading(false);
  };

  return (
    <Section title="B. Reservation Setup">
      {/* autoComplete="off" prevents browser autofill from visually populating fields
          without triggering React onChange, which would leave state empty on submit */}
      <form onSubmit={handleSubmit} autoComplete="off" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="reservation_ref" id="b-rr" value={f.reservation_ref} onChange={set('reservation_ref')} required placeholder="RES-001" />
        <Field label="property_id" id="b-pid" value={f.property_id} onChange={set('property_id')} required placeholder="prop_A" />
        <Field label="chat_id (Telegram)" id="b-cid" value={f.chat_id} onChange={set('chat_id')} required placeholder="123456789" type="number" />
        <Field label="guest_name" id="b-gn" value={f.guest_name} onChange={set('guest_name')} />
        <Field label="guest_count" id="b-gc" value={f.guest_count} onChange={set('guest_count')} type="number" />
        <Field label="check_in (YYYY-MM-DD)" id="b-ci" value={f.check_in} onChange={set('check_in')} type="date" />
        <Field label="check_out (YYYY-MM-DD)" id="b-co" value={f.check_out} onChange={set('check_out')} type="date" />
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">status</label>
          <select
            value={f.status}
            onChange={e => set('status')(e.target.value)}
            className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            {['confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'].map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <Field label="note" id="b-note" value={f.note} onChange={set('note')} rows={2} />
        </div>
        <div className="sm:col-span-2 flex gap-2 mt-1">
          <Btn loading={loading}>Upsert Reservation</Btn>
          <Btn type="button" variant="secondary" loading={readLoading} onClick={handleRead}>
            Read reservation
          </Btn>
        </div>
      </form>
      {lastPayload && (
        <details className="mt-2">
          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">Last sent payload</summary>
          <pre className="mt-1 p-2 rounded text-xs bg-gray-50 border border-gray-200 text-gray-700 whitespace-pre-wrap break-all">
            {JSON.stringify(lastPayload, null, 2)}
          </pre>
        </details>
      )}
      <Result data={res} />
      {readRes && <Result data={readRes} />}
    </Section>
  );
}

// ─── Section C — Property Templates ──────────────────────────────────────────

function PropertyTemplates({ fetch, currentPropertyId }: { fetch: ReturnType<typeof useAdminFetch>; currentPropertyId?: string }) {
  const [f, setF] = useState({
    property_id: '', pre_checkin_template: '', checkout_template: '',
    followup_template: '', escalation_contact_text: '',
  });
  const [res, setRes] = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [readRes, setReadRes] = useState<ApiResult | null>(null);
  const [readLoading, setReadLoading] = useState(false);

  const set = (k: keyof typeof f) => (v: string) => setF(p => ({ ...p, [k]: v }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const body: Record<string, unknown> = { property_id: f.property_id };
    if (f.pre_checkin_template)    body.pre_checkin_template    = f.pre_checkin_template;
    if (f.checkout_template)       body.checkout_template       = f.checkout_template;
    if (f.followup_template)       body.followup_template       = f.followup_template;
    if (f.escalation_contact_text) body.escalation_contact_text = f.escalation_contact_text;
    const r = await fetch('/api/admin/upsert-property-templates', {
      method: 'POST', body: JSON.stringify(body),
    });
    setRes(r);
    setLoading(false);
  };

  const handleRead = async () => {
    if (!f.property_id) return;
    setReadLoading(true);
    const r = await fetch(`/api/admin/property-templates?property_id=${encodeURIComponent(f.property_id)}`);
    setReadRes(r);
    setReadLoading(false);
  };

  return (
    <Section title="C. Property Templates">
      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="c-pid" className="block text-xs font-medium text-gray-600">
              property_id<span className="text-red-500 ml-0.5">*</span>
            </label>
            {currentPropertyId && currentPropertyId !== f.property_id && (
              <button
                type="button"
                onClick={() => set('property_id')(currentPropertyId)}
                className="text-xs text-blue-600 hover:underline"
              >
                Use current ({currentPropertyId})
              </button>
            )}
          </div>
          <input
            id="c-pid"
            type="text"
            value={f.property_id}
            onChange={e => set('property_id')(e.target.value)}
            placeholder="prop_A"
            required
            className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400"
          />
        </div>
        <Field label="pre_checkin_template" id="c-pct" value={f.pre_checkin_template} onChange={set('pre_checkin_template')} rows={3} placeholder="Hi {guest_name}, your check-in is tomorrow…" />
        <Field label="checkout_template" id="c-cot" value={f.checkout_template} onChange={set('checkout_template')} rows={3} />
        <Field label="followup_template" id="c-ft" value={f.followup_template} onChange={set('followup_template')} rows={3} />
        <Field label="escalation_contact_text" id="c-ect" value={f.escalation_contact_text} onChange={set('escalation_contact_text')} rows={2} placeholder="For urgent issues call +7 …" />
        <div className="flex gap-2 mt-1">
          <Btn loading={loading}>Upsert Templates</Btn>
          <Btn type="button" variant="secondary" loading={readLoading} onClick={handleRead}>
            Read templates
          </Btn>
        </div>
      </form>
      <Result data={res} />
      {readRes && <Result data={readRes} />}
    </Section>
  );
}

// ─── Section D — Ops Tasks Viewer ─────────────────────────────────────────────

interface OpsTask {
  id: string;
  task_type: string;
  task_status: string;
  title: string;
  due_at: string | null;
  assigned_to: string | null;
  reservation_id: string | null;
  chat_id: number | null;
  operator_note: string | null;
}

function OpsTasksViewer({ fetch }: { fetch: ReturnType<typeof useAdminFetch> }) {
  const [filters, setFilters] = useState({ property_id: '', reservation_id: '', status: '' });
  const [tasks, setTasks] = useState<OpsTask[]>([]);
  const [fetchRes, setFetchRes] = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editData, setEditData] = useState({ task_status: '', assigned_to: '', operator_note: '' });
  const [updateRes, setUpdateRes] = useState<ApiResult | null>(null);
  const [updateLoading, setUpdateLoading] = useState(false);

  const setFilter = (k: keyof typeof filters) => (v: string) => setFilters(p => ({ ...p, [k]: v }));

  const handleFetch = async (e?: FormEvent) => {
    e?.preventDefault();
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.property_id)    params.set('property_id', filters.property_id);
    if (filters.reservation_id) params.set('reservation_id', filters.reservation_id);
    if (filters.status)         params.set('status', filters.status);
    const r = await fetch(`/api/admin/ops-tasks?${params.toString()}`);
    setFetchRes(r);
    if (r.ok && Array.isArray(r.tasks)) setTasks(r.tasks as OpsTask[]);
    else setTasks([]);
    setLoading(false);
  };

  const startEdit = (t: OpsTask) => {
    setEditId(t.id);
    setEditData({ task_status: t.task_status, assigned_to: t.assigned_to ?? '', operator_note: t.operator_note ?? '' });
  };

  const handleUpdate = async () => {
    if (!editId) return;
    setUpdateLoading(true);
    const body: Record<string, unknown> = { task_id: editId };
    if (editData.task_status) body.task_status = editData.task_status;
    body.assigned_to    = editData.assigned_to   || null;
    body.operator_note  = editData.operator_note || null;
    const r = await fetch('/api/admin/update-ops-task', { method: 'POST', body: JSON.stringify(body) });
    setUpdateRes(r);
    setUpdateLoading(false);
    if (r.ok) {
      setEditId(null);
      await handleFetch();
    }
  };

  return (
    <Section title="D. Ops Tasks">
      <form onSubmit={handleFetch} className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Field label="property_id" id="d-pid" value={filters.property_id} onChange={setFilter('property_id')} placeholder="prop_A" />
        <Field label="reservation_id (UUID)" id="d-rid" value={filters.reservation_id} onChange={setFilter('reservation_id')} />
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">status filter</label>
          <select
            value={filters.status}
            onChange={e => setFilter('status')(e.target.value)}
            className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">— all —</option>
            {['open', 'in_progress', 'resolved', 'canceled'].map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-3">
          <Btn loading={loading}>Fetch Tasks</Btn>
        </div>
      </form>

      {fetchRes && !fetchRes.ok && <Result data={fetchRes} />}

      {tasks.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-600">
                {['id (short)', 'type', 'status', 'title', 'due_at', 'assigned', 'res_id', 'chat_id', ''].map(h => (
                  <th key={h} className="border border-gray-200 px-2 py-1 text-left font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tasks.map(t => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="border border-gray-200 px-2 py-1 font-mono">{t.id.slice(0, 8)}</td>
                  <td className="border border-gray-200 px-2 py-1">{t.task_type}</td>
                  <td className="border border-gray-200 px-2 py-1">
                    <span className={`px-1 rounded ${
                      t.task_status === 'open' ? 'bg-yellow-100 text-yellow-800' :
                      t.task_status === 'in_progress' ? 'bg-blue-100 text-blue-800' :
                      t.task_status === 'resolved' ? 'bg-green-100 text-green-800' :
                      'bg-gray-100 text-gray-600'
                    }`}>{t.task_status}</span>
                  </td>
                  <td className="border border-gray-200 px-2 py-1 max-w-[140px] truncate">{t.title}</td>
                  <td className="border border-gray-200 px-2 py-1 whitespace-nowrap">{t.due_at ? t.due_at.slice(0, 10) : '—'}</td>
                  <td className="border border-gray-200 px-2 py-1">{t.assigned_to ?? '—'}</td>
                  <td className="border border-gray-200 px-2 py-1 font-mono">{t.reservation_id ? t.reservation_id.slice(0, 8) : '—'}</td>
                  <td className="border border-gray-200 px-2 py-1">{t.chat_id ?? '—'}</td>
                  <td className="border border-gray-200 px-2 py-1">
                    <button
                      type="button"
                      onClick={() => startEdit(t)}
                      className="text-blue-600 hover:underline text-xs"
                    >
                      edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editId && (
        <div className="mt-4 p-4 border border-blue-200 rounded bg-blue-50">
          <p className="text-xs font-semibold text-blue-800 mb-3">Editing task: <span className="font-mono">{editId.slice(0, 8)}</span></p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">task_status</label>
              <select
                value={editData.task_status}
                onChange={e => setEditData(p => ({ ...p, task_status: e.target.value }))}
                className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                {['open', 'in_progress', 'resolved', 'canceled'].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <Field
              label="assigned_to"
              id="d-assign"
              value={editData.assigned_to}
              onChange={v => setEditData(p => ({ ...p, assigned_to: v }))}
              placeholder="operator name"
            />
            <Field
              label="operator_note"
              id="d-note"
              value={editData.operator_note}
              onChange={v => setEditData(p => ({ ...p, operator_note: v }))}
              placeholder="optional note"
            />
          </div>
          <div className="flex gap-2 mt-3">
            <Btn type="button" loading={updateLoading} onClick={handleUpdate}>Save</Btn>
            <Btn type="button" variant="secondary" onClick={() => setEditId(null)}>Cancel</Btn>
          </div>
          {updateRes && <Result data={updateRes} />}
        </div>
      )}
    </Section>
  );
}

// ─── Section E — Flow Controls ────────────────────────────────────────────────

function FlowControls({ fetch }: { fetch: ReturnType<typeof useAdminFetch> }) {
  const [resolveId, setResolveId] = useState('');
  const [resolveRes, setResolveRes] = useState<ApiResult | null>(null);
  const [resolveLoading, setResolveLoading] = useState(false);

  const [recoverResId, setRecoverResId] = useState('');
  const [recoverRes, setRecoverRes] = useState<ApiResult | null>(null);
  const [recoverLoading, setRecoverLoading] = useState(false);

  const handleResolve = async (e: FormEvent) => {
    e.preventDefault();
    setResolveLoading(true);
    const r = await fetch('/api/admin/resolve-escalation', {
      method: 'POST',
      body: JSON.stringify({ chat_id: Number(resolveId) }),
    });
    setResolveRes(r);
    setResolveLoading(false);
  };

  const handleRecover = async (e: FormEvent) => {
    e.preventDefault();
    setRecoverLoading(true);
    const r = await fetch('/api/admin/recover-stay-flow', {
      method: 'POST',
      body: JSON.stringify({ reservation_id: recoverResId }),
    });
    setRecoverRes(r);
    setRecoverLoading(false);
  };

  return (
    <Section title="E. Flow Controls">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* Resolve escalation / resume flow */}
        <div>
          <h3 className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
            Resolve Escalation / Resume Flow
          </h3>
          <p className="text-xs text-gray-500 mb-3">
            Transitions session from <code>operator_review_required</code> → <code>active</code>.
          </p>
          <form onSubmit={handleResolve} className="flex gap-2">
            <input
              type="number"
              value={resolveId}
              onChange={e => setResolveId(e.target.value)}
              placeholder="chat_id"
              className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400"
            />
            <Btn loading={resolveLoading}>Resolve</Btn>
          </form>
          <Result data={resolveRes} />
        </div>

        {/* Recover missing stay flow */}
        <div>
          <h3 className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
            Recover Missing Stay-Flow Tasks
          </h3>
          <p className="text-xs text-gray-500 mb-3">
            Creates any missing ops tasks for a reservation (pre_arrival_prep, checkin_ready, checkout, turnover).
          </p>
          <form onSubmit={handleRecover} className="flex gap-2">
            <input
              type="text"
              value={recoverResId}
              onChange={e => setRecoverResId(e.target.value)}
              placeholder="reservation_id (UUID)"
              className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400"
            />
            <Btn loading={recoverLoading}>Recover</Btn>
          </form>
          <Result data={recoverRes} />
        </div>
      </div>
    </Section>
  );
}

// ─── Section F — Unit State & Readiness ───────────────────────────────────────

interface UnitStateData {
  current_state: string;
  ready_for_checkin: boolean;
  dirty: boolean;
  blocked_reason: string | null;
  current_reservation_id: string | null;
  last_turnover_completed_at: string | null;
  updated_at: string;
}

interface CheckinGateData {
  allowed: boolean;
  unit_state: string | null;
  blocked_reason: string | null;
  checked_at: string;
}

function UnitStateViewer({ fetch: adminFetch, currentPropertyId }: { fetch: ReturnType<typeof useAdminFetch>; currentPropertyId?: string }) {
  const [propertyId, setPropertyId] = useState('');
  const [loading, setLoading] = useState(false);
  const [unitState, setUnitState] = useState<UnitStateData | null>(null);
  const [checkinGate, setCheckinGate] = useState<CheckinGateData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFetch = async () => {
    const pid = propertyId || currentPropertyId;
    if (!pid) return;
    setLoading(true);
    setError(null);
    const r = await adminFetch(`/api/admin/unit-state?property_id=${encodeURIComponent(pid)}`);
    if (r.ok) {
      setUnitState((r.state as UnitStateData) ?? null);
      setCheckinGate((r.checkin_gate as CheckinGateData) ?? null);
    } else {
      setError(r.error as string ?? 'Failed to fetch');
      setUnitState(null);
      setCheckinGate(null);
    }
    setLoading(false);
  };

  const stateColor = (s: string) => {
    if (s === 'ready') return 'bg-green-100 text-green-800';
    if (s === 'blocked') return 'bg-red-100 text-red-800';
    if (s === 'in_turnover' || s === 'turnover_needed') return 'bg-yellow-100 text-yellow-800';
    return 'bg-gray-100 text-gray-700';
  };

  return (
    <Section title="F. Unit State & Readiness">
      <div className="flex gap-2 mb-4">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="f-pid" className="block text-xs font-medium text-gray-600">
              property_id
            </label>
            {currentPropertyId && currentPropertyId !== propertyId && (
              <button
                type="button"
                onClick={() => setPropertyId(currentPropertyId)}
                className="text-xs text-blue-600 hover:underline"
              >
                Use current ({currentPropertyId})
              </button>
            )}
          </div>
          <input
            id="f-pid"
            type="text"
            value={propertyId}
            onChange={e => setPropertyId(e.target.value)}
            placeholder="prop_A"
            className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400"
          />
        </div>
        <div className="flex items-end">
          <Btn type="button" loading={loading} onClick={handleFetch}>Fetch State</Btn>
        </div>
      </div>

      {error && (
        <pre className="mt-2 p-3 rounded text-xs bg-red-50 border border-red-200 text-red-900">{error}</pre>
      )}

      {unitState && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
          <div className="border border-gray-200 rounded p-3">
            <h3 className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Unit State</h3>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">State</span>
                <span className={`px-1.5 rounded font-medium ${stateColor(unitState.current_state)}`}>
                  {unitState.current_state}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Ready for check-in</span>
                <span className={unitState.ready_for_checkin ? 'text-green-700 font-medium' : 'text-gray-600'}>
                  {unitState.ready_for_checkin ? '✓ Yes' : '✗ No'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Dirty</span>
                <span className={unitState.dirty ? 'text-red-600 font-medium' : 'text-gray-600'}>
                  {unitState.dirty ? '⚠ Yes' : 'No'}
                </span>
              </div>
              {unitState.blocked_reason && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Blocked reason</span>
                  <span className="text-red-700 font-mono">{unitState.blocked_reason}</span>
                </div>
              )}
              {unitState.current_reservation_id && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Reservation</span>
                  <span className="font-mono">{unitState.current_reservation_id.slice(0, 8)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Updated at</span>
                <span className="text-gray-600">{unitState.updated_at?.slice(0, 19) ?? '—'}</span>
              </div>
            </div>
          </div>

          {checkinGate && (
            <div className={`border rounded p-3 ${checkinGate.allowed ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
              <h3 className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Check-in Gate</h3>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">Gate result</span>
                  <span className={`px-1.5 rounded font-semibold ${checkinGate.allowed ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'}`}>
                    {checkinGate.allowed ? '✓ ALLOWED' : '✗ BLOCKED'}
                  </span>
                </div>
                {checkinGate.blocked_reason && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Reason</span>
                    <span className="text-red-700 font-mono">{checkinGate.blocked_reason}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500">Checked at</span>
                  <span className="text-gray-600">{checkinGate.checked_at?.slice(0, 19) ?? '—'}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {!unitState && !error && !loading && (
        <p className="text-xs text-gray-400 mt-2">Enter a property_id and click Fetch State to view unit state and check-in gate status.</p>
      )}
    </Section>
  );
}

// ─── Root Page ────────────────────────────────────────────────────────────────

export default function OpsConsolePage() {
  const [secret, setSecret] = useState('');
  const [committed, setCommitted] = useState(false);
  const [sharedPropertyId, setSharedPropertyId] = useState('');

  const adminFetch = useAdminFetch(committed ? secret : '');

  if (!committed) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow p-8 w-full max-w-sm">
          <h1 className="text-lg font-bold text-gray-900 mb-1">Internal Ops Console</h1>
          <p className="text-sm text-gray-500 mb-6">Enter admin secret to continue.</p>
          <form
            onSubmit={e => { e.preventDefault(); if (secret) setCommitted(true); }}
            className="space-y-4"
          >
            <input
              type="password"
              value={secret}
              onChange={e => setSecret(e.target.value)}
              placeholder="Admin secret"
              autoFocus
              className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
            />
            <button
              type="submit"
              disabled={!secret}
              className="w-full bg-blue-600 text-white rounded py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
            >
              Enter
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Internal Ops Console</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Pilot operator panel — property setup, reservations, ops tasks, flow controls.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setCommitted(false); setSecret(''); }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            sign out
          </button>
        </header>

        <PropertySetup fetch={adminFetch} onPropertyIdChange={setSharedPropertyId} />
        <ReservationSetup fetch={adminFetch} />
        <PropertyTemplates fetch={adminFetch} currentPropertyId={sharedPropertyId} />
        <OpsTasksViewer fetch={adminFetch} />
        <FlowControls fetch={adminFetch} />
        <UnitStateViewer fetch={adminFetch} currentPropertyId={sharedPropertyId} />
      </div>
    </div>
  );
}

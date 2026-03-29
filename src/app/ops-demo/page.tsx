'use client';

import { useState } from 'react';

interface ScenarioResult {
  scenario: string;
  issueType: string;
  severity: string;
  before_state: string;
  after_state: string;
  ready_before: boolean;
  ready_after: boolean;
  can_proceed: boolean;
  decision_block: boolean;
  decision_payer: string;
  decision_comms: string;
  decision_escalate: boolean;
  decision_reasons: string[];
}

interface ApiResponse {
  ok: boolean;
  scenarios?: ScenarioResult[];
  error?: string;
}

type OverridePayer = 'guest' | 'owner' | 'insurance' | 'operator' | 'none';
type OverrideComms = 'silent' | 'soft' | 'warning' | 'escalation';

interface ScenarioOverride {
  enabled: boolean;
  payer: OverridePayer;
  communicationMode: OverrideComms;
  blockCheckin: boolean;
  escalateToHuman: boolean;
}

const defaultOverride = (): ScenarioOverride => ({
  enabled: false,
  payer: 'operator',
  communicationMode: 'soft',
  blockCheckin: false,
  escalateToHuman: false,
});

function BoolBadge({ value }: { value: boolean }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 8px',
      borderRadius: 4,
      fontSize: 12,
      fontWeight: 600,
      background: value ? '#dcfce7' : '#fee2e2',
      color: value ? '#166534' : '#991b1b',
    }}>
      {value ? 'true' : 'false'}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <td style={{ padding: '4px 12px 4px 0', color: '#6b7280', fontSize: 13, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
        {label}
      </td>
      <td style={{ padding: '4px 0', fontSize: 13, fontWeight: 500, verticalAlign: 'middle' }}>
        {children}
      </td>
    </tr>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '4px 7px',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  fontSize: 12,
  background: '#fff',
  cursor: 'pointer',
};

function ScenarioCard({ s }: { s: ScenarioResult }) {
  const [ov, setOv] = useState<ScenarioOverride>(defaultOverride);

  const setField = <K extends keyof ScenarioOverride>(k: K, v: ScenarioOverride[K]) =>
    setOv((prev) => ({ ...prev, [k]: v }));

  const effectiveDecision = ov.enabled
    ? {
        blockCheckin: ov.blockCheckin,
        recommendedPayer: ov.payer,
        communicationMode: ov.communicationMode,
        escalateToHuman: ov.escalateToHuman,
      }
    : {
        blockCheckin: s.decision_block,
        recommendedPayer: s.decision_payer,
        communicationMode: s.decision_comms,
        escalateToHuman: s.decision_escalate,
      };

  const overrideDiff = ov.enabled
    ? {
        blockCheckin: ov.blockCheckin !== s.decision_block,
        payer: ov.payer !== s.decision_payer,
        comms: ov.communicationMode !== s.decision_comms,
        escalate: ov.escalateToHuman !== s.decision_escalate,
      }
    : null;

  return (
    <div style={{
      border: `1px solid ${ov.enabled ? '#a5b4fc' : '#e5e7eb'}`,
      borderRadius: 8,
      padding: '16px 20px',
      background: '#fff',
      marginBottom: 16,
    }}>
      {/* Header */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 15, color: '#111827' }}>
            {s.scenario}
          </span>
          <span style={{ marginLeft: 10, fontSize: 12, color: '#6b7280' }}>
            {s.issueType} · {s.severity}
          </span>
        </div>

        {/* Override toggle */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: ov.enabled ? '#4338ca' : '#6b7280', userSelect: 'none' }}>
          <input
            type="checkbox"
            checked={ov.enabled}
            onChange={(e) => setField('enabled', e.target.checked)}
            style={{ accentColor: '#4338ca' }}
          />
          Override decision
        </label>
      </div>

      {/* Override active banner */}
      {ov.enabled && (
        <div style={{
          marginBottom: 12,
          padding: '5px 10px',
          borderRadius: 4,
          background: '#eef2ff',
          border: '1px solid #c7d2fe',
          fontSize: 12,
          fontWeight: 600,
          color: '#3730a3',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <span>System decision</span>
          <span style={{ color: '#6366f1' }}>→</span>
          <span>Overridden</span>
        </div>
      )}

      {/* Decision table: System + Override columns */}
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th style={{ width: 130 }} />
            <th style={{ textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', paddingBottom: 4 }}>
              System
            </th>
            {ov.enabled && (
              <th style={{ textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#4338ca', textTransform: 'uppercase', letterSpacing: '0.05em', paddingBottom: 4, paddingLeft: 16 }}>
                Override
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {/* after_state / can_proceed — system only, no override */}
          <tr>
            <td style={{ padding: '4px 12px 4px 0', color: '#6b7280', fontSize: 13, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>after_state</td>
            <td style={{ padding: '4px 0', fontSize: 13, fontWeight: 500, verticalAlign: 'middle' }}>
              <code style={{ background: '#f3f4f6', padding: '1px 6px', borderRadius: 3 }}>{s.after_state}</code>
            </td>
            {ov.enabled && <td />}
          </tr>
          <tr>
            <td style={{ padding: '4px 12px 4px 0', color: '#6b7280', fontSize: 13, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>can_proceed</td>
            <td style={{ padding: '4px 0', fontSize: 13, fontWeight: 500, verticalAlign: 'middle' }}><BoolBadge value={s.can_proceed} /></td>
            {ov.enabled && <td />}
          </tr>

          {/* decision_block */}
          <tr>
            <td style={{ padding: '4px 12px 4px 0', color: '#6b7280', fontSize: 13, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>decision_block</td>
            <td style={{ padding: '4px 0', fontSize: 13, fontWeight: 500, verticalAlign: 'middle' }}><BoolBadge value={s.decision_block} /></td>
            {ov.enabled && (
              <td style={{ paddingLeft: 16, verticalAlign: 'middle' }}>
                <BoolBadge value={ov.blockCheckin} />
              </td>
            )}
          </tr>

          {/* decision_payer */}
          <tr>
            <td style={{ padding: '4px 12px 4px 0', color: '#6b7280', fontSize: 13, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>decision_payer</td>
            <td style={{ padding: '4px 0', fontSize: 13, fontWeight: 500, verticalAlign: 'middle' }}>{s.decision_payer}</td>
            {ov.enabled && (
              <td style={{ paddingLeft: 16, verticalAlign: 'middle' }}>
                <code style={{ fontSize: 12, fontWeight: 600, color: '#4338ca' }}>{ov.payer}</code>
              </td>
            )}
          </tr>

          {/* decision_comms */}
          <tr>
            <td style={{ padding: '4px 12px 4px 0', color: '#6b7280', fontSize: 13, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>decision_comms</td>
            <td style={{ padding: '4px 0', fontSize: 13, fontWeight: 500, verticalAlign: 'middle' }}>{s.decision_comms}</td>
            {ov.enabled && (
              <td style={{ paddingLeft: 16, verticalAlign: 'middle' }}>
                <code style={{ fontSize: 12, fontWeight: 600, color: '#4338ca' }}>{ov.communicationMode}</code>
              </td>
            )}
          </tr>

          {/* decision_escalate */}
          <tr>
            <td style={{ padding: '4px 12px 4px 0', color: '#6b7280', fontSize: 13, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>decision_escalate</td>
            <td style={{ padding: '4px 0', fontSize: 13, fontWeight: 500, verticalAlign: 'middle' }}><BoolBadge value={s.decision_escalate} /></td>
            {ov.enabled && (
              <td style={{ paddingLeft: 16, verticalAlign: 'middle' }}>
                <BoolBadge value={ov.escalateToHuman} />
              </td>
            )}
          </tr>
        </tbody>
      </table>

      {/* Override controls */}
      {ov.enabled && (
        <div style={{
          marginTop: 14,
          padding: '12px 14px',
          background: '#f5f3ff',
          border: '1px solid #ddd6fe',
          borderRadius: 6,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6d28d9', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
            Override values
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
            {/* Payer */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#7c3aed', marginBottom: 3 }}>Payer</label>
              <select
                value={ov.payer}
                onChange={(e) => setField('payer', e.target.value as OverridePayer)}
                style={inputStyle}
              >
                <option value="guest">guest</option>
                <option value="owner">owner</option>
                <option value="insurance">insurance</option>
                <option value="operator">operator</option>
                <option value="none">none</option>
              </select>
            </div>

            {/* Communication mode */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#7c3aed', marginBottom: 3 }}>Communication mode</label>
              <select
                value={ov.communicationMode}
                onChange={(e) => setField('communicationMode', e.target.value as OverrideComms)}
                style={inputStyle}
              >
                <option value="silent">silent</option>
                <option value="soft">soft</option>
                <option value="warning">warning</option>
                <option value="escalation">escalation</option>
              </select>
            </div>

            {/* Block checkin */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: '#7c3aed', cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={ov.blockCheckin}
                onChange={(e) => setField('blockCheckin', e.target.checked)}
                style={{ accentColor: '#7c3aed' }}
              />
              blockCheckin
            </label>

            {/* Escalate to human */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: '#7c3aed', cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={ov.escalateToHuman}
                onChange={(e) => setField('escalateToHuman', e.target.checked)}
                style={{ accentColor: '#7c3aed' }}
              />
              escalateToHuman
            </label>
          </div>
        </div>
      )}

      {/* Override audit trail */}
      {overrideDiff && (
        <div style={{
          marginTop: 14,
          padding: '10px 14px',
          background: '#f9fafb',
          border: '1px solid #e5e7eb',
          borderRadius: 6,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
            Override changes
          </div>
          {!overrideDiff.blockCheckin && !overrideDiff.payer && !overrideDiff.comms && !overrideDiff.escalate ? (
            <span style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>No changes from system decision</span>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {overrideDiff.payer && (
                <li style={{ fontSize: 12, color: '#374151', paddingBottom: 3 }}>
                  · payer: <span style={{ fontWeight: 600 }}>{s.decision_payer}</span>
                  <span style={{ color: '#9ca3af', margin: '0 5px' }}>→</span>
                  <span style={{ fontWeight: 600 }}>{ov.payer}</span>
                </li>
              )}
              {overrideDiff.comms && (
                <li style={{ fontSize: 12, color: '#374151', paddingBottom: 3 }}>
                  · comms: <span style={{ fontWeight: 600 }}>{s.decision_comms}</span>
                  <span style={{ color: '#9ca3af', margin: '0 5px' }}>→</span>
                  <span style={{ fontWeight: 600 }}>{ov.communicationMode}</span>
                </li>
              )}
              {overrideDiff.blockCheckin && (
                <li style={{ fontSize: 12, color: '#374151', paddingBottom: 3 }}>
                  · blockCheckin: <span style={{ fontWeight: 600 }}>{String(s.decision_block)}</span>
                  <span style={{ color: '#9ca3af', margin: '0 5px' }}>→</span>
                  <span style={{ fontWeight: 600 }}>{String(ov.blockCheckin)}</span>
                </li>
              )}
              {overrideDiff.escalate && (
                <li style={{ fontSize: 12, color: '#374151', paddingBottom: 3 }}>
                  · escalate: <span style={{ fontWeight: 600 }}>{String(s.decision_escalate)}</span>
                  <span style={{ color: '#9ca3af', margin: '0 5px' }}>→</span>
                  <span style={{ fontWeight: 600 }}>{String(ov.escalateToHuman)}</span>
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* Effective decision */}
      <div style={{
        marginTop: 14,
        padding: '12px 14px',
        background: '#f0fdf4',
        border: `1px solid ${ov.enabled ? '#86efac' : '#d1fae5'}`,
        borderRadius: 6,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
          Effective decision
        </div>
        <div style={{ fontSize: 11, color: '#4ade80', fontWeight: 500, marginBottom: 10 }}>
          Final outcome (what system will execute)
        </div>
        <table style={{ borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td style={{ padding: '3px 12px 3px 0', color: '#6b7280', fontSize: 12, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>blockCheckin</td>
              <td style={{ padding: '3px 0', verticalAlign: 'middle' }}><BoolBadge value={effectiveDecision.blockCheckin} /></td>
            </tr>
            <tr>
              <td style={{ padding: '3px 12px 3px 0', color: '#6b7280', fontSize: 12, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>payer</td>
              <td style={{ padding: '3px 0', fontSize: 12, fontWeight: 600, color: '#15803d', verticalAlign: 'middle' }}>{effectiveDecision.recommendedPayer}</td>
            </tr>
            <tr>
              <td style={{ padding: '3px 12px 3px 0', color: '#6b7280', fontSize: 12, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>comms</td>
              <td style={{ padding: '3px 0', fontSize: 12, fontWeight: 600, color: '#15803d', verticalAlign: 'middle' }}>{effectiveDecision.communicationMode}</td>
            </tr>
            <tr>
              <td style={{ padding: '3px 12px 3px 0', color: '#6b7280', fontSize: 12, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>escalate</td>
              <td style={{ padding: '3px 0', verticalAlign: 'middle' }}><BoolBadge value={effectiveDecision.escalateToHuman} /></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Decision reasons */}
      {s.decision_reasons.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            Decision reasons
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {s.decision_reasons.map((r) => (
              <li key={r} style={{ fontSize: 12, color: '#6b7280', paddingBottom: 2 }}>
                · {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

type GuestTier = 'strict' | 'trusted' | 'privileged';
type CostTier = 'micro' | 'minor' | 'major';
type EvidenceConfidence = 'low' | 'medium' | 'high';

export default function OpsDemoPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [guestTier, setGuestTier] = useState<GuestTier>('trusted');
  const [costTier, setCostTier] = useState<CostTier>('minor');
  const [evidenceConfidence, setEvidenceConfidence] = useState<EvidenceConfidence>('medium');
  const [simLabel, setSimLabel] = useState<string | null>(null);

  const runScenarios = async () => {
    setLoading(true);
    setResult(null);
    const params = new URLSearchParams({ guestTier, costTier, evidenceConfidence });
    setSimLabel(`${guestTier} / ${costTier} / ${evidenceConfidence}`);
    try {
      const res = await fetch(`/api/ops-demo?${params}`);
      const data: ApiResponse = await res.json();
      setResult(data);
    } catch {
      setResult({ ok: false, error: 'fetch_failed' });
    } finally {
      setLoading(false);
    }
  };

  const selectStyle: React.CSSProperties = {
    padding: '5px 8px',
    border: '1px solid #d1d5db',
    borderRadius: 5,
    fontSize: 13,
    background: '#fff',
    cursor: 'pointer',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: 600,
    marginBottom: 4,
    display: 'block',
  };

  return (
    <div style={{ maxWidth: 640, margin: '40px auto', padding: '0 20px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4, color: '#111827' }}>OPS Decision Engine</h1>
      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>
        Runs all incident scenarios through the decision engine and shows the output.
      </p>

      {/* Demo context banner */}
      <div style={{
        padding: '10px 16px',
        marginBottom: 24,
        background: '#eff6ff',
        border: '1px solid #bfdbfe',
        borderRadius: 6,
        fontSize: 13,
        color: '#1e40af',
        fontWeight: 500,
      }}>
        Это демонстрация того, как ASI принимает решения в реальном времени
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={labelStyle}>Guest tier</label>
          <select value={guestTier} onChange={(e) => setGuestTier(e.target.value as GuestTier)} style={selectStyle}>
            <option value="strict">strict</option>
            <option value="trusted">trusted</option>
            <option value="privileged">privileged</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Cost tier</label>
          <select value={costTier} onChange={(e) => setCostTier(e.target.value as CostTier)} style={selectStyle}>
            <option value="micro">micro</option>
            <option value="minor">minor</option>
            <option value="major">major</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Evidence confidence</label>
          <select value={evidenceConfidence} onChange={(e) => setEvidenceConfidence(e.target.value as EvidenceConfidence)} style={selectStyle}>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </div>
      </div>

      {/* Conversion CTA */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <a
          href="/connect"
          style={{
            display: 'inline-block',
            padding: '8px 20px',
            background: '#16a34a',
            color: '#fff',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Подключить свои объекты
        </a>
        <a
          href="/"
          style={{
            fontSize: 13,
            color: '#6b7280',
            textDecoration: 'underline',
          }}
        >
          Вернуться на главную
        </a>
      </div>

      <button
        onClick={runScenarios}
        disabled={loading}
        style={{
          padding: '8px 20px',
          background: loading ? '#9ca3af' : '#1d4ed8',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          fontSize: 14,
          fontWeight: 600,
          cursor: loading ? 'not-allowed' : 'pointer',
          marginBottom: 28,
        }}
      >
        {loading ? 'Running…' : 'Run scenarios'}
      </button>

      {result && !result.ok && (
        <div style={{
          padding: '12px 16px',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: 6,
          color: '#991b1b',
          fontSize: 13,
        }}>
          Failed to load OPS demo
        </div>
      )}

      {result?.ok && result.scenarios && (
        <div>
          {simLabel && (
            <p style={{ fontSize: 12, color: '#374151', fontWeight: 600, marginBottom: 8 }}>
              Simulation: {simLabel}
            </p>
          )}
          <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 16 }}>
            {result.scenarios.length} scenario{result.scenarios.length !== 1 ? 's' : ''} returned
          </p>
          {result.scenarios.map((s) => (
            <ScenarioCard key={s.scenario} s={s} />
          ))}
        </div>
      )}
    </div>
  );
}

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCHEMA_VERSION = 'asi.strigunov-crm-local-acceptance.v2';
const NEXT_ACTION = 'Связаться с заявителем, уточнить объект и согласовать подключение.';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

type GateStatus = 'PASS' | 'BLOCKED' | 'NOT_RUN';

type GateResult = {
  status: GateStatus;
  reasons: string[];
};

type EvidenceState = {
  unitContracts: GateStatus;
  realIsolatedPersistence: GateStatus;
  authenticatedOperatorHttp: GateStatus;
  cleanup: GateStatus;
};

type SideEffects = {
  databaseWrites: boolean;
  networkRequests: boolean;
  secretsRead: boolean;
  cleanupDeletes: boolean;
};

export type FixtureIdentity = {
  runId: string;
  name: string;
  telegramUsername: string;
  referral: 'strigunov';
  nextAction: string;
  source: 'form';
  status: 'new';
  communicationStatus: 'needs_manual_reaction';
  objectsCount: 2;
};

type StoredFixture = FixtureIdentity & { id: string };

type StoreAdapter = {
  insertFixture(fixture: FixtureIdentity): Promise<{ id: string }>;
  readFixtureByIdStrict(id: string): Promise<StoredFixture | null>;
  deleteOwnedFixture(
    id: string,
    fixture: FixtureIdentity,
  ): Promise<{ deleted: boolean; ownershipMatched: boolean; deletedId: string | null }>;
};

type AcceptanceContractInput = {
  evidenceKind: 'unit_contract';
  runId: string;
  identityEvidence: unknown;
  serviceKey: string | undefined;
  credentialEvidence: unknown;
  adapter: StoreAdapter;
  getQueueProof(fixtureId: string, fixture: FixtureIdentity): Promise<unknown>;
};

type AcceptanceContractResult = {
  schemaVersion: typeof SCHEMA_VERSION;
  mode: 'contract-test';
  verdict: 'CONTRACT_PASS' | 'BLOCKED';
  safeToExecute: false;
  runId: string;
  fixtureId: string | null;
  gates: {
    disposableStoreIdentity: GateResult;
    serviceCredential: GateResult;
    strictPersistence: GateResult;
    authenticatedOperatorHttp: GateResult;
  };
  cleanup: GateResult;
  evidence: EvidenceState;
  blockers: string[];
  sideEffects: SideEffects;
};

type IdentityEvidence = {
  authority?: unknown;
  proofKind?: unknown;
  runId?: unknown;
  instanceId?: unknown;
  apiOrigin?: unknown;
  apiBindingHost?: unknown;
  databaseBindingHost?: unknown;
  apiContainerId?: unknown;
  databaseContainerId?: unknown;
  disposable?: unknown;
  harnessOwned?: unknown;
  remoteEgressDenied?: unknown;
  tunnelDetected?: unknown;
  proxyDetected?: unknown;
};

type QueueProof = {
  route?: unknown;
  unauthenticatedStatus?: unknown;
  forbiddenStatus?: unknown;
  operatorStatus?: unknown;
  item?: unknown;
};

function blocked(...reasons: string[]): GateResult {
  return { status: 'BLOCKED', reasons };
}

function passed(): GateResult {
  return { status: 'PASS', reasons: [] };
}

function notRun(reason: string): GateResult {
  return { status: 'NOT_RUN', reasons: [reason] };
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function safeErrorCode(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? 'unknown');
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'unknown';
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isLoopbackHttpOrigin(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname) && url.port === '54321';
  } catch {
    return false;
  }
}

function hasContainerId(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

export function buildFixtureIdentity(runId = randomUUID().replaceAll('-', '').slice(0, 12)): FixtureIdentity {
  if (!/^[0-9a-f]{12}$/.test(runId)) {
    throw new Error('acceptance_run_id_must_be_12_lowercase_hex_characters');
  }
  return {
    runId,
    name: `ASI CRM ACCEPT ${runId}`,
    telegramUsername: `asi_acc_${runId}`,
    referral: 'strigunov',
    nextAction: NEXT_ACTION,
    source: 'form',
    status: 'new',
    communicationStatus: 'needs_manual_reaction',
    objectsCount: 2,
  };
}

export function validateDisposableStoreIdentity(
  rawEvidence: unknown,
  expectedRunId: string,
): GateResult {
  const evidence = record(rawEvidence) as IdentityEvidence | null;
  if (!evidence) return blocked('authoritative_disposable_store_identity_missing');

  const reasons: string[] = [];
  if (evidence.authority !== 'trusted_local_runtime_probe') {
    reasons.push('caller_self_attestation_is_not_identity_proof');
  }
  if (evidence.proofKind !== 'docker_daemon_socket_owner_and_database_identity') {
    reasons.push('runtime_socket_and_database_identity_proof_missing');
  }
  if (evidence.runId !== expectedRunId) reasons.push('store_identity_run_mismatch');
  if (typeof evidence.instanceId !== 'string' || !evidence.instanceId) {
    reasons.push('store_instance_id_missing');
  }
  if (!isLoopbackHttpOrigin(evidence.apiOrigin)) reasons.push('store_api_origin_not_exact_loopback');
  if (evidence.apiBindingHost !== '127.0.0.1') reasons.push('store_api_binding_ambiguous_or_nonloopback');
  if (evidence.databaseBindingHost !== '127.0.0.1') reasons.push('store_database_binding_ambiguous_or_nonloopback');
  if (!hasContainerId(evidence.apiContainerId)) reasons.push('store_api_socket_owner_unproven');
  if (!hasContainerId(evidence.databaseContainerId)) reasons.push('store_database_instance_unproven');
  if (evidence.disposable !== true || evidence.harnessOwned !== true) {
    reasons.push('store_disposable_ownership_unproven');
  }
  if (evidence.remoteEgressDenied !== true) reasons.push('store_remote_egress_not_denied');
  if (evidence.tunnelDetected !== false) reasons.push('store_tunnel_absence_unproven');
  if (evidence.proxyDetected !== false) reasons.push('store_proxy_absence_unproven');
  return reasons.length > 0 ? blocked(...reasons) : passed();
}

export function validateServiceCredentialProof(
  serviceKey: string | undefined,
  rawProof: unknown,
  rawIdentity: unknown,
): GateResult {
  if (!serviceKey) return blocked('service_key_missing');
  const proof = record(rawProof);
  const identity = record(rawIdentity);
  if (!proof || !identity) return blocked('service_key_not_verified_by_identified_local_store');

  const reasons: string[] = [];
  if (proof.authority !== 'identified_local_auth_api' || proof.accepted !== true) {
    reasons.push('service_key_not_verified_by_identified_local_store');
  }
  if (proof.instanceId !== identity.instanceId) reasons.push('service_key_store_identity_mismatch');
  if (proof.runId !== identity.runId) reasons.push('service_key_run_identity_mismatch');
  return reasons.length > 0 ? blocked(...reasons) : passed();
}

export function validateAuthenticatedQueueProof(
  rawProof: unknown,
  fixtureId: string,
  fixture: FixtureIdentity,
): GateResult {
  const proof = record(rawProof) as QueueProof | null;
  if (!proof) return blocked('authenticated_operator_http_proof_missing');
  const item = record(proof.item);
  const reasons: string[] = [];
  if (proof.route !== '/api/dashboard/crm/queue?includeTest=1') {
    reasons.push('operator_http_route_mismatch');
  }
  if (proof.unauthenticatedStatus !== 401) reasons.push('operator_http_401_not_proven');
  if (proof.forbiddenStatus !== 403) reasons.push('operator_http_403_not_proven');
  if (proof.operatorStatus !== 200) reasons.push('operator_http_200_not_proven');
  if (!item || item.id !== fixtureId) reasons.push('operator_http_fixture_visibility_not_proven');
  if (!item || item.referral !== fixture.referral) reasons.push('operator_http_referral_visibility_not_proven');
  if (!item || item.nextAction !== fixture.nextAction) reasons.push('operator_http_next_action_visibility_not_proven');
  return reasons.length > 0 ? blocked(...reasons) : passed();
}

function validateStrictReadback(
  row: StoredFixture | null,
  fixtureId: string,
  fixture: FixtureIdentity,
): GateResult {
  if (!row) return blocked('strict_repository_readback_missing');
  const ownershipMatches = row.id === fixtureId
    && row.runId === fixture.runId
    && row.name === fixture.name
    && row.telegramUsername === fixture.telegramUsername;
  if (!ownershipMatches) return blocked('fixture_ownership_mismatch');
  const contractMatches = row.referral === fixture.referral
    && row.nextAction === fixture.nextAction
    && row.source === fixture.source
    && row.status === fixture.status
    && row.communicationStatus === fixture.communicationStatus
    && row.objectsCount === fixture.objectsCount;
  return contractMatches ? passed() : blocked('strict_repository_readback_contract_mismatch');
}

function contractEvidence(status: GateStatus): EvidenceState {
  return {
    unitContracts: status,
    realIsolatedPersistence: 'NOT_RUN',
    authenticatedOperatorHttp: 'NOT_RUN',
    cleanup: 'NOT_RUN',
  };
}

export async function runAcceptanceContract(
  input: AcceptanceContractInput,
): Promise<AcceptanceContractResult> {
  const fixture = buildFixtureIdentity(input.runId);
  const identityGate = validateDisposableStoreIdentity(input.identityEvidence, input.runId);
  const credentialGate = validateServiceCredentialProof(
    input.serviceKey,
    input.credentialEvidence,
    input.identityEvidence,
  );
  let strictPersistence = notRun('write_not_started');
  let authenticatedOperatorHttp = notRun('strict_persistence_not_proven');
  let cleanup = notRun('no_owned_fixture_id');
  let fixtureId: string | null = null;
  const blockers = [...identityGate.reasons, ...credentialGate.reasons];

  if (identityGate.status === 'PASS' && credentialGate.status === 'PASS') {
    try {
      const receipt = await input.adapter.insertFixture(fixture);
      if (!receipt || typeof receipt.id !== 'string' || !receipt.id.trim()) {
        throw new Error('write_receipt_missing_owned_id');
      }
      fixtureId = receipt.id;
      const persisted = await input.adapter.readFixtureByIdStrict(fixtureId);
      strictPersistence = validateStrictReadback(persisted, fixtureId, fixture);
      blockers.push(...strictPersistence.reasons);
      if (strictPersistence.status === 'PASS') {
        try {
          const queueProof = await input.getQueueProof(fixtureId, fixture);
          authenticatedOperatorHttp = validateAuthenticatedQueueProof(queueProof, fixtureId, fixture);
        } catch (error) {
          authenticatedOperatorHttp = blocked(`authenticated_operator_http_failed:${safeErrorCode(error)}`);
        }
        blockers.push(...authenticatedOperatorHttp.reasons);
      }
    } catch (error) {
      if (!fixtureId) {
        blockers.push(`write_outcome_missing_owned_id:${safeErrorCode(error)}`);
        cleanup = blocked('cleanup_unproven_without_owned_id');
      } else {
        blockers.push(`acceptance_flow_failed:${safeErrorCode(error)}`);
      }
    } finally {
      if (fixtureId) {
        try {
          const receipt = await input.adapter.deleteOwnedFixture(fixtureId, fixture);
          if (!receipt.deleted || !receipt.ownershipMatched || receipt.deletedId !== fixtureId) {
            cleanup = blocked('cleanup_refused_fixture_ownership_mismatch');
          } else {
            const remaining = await input.adapter.readFixtureByIdStrict(fixtureId);
            cleanup = remaining === null
              ? passed()
              : blocked('cleanup_readback_still_present');
          }
        } catch (error) {
          cleanup = blocked(`cleanup_failed:${safeErrorCode(error)}`);
        }
      }
      blockers.push(...cleanup.reasons);
    }
  }

  const finalBlockers = unique(blockers);
  const contractPassed = finalBlockers.length === 0
    && strictPersistence.status === 'PASS'
    && authenticatedOperatorHttp.status === 'PASS'
    && cleanup.status === 'PASS';

  return {
    schemaVersion: SCHEMA_VERSION,
    mode: 'contract-test',
    verdict: contractPassed ? 'CONTRACT_PASS' : 'BLOCKED',
    safeToExecute: false,
    runId: input.runId,
    fixtureId,
    gates: {
      disposableStoreIdentity: identityGate,
      serviceCredential: credentialGate,
      strictPersistence,
      authenticatedOperatorHttp,
    },
    cleanup,
    evidence: contractEvidence(contractPassed ? 'PASS' : 'BLOCKED'),
    blockers: finalBlockers,
    sideEffects: {
      databaseWrites: false,
      networkRequests: false,
      secretsRead: false,
      cleanupDeletes: false,
    },
  };
}

function zeroSideEffects(): SideEffects {
  return {
    databaseWrites: false,
    networkRequests: false,
    secretsRead: false,
    cleanupDeletes: false,
  };
}

function buildPlanReport() {
  return {
    schemaVersion: SCHEMA_VERSION,
    mode: 'plan',
    verdict: 'PLAN_ONLY',
    safeToExecute: false,
    gates: {
      staticPolicy: notRun('plan_does_not_evaluate_runtime_policy'),
      disposableStoreIdentity: notRun('authoritative_runtime_probe_not_run'),
      serviceCredential: notRun('credential_not_verified'),
      strictPersistence: notRun('real_store_not_accessed'),
      authenticatedOperatorHttp: notRun('real_http_route_not_accessed'),
      cleanup: notRun('no_fixture_created'),
    },
    evidence: {
      unitContracts: 'NOT_RUN',
      realIsolatedPersistence: 'NOT_RUN',
      authenticatedOperatorHttp: 'NOT_RUN',
      cleanup: 'NOT_RUN',
    } satisfies EvidenceState,
    blockers: [
      'plan_only_is_not_security_or_acceptance_evidence',
      'execute_requires_authoritative_disposable_store_identity',
      'execute_requires_real_authenticated_operator_http_401_403_200_with_attribution',
    ],
    sideEffects: zeroSideEffects(),
  };
}

function staticPolicyReasons(env: NodeJS.ProcessEnv): string[] {
  const reasons: string[] = [];
  if (env.NODE_ENV !== 'test') reasons.push('node_env_test_required');
  if (env.ASI_LOCAL_CRM_ACCEPTANCE !== '1') reasons.push('explicit_local_acceptance_opt_in_required');
  if (!isLoopbackHttpOrigin(env.SUPABASE_URL)) reasons.push('exact_loopback_supabase_url_required');
  return reasons;
}

function buildBlockedRuntimeReport(mode: 'dry-run' | 'execute', env: NodeJS.ProcessEnv) {
  const policyReasons = staticPolicyReasons(env);
  const blockers = unique([
    ...policyReasons,
    'authoritative_disposable_store_identity_unavailable',
    'local_url_opt_in_and_key_string_are_not_identity_proof',
    'service_key_not_verified_by_identified_local_store',
    'strict_repository_readback_without_demo_fallback_unavailable',
    'authenticated_operator_http_proof_unavailable',
    'queue_route_does_not_expose_referral_and_stored_next_action',
    'owned_id_cleanup_proof_unavailable',
  ]);
  return {
    schemaVersion: SCHEMA_VERSION,
    mode,
    verdict: 'BLOCKED',
    safeToExecute: false,
    gates: {
      staticPolicy: policyReasons.length === 0 ? passed() : blocked(...policyReasons),
      disposableStoreIdentity: blocked('authoritative_disposable_store_identity_unavailable'),
      serviceCredential: blocked('service_key_not_verified_by_identified_local_store'),
      strictPersistence: blocked('strict_repository_readback_without_demo_fallback_unavailable'),
      authenticatedOperatorHttp: blocked(
        'authenticated_operator_http_proof_unavailable',
        'queue_route_does_not_expose_referral_and_stored_next_action',
      ),
      cleanup: blocked('owned_id_cleanup_proof_unavailable'),
    },
    evidence: {
      unitContracts: 'NOT_RUN',
      realIsolatedPersistence: 'BLOCKED',
      authenticatedOperatorHttp: 'BLOCKED',
      cleanup: 'BLOCKED',
    } satisfies EvidenceState,
    blockers,
    sideEffects: zeroSideEffects(),
  };
}

function printReport(report: unknown): void {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function invokedAsMain(): boolean {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
}

function main(): void {
  const modes = process.argv.slice(2).filter((arg) => ['--plan', '--dry-run', '--execute'].includes(arg));
  if (modes.length !== 1 || process.argv.slice(2).some((arg) => !modes.includes(arg))) {
    printReport({
      schemaVersion: SCHEMA_VERSION,
      mode: 'invalid',
      verdict: 'BLOCKED',
      safeToExecute: false,
      blockers: ['exactly_one_mode_required:--plan|--dry-run|--execute'],
      sideEffects: zeroSideEffects(),
    });
    process.exitCode = 2;
    return;
  }
  if (modes[0] === '--plan') {
    printReport(buildPlanReport());
    return;
  }
  const mode = modes[0] === '--execute' ? 'execute' : 'dry-run';
  printReport(buildBlockedRuntimeReport(mode, process.env));
  process.exitCode = 2;
}

if (invokedAsMain()) main();

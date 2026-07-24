import 'server-only';
import { supabase } from '@/lib/supabase';
import { runtimeBridgeRequestHash } from './bridge-hash';
import type {
  RuntimeBridgeChatInput,
  RuntimeBridgeOwnerGateView,
  RuntimeBridgeRunnerInput,
  RuntimeBridgeSafeResult,
  RuntimeBridgeTaskView,
} from './bridge-types';

type Row = Record<string, unknown>;

export class RuntimeBridgeError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

function rpcError(error: { message?: string; code?: string } | null): never {
  const message = error?.message ?? 'runtime_bridge_storage_error';
  if (message.includes('idempotency_conflict')) throw new RuntimeBridgeError('idempotency_conflict', 409);
  if (message.includes('decision_conflict')) throw new RuntimeBridgeError('decision_conflict', 409);
  if (message.includes('owner_gate_mismatch')) throw new RuntimeBridgeError('owner_gate_mismatch', 409);
  if (message.includes('lease_conflict')) throw new RuntimeBridgeError('lease_conflict', 409);
  throw new RuntimeBridgeError('runtime_bridge_storage_error', 500);
}

function taskView(row: Row): RuntimeBridgeTaskView {
  return {
    taskId: String(row.id),
    chatgptTaskId: String(row.chatgpt_task_id),
    conversationId: String(row.conversation_id),
    status: row.status as RuntimeBridgeTaskView['status'],
    attemptCount: Number(row.attempt_count),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function gateView(row: Row): RuntimeBridgeOwnerGateView {
  const request = row.request as Omit<RuntimeBridgeOwnerGateView, 'gateId' | 'taskId' | 'status' | 'createdAt'>;
  return {
    ...request,
    gateId: String(row.id),
    taskId: String(row.task_id),
    status: row.status as RuntimeBridgeOwnerGateView['status'],
    createdAt: String(row.created_at),
  };
}

export async function submitRuntimeBridgeTask(
  clientId: string,
  input: Extract<RuntimeBridgeChatInput, { operation: 'runtime_submit_task' }>['input'],
): Promise<{ task: RuntimeBridgeTaskView; deduplicated: boolean }> {
  const { data, error } = await supabase.rpc('submit_asi_runtime_bridge_task', {
    p_client_id: clientId,
    p_chatgpt_task_id: input.chatgptTaskId,
    p_conversation_id: input.conversationId,
    p_idempotency_key: input.idempotencyKey,
    p_request: input.task,
    p_request_hash: runtimeBridgeRequestHash(input.task),
  });
  if (error || !data) rpcError(error);
  const response = data as { task: Row; deduplicated: boolean };
  return { task: taskView(response.task), deduplicated: response.deduplicated };
}

export async function getRuntimeBridgeTask(clientId: string, taskId: string): Promise<RuntimeBridgeTaskView> {
  const expired = await supabase.rpc('expire_asi_runtime_bridge_owner_gates', { p_client_id: clientId });
  if (expired.error) rpcError(expired.error);
  const { data, error } = await supabase
    .from('asi_runtime_bridge_tasks')
    .select('id,chatgpt_task_id,conversation_id,status,attempt_count,created_at,updated_at')
    .eq('client_id', clientId)
    .eq('id', taskId)
    .maybeSingle();
  if (error) rpcError(error);
  if (!data) throw new RuntimeBridgeError('task_not_found', 404);
  return taskView(data as Row);
}

export async function getRuntimeBridgeResult(
  clientId: string,
  taskId: string,
): Promise<{ taskId: string; status: RuntimeBridgeTaskView['status']; result: RuntimeBridgeSafeResult | null }> {
  const expired = await supabase.rpc('expire_asi_runtime_bridge_owner_gates', { p_client_id: clientId });
  if (expired.error) rpcError(expired.error);
  const { data, error } = await supabase
    .from('asi_runtime_bridge_tasks')
    .select('id,status,result')
    .eq('client_id', clientId)
    .eq('id', taskId)
    .maybeSingle();
  if (error) rpcError(error);
  if (!data) throw new RuntimeBridgeError('task_not_found', 404);
  return { taskId: String(data.id), status: data.status, result: (data.result as RuntimeBridgeSafeResult | null) ?? null };
}

export async function listRuntimeBridgeOwnerGates(clientId: string): Promise<RuntimeBridgeOwnerGateView[]> {
  const expired = await supabase.rpc('expire_asi_runtime_bridge_owner_gates', { p_client_id: clientId });
  if (expired.error) rpcError(expired.error);
  const { data, error } = await supabase
    .from('asi_runtime_bridge_owner_gates')
    .select('id,task_id,status,request,created_at')
    .eq('client_id', clientId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) rpcError(error);
  return (data ?? []).map((row) => gateView(row as Row));
}

export async function submitRuntimeBridgeOwnerDecision(
  clientId: string,
  input: Extract<RuntimeBridgeChatInput, { operation: 'runtime_submit_owner_decision' }>['input'],
): Promise<{ task: RuntimeBridgeTaskView; gate: RuntimeBridgeOwnerGateView; deduplicated: boolean }> {
  const expired = await supabase.rpc('expire_asi_runtime_bridge_owner_gates', { p_client_id: clientId });
  if (expired.error) rpcError(expired.error);
  const { data, error } = await supabase.rpc('decide_asi_runtime_bridge_owner_gate', {
    p_client_id: clientId,
    p_task_id: input.taskId,
    p_gate_id: input.gateId,
    p_decision_id: input.decisionId,
    p_task_cycle: input.taskCycle,
    p_decision: input.decision,
    p_source: input.source,
    p_note: input.note ?? null,
  });
  if (error || !data) rpcError(error);
  const response = data as { task: Row; gate: Row; deduplicated: boolean };
  return { task: taskView(response.task), gate: gateView(response.gate), deduplicated: response.deduplicated };
}

export async function runRuntimeBridgeRunnerOperation(clientId: string, request: RuntimeBridgeRunnerInput): Promise<unknown> {
  let rpc: string;
  let args: Record<string, unknown>;
  switch (request.operation) {
    case 'runner_claim_task': {
      const input = request.input;
      rpc = 'claim_asi_runtime_bridge_task';
      args = { p_client_id: clientId, p_runner_id: input.runnerId, p_lease_seconds: input.leaseSeconds };
      break;
    }
    case 'runner_heartbeat': {
      const input = request.input;
      rpc = 'heartbeat_asi_runtime_bridge_task';
      args = {
        p_client_id: clientId, p_runner_id: input.runnerId, p_task_id: input.taskId,
        p_lease_token: input.leaseToken, p_lease_seconds: input.leaseSeconds,
      };
      break;
    }
    case 'runner_submit_result': {
      const input = request.input;
      rpc = 'complete_asi_runtime_bridge_task';
      args = {
        p_client_id: clientId, p_runner_id: input.runnerId, p_task_id: input.taskId,
        p_lease_token: input.leaseToken, p_result: input.result,
      };
      break;
    }
    case 'runner_submit_owner_gate': {
      const input = request.input;
      rpc = 'gate_asi_runtime_bridge_task';
      args = {
        p_client_id: clientId, p_runner_id: input.runnerId, p_task_id: input.taskId,
        p_lease_token: input.leaseToken, p_gate: input.gate,
      };
      break;
    }
    case 'runner_fail_task': {
      const input = request.input;
      rpc = 'fail_asi_runtime_bridge_task';
      args = {
        p_client_id: clientId, p_runner_id: input.runnerId, p_task_id: input.taskId,
        p_lease_token: input.leaseToken, p_retryable: input.retryable, p_error_code: input.errorCode,
      };
      break;
    }
  }
  const { data, error } = await supabase.rpc(rpc, args);
  if (error) rpcError(error);
  return data;
}

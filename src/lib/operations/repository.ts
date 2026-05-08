import { supabase } from '@/lib/supabase';
import {
  buildChecklistSet,
  checklistKeyForStage,
  operationsStageLabels,
} from './demo-data';
import type {
  OperationsAuditEvent,
  OperationsAuditEventType,
  OperationsAutomationMode,
  OperationsBookingDates,
  OperationsChecklistItem,
  OperationsChecklistSet,
  OperationsChecklistStage,
  OperationsChecklistStatus,
  OperationsEscalationStatus,
  OperationsGuestContact,
  OperationsIssue,
  OperationsIssueStatus,
  OperationsIssueType,
  OperationsIssueUrgency,
  OperationsItem,
  OperationsItemIssueStatus,
  OperationsNote,
  OperationsSourceChannel,
  OperationsState,
  OperationsWorkflowStage,
} from './types';

type DbRow = Record<string, any>;

export class OperationsRepositoryUnavailableError extends Error {
  constructor(message = 'operations_repository_unavailable') {
    super(message);
    this.name = 'OperationsRepositoryUnavailableError';
  }
}

export interface OperationsRepositoryContext {
  accountId: string;
  userId?: string;
}

export interface CreateOperationItemInput {
  guest: OperationsGuestContact;
  sourceChannel: OperationsSourceChannel;
  propertyId?: string;
  objectId?: string;
  objectLabel: string;
  bookingDates?: OperationsBookingDates;
  stage?: OperationsWorkflowStage;
  automationMode?: OperationsAutomationMode;
  communicationReviewId?: string;
  communicationSessionId?: string;
}

export interface CreateIssueInput {
  title: string;
  issueType: OperationsIssueType;
  urgency: OperationsIssueUrgency;
  note?: string;
}

export interface AppendAuditInput {
  eventType: OperationsAuditEventType;
  label: string;
  detail?: string;
  tone?: OperationsAuditEvent['tone'];
  issueId?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isBackendAccount(accountId: string): boolean {
  return Boolean(accountId && accountId !== 'legacy');
}

function assertBackendContext(ctx: OperationsRepositoryContext): void {
  if (!isBackendAccount(ctx.accountId)) {
    throw new OperationsRepositoryUnavailableError('account_workspace_unavailable');
  }
}

function rethrowUnavailable(err: unknown): never {
  if (err instanceof OperationsRepositoryUnavailableError) throw err;
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes('operations_items') ||
    message.includes('operations_issues') ||
    message.includes('operations_notes') ||
    message.includes('operations_audit_events') ||
    message.includes('operations_checklist_items') ||
    message.includes('relation')
  ) {
    throw new OperationsRepositoryUnavailableError(message);
  }
  throw err;
}

function itemRowToOperation(row: DbRow): OperationsItem {
  return {
    id: row.id as string,
    guest: {
      name: row.guest_name as string,
      email: (row.guest_email as string | null) ?? undefined,
      phone: (row.guest_phone as string | null) ?? undefined,
      channel: row.guest_channel as OperationsSourceChannel,
      externalContactId: (row.guest_external_contact_id as string | null) ?? undefined,
    },
    sourceChannel: row.source_channel as OperationsSourceChannel,
    propertyId: (row.property_id as string | null) ?? undefined,
    objectId: (row.object_id as string | null) ?? undefined,
    objectLabel: row.object_label as string,
    bookingDates: {
      checkIn: (row.booking_check_in as string | null) ?? undefined,
      checkOut: (row.booking_check_out as string | null) ?? undefined,
      nights: (row.booking_nights as number | null) ?? undefined,
    },
    stage: row.workflow_stage as OperationsWorkflowStage,
    automationMode: row.automation_mode as OperationsAutomationMode,
    checklists: buildChecklistSet(),
    issueStatus: row.issue_status as OperationsItemIssueStatus,
    escalationStatus: row.escalation_status as OperationsEscalationStatus,
    notes: [],
    auditEvents: [],
    communicationReviewId: (row.communication_review_id as string | null) ?? undefined,
    communicationSessionId: (row.communication_session_id as string | null) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function checklistRowToItem(row: DbRow): OperationsChecklistItem {
  return {
    id: row.checklist_item_id as string,
    label: row.label as string,
    status: row.status as OperationsChecklistStatus,
    note: (row.note as string | null) ?? undefined,
    completedAt: (row.completed_at as string | null) ?? undefined,
  };
}

function noteRowToNote(row: DbRow): OperationsNote {
  return {
    id: row.id as string,
    body: row.body as string,
    author: (row.author as string | null) ?? undefined,
    createdAt: row.created_at as string,
  };
}

function auditRowToEvent(row: DbRow): OperationsAuditEvent {
  return {
    id: row.id as string,
    type: row.event_type as OperationsAuditEventType,
    label: row.label as string,
    detail: (row.detail as string | null) ?? undefined,
    tone: row.tone as OperationsAuditEvent['tone'],
    createdAt: row.created_at as string,
  };
}

function issueRowToIssue(row: DbRow): OperationsIssue {
  return {
    id: row.id as string,
    operationItemId: row.operation_item_id as string,
    title: row.title as string,
    type: row.issue_type as OperationsIssueType,
    urgency: row.urgency as OperationsIssueUrgency,
    status: row.status as OperationsIssueStatus,
    communicationReviewId: (row.communication_review_id as string | null) ?? undefined,
    notes: [],
    auditEvents: [],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    resolvedAt: (row.resolved_at as string | null) ?? undefined,
  };
}

function emptyChecklistSet(): OperationsChecklistSet {
  return {
    preCheckIn: [],
    checkIn: [],
    inStay: [],
    checkout: [],
    reviewFollowup: [],
  };
}

function attachChecklist(item: OperationsItem, rows: DbRow[]): OperationsItem {
  const checklists = rows.reduce<OperationsChecklistSet>((acc, row) => {
    const stage = row.checklist_stage as OperationsChecklistStage;
    const key = checklistKeyForStage(stage);
    acc[key].push(checklistRowToItem(row));
    return acc;
  }, emptyChecklistSet());

  return { ...item, checklists };
}

function resolveIssueStatus(issues: OperationsIssue[], itemId: string): OperationsItemIssueStatus {
  if (issues.some((issue) => issue.operationItemId === itemId && issue.status === 'open')) return 'open';
  if (issues.some((issue) => issue.operationItemId === itemId && issue.status === 'in_progress')) return 'in_progress';
  return issues.some((issue) => issue.operationItemId === itemId) ? 'resolved' : 'none';
}

async function loadRelatedForItems(accountId: string, items: OperationsItem[]): Promise<{ items: OperationsItem[]; issues: OperationsIssue[] }> {
  if (items.length === 0) return { items, issues: [] };

  const itemIds = items.map((item) => item.id);
  const [checklistsResult, notesResult, auditsResult, issuesResult] = await Promise.all([
    supabase
      .from('operations_checklist_items')
      .select('*')
      .eq('account_id', accountId)
      .in('operation_item_id', itemIds)
      .order('sort_order', { ascending: true }),
    supabase
      .from('operations_notes')
      .select('*')
      .eq('account_id', accountId)
      .in('operation_item_id', itemIds)
      .order('created_at', { ascending: true }),
    supabase
      .from('operations_audit_events')
      .select('*')
      .eq('account_id', accountId)
      .in('operation_item_id', itemIds)
      .order('created_at', { ascending: true }),
    supabase
      .from('operations_issues')
      .select('*')
      .eq('account_id', accountId)
      .in('operation_item_id', itemIds)
      .order('created_at', { ascending: false }),
  ]);

  if (checklistsResult.error) throw new Error(checklistsResult.error.message);
  if (notesResult.error) throw new Error(notesResult.error.message);
  if (auditsResult.error) throw new Error(auditsResult.error.message);
  if (issuesResult.error) throw new Error(issuesResult.error.message);

  const issues = ((issuesResult.data ?? []) as DbRow[]).map(issueRowToIssue);
  const issueIds = issues.map((issue) => issue.id);

  if (issueIds.length > 0) {
    const [issueNotesResult, issueAuditsResult] = await Promise.all([
      supabase
        .from('operations_notes')
        .select('*')
        .eq('account_id', accountId)
        .in('issue_id', issueIds)
        .order('created_at', { ascending: true }),
      supabase
        .from('operations_audit_events')
        .select('*')
        .eq('account_id', accountId)
        .in('issue_id', issueIds)
        .order('created_at', { ascending: true }),
    ]);

    if (issueNotesResult.error) throw new Error(issueNotesResult.error.message);
    if (issueAuditsResult.error) throw new Error(issueAuditsResult.error.message);

    const issueNotes = (issueNotesResult.data ?? []) as DbRow[];
    const issueAudits = (issueAuditsResult.data ?? []) as DbRow[];
    for (const issue of issues) {
      issue.notes = issueNotes.filter((row) => row.issue_id === issue.id).map(noteRowToNote);
      issue.auditEvents = issueAudits.filter((row) => row.issue_id === issue.id).map(auditRowToEvent);
    }
  }

  const checklistRows = (checklistsResult.data ?? []) as DbRow[];
  const noteRows = (notesResult.data ?? []) as DbRow[];
  const auditRows = (auditsResult.data ?? []) as DbRow[];

  const hydrated = items.map((item) => {
    const itemIssues = issues.filter((issue) => issue.operationItemId === item.id);
    return {
      ...attachChecklist(
        item,
        checklistRows.filter((row) => row.operation_item_id === item.id),
      ),
      issueStatus: resolveIssueStatus(issues, item.id),
      notes: noteRows.filter((row) => row.operation_item_id === item.id && !row.issue_id).map(noteRowToNote),
      auditEvents: auditRows.filter((row) => row.operation_item_id === item.id && !row.issue_id).map(auditRowToEvent),
      escalationStatus:
        item.escalationStatus === 'pending_operator' && itemIssues.every((issue) => issue.status === 'resolved')
          ? 'resolved'
          : item.escalationStatus,
    };
  });

  return { items: hydrated, issues };
}

async function appendAuditEvent(
  ctx: OperationsRepositoryContext,
  operationItemId: string,
  input: AppendAuditInput,
): Promise<OperationsAuditEvent> {
  assertBackendContext(ctx);
  const { data, error } = await supabase
    .from('operations_audit_events')
    .insert({
      account_id: ctx.accountId,
      operation_item_id: operationItemId,
      issue_id: input.issueId ?? null,
      event_type: input.eventType,
      label: input.label,
      detail: input.detail ?? null,
      tone: input.tone ?? 'normal',
      created_by_user_id: ctx.userId ?? null,
    })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return auditRowToEvent(data as DbRow);
}

async function updateItemIssueStatus(ctx: OperationsRepositoryContext, itemId: string): Promise<void> {
  const { data, error } = await supabase
    .from('operations_issues')
    .select('id, operation_item_id, status')
    .eq('account_id', ctx.accountId)
    .eq('operation_item_id', itemId);
  if (error) throw new Error(error.message);

  const issueStatus = resolveIssueStatus((data ?? []).map(issueRowToIssue), itemId);
  const activeIssue = (data ?? []).some((row) => row.status !== 'resolved');
  const patch: DbRow = {
    issue_status: issueStatus,
    updated_at: nowIso(),
  };
  if (!activeIssue) patch.escalation_status = 'resolved';

  const { error: updateError } = await supabase
    .from('operations_items')
    .update(patch)
    .eq('account_id', ctx.accountId)
    .eq('id', itemId);
  if (updateError) throw new Error(updateError.message);
}

export async function listOperationItems(ctx: OperationsRepositoryContext): Promise<OperationsState> {
  try {
    assertBackendContext(ctx);
    const { data, error } = await supabase
      .from('operations_items')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('updated_at', { ascending: false });

    if (error) throw new Error(error.message);

    const { items, issues } = await loadRelatedForItems(ctx.accountId, ((data ?? []) as DbRow[]).map(itemRowToOperation));
    return { items, issues, storageMode: 'backend', updatedAt: nowIso() };
  } catch (err) {
    rethrowUnavailable(err);
  }
}

export async function getOperationItem(ctx: OperationsRepositoryContext, itemId: string): Promise<OperationsItem | null> {
  try {
    assertBackendContext(ctx);
    const { data, error } = await supabase
      .from('operations_items')
      .select('*')
      .eq('account_id', ctx.accountId)
      .eq('id', itemId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;

    const { items } = await loadRelatedForItems(ctx.accountId, [itemRowToOperation(data as DbRow)]);
    return items[0] ?? null;
  } catch (err) {
    rethrowUnavailable(err);
  }
}

export async function createOperationItem(
  ctx: OperationsRepositoryContext,
  input: CreateOperationItemInput,
): Promise<OperationsItem> {
  try {
    assertBackendContext(ctx);
    const at = nowIso();
    const { data, error } = await supabase
      .from('operations_items')
      .insert({
        account_id: ctx.accountId,
        created_by_user_id: ctx.userId ?? null,
        guest_name: input.guest.name,
        guest_email: input.guest.email ?? null,
        guest_phone: input.guest.phone ?? null,
        guest_channel: input.guest.channel,
        guest_external_contact_id: input.guest.externalContactId ?? null,
        source_channel: input.sourceChannel,
        property_id: input.propertyId ?? null,
        object_id: input.objectId ?? null,
        object_label: input.objectLabel,
        booking_check_in: input.bookingDates?.checkIn ?? null,
        booking_check_out: input.bookingDates?.checkOut ?? null,
        booking_nights: input.bookingDates?.nights ?? null,
        workflow_stage: input.stage ?? 'new_inquiry',
        automation_mode: input.automationMode ?? 'manual',
        issue_status: 'none',
        escalation_status: 'none',
        communication_review_id: input.communicationReviewId ?? null,
        communication_session_id: input.communicationSessionId ?? null,
        created_at: at,
        updated_at: at,
      })
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    const item = itemRowToOperation(data as DbRow);

    const templates = buildChecklistSet();
    const checklistRows = (Object.entries({
      pre_checkin: templates.preCheckIn,
      checkin: templates.checkIn,
      in_stay: templates.inStay,
      checkout: templates.checkout,
      review_followup: templates.reviewFollowup,
    }) as Array<[OperationsChecklistStage, OperationsChecklistItem[]]>).flatMap(([stage, entries]) =>
      entries.map((entry, index) => ({
        account_id: ctx.accountId,
        operation_item_id: item.id,
        checklist_stage: stage,
        checklist_item_id: entry.id,
        label: entry.label,
        status: entry.status,
        note: entry.note ?? null,
        sort_order: index,
      })),
    );

    if (checklistRows.length > 0) {
      const { error: checklistError } = await supabase.from('operations_checklist_items').insert(checklistRows);
      if (checklistError) throw new Error(checklistError.message);
    }

    await appendAuditEvent(ctx, item.id, {
      eventType: 'item_created',
      label: 'Операция создана',
      detail: 'Создана в backend operations repository.',
    });

    const created = await getOperationItem(ctx, item.id);
    if (!created) throw new Error('operation_item_not_found_after_create');
    return created;
  } catch (err) {
    rethrowUnavailable(err);
  }
}

export async function updateOperationStage(
  ctx: OperationsRepositoryContext,
  itemId: string,
  stage: OperationsWorkflowStage,
): Promise<OperationsItem | null> {
  try {
    assertBackendContext(ctx);
    const current = await getOperationItem(ctx, itemId);
    if (!current) return null;
    const at = nowIso();
    const { error } = await supabase
      .from('operations_items')
      .update({ workflow_stage: stage, updated_at: at })
      .eq('account_id', ctx.accountId)
      .eq('id', itemId);
    if (error) throw new Error(error.message);

    await appendAuditEvent(ctx, itemId, {
      eventType: 'stage_changed',
      label: 'Стадия изменена',
      detail: `${operationsStageLabels[current.stage]} -> ${operationsStageLabels[stage]}`,
    });

    return getOperationItem(ctx, itemId);
  } catch (err) {
    rethrowUnavailable(err);
  }
}

export async function updateChecklistItem(
  ctx: OperationsRepositoryContext,
  itemId: string,
  stage: OperationsChecklistStage,
  checklistItemId: string,
  status: OperationsChecklistStatus,
): Promise<OperationsItem | null> {
  try {
    assertBackendContext(ctx);
    const at = nowIso();
    const { data, error } = await supabase
      .from('operations_checklist_items')
      .update({
        status,
        completed_at: status === 'done' ? at : null,
        updated_at: at,
      })
      .eq('account_id', ctx.accountId)
      .eq('operation_item_id', itemId)
      .eq('checklist_stage', stage)
      .eq('checklist_item_id', checklistItemId)
      .select('label')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;

    const { error: itemUpdateError } = await supabase
      .from('operations_items')
      .update({ updated_at: at })
      .eq('account_id', ctx.accountId)
      .eq('id', itemId);
    if (itemUpdateError) throw new Error(itemUpdateError.message);

    if (status === 'done') {
      await appendAuditEvent(ctx, itemId, {
        eventType: 'checklist_item_completed',
        label: 'Пункт чек-листа выполнен',
        detail: (data as DbRow).label as string,
        tone: 'success',
      });
    }

    return getOperationItem(ctx, itemId);
  } catch (err) {
    rethrowUnavailable(err);
  }
}

export async function addOperationNote(
  ctx: OperationsRepositoryContext,
  itemId: string,
  body: string,
): Promise<OperationsNote> {
  try {
    assertBackendContext(ctx);
    const trimmed = body.trim();
    if (!trimmed) throw new Error('note_body_required');
    const { data, error } = await supabase
      .from('operations_notes')
      .insert({
        account_id: ctx.accountId,
        operation_item_id: itemId,
        body: trimmed,
        author: 'Оператор',
        created_by_user_id: ctx.userId ?? null,
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);

    await appendAuditEvent(ctx, itemId, {
      eventType: 'note_added',
      label: 'Заметка добавлена',
      detail: trimmed,
    });

    const { error: itemUpdateError } = await supabase
      .from('operations_items')
      .update({ updated_at: nowIso() })
      .eq('account_id', ctx.accountId)
      .eq('id', itemId);
    if (itemUpdateError) throw new Error(itemUpdateError.message);

    return noteRowToNote(data as DbRow);
  } catch (err) {
    rethrowUnavailable(err);
  }
}

export async function createOperationIssue(
  ctx: OperationsRepositoryContext,
  itemId: string,
  input: CreateIssueInput,
): Promise<OperationsIssue> {
  try {
    assertBackendContext(ctx);
    const item = await getOperationItem(ctx, itemId);
    if (!item) throw new Error('operation_item_not_found');
    const title = input.title.trim() || 'Операционный вопрос';
    const at = nowIso();

    const { data, error } = await supabase
      .from('operations_issues')
      .insert({
        account_id: ctx.accountId,
        operation_item_id: itemId,
        title,
        issue_type: input.issueType,
        urgency: input.urgency,
        status: 'open',
        communication_review_id: item.communicationReviewId ?? null,
        created_at: at,
        updated_at: at,
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);

    const issue = issueRowToIssue(data as DbRow);

    if (input.note?.trim()) {
      const { data: noteData, error: noteError } = await supabase
        .from('operations_notes')
        .insert({
          account_id: ctx.accountId,
          operation_item_id: itemId,
          issue_id: issue.id,
          body: input.note.trim(),
          author: 'Оператор',
          created_by_user_id: ctx.userId ?? null,
        })
        .select('*')
        .single();
      if (noteError) throw new Error(noteError.message);
      issue.notes = [noteRowToNote(noteData as DbRow)];
    }

    const audit = await appendAuditEvent(ctx, itemId, {
      eventType: 'issue_created',
      label: input.urgency === 'urgent' ? 'Срочный вопрос создан' : 'Вопрос создан',
      detail: title,
      tone: input.urgency === 'urgent' ? 'warn' : 'normal',
      issueId: issue.id,
    });
    issue.auditEvents = [audit];

    const { error: itemUpdateError } = await supabase
      .from('operations_items')
      .update({ issue_status: 'open', updated_at: at })
      .eq('account_id', ctx.accountId)
      .eq('id', itemId);
    if (itemUpdateError) throw new Error(itemUpdateError.message);

    return issue;
  } catch (err) {
    rethrowUnavailable(err);
  }
}

export async function closeOperationIssue(
  ctx: OperationsRepositoryContext,
  issueId: string,
): Promise<OperationsIssue | null> {
  try {
    assertBackendContext(ctx);
    const at = nowIso();
    const { data, error } = await supabase
      .from('operations_issues')
      .update({ status: 'resolved', resolved_at: at, updated_at: at })
      .eq('account_id', ctx.accountId)
      .eq('id', issueId)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;

    const issue = issueRowToIssue(data as DbRow);
    const audit = await appendAuditEvent(ctx, issue.operationItemId, {
      eventType: 'issue_resolved',
      label: 'Вопрос закрыт',
      detail: issue.title,
      tone: 'success',
      issueId: issue.id,
    });
    issue.auditEvents = [audit];

    await updateItemIssueStatus(ctx, issue.operationItemId);
    return issue;
  } catch (err) {
    rethrowUnavailable(err);
  }
}

export async function escalateOperationToOperator(
  ctx: OperationsRepositoryContext,
  itemId: string,
): Promise<OperationsItem | null> {
  try {
    assertBackendContext(ctx);
    const current = await getOperationItem(ctx, itemId);
    if (!current) return null;
    const at = nowIso();
    const { error } = await supabase
      .from('operations_items')
      .update({
        workflow_stage: 'needs_operator',
        escalation_status: 'pending_operator',
        updated_at: at,
      })
      .eq('account_id', ctx.accountId)
      .eq('id', itemId);
    if (error) throw new Error(error.message);

    if (current.stage !== 'needs_operator') {
      await appendAuditEvent(ctx, itemId, {
        eventType: 'stage_changed',
        label: 'Стадия изменена',
        detail: `${operationsStageLabels[current.stage]} -> ${operationsStageLabels.needs_operator}`,
        tone: 'warn',
      });
    }

    await appendAuditEvent(ctx, itemId, {
      eventType: 'escalated',
      label: 'Передано оператору',
      detail: current.communicationReviewId
        ? `Связано с коммуникационным обзором ${current.communicationReviewId}.`
        : 'Коммуникационный обзор не привязан.',
      tone: 'warn',
    });

    return getOperationItem(ctx, itemId);
  } catch (err) {
    rethrowUnavailable(err);
  }
}

export async function appendOperationAuditEvent(
  ctx: OperationsRepositoryContext,
  itemId: string,
  input: AppendAuditInput,
): Promise<OperationsAuditEvent> {
  try {
    return await appendAuditEvent(ctx, itemId, input);
  } catch (err) {
    rethrowUnavailable(err);
  }
}


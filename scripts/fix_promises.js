const fs = require('fs');

function processFile(path) {
  let content = fs.readFileSync(path, 'utf8');

  // Insert import if needed
  if (!content.includes("import { runInBackground }") && content.match(/runInBackground/)) {
    // wait I'll inject the import in orchestrator manually, or dynamically.
  }

  // Common replacements for orchestrator.ts
  if (path.includes('orchestrator.ts')) {
    if (!content.includes("import { runInBackground }")) {
      content = content.replace("import { supabase } from '@/lib/supabase';", "import { supabase } from '@/lib/supabase';\nimport { runInBackground } from './background';");
    }
    content = content.replace("transitionSessionStatus(chatId, SessionStatus.Active).catch(() => {});", "runInBackground('transitionSessionStatus', transitionSessionStatus(chatId, SessionStatus.Active));");
    content = content.replace("await upsertSession(chatId).catch(() => {});", "await upsertSession(chatId).catch(err => console.error('[Orchestrator] upsertSession failed:', err));");
    content = content.replace("await saveUserTurn({ chat_id: chatId, update_id, text }).catch(() => {});", "await saveUserTurn({ chat_id: chatId, update_id, text }).catch(err => console.error('[Orchestrator] saveUserTurn failed:', err));");
    
    // Line 235 block: Guest issue escalated ops task
    content = content.replace(
      /createOpsTask\(\{\s*property_id: commContext\.reservation\.propertyId \?\? 'unknown',[\s\S]*?trigger_reason: escalation\.reason,\s*\}\)\.then\(\(\{\s*task_id\s*\}\) => \{\s*appendTimelineEvent\([^)]+\)\.catch\(\(\) => \{\}\);\s*\}\)\.catch\(\(\) => \{\}\);/m,
      `runInBackground('createOpsTask_Escalate', async () => {
        const { task_id, error } = await createOpsTask({
          property_id: commContext.reservation.propertyId ?? 'unknown',
          reservation_id: commContext.reservation.reservationId ?? null,
          chat_id: chatId,
          task_type: OpsTaskType.GuestIssue,
          title: \`Guest issue escalated: \${escalation.reason}\`,
          description: escalation.summary,
          priority: OpsTaskPriority.Urgent,
          source_event: 'escalation_policy',
          trigger_reason: escalation.reason,
        });
        if (error) throw new Error(error);
        if (task_id) {
          await appendTimelineEvent(identity.guestId, { type: 'ops_task_created', task_type: OpsTaskType.GuestIssue, task_id, ts: new Date() });
        }
      });`
    );

    // Line 258 block: checkin_gate_passed
    content = content.replace(
      /appendTimelineEvent\(identity\.guestId, \{\s*type: 'checkin_gate_passed',[\s\S]*?ts: new Date\(\),\s*\}\)\.catch\(\(\) => \{\}\);/m,
      `runInBackground('appendTimelineEvent_CheckinPassed', () => appendTimelineEvent(identity.guestId, {
          type: 'checkin_gate_passed',
          property_id: propertyId!,
          reservation_id: commContext.reservation.reservationId ?? null,
          ts: new Date(),
        }));`
    );

    // Line 262 block: pre_checkin_sent_at
    content = content.replace(
      /Promise\.resolve\(\)\.then\(\(\) =>\s*supabase\s*\.from\('tg_guest_reservations'\)\s*\.update\(\{ pre_checkin_sent_at: new Date\(\)\.toISOString\(\) \}\)\s*\.eq\('id', resId\),\s*\)\.catch\(\(\) => \{\}\);/m,
      `runInBackground('update_pre_checkin_sent_at', async () => {
            const { error } = await supabase
              .from('tg_guest_reservations')
              .update({ pre_checkin_sent_at: new Date().toISOString() })
              .eq('id', resId);
            if (error) throw new Error(error.message);
          });`
    );

    // Line 276 block: stay_flow_readiness_blocked
    content = content.replace(
      /appendTimelineEvent\(identity\.guestId, \{\s*type: 'stay_flow_readiness_blocked',[\s\S]*?ts: new Date\(\),\s*\}\)\.catch\(\(\) => \{\}\);/m,
      `runInBackground('appendTimelineEvent_ReadinessBlocked', () => appendTimelineEvent(identity.guestId, {
          type: 'stay_flow_readiness_blocked',
          property_id: propertyId!,
          blocked_reason: gateResult.blocked_reason ?? 'unit_not_ready',
          reservation_id: commContext.reservation.reservationId ?? null,
          ts: new Date(),
        }));`
    );

    // Line 285 block: readiness_blocked true
    content = content.replace(
      /Promise\.resolve\(\s*supabase\s*\.from\('tg_guest_reservations'\)\s*\.update\(\{[\s\S]*?readiness_checked_at: gateResult\.checked_at,\s*\}\)\s*\.eq\('id', commContext\.reservation\.reservationId\),\s*\)\.catch\(\(\) => \{\}\);/m,
      `runInBackground('update_readiness_blocked', async () => {
          const { error } = await supabase
            .from('tg_guest_reservations')
            .update({
              readiness_blocked: true,
              readiness_block_reason: gateResult.blocked_reason,
              readiness_checked_at: gateResult.checked_at,
            })
            .eq('id', commContext.reservation.reservationId);
          if (error) throw new Error(error.message);
        });`
    );

    // Line 297 block: CheckinReady task
    content = content.replace(
      /createOpsTask\(\{[\s\S]*?task_type: OpsTaskType\.CheckinReady,[\s\S]*?dedup_key: `checkin_gate_blocked:\$\{commContext\.reservation\.reservationId \?\? propertyId \?\? 'unknown'\}`,\s*\}\)\.catch\(\(\) => \{\}\);/m,
      `runInBackground('createOpsTask_CheckinBlocked', async () => {
          const { error } = await createOpsTask({
            property_id: propertyId ?? 'unknown',
            reservation_id: commContext.reservation.reservationId ?? null,
            chat_id: chatId,
            task_type: OpsTaskType.CheckinReady,
            title: \`Check-in blocked: \${gateResult.blocked_reason}\`,
            description: \`Guest asked for check-in info but unit is not ready. Reason: \${gateResult.blocked_reason}. Unit state: \${gateResult.unit_state ?? 'unknown'}.\`,
            priority: OpsTaskPriority.Urgent,
            source_event: 'checkin_gate_blocked',
            trigger_reason: gateResult.blocked_reason ?? 'unit_not_ready',
            dedup_key: \`checkin_gate_blocked:\${commContext.reservation.reservationId ?? propertyId ?? 'unknown'}\`,
          });
          if (error) throw new Error(error);
        });`
    );

    // Line 390 block: escalation_llm_fallback ops task
    content = content.replace(
      /createOpsTask\(\{\s*property_id: commContext\.reservation\.propertyId \?\? 'unknown',[\s\S]*?trigger_reason: reason,\s*\}\)\.then\(\(\{\s*task_id\s*\}\) => \{\s*appendTimelineEvent\([^)]+\)\.catch\(\(\) => \{\}\);\s*\}\)\.catch\(\(\) => \{\}\);/m,
      `runInBackground('createOpsTask_LLMFallback', async () => {
        const { task_id, error } = await createOpsTask({
          property_id: commContext.reservation.propertyId ?? 'unknown',
          reservation_id: commContext.reservation.reservationId ?? null,
          chat_id: chatId,
          task_type: OpsTaskType.GuestIssue,
          title: \`Guest issue escalated: \${reason}\`,
          description: escalation!.summary,
          priority: classification.slots.isUrgent ? OpsTaskPriority.Urgent : OpsTaskPriority.Normal,
          source_event: 'escalation_llm_fallback',
          trigger_reason: reason,
        });
        if (error) throw new Error(error);
        if (task_id) {
          await appendTimelineEvent(identity.guestId, { type: 'ops_task_created', task_type: OpsTaskType.GuestIssue, task_id, ts: new Date() });
        }
      });`
    );

    // Line 407 block: checkout_intent ops task
    content = content.replace(
      /createOpsTask\(\{\s*property_id: commContext\.reservation\.propertyId,[\s\S]*?trigger_reason: 'checkout_message_sent',\s*\}\)\.then\(\(\{\s*task_id\s*\}\) => \{\s*appendTimelineEvent\([^)]+\)\.catch\(\(\) => \{\}\);\s*\}\)\.catch\(\(\) => \{\}\);/m,
      `runInBackground('createOpsTask_Checkout', async () => {
        const { task_id, error } = await createOpsTask({
          property_id: commContext.reservation.propertyId!,
          reservation_id: commContext.reservation.reservationId ?? null,
          chat_id: chatId,
          task_type: OpsTaskType.Checkout,
          title: 'Guest checkout',
          priority: OpsTaskPriority.Normal,
          source_event: 'checkout_intent',
          trigger_reason: 'checkout_message_sent',
        });
        if (error) throw new Error(error);
        if (task_id) {
          await appendTimelineEvent(identity.guestId, { type: 'ops_task_created', task_type: OpsTaskType.Checkout, task_id, ts: new Date() });
        }
      });`
    );

    // Line 594: appendAttachmentsToLatestTask
    content = content.replace(
      /appendAttachmentsToLatestTask\(message\.chat\.id, refs\)\.catch\(\(\) => \{\}\);/,
      `runInBackground('appendAttachmentsToLatestTask', () => appendAttachmentsToLatestTask(message.chat.id, refs));`
    );
  }

  // Common replacements for conversation.ts
  if (path.includes('conversation.ts')) {
    if (!content.includes("import { runInBackground }")) {
      content = content.replace("import { supabase } from '@/lib/supabase';", "import { supabase } from '@/lib/supabase';\nimport { runInBackground } from './background';");
    }
    content = content.replace(
      /\.then\(\(\{ error \}\) => \{\s*if \(error\) console\.warn\(`\[Conversation\] Supabase state update failed: \$\{error\.message\}`\);\s*\}\);/,
      `.then(({ error }) => { if (error) console.error(\`[Conversation] Supabase state update failed: \${error.message}\`); });`
    );
    content = content.replace(
      /\.then\(\(\{ error \}\) => \{\s*if \(error\) console\.warn\(`\[Conversation\] linkEntities Supabase error: \$\{error\.message\}`\);\s*\}\);/,
      `.then(({ error }) => { if (error) console.error(\`[Conversation] linkEntities Supabase error: \${error.message}\`); });`
    );
    // best-effort update last_message_at
    content = content.replace(
      /supabase\s*\.from\('tg_conversations'\)\s*\.update\(\{ last_message_at: now, updated_at: now \}\)\s*\.eq\('id', conv\.id\)\s*\.then\(\(\) => \{\/\* best-effort \*\/ \}\);/m,
      `runInBackground('touchConversation', async () => {
      const { error } = await supabase.from('tg_conversations').update({ last_message_at: now, updated_at: now }).eq('id', conv.id);
      if (error) throw new Error(error.message);
    });`
    );
  }

  // Common replacements for events.ts
  if (path.includes('events.ts')) {
    if (!content.includes("import { runInBackground }")) {
      content = content.replace("import { supabase } from '@/lib/supabase';", "import { supabase } from '@/lib/supabase';\nimport { runInBackground } from './background';");
    }
    // Change best-effort insert
    content = content.replace(
      /supabase\s*\.from\('comm_events'\)\s*\.insert\(\{[\s\S]*?created_at:\s*event\.ts,\s*\}\)\s*\.then\(\(\{ error \}\) => \{\s*if \(error\) console\.warn\(`\[Events\] DB insert failed for \$\{type\}: \$\{error\.message\}`\);\s*\}\);/m,
      `runInBackground('emit_comm_event_db', async () => {
      const { error } = await supabase.from('comm_events').insert({
        id:              randomUUID(),
        type:            event.type,
        conversation_id: event.conversationId ?? null,
        chat_id:         event.chatId ?? null,
        channel:         event.channel ?? null,
        payload:         event.payload,
        created_at:      event.ts,
      });
      if (error) throw new Error(\`DB insert failed for \${type}: \${error.message}\`);
    });`
    );

    // change observer error log
    content = content.replace(
      /Promise\.resolve\(fn\(event\)\)\.catch\(err =>\s*console\.warn\(`\[Events\] Observer error for \$\{type\}:`,\s*err\),\s*\);/m,
      `runInBackground('emit_comm_event_observer', async () => await fn(event));`
    );
  }

  // session-status.ts
  if (path.includes('session-status.ts')) {
    if (!content.includes("import { runInBackground }")) {
      content = content.replace("import { supabase } from '@/lib/supabase';", "import { supabase } from '@/lib/supabase';\nimport { runInBackground } from './background';");
    }
    // Update best-effort upsert
    content = content.replace(
      /supabase\s*\.from\('tg_conversation_sessions'\)\s*\.upsert\([\s\S]*?\s*\{ onConflict: 'chat_id', ignoreDuplicates: false \},\s*\)\s*\.then\(\(\{ error \}\) => \{\s*if \(error\) \{\s*console\.warn\(`\[SessionStatus\] Supabase write failed chatId=\$\{chatId\}: \$\{error\.message\}`\);\s*\}\s*\}\);/m,
      `runInBackground('transitionSessionStatus_db', async () => {
      const { error } = await supabase.from('tg_conversation_sessions').upsert({
        chat_id: chatId,
        status: newStatus,
        status_updated_at: now.toISOString(),
        updated_at: now.toISOString(),
      }, { onConflict: 'chat_id', ignoreDuplicates: false });
      if (error) throw new Error(\`Supabase write failed chatId=\${chatId}: \${error.message}\`);
    });`
    );
  }

  fs.writeFileSync(path, content, 'utf8');
  console.log('Processed', path);
}

['c:/projects/asi-landing/src/lib/communication/orchestrator.ts',
 'c:/projects/asi-landing/src/lib/communication/conversation.ts',
 'c:/projects/asi-landing/src/lib/communication/events.ts',
 'c:/projects/asi-landing/src/lib/communication/session-status.ts'
].forEach(processFile);

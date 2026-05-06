import type { Metadata } from 'next';
import Link from 'next/link';
import { RuBottomQuickLinks } from '@/components/ru/RuBottomQuickLinks';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
import { ThemeProvider } from '@/theme/ThemeProvider';
import {
  bookingAuditEvents,
  bookingOperations,
  cleaningTasks,
  communicationBridgeMockResults,
  deriveBookingOperationTasks,
  getBookingOperationForScenario,
  getCleaningTasksForBooking,
  getCommunicationEventsForBooking,
  getMaintenanceTasksForBooking,
  getNextOperationPhase,
  getOperationLifecycleLabel,
  getOperationPhase,
  getOperationProgress,
  getOperatorEscalationForBooking,
  guestCommunicationEvents,
  hasAutomatedGuestCommunication,
  maintenanceTasks,
  needsHumanHandoff,
  needsOperatorForBooking,
  operationAutomationLabelsRu,
  operationPhases,
  operationScenarios,
  operationStatusLabelsRu,
  operatorEscalations,
} from '@/lib/operations';
import type {
  OperationCommunicationEventType,
  OperationActor,
  OperationAutomationStatus,
  OperationPriority,
  OperationStatus,
  OperationTaskStatus,
} from '@/lib/operations';

export const metadata: Metadata = {
  title: 'Workflow операционного модуля - ASI',
  description:
    'Демо workflow операционного модуля ASI: фазы, статусы, next action, автоматизация, handoff и история событий.',
};

const actorLabelsRu: Record<OperationActor, string> = {
  asi: 'ASI',
  guest: 'Гость',
  operator: 'Оператор',
  partner: 'Партнер',
  system: 'Система',
};

const priorityLabelsRu: Record<OperationPriority, string> = {
  low: 'Низкий',
  normal: 'Обычный',
  high: 'Высокий',
  urgent: 'Срочный',
};

const taskStatusLabelsRu: Record<OperationTaskStatus, string> = {
  queued: 'В очереди',
  assigned: 'Назначено',
  in_progress: 'В работе',
  waiting_confirmation: 'Ждет подтверждения',
  needs_human: 'Нужен оператор',
  completed: 'Завершено',
};

const bridgeEventLabelsRu: Record<OperationCommunicationEventType, string> = {
  guest_question: 'Вопрос гостя',
  early_checkin_request: 'Ранний заезд',
  late_checkout_request: 'Поздний выезд',
  maintenance_issue: 'Maintenance issue',
  cleaning_issue: 'Cleaning issue',
  complaint: 'Жалоба',
  checkout_support: 'Поддержка выезда',
  review_follow_up: 'Review / follow-up',
};

const statusTone: Record<OperationStatus, string> = {
  queued: 'border-slate-300 bg-slate-500/10 text-slate-700',
  active: 'border-blue-300 bg-blue-500/10 text-blue-700',
  waiting_guest: 'border-amber-300 bg-amber-500/10 text-amber-700',
  waiting_partner: 'border-cyan-300 bg-cyan-500/10 text-cyan-700',
  needs_human: 'border-rose-300 bg-rose-500/10 text-rose-700',
  completed: 'border-emerald-300 bg-emerald-500/10 text-emerald-700',
};

const automationTone: Record<OperationAutomationStatus, string> = {
  automated: 'border-emerald-300 bg-emerald-500/10 text-emerald-700',
  semi_automated: 'border-blue-300 bg-blue-500/10 text-blue-700',
  manual_review: 'border-rose-300 bg-rose-500/10 text-rose-700',
};

export default function RuOperationsWorkflowPage() {
  const activeHandoffs = operationScenarios.filter(needsHumanHandoff);

  return (
    <ThemeProvider defaultTheme="light" className="theme-transition min-h-screen bg-[var(--t-bg)] text-[var(--t-text)]">
      <RuPublicNavHeader surface="theme" density="landing" showContacts={false} />

      <main>
        <section className="px-4 sm:px-6 py-12 sm:py-14 bg-[var(--t-bg)] border-b border-[var(--t-border)]">
          <div className="max-w-6xl mx-auto">
            <Link href="/ru/operations" className="text-sm font-medium text-[var(--t-muted)] hover:text-[var(--t-text)]">
              Назад к модулю
            </Link>
            <div className="mt-5 grid lg:grid-cols-[1fr_auto] gap-8 items-end">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--t-muted)]">
                  Operations workflow
                </p>
                <h1 className="mt-3 text-3xl sm:text-5xl font-bold tracking-tight text-[var(--t-text)]">
                  Живой контур исполнения
                </h1>
                <p className="mt-4 text-base sm:text-lg leading-relaxed text-[var(--t-text-2)] max-w-3xl">
                  Каждый сценарий показывает фазу, next action, режим автоматизации, условие передачи оператору и
                  audit/history события. Это базовый слой для дальнейшей автономной операционной системы.
                </p>
              </div>
              <div className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-5 min-w-[220px]">
                <p className="text-sm text-[var(--t-muted)]">Активные handoff</p>
                <p className="mt-2 text-3xl font-bold text-[var(--t-text)]">{activeHandoffs.length}</p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--t-muted)]">
                  Оператор подключается только к сценариям с риском или нестандартным решением.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="px-4 sm:px-6 py-8 bg-[var(--t-surface-2)] border-b border-[var(--t-border)]">
          <div className="max-w-6xl mx-auto overflow-x-auto">
            <div className="grid min-w-[760px] grid-cols-6 gap-2">
              {operationPhases.map((phase) => (
                <div key={phase.id} className="rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-3">
                  <p className="text-xs font-bold text-[var(--t-muted)]">Фаза {phase.order}</p>
                  <p className="mt-1 text-sm font-semibold leading-snug text-[var(--t-text)]">{phase.titleRu}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 sm:px-6 py-10 sm:py-12 bg-[var(--t-bg)] border-b border-[var(--t-border)]">
          <div className="max-w-6xl mx-auto">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--t-muted)]">
                Communication bridge
              </p>
              <h2 className="mt-2 text-2xl font-bold text-[var(--t-text)]">
                Сообщение гостя → операционное действие
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--t-text-2)]">
                Внутреннее демо: входящее сообщение классифицируется и превращается в Operations event, задачу или
                эскалацию. Реальные Telegram/WhatsApp/voice интеграции здесь не подключены.
              </p>
            </div>

            <div className="mt-6 grid lg:grid-cols-2 gap-4">
              {communicationBridgeMockResults.map((result) => (
                <article
                  key={result.inboundMessage.id}
                  className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--t-muted)]">
                        {result.inboundMessage.channelRu} / {result.inboundMessage.guestNameRu}
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-[var(--t-text)]">
                        {result.inboundMessage.textRu}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                        result.operatorNeeded
                          ? 'border-rose-300 bg-rose-500/10 text-rose-700'
                          : 'border-emerald-300 bg-emerald-500/10 text-emerald-700'
                      }`}
                    >
                      {result.operatorNeeded ? 'Нужен оператор' : 'Автоматически'}
                    </span>
                  </div>

                  <dl className="mt-4 grid sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-[var(--t-muted)]">Классификация</dt>
                      <dd className="mt-1 font-medium text-[var(--t-text)]">
                        {bridgeEventLabelsRu[result.classification.eventType]}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--t-muted)]">Фаза</dt>
                      <dd className="mt-1 font-medium text-[var(--t-text)]">
                        {getOperationPhase(result.classification.phaseId).titleRu}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {result.createdActionLabelsRu.map((label) => (
                      <span
                        key={label}
                        className="rounded-full border border-[var(--t-border)] bg-[var(--t-bg)] px-3 py-1 text-xs text-[var(--t-text-2)]"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 sm:px-6 py-12 sm:py-14 bg-[var(--t-bg)]">
          <div className="max-w-6xl mx-auto grid gap-5">
            {operationScenarios.map((scenario) => {
              const booking = getBookingOperationForScenario(scenario, bookingOperations);
              const phase = getOperationPhase(scenario.phaseId);
              const nextPhase = getNextOperationPhase(scenario.phaseId);
              const progress = getOperationProgress(scenario.phaseId);
              const scenarioCleaningTasks = booking ? getCleaningTasksForBooking(booking, cleaningTasks) : [];
              const scenarioMaintenanceTasks = booking ? getMaintenanceTasksForBooking(booking, maintenanceTasks) : [];
              const scenarioCommunications = booking
                ? getCommunicationEventsForBooking(booking, guestCommunicationEvents)
                : [];
              const derivedTasks = deriveBookingOperationTasks(
                scenario,
                bookingOperations,
                cleaningTasks,
                maintenanceTasks,
                guestCommunicationEvents,
                operatorEscalations,
              );
              const escalation = booking ? getOperatorEscalationForBooking(booking, operatorEscalations) : null;
              const bookingAudit = booking
                ? bookingAuditEvents.filter((event) => booking.auditEventIds.includes(event.id))
                : [];
              const handoff = booking
                ? needsOperatorForBooking(booking, operatorEscalations)
                : needsHumanHandoff(scenario);
              const hasAutoCommunication = booking
                ? hasAutomatedGuestCommunication(booking, guestCommunicationEvents)
                : false;
              const allAuditEvents = [...scenario.events, ...bookingAudit];

              return (
                <article
                  key={scenario.id}
                  className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-5 sm:p-6"
                >
                  <div className="grid lg:grid-cols-[0.85fr_1.15fr] gap-6">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusTone[scenario.status]}`}>
                          {operationStatusLabelsRu[scenario.status]}
                        </span>
                        <span
                          className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${automationTone[scenario.automationStatus]}`}
                        >
                          {operationAutomationLabelsRu[scenario.automationStatus]}
                        </span>
                        <span className="inline-flex rounded-full border border-[var(--t-border)] bg-[var(--t-bg)] px-3 py-1 text-xs font-semibold text-[var(--t-text-2)]">
                          Приоритет: {priorityLabelsRu[scenario.priority]}
                        </span>
                      </div>

                      <h2 className="mt-4 text-xl sm:text-2xl font-bold text-[var(--t-text)]">{scenario.nameRu}</h2>
                      <p className="mt-2 text-sm leading-relaxed text-[var(--t-text-2)]">{scenario.summaryRu}</p>

                      <dl className="mt-5 grid sm:grid-cols-2 gap-3 text-sm">
                        <div>
                          <dt className="text-[var(--t-muted)]">Объект</dt>
                          <dd className="mt-1 font-medium text-[var(--t-text)]">{scenario.propertyNameRu}</dd>
                        </div>
                        <div>
                          <dt className="text-[var(--t-muted)]">Гость</dt>
                          <dd className="mt-1 font-medium text-[var(--t-text)]">{scenario.guestNameRu}</dd>
                        </div>
                        <div>
                          <dt className="text-[var(--t-muted)]">Канал</dt>
                          <dd className="mt-1 font-medium text-[var(--t-text)]">{scenario.channelRu}</dd>
                        </div>
                        <div>
                          <dt className="text-[var(--t-muted)]">Lifecycle</dt>
                          <dd className="mt-1 font-medium text-[var(--t-text)]">{getOperationLifecycleLabel(scenario)}</dd>
                        </div>
                        {booking ? (
                          <>
                            <div>
                              <dt className="text-[var(--t-muted)]">Бронь</dt>
                              <dd className="mt-1 font-medium text-[var(--t-text)]">
                                {booking.bookingCode} / {booking.sourceChannelRu}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-[var(--t-muted)]">Класс запроса</dt>
                              <dd className="mt-1 font-medium text-[var(--t-text)]">{booking.requestClassRu}</dd>
                            </div>
                          </>
                        ) : null}
                      </dl>
                    </div>

                    <div className="grid gap-4">
                      <div className="rounded-xl border border-[var(--t-border)] bg-[var(--t-bg)] p-4">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--t-muted)]">
                              Текущая фаза
                            </p>
                            <p className="mt-2 text-base font-semibold text-[var(--t-text)]">{phase.titleRu}</p>
                          </div>
                          <p className="text-sm font-bold text-[var(--t-muted)]">
                            {progress.current}/{progress.total}
                          </p>
                        </div>
                        <div className="mt-4 h-2 rounded-full bg-[var(--t-surface-2)] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[var(--t-accent)]"
                            style={{ width: `${progress.percent}%` }}
                          />
                        </div>
                        <p className="mt-3 text-sm leading-relaxed text-[var(--t-text-2)]">{phase.automationRoleRu}</p>
                        <p className="mt-2 text-xs text-[var(--t-muted)]">
                          Следующая фаза: {nextPhase ? nextPhase.titleRu : 'финальное закрытие сценария'}
                        </p>
                      </div>

                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="rounded-xl border border-[var(--t-border)] bg-[var(--t-bg)] p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--t-muted)]">
                            Next action
                          </p>
                          <p className="mt-2 text-sm font-semibold leading-relaxed text-[var(--t-text)]">
                            {scenario.nextAction.labelRu}
                          </p>
                          <p className="mt-2 text-xs text-[var(--t-muted)]">
                            Владелец: {actorLabelsRu[scenario.nextAction.owner]} / срок: {scenario.nextAction.dueRu}
                          </p>
                        </div>

                        <div className="rounded-xl border border-[var(--t-border)] bg-[var(--t-bg)] p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--t-muted)]">
                            Human handoff
                          </p>
                          <p className={`mt-2 text-sm font-semibold ${handoff ? 'text-rose-700' : 'text-emerald-700'}`}>
                            {handoff ? 'Нужен оператор' : 'Оператор не нужен'}
                          </p>
                          <p className="mt-2 text-xs leading-relaxed text-[var(--t-muted)]">
                            {handoff
                              ? phase.handoffTriggersRu.join(', ')
                              : 'Сценарий остается в автоматическом контуре.'}
                          </p>
                        </div>
                      </div>

                      {booking ? (
                        <div className="rounded-xl border border-[var(--t-border)] bg-[var(--t-bg)] p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--t-muted)]">
                            Booking-to-review контур
                          </p>
                          <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                            <div className="rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-3">
                              <p className="text-xs font-semibold text-[var(--t-muted)]">Бронь</p>
                              <p className="mt-1 text-[var(--t-text)]">{booking.checkInRu} - {booking.checkOutRu}</p>
                              <p className="mt-1 text-xs text-[var(--t-muted)]">{booking.guestsCount} гостя</p>
                            </div>
                            <div className="rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-3">
                              <p className="text-xs font-semibold text-[var(--t-muted)]">Гость</p>
                              <p className="mt-1 text-[var(--t-text)]">{booking.guestTypeRu}</p>
                              <p className="mt-1 text-xs text-[var(--t-muted)]">{booking.requestClassRu}</p>
                            </div>
                            <div className="rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-3">
                              <p className="text-xs font-semibold text-[var(--t-muted)]">Клининг</p>
                              <p className="mt-1 text-[var(--t-text)]">
                                {scenarioCleaningTasks[0]
                                  ? taskStatusLabelsRu[scenarioCleaningTasks[0].status]
                                  : 'Нет задачи'}
                              </p>
                              <p className="mt-1 text-xs text-[var(--t-muted)]">
                                {scenarioCleaningTasks[0]?.assignedToRu ?? 'Создается при нужной фазе'}
                              </p>
                            </div>
                            <div className="rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-3">
                              <p className="text-xs font-semibold text-[var(--t-muted)]">Home master</p>
                              <p className="mt-1 text-[var(--t-text)]">
                                {scenarioMaintenanceTasks[0]
                                  ? taskStatusLabelsRu[scenarioMaintenanceTasks[0].status]
                                  : 'Нет задачи'}
                              </p>
                              <p className="mt-1 text-xs text-[var(--t-muted)]">
                                {scenarioMaintenanceTasks[0]?.titleRu ?? 'Назначается при инциденте'}
                              </p>
                            </div>
                            <div className="rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-3">
                              <p className="text-xs font-semibold text-[var(--t-muted)]">Коммуникация</p>
                              <p className="mt-1 text-[var(--t-text)]">
                                {hasAutoCommunication ? 'Автоматически' : 'Нет события'}
                              </p>
                              <p className="mt-1 text-xs text-[var(--t-muted)]">
                                {scenarioCommunications[0]?.intentRu ?? 'Ожидает триггер'}
                              </p>
                            </div>
                            <div className="rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-3">
                              <p className="text-xs font-semibold text-[var(--t-muted)]">Review / escalation</p>
                              <p className={`mt-1 ${escalation ? 'text-rose-700' : 'text-[var(--t-text)]'}`}>
                                {escalation ? 'Открыта эскалация' : 'В автопилоте'}
                              </p>
                              <p className="mt-1 text-xs text-[var(--t-muted)]">
                                {escalation?.decisionNeededRu ?? 'Follow-up будет создан после выезда'}
                              </p>
                            </div>
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {derivedTasks.taskLabelsRu.map((label) => (
                              <span
                                key={label}
                                className="rounded-full border border-[var(--t-border)] bg-[var(--t-surface)] px-3 py-1 text-xs text-[var(--t-text-2)]"
                              >
                                {label}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div className="rounded-xl border border-[var(--t-border)] bg-[var(--t-bg)] p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--t-muted)]">
                          Audit events
                        </p>
                        <div className="mt-3 grid gap-3">
                          {allAuditEvents.map((event) => (
                            <div key={event.id} className="grid grid-cols-[4rem_1fr] gap-3 text-sm">
                              <p className="font-mono text-xs text-[var(--t-muted)]">{event.atRu}</p>
                              <div>
                                <p className="font-semibold text-[var(--t-text)]">
                                  {event.titleRu}{' '}
                                  <span className="font-normal text-[var(--t-muted)]">- {actorLabelsRu[event.actor]}</span>
                                </p>
                                <p className="mt-1 text-xs leading-relaxed text-[var(--t-text-2)]">{event.detailRu}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </main>

      <RuBottomQuickLinks tone="theme" />
      <RuComplianceFooter tone="theme" />
    </ThemeProvider>
  );
}

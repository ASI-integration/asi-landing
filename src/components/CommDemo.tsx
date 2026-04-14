'use client';

import { useState, useRef, useEffect } from 'react';
import { useTranslation } from '@/i18n/useTranslation';

interface ChatMessage {
  id: number;
  role: 'guest' | 'asi';
  text: string;
}

interface Step {
  label: string;
  status: 'pending' | 'active' | 'done';
  escalate?: boolean;
}

interface Preset {
  label: string;
  userText: string;
  reply: string;
  escalate: boolean;
  stepLabels: string[];
}

function now() {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export function CommDemo() {
  const { t, get } = useTranslation();

  const presets = (get<Preset[]>('commDemo.presets') ?? []).filter(Boolean);
  const defaultStepLabels = get<string[]>('commDemo.defaultSteps') ?? [];

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 0,
      role: 'asi',
      text: t('commDemo.botIntro'),
    },
  ]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [phase, setPhase] = useState<'idle' | 'processing' | 'done'>('idle');
  const [input, setInput] = useState('');
  const [escalated, setEscalated] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
  const msgId = useRef(1);

  // Scroll chat container (not the page) when messages update
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, phase]);

  function clearTimers() {
    timerRefs.current.forEach(clearTimeout);
    timerRefs.current = [];
  }

  function sendMessage(text: string, preset?: Preset) {
    if (phase === 'processing') return;
    clearTimers();

    const userMsg: ChatMessage = { id: msgId.current++, role: 'guest', text };
    setMessages(prev => [...prev, userMsg]);
    setPhase('processing');
    setEscalated(preset?.escalate ?? false);

    const stepLabels = preset?.stepLabels?.length ? preset.stepLabels : defaultStepLabels;

    const activeSteps: Step[] = stepLabels.map((label, i) => ({
      label,
      status: 'pending' as const,
      escalate: preset?.escalate && i === stepLabels.length - 1,
    }));
    setSteps(activeSteps);

    // Animate steps sequentially
    activeSteps.forEach((_, i) => {
      const delay = 380 + i * 430;
      const t1 = setTimeout(() => {
        setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'active' } : s));
      }, delay);
      const t2 = setTimeout(() => {
        setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'done' } : s));
      }, delay + 360);
      timerRefs.current.push(t1, t2);
    });

    // Bot reply after all steps settle
    const replyDelay = 380 + (stepLabels.length - 1) * 430 + 720;
    const replyText = preset?.reply ?? t('commDemo.defaultReply');
    const timer = setTimeout(() => {
      setMessages(prev => [...prev, { id: msgId.current++, role: 'asi', text: replyText }]);
      setPhase('done');
    }, replyDelay);
    timerRefs.current.push(timer);
  }

  function handlePreset(preset: Preset) {
    sendMessage(preset.userText, preset);
    setInput('');
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || phase === 'processing') return;
    sendMessage(trimmed);
    setInput('');
  }

  return (
    <section className="py-20 sm:py-24 px-4 sm:px-6 bg-slate-950 border-t border-slate-800/60">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="mb-10 max-w-2xl text-left space-y-4">
          <h2 className="text-4xl sm:text-5xl font-bold text-white leading-[1.1] tracking-tight">
            {t('commDemo.title')}
          </h2>
          <p className="text-lg sm:text-xl text-slate-400 leading-relaxed">
            {t('commDemo.subtitle')}
          </p>
        </div>

        {/* Two-panel layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Left: chat */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden flex flex-col" style={{ minHeight: 460 }}>
            {/* Chat header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800/80 bg-slate-900/80 shrink-0">
              <div className="relative">
                <div className="w-9 h-9 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-base">🤖</div>
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-slate-900" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">ASI</p>
                <p className="text-[11px] text-emerald-400">{t('commDemo.statusOnline')}</p>
              </div>
            </div>

            {/* Messages — scroll the container, not the page */}
            <div
              ref={chatContainerRef}
              className="flex-1 overflow-y-auto p-4 space-y-3"
              style={{ maxHeight: 300 }}
            >
              {messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.role === 'guest' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      msg.role === 'guest'
                        ? 'bg-indigo-600/80 text-white rounded-br-sm'
                        : 'bg-slate-800 text-slate-200 rounded-bl-sm'
                    }`}
                  >
                    {msg.text}
                    <p className={`text-[10px] mt-1 ${msg.role === 'guest' ? 'text-indigo-300/60' : 'text-slate-400'}`}>
                      {now()}
                    </p>
                  </div>
                </div>
              ))}

              {phase === 'processing' && (
                <div className="flex justify-start">
                  <div className="bg-slate-800 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5">
                    {[0, 1, 2].map(i => (
                      <span
                        key={i}
                        className="w-1.5 h-1.5 rounded-full bg-slate-500 inline-block"
                        style={{ animation: `bounce 1s ease-in-out ${i * 0.15}s infinite` }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Presets + input */}
            <div className="border-t border-slate-800/80 p-3 space-y-2.5 shrink-0">
              {phase !== 'processing' && (
                <div className="flex flex-wrap gap-1.5">
                  {presets.map(p => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => handlePreset(p)}
                      className="text-[11px] px-2.5 py-1 rounded-lg border border-slate-700 text-slate-400 hover:border-indigo-500/50 hover:text-indigo-300 hover:bg-indigo-500/5 transition-all"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
              <form onSubmit={handleSubmit} className="flex gap-2">
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  disabled={phase === 'processing'}
                  placeholder={t('commDemo.inputPlaceholder')}
                  className="flex-1 bg-slate-800/60 border border-slate-700/60 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:border-indigo-500/50 disabled:opacity-50 transition-colors"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || phase === 'processing'}
                  className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl transition-colors"
                  aria-label="Send message"
                >
                  <span className="sr-only">Send message</span>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                  </svg>
                </button>
              </form>
            </div>
          </div>

          {/* Right: internal processing */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 flex flex-col gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 mb-1">
                {t('commDemo.insideTitle')}
              </p>
              <p className="text-sm text-slate-400">
                {t('commDemo.insideSubtitle')}
              </p>
            </div>

            {/* Steps */}
            <div className="space-y-2 flex-1">
              {steps.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-10 text-center">
                  <div className="w-12 h-12 rounded-full border border-slate-800 flex items-center justify-center mb-3">
                    <svg className="w-5 h-5 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                    </svg>
                  </div>
                  <p className="text-sm text-slate-400">
                    {t('commDemo.emptyStateLine1')}
                    <br />
                    {t('commDemo.emptyStateLine2')}
                  </p>
                </div>
              ) : (
                steps.map((step, i) => {
                  const isEscalateStep = step.escalate;
                  return (
                    <div
                      key={i}
                      className={`flex items-center gap-3 rounded-xl px-4 py-2.5 border transition-all duration-300 ${
                        step.status === 'done'
                          ? isEscalateStep
                            ? 'border-amber-700/40 bg-amber-900/10'
                            : 'border-emerald-800/40 bg-emerald-900/10'
                          : step.status === 'active'
                          ? 'border-indigo-600/40 bg-indigo-900/10'
                          : 'border-slate-800/60 bg-slate-900/30 opacity-35'
                      }`}
                    >
                      {/* Status icon */}
                      <div className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${
                        step.status === 'done'
                          ? isEscalateStep ? 'bg-amber-500/20' : 'bg-emerald-500/20'
                          : step.status === 'active'
                          ? 'bg-indigo-500/20'
                          : 'bg-slate-800'
                      }`}>
                        {step.status === 'done' ? (
                          isEscalateStep ? (
                            <svg className="w-3 h-3 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                            </svg>
                          ) : (
                            <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                            </svg>
                          )
                        ) : step.status === 'active' ? (
                          <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                        ) : (
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-700" />
                        )}
                      </div>

                      {/* Step number + label */}
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-[10px] font-mono shrink-0 tabular-nums ${
                          step.status === 'done'
                            ? isEscalateStep ? 'text-amber-600' : 'text-emerald-700'
                            : step.status === 'active'
                            ? 'text-indigo-600'
                            : 'text-slate-700'
                        }`}>
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span className={`text-sm font-medium truncate ${
                          step.status === 'done'
                            ? isEscalateStep ? 'text-amber-300' : 'text-emerald-300'
                            : step.status === 'active'
                            ? 'text-indigo-300'
                            : 'text-slate-600'
                        }`}>
                          {step.label}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Bottom note */}
            {phase === 'done' && (
              <p className="text-xs text-slate-400 text-center border-t border-slate-800/60 pt-3">
                {escalated
                  ? t('commDemo.doneNoteEscalated')
                  : t('commDemo.doneNoteAuto')}
              </p>
            )}
          </div>

        </div>
      </div>

      {/* bounce keyframes */}
      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); opacity: 0.5; }
          50% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </section>
  );
}

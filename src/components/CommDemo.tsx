'use client';

import { useState, useRef, useEffect } from 'react';
import { AsiCat } from './AsiCat';

interface ChatMessage {
  id: number;
  role: 'guest' | 'asi';
  text: string;
}

interface Step {
  label: string;
  status: 'pending' | 'active' | 'done';
}

const PRESETS: Array<{
  label: string;
  userText: string;
  reply: string;
  steps: number; // how many of 5 steps to show
  escalate: boolean;
}> = [
  {
    label: 'Когда можно заехать?',
    userText: 'Привет, в котором часу можно заехать?',
    reply: 'Заезд с 14:00. Если нужен ранний — напишите, я проверю доступность и согласую с управляющим.',
    steps: 4,
    escalate: false,
  },
  {
    label: 'Есть парковка?',
    userText: 'Есть ли парковка рядом?',
    reply: 'Да, есть закрытый двор. Код въезда пришлю за час до заезда вместе с инструкцией.',
    steps: 3,
    escalate: false,
  },
  {
    label: 'Можно с животными?',
    userText: 'Можно привезти кота? Он маленький)',
    reply: 'Животных берём — до 10 кг. Нужен залог 2 000 ₽, возвращаю после выезда в день выезда. Выставить счёт?',
    steps: 4,
    escalate: false,
  },
  {
    label: 'Жалоба на шум',
    userText: 'Соседи сверху шумят всю ночь, уже 2:00. Невозможно спать.',
    reply: 'Понял, это недопустимо. Немедленно подключаю управляющего — он позвонит вам в течение нескольких минут.',
    steps: 5,
    escalate: true,
  },
];

const STEP_LABELS = [
  'Сообщение принято',
  'Детали уточнены',
  'Данные собраны',
  'Сценарий продвинут',
  'Передано управляющему',
];

const STEP_DELAYS_MS = [400, 850, 1300, 1750, 2200];

function now() {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export function CommDemo() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 0,
      role: 'asi',
      text: 'Здравствуйте! Я система управления объектом ASI. Чем могу помочь?',
    },
  ]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [phase, setPhase] = useState<'idle' | 'processing' | 'done'>('idle');
  const [input, setInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
  const msgId = useRef(1);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function clearTimers() {
    timerRefs.current.forEach(clearTimeout);
    timerRefs.current = [];
  }

  function sendMessage(text: string, preset?: typeof PRESETS[number]) {
    if (phase === 'processing') return;
    clearTimers();

    const userMsg: ChatMessage = { id: msgId.current++, role: 'guest', text };
    setMessages(prev => [...prev, userMsg]);
    setPhase('processing');

    const totalSteps = preset?.steps ?? 4;
    const escalate = preset?.escalate ?? false;

    // Build step list
    const activeSteps: Step[] = STEP_LABELS.slice(0, escalate ? 5 : totalSteps).map(label => ({
      label,
      status: 'pending',
    }));
    setSteps(activeSteps);

    // Animate steps
    activeSteps.forEach((_, i) => {
      const t1 = setTimeout(() => {
        setSteps(prev =>
          prev.map((s, idx) =>
            idx === i ? { ...s, status: 'active' } : s
          )
        );
      }, STEP_DELAYS_MS[i]);

      const t2 = setTimeout(() => {
        setSteps(prev =>
          prev.map((s, idx) =>
            idx === i ? { ...s, status: 'done' } : s
          )
        );
      }, STEP_DELAYS_MS[i] + 380);

      timerRefs.current.push(t1, t2);
    });

    // Bot reply after all steps
    const replyDelay = STEP_DELAYS_MS[totalSteps - 1] + 700;
    const replyText = preset?.reply ?? 'Принял. Уточняю детали и вернусь к вам в ближайшее время.';
    const t = setTimeout(() => {
      const botMsg: ChatMessage = { id: msgId.current++, role: 'asi', text: replyText };
      setMessages(prev => [...prev, botMsg]);
      setPhase('done');
    }, replyDelay);
    timerRefs.current.push(t);
  }

  function handlePreset(preset: typeof PRESETS[number]) {
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
        <div className="flex items-start gap-5 mb-10">
          <AsiCat mode="comm" size={72} className="shrink-0 mt-1" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 mb-1">
              Демо 2 из 2
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-white leading-tight">
              Система сама ведёт диалог
            </h2>
            <p className="mt-2 text-slate-400 max-w-lg">
              Выберите сообщение — и посмотрите, как ASI обрабатывает запрос, не тревожа управляющего.
            </p>
          </div>
        </div>

        {/* Two-panel layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Left: chat */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden flex flex-col" style={{ minHeight: 460 }}>
            {/* Chat header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800/80 bg-slate-900/80">
              <div className="relative">
                <div className="w-9 h-9 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-base">🤖</div>
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-slate-900" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">ASI</p>
                <p className="text-[11px] text-emerald-400">в сети · отвечает мгновенно</p>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ maxHeight: 300 }}>
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
                    <p className={`text-[10px] mt-1 ${msg.role === 'guest' ? 'text-indigo-300/60' : 'text-slate-600'}`}>
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

              <div ref={chatEndRef} />
            </div>

            {/* Presets + input */}
            <div className="border-t border-slate-800/80 p-3 space-y-2.5">
              {phase !== 'processing' && (
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map(p => (
                    <button
                      key={p.label}
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
                  placeholder="Или напишите своё сообщение..."
                  className="flex-1 bg-slate-800/60 border border-slate-700/60 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:border-indigo-500/50 disabled:opacity-50 transition-colors"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || phase === 'processing'}
                  className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                  </svg>
                </button>
              </form>
            </div>
          </div>

          {/* Right: system log */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 flex flex-col gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 mb-1">
                Что происходит внутри
              </p>
              <p className="text-sm text-slate-500">
                Каждое сообщение проходит через цепочку шагов — без участия человека.
              </p>
            </div>

            {/* Steps */}
            <div className="space-y-2.5 flex-1">
              {steps.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-10 text-center">
                  <div className="w-12 h-12 rounded-full border border-slate-800 flex items-center justify-center mb-3">
                    <svg className="w-5 h-5 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                    </svg>
                  </div>
                  <p className="text-sm text-slate-600">Отправьте сообщение,<br />чтобы увидеть процесс</p>
                </div>
              ) : (
                steps.map((step, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-3 rounded-xl px-4 py-3 border transition-all duration-300 ${
                      step.status === 'done'
                        ? step.label === 'Передано управляющему'
                          ? 'border-amber-700/40 bg-amber-900/10'
                          : 'border-emerald-800/40 bg-emerald-900/10'
                        : step.status === 'active'
                        ? 'border-indigo-600/40 bg-indigo-900/10'
                        : 'border-slate-800/60 bg-slate-900/30 opacity-40'
                    }`}
                  >
                    {/* Status icon */}
                    <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
                      step.status === 'done'
                        ? step.label === 'Передано управляющему'
                          ? 'bg-amber-500/20'
                          : 'bg-emerald-500/20'
                        : step.status === 'active'
                        ? 'bg-indigo-500/20'
                        : 'bg-slate-800'
                    }`}>
                      {step.status === 'done' ? (
                        step.label === 'Передано управляющему' ? (
                          <svg className="w-3.5 h-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                          </svg>
                        ) : (
                          <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        )
                      ) : step.status === 'active' ? (
                        <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                      ) : (
                        <span className="w-2 h-2 rounded-full bg-slate-700" />
                      )}
                    </div>
                    <span className={`text-sm font-medium ${
                      step.status === 'done'
                        ? step.label === 'Передано управляющему'
                          ? 'text-amber-300'
                          : 'text-emerald-300'
                        : step.status === 'active'
                        ? 'text-indigo-300'
                        : 'text-slate-600'
                    }`}>
                      {step.label}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Bottom note */}
            {phase === 'done' && (
              <p className="text-xs text-slate-600 text-center border-t border-slate-800/60 pt-3">
                {steps.some(s => s.label === 'Передано управляющему')
                  ? 'Нестандартная ситуация — оператор подключён с полным контекстом.'
                  : 'Запрос обработан автоматически. Управляющий не потребовался.'}
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

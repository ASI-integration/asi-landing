import Link from 'next/link';
import { headers } from 'next/headers';
import type { Metadata } from 'next';

import { productSupportEmail } from '@/config/contact';
import { telegramSupportBotHandle, telegramSupportBotUrl } from '@/config/telegramBots';
import { TgIcon } from '@/components/TgIcon';
import { RU_PUBLIC_ORIGIN, EN_PUBLIC_ORIGIN } from '@/config/publicOrigins';
import { hostnameFromHostHeader, isRuRuntimeHost } from '@/lib/runtimeHost';
import HomeRu from '@/app/ru/page';

const PROCESS_STEPS = [
  ['01', 'Event', 'A message, booking, sensor alert, payment issue, task, or operational change enters the system.'],
  ['02', 'Context', 'ASI gathers the relevant state, history, rules, dependencies, and live signals.'],
  ['03', 'Decision', 'The system decides what should happen next within the allowed operating policy.'],
  ['04', 'Action', 'It triggers the required actions across connected systems, people, and AI tools.'],
  ['05', 'Control', 'ASI checks execution, deadlines, exceptions, and whether the expected result actually happened.'],
  ['06', 'Outcome', 'The process is completed, escalated when necessary, and recorded in an audit trail.'],
] as const;

const USE_CASES = [
  {
    eyebrow: 'Working vertical',
    title: 'Hospitality & Property Operations',
    body: 'Guest communication, booking intake, access, housekeeping, inspections, maintenance coordination, and exception handling.',
  },
  {
    eyebrow: 'Expansion vertical',
    title: 'Commercial Property',
    body: 'Operational events, tenant workflows, service requests, payment timing, maintenance, and property-level coordination.',
  },
  {
    eyebrow: 'Expansion vertical',
    title: 'Field & Service Operations',
    body: 'Dispatch, task ownership, SLA control, technician coordination, follow-up, and evidence of completion.',
  },
  {
    eyebrow: 'Reusable core',
    title: 'Back-Office Processes',
    body: 'Multi-step workflows that currently depend on people checking inboxes, dashboards, spreadsheets, and separate AI tools.',
  },
] as const;

const HOSPITALITY_CAPABILITIES = [
  'Guest and web intake',
  'End-to-end communication',
  'Booking intake and operational handoff',
  'Housekeeping, linen, inspection, and maintenance workflows',
  'Rules, approvals, escalation, and owner control',
  'Execution history and audit trail',
] as const;

async function getIsRuHost(): Promise<boolean> {
  const h = await headers();
  const raw = h.get('x-forwarded-host')?.split(',')[0]?.trim() ?? h.get('host') ?? '';
  return isRuRuntimeHost(hostnameFromHostHeader(raw));
}

export async function generateMetadata(): Promise<Metadata> {
  if (await getIsRuHost()) {
    return {
      title: 'ASI — Полная операционная автоматизация',
      description:
        'Автоматизация операций для недвижимости и гостеприимства: коммуникации, объявления, цены, брони и исполнение — замена операционного слоя, а не очередной инструмент.',
      alternates: {
        canonical: `${RU_PUBLIC_ORIGIN}/`,
        languages: {
          ru: `${RU_PUBLIC_ORIGIN}/`,
        },
      },
    };
  }

  return {
    title: 'ASI Global — Autonomous Operational Intelligence',
    description:
      'ASI connects your systems, people and AI, then carries real operational processes from event to verified outcome.',
    alternates: {
      canonical: EN_PUBLIC_ORIGIN,
      languages: {
        'x-default': EN_PUBLIC_ORIGIN,
        en: EN_PUBLIC_ORIGIN,
      },
    },
  };
}

export default async function Home() {
  if (await getIsRuHost()) return <HomeRu />;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="sticky top-0 z-50 border-b border-slate-800/70 bg-slate-950/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-4 py-4 sm:px-6">
          <Link href="/" className="shrink-0 text-xl font-bold tracking-tight">
            ASI Global
          </Link>

          <nav className="hidden items-center gap-6 text-sm text-slate-400 md:flex">
            <a href="#how" className="transition-colors hover:text-white">How it works</a>
            <a href="#use-cases" className="transition-colors hover:text-white">Use cases</a>
            <a href="#hospitality" className="transition-colors hover:text-white">Working product</a>
            <a href="#demo" className="transition-colors hover:text-white">Demo flow</a>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="hidden rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition-colors hover:border-slate-500 hover:text-white sm:inline-flex"
            >
              Log in
            </Link>
            <a
              href="#contact"
              className="inline-flex rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition-transform hover:scale-[1.02]"
            >
              Book a demo
            </a>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden px-4 py-24 sm:px-6 sm:py-32">
          <div className="pointer-events-none absolute inset-0 opacity-[0.04]" style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.15) 1px, transparent 1px)',
            backgroundSize: '64px 64px',
          }} />
          <div className="relative mx-auto max-w-5xl text-center">
            <p className="mb-6 text-xs font-bold uppercase tracking-[0.28em] text-slate-500">
              Autonomous Operational Intelligence
            </p>
            <h1 className="text-5xl font-bold tracking-tight sm:text-7xl lg:text-8xl">
              Your operations run themselves.
            </h1>
            <p className="mx-auto mt-8 max-w-3xl text-lg leading-relaxed text-slate-300 sm:text-2xl">
              ASI connects the systems, people and AI you already use — and carries real operational processes from event to outcome.
            </p>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-500 sm:text-lg">
              It understands context, decides what should happen next, launches the required actions, checks the result, and escalates only when human judgment is needed.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href="#how"
                className="inline-flex min-w-52 items-center justify-center rounded-xl bg-white px-7 py-4 font-semibold text-slate-950 transition-transform hover:scale-[1.02]"
              >
                See how it works
              </a>
              <a
                href="#hospitality"
                className="inline-flex min-w-52 items-center justify-center rounded-xl border border-slate-700 px-7 py-4 font-semibold text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
              >
                See the working vertical
              </a>
            </div>
          </div>
        </section>

        <section className="border-y border-slate-800/70 bg-slate-900/30 px-4 py-20 sm:px-6">
          <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[0.9fr_1.1fr] md:items-start">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500">What ASI is</p>
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">Not another dashboard.</h2>
            </div>
            <div className="space-y-6 text-lg leading-relaxed text-slate-300">
              <p>
                Most operational software still leaves the real work to people: notice the event, open several systems, decide what to do, message someone, follow up, and check whether it was completed.
              </p>
              <p>
                ASI is the layer that keeps that process moving. Existing software remains in place; ASI connects it into one controlled operational flow.
              </p>
            </div>
          </div>
        </section>

        <section id="how" className="scroll-mt-24 px-4 py-24 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <div className="max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500">From event to outcome</p>
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">One complete operational cycle.</h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-400">
                The same core pattern can run across different industries because the hard part is not generating text. It is carrying a real process through safely and reliably.
              </p>
            </div>

            <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {PROCESS_STEPS.map(([number, title, body]) => (
                <div key={number} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
                  <span className="text-xs font-bold tracking-[0.2em] text-slate-600">{number}</span>
                  <h3 className="mt-5 text-xl font-bold">{title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-slate-400">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="use-cases" className="scroll-mt-24 border-y border-slate-800/70 bg-slate-900/30 px-4 py-24 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <div className="max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500">Where it applies</p>
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">Built for real-world operations.</h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-400">
                ASI is vertical-agnostic at the core. Industry rules, tools, approvals, and workflows sit on top of the same operational engine.
              </p>
            </div>

            <div className="mt-12 grid gap-5 md:grid-cols-2">
              {USE_CASES.map(({ eyebrow, title, body }) => (
                <div key={title} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-7">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-600">{eyebrow}</p>
                  <h3 className="mt-4 text-2xl font-bold">{title}</h3>
                  <p className="mt-3 leading-relaxed text-slate-400">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="hospitality" className="scroll-mt-24 px-4 py-24 sm:px-6">
          <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500">First deployed vertical</p>
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">Hospitality & Property Operations</h2>
              <p className="mt-6 text-lg leading-relaxed text-slate-400">
                Our first complete vertical proves the model in an environment with constant messages, bookings, deadlines, physical tasks, exceptions, and multiple external systems.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/features/communication" className="rounded-xl bg-white px-6 py-3 font-semibold text-slate-950">
                  Communication demo
                </Link>
                <Link href="/features/location-analysis" className="rounded-xl border border-slate-700 px-6 py-3 font-semibold text-slate-200 hover:border-slate-500">
                  Location analysis
                </Link>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {HOSPITALITY_CAPABILITIES.map((capability) => (
                <div key={capability} className="flex min-h-28 items-end rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
                  <p className="font-semibold leading-snug text-slate-200">{capability}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-slate-800/70 bg-slate-900/30 px-4 py-24 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-12 lg:grid-cols-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500">No rip-and-replace</p>
                <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">Connect what you already use.</h2>
              </div>
              <div className="space-y-5 text-lg leading-relaxed text-slate-400">
                <p>
                  ASI is designed to sit above existing systems rather than force an organization onto one giant replacement platform.
                </p>
                <p>
                  APIs, messaging channels, databases, internal tools, human approvals, AI models, and operational staff can all remain part of the process — with ASI deciding and controlling what happens next.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="demo" className="scroll-mt-24 px-4 py-24 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <div className="max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500">Hong Kong demo flow</p>
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">One incident. Full autonomous follow-through.</h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-400">
                A universal scenario for showing agentic AI in real operations — without tying the story to one industry.
              </p>
            </div>

            <div className="mt-12 rounded-3xl border border-slate-800 bg-slate-900/50 p-7 sm:p-10">
              <div className="grid gap-8 lg:grid-cols-[0.75fr_1.25fr]">
                <div>
                  <p className="text-sm font-semibold text-slate-500">Example event</p>
                  <p className="mt-3 text-2xl font-bold leading-snug">
                    A critical asset issue is reported while the site is occupied and a service SLA is already running.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    'Classify urgency and understand the live context',
                    'Check occupancy, rules, dependencies, and available response paths',
                    'Notify the affected person with the right instructions',
                    'Assign the right technician or internal team automatically',
                    'Track acknowledgement, arrival, completion, and SLA risk',
                    'Escalate only if the normal path fails or approval is required',
                    'Verify the outcome instead of assuming the task is done',
                    'Store the decisions, actions, evidence, and final result',
                  ].map((item) => (
                    <div key={item} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-sm leading-relaxed text-slate-300">
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="contact" className="scroll-mt-24 border-t border-slate-800/70 px-4 py-24 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500">ASI Global</p>
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">See the system run a real process.</h2>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-slate-400">
              We are preparing ASI for international pilots and partnerships. Tell us what operation you want to automate and we will map the flow from event to outcome.
            </p>

            <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
              <a
                href={`mailto:${productSupportEmail}`}
                className="inline-flex items-center justify-center rounded-xl bg-white px-7 py-4 font-semibold text-slate-950"
              >
                {productSupportEmail}
              </a>
              <a
                href={telegramSupportBotUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-7 py-4 font-semibold text-slate-200 hover:border-slate-500"
              >
                <TgIcon className="h-4 w-4" />
                @{telegramSupportBotHandle}
              </a>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

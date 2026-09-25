import type { Metadata } from 'next';

import { SiteHeader } from '@/components/site/SiteHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import {
  Section,
  Eyebrow,
  Headline,
  GoldRule,
  PrimaryCta,
  SecondaryCta,
} from '@/components/site/primitives';
import { LogoMark } from '@/components/site/LogoMark';
import { Shiro } from '@/components/site/Shiro';
import { FlagCircle } from '@/components/site/FlagCircle';
import { GUEST_AUTOPILOT_ORIGIN } from '@/config/publicOrigins';

const title = 'ASI Global Europe — Autonomous Industrial Operations';
const description =
  'ASI Global coordinates routine industrial and physical operations across tasks, contractors, SLAs and existing systems, with humans handling exceptions.';
const url = `${GUEST_AUTOPILOT_ORIGIN}/markets/netherlands`;

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: url },
  openGraph: {
    title,
    description,
    url,
    siteName: 'ASI Global',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title,
    description,
  },
};

const INDUSTRIAL_USE_CASES = [
  {
    title: 'Equipment & Site Events',
    description: 'Receive operational events and turn them into structured action.',
  },
  {
    title: 'Contractor Coordination',
    description: 'Route work to the right person or service provider and track completion.',
  },
  {
    title: 'SLA & Exception Management',
    description: 'Track deadlines automatically and escalate when work goes outside the expected flow.',
  },
  {
    title: 'Operational Verification',
    description: 'Confirm that required work was completed before the task is closed.',
  },
] as const;

const PILOT_STEPS = [
  'Connect one operational event source.',
  'Let ASI turn events into actions.',
  'Route real work to operators or contractors.',
  'Track SLA and completion.',
  'Measure response time, manual coordination saved and exception rate.',
] as const;

export default function NetherlandsMarketPage() {
  return (
    <div className="font-sans bg-asi-ivory text-asi-navy">
      <SiteHeader />

      <main>
        <section className="relative bg-asi-ivory px-5 sm:px-8 pt-12 sm:pt-20 pb-16 sm:pb-24 overflow-hidden">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-[1.05fr,0.95fr] gap-12 lg:gap-16 items-center">
            <div>
              <div className="flex items-center gap-3">
                <LogoMark size={32} />
                <span className="font-serif text-xl">ASI Global</span>
              </div>
              <p className="mt-2 text-xs uppercase tracking-[0.22em] text-asi-navy/65">
                Europe · Autonomous Industrial Operations
              </p>
              <Headline as="h1" className="mt-7 text-4xl sm:text-6xl">
                Autonomous Operations
                <br />
                <span className="text-asi-gold">for the Physical World.</span>
              </Headline>
              <p className="mt-5 font-serif italic text-xl sm:text-2xl text-asi-navy/70">
                Operations on autopilot. Humans on exceptions.
              </p>
              <GoldRule className="mt-6 mb-6" />
              <p className="text-asi-navy/70 max-w-xl leading-relaxed">
                ASI coordinates routine work across people, contractors, software and physical
                operations. Events come in, work is routed and tracked, and people step in only
                when a real decision is needed.
              </p>
              <div className="mt-9 flex flex-wrap gap-4">
                <PrimaryCta href="#pilot">Explore the pilot model</PrimaryCta>
                <SecondaryCta href="/#intelligence">Explore the platform</SecondaryCta>
              </div>
            </div>

            <div className="border border-asi-border bg-asi-paper p-8 sm:p-10">
              <div className="flex items-center justify-between">
                <Shiro country="nl" size={72} />
                <FlagCircle country="nl" size={38} />
              </div>
              <p className="mt-10 text-xs font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
                Netherlands / Europe
              </p>
              <h2 className="mt-3 font-serif text-3xl">Amsterdam industrial track</h2>
              <p className="mt-4 text-sm text-asi-navy/65 leading-relaxed">
                One ASI engine, adapted from hospitality to construction, field work and other
                operationally complex physical businesses.
              </p>
              <div className="mt-8 border-t border-asi-border pt-6">
                <p className="text-xs uppercase tracking-[0.16em] text-asi-navy/55">Target program</p>
                <p className="mt-2 font-serif text-xl">
                  LANDCROS Innovation Studios Europe Challenge 2026
                </p>
              </div>
            </div>
          </div>
        </section>

        <Section variant="paper">
          <Eyebrow>The problem</Eyebrow>
          <Headline className="text-3xl sm:text-5xl max-w-3xl">
            Physical operations still depend on manual coordination.
          </Headline>
          <div className="mt-10 grid md:grid-cols-2 gap-8">
            <p className="text-asi-navy/70 leading-relaxed">
              A machine event happens. A contractor needs to be called. Someone must check a
              procedure, assign a task, track a deadline, verify the result and update the record.
            </p>
            <p className="text-asi-navy/70 leading-relaxed">
              ASI connects those steps into one operating flow instead of leaving people to
              coordinate every handoff manually.
            </p>
          </div>
        </Section>

        <Section variant="navy">
          <Eyebrow dark>How ASI works</Eyebrow>
          <Headline className="text-3xl sm:text-5xl text-asi-ivory max-w-3xl">
            One event becomes one coordinated flow.
          </Headline>
          <div className="mt-10 flex flex-wrap items-center gap-2 text-sm">
            {[
              'Operational event',
              'ASI understands context',
              'Checks rules',
              'Routes the task',
              'Tracks SLA',
              'Verifies completion',
              'Updates the record',
              'Escalates if needed',
            ].map((step, index, items) => (
              <div key={step} className="flex items-center gap-2">
                <span className="border border-asi-ivory/25 px-3 py-2 text-asi-ivory/85 rounded-sm">
                  {step}
                </span>
                {index < items.length - 1 ? <span className="text-asi-gold-soft">→</span> : null}
              </div>
            ))}
          </div>
          <p className="mt-9 text-asi-ivory/65 max-w-xl">
            ASI does more than show data. It helps run the work.
          </p>
        </Section>

        <Section variant="ivory">
          <Eyebrow>Industrial use cases</Eyebrow>
          <Headline className="text-3xl sm:text-5xl max-w-3xl">
            Start with the coordination work people repeat every day.
          </Headline>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {INDUSTRIAL_USE_CASES.map((item) => (
              <div key={item.title} className="border border-asi-border bg-asi-paper p-6">
                <h3 className="font-serif text-xl">{item.title}</h3>
                <p className="mt-3 text-sm text-asi-navy/65 leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section variant="paper">
          <Eyebrow>Same engine, different business</Eyebrow>
          <Headline className="text-3xl sm:text-5xl max-w-3xl">
            The operating logic already fits more than hospitality.
          </Headline>
          <div className="mt-12 grid md:grid-cols-2 gap-px bg-asi-border border border-asi-border">
            <div className="bg-asi-ivory p-8">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
                Hospitality
              </p>
              <p className="mt-5 text-asi-navy/70 leading-relaxed">
                Booking → guest verification → payment → access → cleaning → maintenance →
                exception
              </p>
            </div>
            <div className="bg-asi-ivory p-8">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
                Industrial
              </p>
              <p className="mt-5 text-asi-navy/70 leading-relaxed">
                Site event → validation → task routing → contractor → SLA → verification →
                exception
              </p>
            </div>
          </div>
          <p className="mt-7 font-serif text-2xl">Different workflows. Same autonomous operating engine.</p>
        </Section>

        <Section variant="ivory">
          <Eyebrow>European expansion</Eyebrow>
          <Headline className="text-3xl sm:text-5xl max-w-3xl">
            LANDCROS Innovation Studios Europe Challenge 2026
          </Headline>
          <div className="mt-10 grid md:grid-cols-3 gap-6">
            <div className="border-l-2 border-asi-gold pl-5">
              <p className="text-xs uppercase tracking-[0.16em] text-asi-navy/55">Status</p>
              <p className="mt-2 font-serif text-xl">Target program</p>
            </div>
            <div className="border-l-2 border-asi-gold pl-5">
              <p className="text-xs uppercase tracking-[0.16em] text-asi-navy/55">Location</p>
              <p className="mt-2 font-serif text-xl">Amsterdam, Netherlands</p>
            </div>
            <div className="border-l-2 border-asi-gold pl-5">
              <p className="text-xs uppercase tracking-[0.16em] text-asi-navy/55">Focus</p>
              <p className="mt-2 font-serif text-xl">Autonomous Operations</p>
            </div>
          </div>
          <p className="mt-8 max-w-3xl text-sm text-asi-navy/65 leading-relaxed">
            ASI is being prepared for the challenge as an autonomous operations platform for
            physical and industrial workflows. This page does not imply selection, endorsement or
            a partnership with the program or its organizers.
          </p>
        </Section>

        <Section id="pilot" variant="paper">
          <Eyebrow>Pilot concept</Eyebrow>
          <Headline className="text-3xl sm:text-5xl max-w-3xl">
            Start with one workflow. Prove it. Expand.
          </Headline>
          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {PILOT_STEPS.map((step, index) => (
              <div key={step} className="border border-asi-border bg-asi-ivory p-5">
                <span className="text-xs font-semibold text-asi-gold-text">0{index + 1}</span>
                <p className="mt-3 text-sm text-asi-navy/70 leading-relaxed">{step}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-asi-navy/65 max-w-3xl leading-relaxed">
            The first pilot does not need to replace existing systems. ASI can operate as the
            coordination layer between them.
          </p>
        </Section>

        <section className="bg-asi-navy text-asi-ivory px-5 sm:px-8 py-16 sm:py-24">
          <div className="max-w-3xl mx-auto text-center">
            <Eyebrow dark>ASI Global</Eyebrow>
            <Headline className="text-3xl sm:text-5xl text-asi-ivory">
              Build the first autonomous workflow with ASI.
            </Headline>
            <p className="mt-5 text-asi-ivory/65">
              Hospitality is proof #1. Industrial operations are the next proof — not the final market.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-4">
              <PrimaryCta href="/#partner">Talk to ASI</PrimaryCta>
              <a
                href="/#intelligence"
                className="inline-flex items-center justify-center px-7 py-3.5 border border-asi-ivory/55 text-asi-ivory text-sm font-sans font-semibold tracking-wide rounded-sm hover:border-asi-ivory transition-colors"
              >
                Explore the Platform
              </a>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

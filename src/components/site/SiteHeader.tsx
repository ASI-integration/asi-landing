'use client';

import Link from 'next/link';
import { useState } from 'react';
import { LogoMark } from './LogoMark';

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/#intelligence', label: 'Platform' },
  { href: '/#micro-hotels', label: 'Micro Hotels' },
  { href: '/markets', label: 'Markets' },
  { href: '/media', label: 'Media' },
  { href: '/#about', label: 'About' },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-asi-ivory/90 backdrop-blur-md border-b border-asi-border">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 sm:h-20 flex items-center justify-between gap-6">
        <Link href="/" className="flex items-center gap-3 shrink-0 text-asi-navy" onClick={() => setOpen(false)}>
          <LogoMark size={28} />
          <span className="font-serif text-lg tracking-tight">ASI Global</span>
        </Link>

        <nav className="hidden lg:flex items-center gap-8">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm font-sans text-asi-navy/75 hover:text-asi-navy transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden lg:block shrink-0">
          <Link
            href="/#partner"
            className="inline-flex items-center px-5 py-2.5 border border-asi-navy text-asi-navy text-sm font-sans font-semibold tracking-wide rounded-sm hover:bg-asi-navy hover:text-asi-ivory transition-colors"
          >
            Partner with ASI
          </Link>
        </div>

        <button
          type="button"
          className="lg:hidden inline-flex items-center justify-center w-10 h-10 text-asi-navy"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            {open ? (
              <path d="M4 4L18 18M18 4L4 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            ) : (
              <>
                <line x1="2" y1="6" x2="20" y2="6" stroke="currentColor" strokeWidth="1.5" />
                <line x1="2" y1="11" x2="20" y2="11" stroke="currentColor" strokeWidth="1.5" />
                <line x1="2" y1="16" x2="20" y2="16" stroke="currentColor" strokeWidth="1.5" />
              </>
            )}
          </svg>
        </button>
      </div>

      {open ? (
        <nav className="lg:hidden border-t border-asi-border bg-asi-ivory px-5 py-4 flex flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="py-2.5 text-base font-sans text-asi-navy border-b border-asi-border/60 last:border-b-0"
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/#partner"
            onClick={() => setOpen(false)}
            className="mt-4 inline-flex items-center justify-center px-5 py-3 bg-asi-navy text-asi-ivory text-sm font-sans font-semibold tracking-wide rounded-sm"
          >
            Partner with ASI
          </Link>
        </nav>
      ) : null}
    </header>
  );
}

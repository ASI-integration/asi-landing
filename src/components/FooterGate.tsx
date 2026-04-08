 'use client';

 import { usePathname } from 'next/navigation';
 import { LegalFooter } from '@/components/LegalFooter';

 export function FooterGate() {
   const pathname = usePathname() || '';

   // RU landing (`/ru`) renders its own RU-specific footer.
   if (pathname === '/ru' || pathname.startsWith('/ru/')) return null;

   return <LegalFooter />;
 }


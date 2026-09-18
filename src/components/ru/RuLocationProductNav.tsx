import Link from 'next/link';
import { LOCATION_REPORT_PRODUCT_PATH, LOCATION_REPORT_SAMPLE_PATH } from '@/lib/location/report-state';

const ANALYSIS_HREF = '/ru/location-analysis?mode=residential#location-check';
const METHODOLOGY_HREF = '/ru/kak-my-ocenivaem-dohodnost-obektov';

const LOCATION_NAV = [
  { href: LOCATION_REPORT_PRODUCT_PATH, label: 'Оценка объекта', match: LOCATION_REPORT_PRODUCT_PATH },
  { href: ANALYSIS_HREF, label: 'Проверка адреса', match: '/ru/location-analysis' },
  { href: METHODOLOGY_HREF, label: 'Методология', match: METHODOLOGY_HREF },
  { href: LOCATION_REPORT_SAMPLE_PATH, label: 'Пример отчёта', match: LOCATION_REPORT_SAMPLE_PATH },
] as const;

/**
 * Compact RU-only product marker for Location Intelligence surfaces.
 * Does not alter global RU navigation.
 */
export function RuLocationProductNav({ currentPath }: { currentPath: string }) {
  return (
    <nav
      aria-label="Оценка локации"
      className="flex flex-wrap gap-x-1 gap-y-2 border-y border-asi-border py-3 mb-10"
    >
      {LOCATION_NAV.map((item) => {
        const active =
          currentPath === item.match ||
          (item.match === '/ru/location-analysis' && currentPath.startsWith('/ru/location-analysis'));
        return (
          <Link
            key={item.label}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`px-3 py-1.5 text-xs sm:text-sm font-sans tracking-wide transition-colors rounded-sm ${
              active
                ? 'bg-asi-navy text-asi-ivory'
                : 'text-asi-navy/70 hover:text-asi-navy hover:bg-asi-paper'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

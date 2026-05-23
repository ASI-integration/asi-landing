type LocationReportMapPanelProps = {
  address: string;
  coordinates?: { lat: number; lon: number } | null;
  mapUnavailable?: boolean;
  unavailableMessageRu?: string;
};

function formatCoordinates(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function LocationReportMapPanel({
  address,
  coordinates,
  mapUnavailable = false,
  unavailableMessageRu = 'Карта временно недоступна, расчёт сохранён.',
}: LocationReportMapPanelProps) {
  const hasCoordinates =
    coordinates != null
    && Number.isFinite(coordinates.lat)
    && Number.isFinite(coordinates.lon);

  return (
    <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 overflow-hidden">
      <div className="px-5 sm:px-6 py-4 border-b border-slate-800/60">
        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Локация на карте</p>
        <p className="mt-2 text-sm text-slate-200 leading-snug">{address}</p>
        {hasCoordinates ? (
          <p className="mt-1 text-xs text-slate-400 tabular-nums">
            Координаты: {formatCoordinates(coordinates.lat, coordinates.lon)}
          </p>
        ) : null}
      </div>
      <div className="px-5 sm:px-6 py-8 sm:py-10 flex flex-col items-center justify-center text-center min-h-[140px] bg-slate-900/40">
        {mapUnavailable ? (
          <>
            <p className="text-sm font-medium text-amber-200/95">{unavailableMessageRu}</p>
            <p className="mt-2 text-xs text-slate-500 max-w-md leading-relaxed">
              Оценка, магниты и транспорт рассчитаны по сохранённым данным — интерактивная карта не требуется.
            </p>
          </>
        ) : (
          <p className="text-xs text-slate-500 max-w-md leading-relaxed">
            Карта окружения не подключена в этом просмотре. Адрес и координаты зафиксированы для расчёта.
          </p>
        )}
      </div>
    </div>
  );
}

export function RuCommercialTimeline({ compact = false }: { compact?: boolean }) {
  const items = [
    {
      title: 'Подключение и настройка',
      value: '0 ₽',
      detail: 'Обычно до 7 дней — срок зависит от объекта и интеграций',
    },
    {
      title: 'Полноценная работа ASI',
      value: '14 дней бесплатно',
      detail: 'Период начинается только после готовности объекта',
    },
    {
      title: 'Дальнейшая работа',
      value: 'Только по вашему решению',
      detail: 'Никакого автоматического перехода на оплату',
    },
  ] as const;

  return (
    <div className={`grid gap-px border border-asi-border bg-asi-border ${compact ? 'sm:grid-cols-3' : 'lg:grid-cols-3'}`}>
      {items.map((item, index) => (
        <div key={item.title} className="bg-asi-paper p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-asi-gold-text">
            {index + 1}. {item.title}
          </p>
          <p className="mt-3 font-serif text-2xl text-asi-navy">{item.value}</p>
          <p className="mt-3 text-sm leading-relaxed text-asi-navy/65">{item.detail}</p>
        </div>
      ))}
    </div>
  );
}

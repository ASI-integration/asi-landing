'use client';

import { useMemo, useState } from 'react';
import {
  createListingIntakeDraft,
  getChannelSyncSummary,
  operationSyncStatusLabelsRu,
  prepareChannelDistributionPackage,
  propertyListingIntakes,
  validateListingIntakeDraft,
} from '@/lib/operations';
import type { ListingIntakeDraftInput, PropertyListingIntake } from '@/lib/operations';

type ListingIntakeFormState = {
  propertyNameRu: string;
  cityRu: string;
  addressRu: string;
  descriptionRu: string;
  amenitiesText: string;
  houseRulesText: string;
  checkInText: string;
  checkOutText: string;
  accessText: string;
  cleaningText: string;
  maintenanceRoleRu: string;
  maintenanceNameRu: string;
  maintenancePhoneRu: string;
  maintenanceAvailabilityRu: string;
  photoTitlesText: string;
};

function listToText(items: string[]) {
  return items.join('\n');
}

function textToList(value: string) {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function stateFromListing(listing: PropertyListingIntake): ListingIntakeFormState {
  const maintenanceContact = listing.maintenanceContacts[0];

  return {
    propertyNameRu: listing.propertyNameRu,
    cityRu: listing.cityRu,
    addressRu: listing.addressRu,
    descriptionRu: listing.descriptionRu,
    amenitiesText: listToText(listing.amenitiesRu),
    houseRulesText: listToText(listing.houseRulesRu),
    checkInText: listToText(listing.checkInInstructionsRu),
    checkOutText: listToText(listing.checkOutInstructionsRu),
    accessText: listToText(listing.accessInfoRu),
    cleaningText: listToText(listing.cleaningRulesRu),
    maintenanceRoleRu: maintenanceContact?.roleRu ?? 'Домашний мастер',
    maintenanceNameRu: maintenanceContact?.nameRu ?? '',
    maintenancePhoneRu: maintenanceContact?.phoneRu ?? '',
    maintenanceAvailabilityRu: maintenanceContact?.availabilityRu ?? 'По заявке',
    photoTitlesText: listToText(listing.media.filter((asset) => asset.kind === 'photo').map((asset) => asset.titleRu)),
  };
}

function inputFromState(state: ListingIntakeFormState): ListingIntakeDraftInput {
  return {
    id: 'listing-intake-demo',
    ownerNameRu: 'Демо-собственник',
    propertyNameRu: state.propertyNameRu,
    cityRu: state.cityRu,
    addressRu: state.addressRu,
    descriptionRu: state.descriptionRu,
    amenitiesRu: textToList(state.amenitiesText),
    houseRulesRu: textToList(state.houseRulesText),
    checkInInstructionsRu: textToList(state.checkInText),
    checkOutInstructionsRu: textToList(state.checkOutText),
    accessInfoRu: textToList(state.accessText),
    cleaningRulesRu: textToList(state.cleaningText),
    maintenanceContact: {
      roleRu: state.maintenanceRoleRu,
      nameRu: state.maintenanceNameRu,
      phoneRu: state.maintenancePhoneRu,
      availabilityRu: state.maintenanceAvailabilityRu,
    },
    photoTitlesRu: textToList(state.photoTitlesText),
  };
}

const emptyState: ListingIntakeFormState = {
  propertyNameRu: '',
  cityRu: '',
  addressRu: '',
  descriptionRu: '',
  amenitiesText: '',
  houseRulesText: '',
  checkInText: '',
  checkOutText: '',
  accessText: '',
  cleaningText: '',
  maintenanceRoleRu: 'Домашний мастер',
  maintenanceNameRu: '',
  maintenancePhoneRu: '',
  maintenanceAvailabilityRu: 'По заявке',
  photoTitlesText: '',
};

function Field({
  label,
  value,
  onChange,
  textarea = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  textarea?: boolean;
}) {
  const className =
    'mt-1 w-full rounded-lg border border-[var(--t-border)] bg-[var(--t-bg)] px-3 py-2 text-sm text-[var(--t-text)] outline-none focus:border-[var(--t-accent)]';

  return (
    <label className="block text-sm font-medium text-[var(--t-text)]">
      {label}
      {textarea ? (
        <textarea className={`${className} min-h-[88px]`} value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input className={className} value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

export function ListingIntakeDemo() {
  const mockListing = propertyListingIntakes[0];
  const [form, setForm] = useState<ListingIntakeFormState>(() => stateFromListing(mockListing));
  const listing = useMemo(() => createListingIntakeDraft(inputFromState(form)), [form]);
  const validation = useMemo(() => validateListingIntakeDraft(listing), [listing]);
  const distributionPackage = useMemo(() => prepareChannelDistributionPackage(listing), [listing]);
  const syncSummary = useMemo(() => getChannelSyncSummary(listing.distributionTargets), [listing]);

  const update = (key: keyof ListingIntakeFormState) => (value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  return (
    <section className="px-4 sm:px-6 py-14 sm:py-16 bg-[var(--t-bg)] border-y border-[var(--t-border)]">
      <div className="max-w-6xl mx-auto">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--t-muted)]">
            Внутреннее демо / listing intake
          </p>
          <h2 className="mt-3 text-2xl sm:text-3xl font-bold text-[var(--t-text)]">Intake карточки объекта</h2>
          <p className="mt-3 text-base text-[var(--t-text-2)] leading-relaxed">
            Демо показывает, как собственник один раз передает данные объекта, а ASI собирает из них единую карточку и
            distribution package для будущего channel-manager слоя.
          </p>
        </div>

        <div className="mt-8 grid lg:grid-cols-[0.95fr_1.05fr] gap-6 lg:gap-8 items-start">
          <div className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-[var(--t-text)]">Форма intake</h3>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-[var(--t-border)] bg-[var(--t-bg)] px-3 py-2 text-xs font-semibold text-[var(--t-text)]"
                  onClick={() => setForm(stateFromListing(mockListing))}
                >
                  Подставить mock
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-[var(--t-border)] bg-[var(--t-bg)] px-3 py-2 text-xs font-semibold text-[var(--t-text)]"
                  onClick={() => setForm(emptyState)}
                >
                  Очистить демо
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Название объекта" value={form.propertyNameRu} onChange={update('propertyNameRu')} />
                <Field label="Город" value={form.cityRu} onChange={update('cityRu')} />
              </div>
              <Field label="Адрес / район" value={form.addressRu} onChange={update('addressRu')} />
              <Field label="Описание" value={form.descriptionRu} onChange={update('descriptionRu')} textarea />
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Удобства (по строкам)" value={form.amenitiesText} onChange={update('amenitiesText')} textarea />
                <Field label="Правила дома (по строкам)" value={form.houseRulesText} onChange={update('houseRulesText')} textarea />
                <Field label="Check-in инструкции" value={form.checkInText} onChange={update('checkInText')} textarea />
                <Field label="Check-out инструкции" value={form.checkOutText} onChange={update('checkOutText')} textarea />
                <Field label="Доступ / ключи" value={form.accessText} onChange={update('accessText')} textarea />
                <Field label="Правила клининга" value={form.cleaningText} onChange={update('cleaningText')} textarea />
              </div>

              <div className="rounded-lg border border-[var(--t-border)] bg-[var(--t-bg)] p-4">
                <p className="text-sm font-semibold text-[var(--t-text)]">Контакт обслуживания</p>
                <div className="mt-3 grid sm:grid-cols-2 gap-4">
                  <Field label="Роль" value={form.maintenanceRoleRu} onChange={update('maintenanceRoleRu')} />
                  <Field label="Имя" value={form.maintenanceNameRu} onChange={update('maintenanceNameRu')} />
                  <Field label="Телефон" value={form.maintenancePhoneRu} onChange={update('maintenancePhoneRu')} />
                  <Field
                    label="Доступность"
                    value={form.maintenanceAvailabilityRu}
                    onChange={update('maintenanceAvailabilityRu')}
                  />
                </div>
              </div>

              <div className="rounded-lg border border-dashed border-[var(--t-border)] bg-[var(--t-bg)] p-4">
                <p className="text-sm font-semibold text-[var(--t-text)]">Фото объекта / mock upload area</p>
                <p className="mt-1 text-xs text-[var(--t-muted)]">Backend загрузки пока нет. Здесь только названия demo assets.</p>
                <Field label="Фото (по строкам)" value={form.photoTitlesText} onChange={update('photoTitlesText')} textarea />
              </div>
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-[var(--t-text)]">Единая карточка объекта</h3>
                  <p className="mt-1 text-sm text-[var(--t-text-2)]">
                    {listing.propertyNameRu || 'Без названия'} / {listing.cityRu || 'город не указан'}
                  </p>
                </div>
                <span className="rounded-full border border-[var(--t-border)] bg-[var(--t-bg)] px-3 py-1 text-xs font-semibold text-[var(--t-text)]">
                  {distributionPackage.statusRu}
                </span>
              </div>

              {!validation.isValid ? (
                <div className="mt-4 rounded-lg border border-amber-300 bg-amber-500/10 p-3">
                  <p className="text-sm font-semibold text-amber-800">Нужно заполнить</p>
                  <p className="mt-1 text-xs leading-relaxed text-amber-800">{validation.missingFieldsRu.join(', ')}</p>
                </div>
              ) : (
                <div className="mt-4 rounded-lg border border-emerald-300 bg-emerald-500/10 p-3">
                  <p className="text-sm font-semibold text-emerald-800">Готово к отправке на площадки</p>
                  <p className="mt-1 text-xs leading-relaxed text-emerald-800">
                    Package собран из формы intake. Реальной отправки в OTA пока нет.
                  </p>
                </div>
              )}

              <dl className="mt-5 grid sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <dt className="text-[var(--t-muted)]">Фото</dt>
                  <dd className="mt-1 font-medium text-[var(--t-text)]">{listing.media.length}</dd>
                </div>
                <div>
                  <dt className="text-[var(--t-muted)]">Каналы</dt>
                  <dd className="mt-1 font-medium text-[var(--t-text)]">{syncSummary.total}</dd>
                </div>
                <div>
                  <dt className="text-[var(--t-muted)]">В очереди</dt>
                  <dd className="mt-1 font-medium text-[var(--t-text)]">{syncSummary.queued}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-5">
              <h3 className="text-base font-semibold text-[var(--t-text)]">Channel sync statuses</h3>
              <div className="mt-4 grid gap-3">
                {distributionPackage.targets.map((target) => (
                  <div
                    key={target.channelId}
                    className="grid sm:grid-cols-[1fr_auto] gap-3 rounded-lg border border-[var(--t-border)] bg-[var(--t-bg)] p-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-[var(--t-text)]">{target.channelNameRu}</p>
                      <p className="mt-1 text-xs text-[var(--t-muted)]">
                        {target.canQueueSync ? 'Можно поставить в demo sync queue' : 'Пока только placeholder / draft'}
                      </p>
                    </div>
                    <div className="sm:text-right">
                      <p className="text-xs font-semibold text-[var(--t-text)]">
                        {operationSyncStatusLabelsRu[target.syncStatus]}
                      </p>
                      <p className="mt-1 text-xs text-[var(--t-muted)]">
                        pending: {target.missingFieldsRu.length}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-5">
              <h3 className="text-base font-semibold text-[var(--t-text)]">Что попадет в package</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {distributionPackage.targets[0]?.payloadFieldsRu.map((field) => (
                  <span
                    key={field}
                    className="rounded-full border border-[var(--t-border)] bg-[var(--t-bg)] px-3 py-1 text-xs text-[var(--t-text-2)]"
                  >
                    {field}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

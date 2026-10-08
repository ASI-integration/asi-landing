# Strigunov RU pilot invitation — exact pre-publication gate

The first post invites owners to apply for a **controlled, free, 14-day guest-communication pilot**; it does not imply general OTA publishing, automated contracts, payments, worker dispatch or 99% production autonomy.

## Engineering safety

- [x] Pilot lead form now routes to an authenticated-operator-visible CRM contact record with source `form` and Strigunov referral stored as a note. Landing response success is dependent on a persisted CRM id.
- [x] Public lead API returns a CRM id only; it never returns owner PII.
- [x] Legacy detailed object GET and POST are restricted to authenticated CRM operators before reading sensitive fields.
- [x] Consent checkbox and honeypot; strict contact, name and object-count validation.
- [x] Referral query is retained when navigating to the anchor on the pilot page.
- [ ] Confirm infrastructure-level anti-spam/rate protection for high-traffic public POST before a large wave. The form honeypot alone is not sufficient against deliberate abuse.
- [ ] Confirm GitHub CI passes with the route/privacy/test contract.

## Operational proof (must be completed before sending public traffic)

- [ ] On an isolated test/staging environment: submit a synthetic, explicitly labeled test lead, verify the exact `crm_contacts` record is visible to an authorized operator with correct contact type, `needs_manual_reaction`, and referral marker.
- [ ] Verify no anonymous call to the sensitive detailed object route can read owner contact, Wi-Fi passwords or access instructions.
- [ ] Deploy the reviewed release to production **through the separate owner-approved deployment gate**, after checking outbound communication changes/rollback.
- [ ] Verify production `/api/health`, `/api/version`, `/ru`, `/ru/early-access?ref=strigunov`, and `/ru/privacy`.
- [ ] Confirm the operator/CRM can process incoming leads, respond in the promised timeframe, and that there is a manual fallback for downtime.
- [ ] Mobile smoke: Android viewport, CTA anchors, keyboard, consent, loading/error state and full-length text; never fake a submission on the live public site.
- [ ] Review current legal executor status/address, privacy consent wording and retention obligations.
- [ ] Approve the text/creative and explicitly authorize the post by Strigunov.

**Launch link:** `https://asi-global.ru/ru/early-access?ref=strigunov`

**Do not mark READY** based solely on merged code, a healthy HTTP page, or successful CI. Evidence of CRM receipt and deployment is required.

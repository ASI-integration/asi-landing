# RU location report payments

The paid location report order flow is provider-neutral. A report request stores
`product_type=location_report_detail`, `payment_provider`, optional `payment_id`,
optional `payment_url`, and server-owned `access_status`.

Current fallback:

- `manual`: create the order as `pending_payment` and confirm payment manually from server-side tooling.
- `prodamus`: create the order as `pending_payment` and send the user to `LOCATION_REPORT_PAYMENT_URL` or `PRODAMUS_PAYMENT_URL` when configured.

TODO:

- Add Prodamus API/webhook integration when automation is available.
- Retry YooKassa after website maturity review.
- Any payment webhook must include `location_report_request_id` and `product_type=location_report_detail` before it can set `access_status=paid`.

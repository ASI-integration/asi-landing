# OPS v17.2 golden-path acceptance

The admin-only Booking Ops panel and `POST /api/admin/booking-ops-golden-path-acceptance` plan or execute the existing OPS v16 event lifecycle for one account-scoped test reservation.

Execution is disabled unless `OPS_GOLDEN_PATH_ACCEPTANCE_ENABLED=true`, `dryRun` is explicitly `false`, `confirm` is `true`, and `reservation_metadata` contains `acceptance_safe: true` (or an equivalent supported test marker). Dry-run is the default. The API accepts `bookingOpsRecordId` or `asiReference`; UUIDs are not hardcoded.

The runner creates deterministic internal domain events and uses the existing lifecycle reducer. It never enables sending and does not call messaging, OTA, channel-manager, or payment providers. Its report contains operational counts and results only, with no guest contact or identity fields.

No production run, deployment, migration, or production-data change is part of this implementation.

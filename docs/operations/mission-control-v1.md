# Owner Mission Control v1

Owner-only status board for long-running ASI/KIM/ORIS work.

## UI

Route:

- `/dashboard/control-center`

The page shows three large project cards:

- KIM
- ASI ENGINE
- ORIS

Each card exposes only safe operational telemetry:

- RUNNING / WAITING / ERROR / DONE / IDLE
- overall progress
- current stage and stage progress
- completed / total items
- speed
- ETA
- current item
- last safe event
- last update age

The page refreshes every 5 seconds and marks data stale after 2 minutes.

## Access

The page and dashboard status endpoint use the existing Development Owner guard.

The ingest endpoint is:

- `POST /api/internal/mission-control/status`

It accepts the existing `ASI_RUNTIME_INGEST_TOKEN` bearer credential. The Windows reporter can fall back to the already-provisioned `INTERNAL_TEST_SECRET` via `x-internal-test-secret`, so no new production secret is required.

Payload validation is allowlisted and rejects likely secrets, local filesystem paths, nested objects, unknown projects, malformed progress values, and oversized bodies.

## Persistence

The server writes only three fixed JSON files under:

- `$COMM_STATE_DIR/mission-control`

Production already uses a persistent shared `COMM_STATE_DIR`, so no new database migration is needed.

Writes are atomic (temporary file + rename).

## Local reporter

Run one snapshot without network writes:

```powershell
python scripts/mission-control-reporter.py --dry-run
```

After the endpoint is deployed, continuous push can be started with:

```powershell
python scripts/mission-control-reporter.py --loop --interval 5
```

The reporter reads only local status metadata:

- KIM batch status + current batch log
- ASI production-continuation status
- ORIS archive summaries

It never sends source files, transcripts, raw logs, local paths, tokens, or provider credentials.

Optional local-path overrides:

- `KIM_PROJECT_ROOT`
- `ORIS_PROJECT_ROOT`
- `ASI_CONTINUATION_STATUS`
- `ASI_LOCAL_REPO`
- `ASI_MISSION_CONTROL_LOCAL_DIR`
- `ASI_MISSION_CONTROL_ENDPOINT`

## TailAdmin reference

The visual hierarchy (large KPI cards, rounded status cards, badges, progress bars) was reviewed against the downloaded TailAdmin MIT template. Mission Control uses project-native components/classes rather than importing the TailAdmin application or its dependencies.

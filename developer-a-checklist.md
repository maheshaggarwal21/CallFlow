# Developer A Checklist (CALLFLOW_PLAN_V6)

## Backend (apps/api)
- [x] DB migrations 001-003 with required fields and indexes
- [x] Express setup and CORS with WEB_ORIGIN + credentials
- [x] Auth: JWT, httpOnly SameSite=None cookie, mobile token in body
- [x] Shared types with call_stats, intercom_phone_number, source_label, color_index, daily_breakdown
- [x] Employees endpoints: list with call_stats, names, create/patch, API key
- [x] Calls list/search joins + filters + resolution endpoint
- [x] Lines with call_count_today
- [x] Intercoms with call_count_total and PATCH fix
- [x] Devices CRUD + names
- [x] Students import + PATCH + DELETE
- [x] System status endpoint
- [x] Analytics: misc-count expanded, overview, employee daily_breakdown (current week)
- [x] AI queue + worker wiring

## FTP Service (apps/ftp-service)
- [x] Filename parser regex supports 1-3 digit intercom codes
- [x] Poller runs Mon-Sat, 9-18, every 15 minutes
- [x] Dedup by source_file_key, misc if duration < 30s
- [x] Student and employee lookup during ingest
- [x] Updates system_state.ftp_last_sync_at
- [ ] E2E FTP test with real KoreCall credentials (on hold - needs creds)

## Mobile (apps/mobile)
- [x] Login screen (API key), device setup, offline queue indicator
- [x] Call sync every 15 minutes with offline queue
- [x] Android runtime permissions requested on first launch
- [x] QR scan button and scanner implementation

## Validation / QA (on hold)
- [ ] R2 + OpenAI AI pipeline validation (needs creds)
- [ ] FTP to dashboard verification with real recordings (needs creds)
- [ ] Mobile end-to-end: Android call to dashboard (needs device)
- [ ] Integration checks: intercom_phone_number, source filter, agent filter rules

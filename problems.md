# Problems / Blockers

- No new blockers noted in the latest batch.

- Docker CLI not found (`docker` and `docker-compose` commands missing). Unable to start Postgres/Redis containers for migration tests.
- Retry on 2026-04-30 still failed: `docker` command not found.
- Docker Desktop daemon not running: npipe //./pipe/dockerDesktopLinuxEngine not found when using docker.exe.
- Docker Desktop started but compose pull failed: `docker-credential-desktop` missing from PATH; image pulls aborted.
- API crash on PATCH /intercoms/:id: Postgres error `could not determine data type of parameter $1` at intercoms.routes.ts:40 (likely needs explicit type cast for nullable phone).
- Resolved: PATCH /intercoms/:id now casts phone_number parameter; retested OK.

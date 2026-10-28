# SHOOT2CODE

A self-contained internal hackathon portal with a responsive frontend, a Python standard-library API, and JSON-file persistence.

## Run locally

From this folder, run:

```powershell
py server.py
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). The server creates `data\store.json` on first launch. That file contains the event settings, missions, registrations, teams, schedule, and FAQ; keep it private and back it up. Set `S2C_DATA_DIR` to store this file in a different private directory.

The first launch prints a generated organizer email and password once. Set `S2C_ADMIN_PASSWORD` before starting the server to provide your own password, and optionally set `S2C_ADMIN_EMAIL` (default: `admin@shoot2code.local`). If a generated password is lost, stop the server, remove only `data\store.json`, and restart it; this also resets portal data.

## Configure the event

Sign in using **Organizer login** → **Event settings**. Enter the confirmed January dates, venue/format, registration deadline, team-size limits, capacity, organizer, and contact email. Blank dates and venue details remain “to be announced”; no actual event date or location is assumed by the starter data.

The organizer console also manages missions, registration status, project approvals and scores, schedule, and FAQ. The initial mission cards and schedule are editable starter examples, not official event announcements.

## Optional email confirmation

Email is not sent unless SMTP is configured in the server environment:

- `S2C_SMTP_HOST`
- `S2C_SMTP_PORT` (defaults to `587`)
- `S2C_SMTP_FROM` (defaults to `S2C_SMTP_USER`)
- `S2C_SMTP_USER` and `S2C_SMTP_PASSWORD` (optional if the SMTP relay does not require authentication)

Set `S2C_COOKIE_SECURE=1` when serving behind HTTPS. The included `http.server` service is intended for local/internal prototyping; use a production-grade HTTPS deployment, durable database, and managed secret storage before exposing the portal to a public network.

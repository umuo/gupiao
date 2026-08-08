# vinext-starter

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Independent Accounts

Paper Alpha includes its own email-and-password account system and does not
depend on ChatGPT, OpenAI workspace headers, or an external identity provider.
Passwords are stored as salted PBKDF2-SHA256 hashes. Login sessions use random
tokens in `HttpOnly`, `SameSite=Lax` cookies; only token hashes are stored in D1.

The `DB` binding is required for users, sessions, personal strategies, and AI
endpoint preferences. Apply the generated migrations in `drizzle/` when
deploying outside Sites.

On a new database, the first registered account is assigned the `superadmin`
role. When upgrading an existing database, migration `0001` promotes the
earliest account if no superadmin exists. No default password is stored in the
source; the site owner sets the superadmin password during registration.

## OpenAI-Compatible Strategy Generation

Users can configure an HTTPS API Base URL and model name for services that
implement `POST /chat/completions`. The API key is never written to the database
or source code; it stays in the current page session and is sent only to the
server-side proxy for the generation request.

## Scheduled Signals and Webhooks

Scheduled tasks and notification channels are independent. A task selects one
or more existing channels rather than storing Webhook details itself. Users can
create two kinds of strategy tasks:

- `daily`: uses TickFlow Free historical daily K-lines and runs once on selected
  weekdays at the configured Beijing time.
- `realtime`: checks only during the mainland continuous auction sessions
  (`09:30-11:30`, `13:00-15:00`, Asia/Shanghai) and requires the user to save a
  TickFlow API key with realtime quote permission.

Realtime API keys are encrypted with AES-GCM before being stored in D1. Copy
`.dev.vars.example` to `.dev.vars` for local development. In an independent
deployment, configure long random values for `APP_ENCRYPTION_KEY` and
`CRON_SECRET` as Worker secrets; do not commit production values. The Worker
includes a once-per-minute scheduled handler. An external scheduler can instead
call `POST /api/cron/run` with `Authorization: Bearer <CRON_SECRET>`.

Notification channels include custom Webhook, DingTalk group robot and Feishu
group robot types. DingTalk and Feishu use their native text-message JSON
formats and validate the provider response during connectivity tests. Custom
Webhooks support `GET`, `POST`, `PUT`, and `PATCH`, encrypted request headers,
JSON, form-encoded and plain-text bodies, and user-defined templates. A single
signal is sent to all channels selected by its task. Notifications are signals
only—they do not submit real brokerage orders.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)

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
Before submitting a login, the browser obtains a short-lived challenge and the
server's RSA public key. It then encrypts the complete credential payload with
AES-256-GCM and wraps the one-time AES key with RSA-OAEP-SHA256. The login API
accepts only this encrypted envelope. Configure the matching private JWK as the
`LOGIN_PRIVATE_KEY_JWK` runtime secret; it is never returned to the browser.

The `DB` binding is required for users, sessions, personal strategies, and AI
endpoint preferences. Apply the generated migrations in `drizzle/` when
deploying outside Sites.

Public registration is disabled. On a new database, the server initializes a
`superadmin` account from the `DEFAULT_ADMIN_PASSWORD` runtime secret. The
default identity is `admin@gupiao.local` / `系统管理员`; deployments can override
it with `DEFAULT_ADMIN_EMAIL` and `DEFAULT_ADMIN_NAME`. Only a signed-in
superadmin can create ordinary users from the user-management panel. Passwords
are stored only as salted PBKDF2-SHA256 hashes.

## OpenAI-Compatible Strategy Generation

Users can configure an HTTPS API Base URL and model name for services that
implement `POST /chat/completions`. The API key is never written to the database
or source code; it stays in the current page session and is sent only to the
server-side proxy for the generation request.

## Persistent Paper Accounts

Each signed-in user can create up to 20 independent paper accounts. A paper
account owns its initial capital, cash ledger, strategy snapshot, risk settings,
position, immutable trade history, and one daily equity snapshot. Core inputs
(capital, symbol, and strategy) become read-only after the first trade so a
historical return series cannot silently change meaning.

Paper accounts do not require an automation. The paper-account center can value
every account with the latest TickFlow daily close. An optional one-to-one
automation can execute strategy signals against the account's cash and position
ledger, record a simulated fill with commission and slippage, and then deliver
the buy or sell notice through any selected notification channels. Simulated
fills are committed independently of delivery, so a failed Webhook cannot cause
the same trade to run again.

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
`CRON_SECRET`, plus the RSA private JWK in `LOGIN_PRIVATE_KEY_JWK`, as Worker
secrets; do not commit production values. The Worker
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

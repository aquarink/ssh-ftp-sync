# Email: verification and notifications — design

Status: stage 1 (signup verification) in progress. Decided 2026-11-08.

## Goals

- Open registration, but an account cannot sign in until its email is proven
  (click a link). Admin approval still follows (unchanged).
- A few useful notifications without paying per message: signup verification,
  new-device login, and an optional SSH-host digest.
- Stay inside the free limits: SMTP2GO free is 1,000/month and 200/day
  (see the sources in the chat summary; confirm in the dashboard).

## Transports

| Role | Primary | Fallback |
|---|---|---|
| Everything | cPanel SMTP `mail.uinjakarta.id:465` (SSL) | SMTP2GO `mail.smtp2go.com:2525` (STARTTLS) or `:465` |

The fallback is used only when the primary fails with a transient or limit
error (4xx/421/450, timeout, connection refused). A permanent 5xx rejection is
not retried elsewhere, so a bad address does not burn the fallback quota.

Config lives in the VM's `.env` only: `MAIL_FROM`, `SMTP_PRIMARY_HOST`,
`SMTP_PRIMARY_PORT`, `SMTP_PRIMARY_USER`, `SMTP_PRIMARY_PASS`,
`SMTP_FALLBACK_HOST`, `SMTP_FALLBACK_PORT`, `SMTP_FALLBACK_USER`,
`SMTP_FALLBACK_PASS`. Without any SMTP config the mailer refuses to send and
the signup says so; nothing is silently dropped.

## Stage 1: signup verification

Data (migration 011):

- `users.email_verified_at DATETIME(3) NULL`. Existing users are backfilled to
  `UTC_TIMESTAMP(3)`, so nobody already in the system is locked out.
- `email_verification_tokens`: `id`, `user_id`, `token_hash` (SHA-256, unique),
  `purpose` (`signup` now, `login_alert` etc. later), `expires_at` (24 h),
  `used_at`, `created_at`.

Flow:

1. `POST /api/auth/register` creates the user with `email_verified_at = NULL`
   and `approval_status = 'pending'`, mails a link
   `${PUBLIC_ORIGIN}/verify?token=…`, and answers "check your email".
2. `POST /api/auth/verify-email` (body `{token}`) marks the token used and sets
   `email_verified_at`. Single use; expired or used tokens get a generic error.
3. `POST /api/auth/resend-verification` (body `{email}`) answers the same
   message for known and unknown addresses (no enumeration). Limited to
   3 per email per hour and 10 per IP per hour.
4. Login refuses an unverified account with a clear message, before the
   approval check.

Rules:

- The link carries a random token; only its hash is stored.
- Turnstile stays on register and resend (bot protection and cost).
- QuickEmailVerification (`verifySignupEmail`) is not needed once the link
  proves ownership. It is kept for now and removed in a later step if the link
  flow works. This saves the per-check cost.

## Stage 2: login alerts (new device or IP)

Only when `client = 'desktop'` or the IP was never seen for this user in the
last 30 days. Uses `sessions.device_label` and `requester_ip`. One email per
new device, never per login. Opt-out in settings.

## Stage 3: SSH-host digest

Daily summary of hosts created or changed, sent only if the user opted in.
Metadata only: name, host, port. Never username, password, passphrase, keys or
certificates. Full backups are an in-app export, not email.

## Outbox and limits

Table `email_outbox` (id, to, template, status queued/sent/failed,
attempts, next_attempt_at, provider, last_error, created_at). Sends go through
the outbox with retries and backoff, so a provider outage does not lose
verification mail. A daily counter per provider stops sending before the
SMTP2GO 200/day cap and switches to the other provider.

## Open questions

- Ask IT whether the app may send automated mail from `mail.uinjakarta.id`
  and what its per-hour cap is (cPanel label "unlimited" is not a promise).
- SPF, DKIM, DMARC for the sending domain, so verification mail is not sent to
  spam.
- Password rotation: the cPanel and SMTP2GO credentials shared in chat must be
  rotated before real users receive mail.

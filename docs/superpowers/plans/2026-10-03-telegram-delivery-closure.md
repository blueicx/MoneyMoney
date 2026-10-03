# Telegram delivery and handling closure plan

## Goal

Make Telegram delivery diagnostics private and reliable, with an explicit user-triggered test message. Do not send any real Telegram message automatically during implementation or deployment. Preserve configured chat allowlists and avoid exposing identifiers, tokens, or message bodies publicly.

## Tasks

1. Add failing unit tests in `tests/telegram-test-delivery.test.cjs` for configured-recipient enforcement, admin recipient enforcement, no configured bot/recipient, successful send, transport failure, per-chat cooldown/idempotency, and bounded persistent delivery history.
2. Implement an injectable test-delivery service in `src/features/telegram-test-delivery.ts`, recording status, attempt time, chat fingerprint (not raw chat ID), and sanitized error in SQLite state. The service sends only when explicitly invoked and only to a configured allowlisted admin chat.
3. Add admin-only `POST /api/telegram/test-delivery`; select only a configured admin+allowed chat, call the interaction bot transport, and return/record a precise outcome. Make legacy `/api/telegram/test`, `/api/telegram/status`, `/api/telegram/command-center`, and notification-channel test routes admin-only; preserve compatibility where practical.
4. Add an explicit button in Telegram settings with a confirmation prompt, show latest delivery status/time/reason, and never auto-run on settings load/save. Include CSRF through the shared authenticated fetch wrapper.
5. Add route/markup contract tests for admin protection, no automatic test call on render/save, and display of sent/failed evidence.
6. Verify focused tests, complete test/build/smoke/security/diff gates. Production acceptance of actual delivery remains pending until the user clicks the button; do not claim real chat delivery from mocked tests.

## Acceptance

Guests and unauthenticated requests cannot inspect private Telegram state or trigger sends. A click sends at most once to an explicitly configured admin recipient, records a result without secrets, and displays failures. No unsolicited real message is sent by tests, startup, or deployment.

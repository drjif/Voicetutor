# same3le Supabase setup

This repository contains:

- `supabase/migrations/202608010001_initial_accounts.sql` — profiles, consent, marketing preference, entitlements, usage events, and deletion requests.
- `supabase/migrations/202608270001_saved_sources.sql` — Account Sync v1 Google Sheet references only.

Do not treat public account signup as production-ready until the legal operator identity, privacy contacts, retention schedule, custom SMTP, and authentication redirect allowlist are finalized.

## Intended scope

Supabase should store only:

- authenticated user ID and email through Supabase Auth;
- profile metadata;
- versioned legal-consent records;
- separate marketing preference;
- Free/Pro entitlement status;
- minimized product events;
- account-deletion requests;
- saved Google Sheet identifiers (`spreadsheet_id`, `sheet_gid`), a display name, and lightweight last-opened / last-source-row progress.

It should not receive question text, answer text, CSV/Excel/Anki contents, raw Google Sheet URLs, spoken audio, transcripts, patient information, advertising identifiers, precise location, or raw payment-card data by default.

## Authentication

1. Use the existing **same3le** project in the **GIJAD Free** organization. Do not apply these migrations to a different project.
2. Keep the current production site URL `https://tutor.gi-jad.com`. Do not switch to `same3le.com` yet.
3. Add redirect URLs:
   - `https://tutor.gi-jad.com/`
   - `http://localhost:4173/` for local testing
4. Enable email OTP / magic link. Do not require a password for Account Sync v1.
5. Configure custom SMTP before public signup. Supabase's development email service is not a production mailing system.
6. Customize authentication templates with the same3le brand and support contacts.
7. Do not expose a secret/service-role key in browser code.

Frontend environment values may include only the project URL and Supabase publishable/anonymous key. Put those in `supabase-config.js`. Server-only secrets belong in the hosting platform's encrypted environment settings, never GitHub.

## Database and RLS

Apply the initial accounts migration first, then `202608270001_saved_sources.sql`. Do not duplicate `saved_sources`. Verify that Row Level Security is enabled on every public table. The intended access model is:

- users may read and update their own profile;
- users may append and read their own consent history;
- users may manage their own marketing preference;
- users may read, but not directly modify, their own subscription entitlement;
- users may insert and read their own minimized usage events;
- users may create and view their own deletion request;
- users may select, insert, update, and delete only their own `saved_sources`;
- signed-out clients must not read `saved_sources`;
- server-side webhook code manages subscription status.

Test every policy while signed out, signed in as User A, and signed in as User B. User A must never be able to select or modify User B's rows. After applying migrations, run Supabase security advisors and fix relevant findings.

A replayable SQL checklist is in `supabase/tests/saved_sources_rls.sql`.

## Subscription architecture

Recommended flow:

1. User selects Pro.
2. A server-side endpoint creates a checkout session with the payment processor.
3. The payment processor collects card details on its hosted interface.
4. Signed webhook events update `subscription_entitlements` using a server secret.
5. The browser reads only the resulting entitlement row.
6. Cancellation opens the provider's billing portal or an equivalent online cancellation interface.

Never activate Pro based only on a success URL, browser local storage, or client-provided plan value.

## Consent records

At account creation, require separate controls for:

- required acceptance of Terms, Privacy Policy, and Acceptable Use Policy;
- required confirmation that the user is at least 18;
- required confirmation of U.S. access for the initial launch;
- optional marketing consent, unchecked by default.

Insert an append-only `consent_records` row with the exact policy versions and timestamp. Do not overwrite the historical record when policies change.

## Usage events

Allowed events are intentionally narrow. Never place question text, answers, transcripts, Sheet URLs, email addresses, or sensitive information in the `details` JSON. Aggregate analytics should be calculated from event names and timestamps.

## Account deletion

A production implementation should:

1. confirm the request through an authenticated session or email verification;
2. stop marketing messages;
3. cancel or detach active subscriptions as appropriate;
4. remove account content and Auth identity;
5. retain only narrowly required billing, fraud, security, consent, and legal records;
6. send completion confirmation.

## Pre-launch verification

- RLS tests pass.
- Authentication redirects use the permanent HTTPS domain.
- Custom SMTP is operational.
- Rate limits are configured.
- Security and privacy contacts are monitored.
- Data retention jobs are implemented.
- Payment webhooks verify signatures.
- Checkout displays all recurring terms before payment.
- Online cancellation works end to end.
- Terms and Privacy Policy match actual production behavior.

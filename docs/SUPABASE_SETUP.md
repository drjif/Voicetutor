# samme3le Supabase setup

This repository now contains a proposed production-account schema in:

`supabase/migrations/202608010001_initial_accounts.sql`

Do not connect production users until the legal operator identity, privacy contacts, retention schedule, permanent domain, email delivery, and subscription terms are finalized.

## Intended scope

Supabase should store only:

- authenticated user ID and email through Supabase Auth;
- profile metadata;
- versioned legal-consent records;
- separate marketing preference;
- Free/Pro entitlement status;
- minimized product events;
- account-deletion requests.

It should not receive question text, answer text, CSV contents, Google Sheet URLs, spoken audio, transcripts, patient information, advertising identifiers, precise location, or raw payment-card data by default.

## Authentication

1. Create a Supabase project.
2. Configure the final `https://samme3le.com` site URL and approved redirect URLs.
3. Enable email magic links or email OTP.
4. Configure custom SMTP before a public beta. Supabase's development email service is not a production mailing system.
5. Customize authentication and security templates with the same3le brand and support contacts.
6. Do not expose a secret/service-role key in browser code.

Frontend environment values may include only the project URL and Supabase publishable/anonymous key. Server-only secrets belong in the hosting platform's encrypted environment settings.

## Database and RLS

Apply the migration and verify that Row Level Security is enabled on every public table. The intended access model is:

- users may read and update their own profile;
- users may append and read their own consent history;
- users may manage their own marketing preference;
- users may read, but not directly modify, their own subscription entitlement;
- users may insert and read their own minimized usage events;
- users may create and view their own deletion request;
- server-side webhook code manages subscription status.

Test every policy while signed out, signed in as User A, and signed in as User B. User A must never be able to select or modify User B's rows.

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

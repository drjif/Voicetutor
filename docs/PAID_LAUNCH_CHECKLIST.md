# Paid launch checklist

Paid subscriptions must remain disabled until every blocking item below is complete.

## Legal operator

- [ ] Confirm the legal operator's full name.
- [ ] Confirm whether the operator is an individual or registered entity.
- [ ] Publish the service and mailing address.
- [ ] Activate and monitor support, privacy, legal, accessibility, and security email addresses.
- [ ] Select governing law and dispute forum with counsel.
- [ ] Decide whether arbitration and a class-action waiver will be used.
- [ ] Complete a qualified legal review of the Terms, Privacy Policy, subscription terms, refund policy, and checkout disclosures.

## Product decisions

- [ ] Confirm the Free plan limits that will remain after Pro launches.
- [ ] Set the Pro price, currency, and monthly or annual billing interval.
- [ ] Decide whether a trial will exist and whether payment details are required.
- [ ] Define refund eligibility and request deadlines.
- [ ] Define upgrade, downgrade, proration, failed-payment, grace-period, and cancellation behavior.
- [ ] Confirm the initial U.S.-only and age-18-plus scope.

## Checkout and recurring billing

- [ ] Display price, billing interval, automatic renewal, taxes, trial conversion, and cancellation method before payment.
- [ ] Require explicit affirmative subscription consent; no prechecked enrollment.
- [ ] Send a purchase confirmation containing all material recurring terms.
- [ ] Provide online cancellation through account settings or a billing portal.
- [ ] Send legally required renewal or trial-ending notices.
- [ ] Verify payment webhooks server-side.
- [ ] Test cancellation, failed payment, refund, dispute, upgrade, and downgrade workflows.

## Privacy and data governance

- [ ] Confirm the exact Supabase region and vendors.
- [ ] Sign and retain applicable vendor data-processing terms.
- [ ] Finalize the data map and retention schedule.
- [ ] Implement access, correction, export, deletion, and marketing-withdrawal workflows.
- [ ] Implement Global Privacy Control handling if any sale or sharing practice is introduced.
- [ ] Confirm no advertising pixels or cross-site behavioral tracking are present.
- [ ] Create an incident-response and breach-assessment process.
- [ ] Confirm question banks, audio, transcripts, and Sheet URLs are not stored unless separately reviewed and disclosed.

## Security

- [ ] Enforce HTTPS and security headers on production hosting.
- [ ] Enable RLS on every Supabase public table and test cross-user isolation.
- [ ] Keep secret/service-role keys server-side.
- [ ] Configure authentication rate limits and secure redirect allowlists.
- [ ] Configure custom SMTP and protect against account enumeration.
- [ ] Enable secret scanning, dependency review, backups, and restoration testing.
- [ ] Separate production and development environments.

## Accessibility and support

- [ ] Test keyboard-only use and visible focus.
- [ ] Test VoiceOver, TalkBack, and a desktop screen reader.
- [ ] Test 200% and 400% zoom, reduced motion, and mobile reflow.
- [ ] Confirm all authentication, checkout, billing-portal, and cancellation flows are accessible.
- [ ] Publish a monitored accessibility-feedback channel.

## Domain and search

- [ ] Purchase and secure `samme3le.com`.
- [ ] Point the final domain to production hosting.
- [ ] Replace current `tutor.gi-jad.com` canonicals and sitemap URLs.
- [ ] Redirect every old URL to its matching new URL with permanent redirects.
- [ ] Verify the new domain in Google Search Console and Bing Webmaster Tools.
- [ ] Submit the new sitemap and monitor indexing and redirect errors.

## Immigration and business authorization

- [ ] Obtain written immigration-counsel guidance before the user personally operates, markets, supports, contracts for, or receives compensation from the business.
- [ ] Confirm who is legally authorized to operate the service and sign vendor or customer contracts.
- [ ] Confirm tax, entity, banking, and accounting setup before revenue collection.

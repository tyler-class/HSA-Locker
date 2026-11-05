# Email setup

HSA Locker can receive receipts and EOBs by email. Cloudflare Email Routing hands each message to the Worker, which keeps PDFs and photos (and, for receipts with no attachment, the email body), stores the original `.eml`, and reads each document.

The app walks you through this in **Settings → Inbox**. This page has the background.

## What you need

- A domain whose DNS is on your Cloudflare account.
- A **subdomain of it that doesn’t receive email today**, such as `hsa-in.example.com`.

No domain on Cloudflare? Skip email. Uploading (including **Take photo** on phones) does everything email does.

## Why a subdomain

Turning on Email Routing for a name adds Cloudflare MX records for it, and MX records decide where that name’s mail goes. **Don’t enable Email Routing on a domain that already gets mail elsewhere** (Google Workspace, Fastmail, iCloud…): it would take over delivery.

Email Routing supports subdomains (Email → Email Routing → **Settings → Subdomains**). Adding `hsa-in.example.com` creates MX and SPF records for that label only; `example.com`’s mail and provider are untouched.

Keep the app’s hostname and the email subdomain separate (for example the app on `hsa-locker.you.workers.dev`, mail on `hsa-in.example.com`). That’s a recommendation, not a requirement.

## Steps

1. **Settings → Inbox:** enter the subdomain. HSA Locker shows your address: `hsa-xxxxxxxxxx@hsa-in.example.com`. The `hsa-…` part is a random token. Treat the address like a password: anyone who has it can send documents into your ledger.
2. **Cloudflare dashboard → your domain → Email → Email Routing**
   - **Settings → Subdomains:** add the subdomain.
   - **Routing rules → Custom addresses:** create the address, action **Send to a Worker**, destination **hsa-locker**.
3. **Send a test:** email a receipt to the address. The Inbox page changes from “Waiting for the first email…” to what arrived.

The routing rule is created in the dashboard. Wrangler 4.113+ can also declare Email Routing addresses in `wrangler.jsonc` (`"addresses": [...]`), but your address contains your private token and your own domain, so HSA Locker doesn’t ship one. A future version may offer an “Automate setup” button that creates the rule with a scoped API token (Email Routing Rules: Edit).

## Forwarding

- **By hand:** forward any email to the address.
- **Automatically:** create a rule in your mail provider that forwards only the senders you want (your insurer, provider portals, pharmacies). Settings → Inbox has steps for Gmail, Outlook, Fastmail and iCloud.

### Forwarding confirmations

Gmail (and sometimes iCloud) sends a confirmation message to a new forwarding address before it will forward automatically. HSA Locker recognizes these, doesn’t treat them as documents, and shows the **code and link under “Verification waiting”** in Settings → Inbox. Enter the code back in Gmail. The patterns live in `src/shared/logic/verification.ts`; other providers can be added there.

## What gets kept from a message

- PDFs, always.
- Photos (JPEG, PNG, WebP, HEIC) at or above the minimum size (25 KB by default, like HSA Wizard’s “Min Image Size”), except images the email’s HTML shows inline (logos) and files named like logos or signatures.
- Attached emails (“forward as attachment”), opened and searched the same way.
- No usable attachment: the body is saved as a document and read. If it isn’t a receipt, it waits in Review rather than vanishing.
- The raw `.eml`, stored with the first document from each message (open it from an entry’s details).

HEIC photos can be stored but not read by Workers AI; they go to Review. iPhones convert photos to JPEG when you upload them through the browser, so prefer upload for iPhone photos (or use a Gemini key, which reads HEIC).

## Limits and safety

- Mail to any other address at the subdomain is rejected. **Rotate address** makes a new token; the old one stops working immediately.
- Per-message limits (attachments, size) and a daily cap, all adjustable under Settings → Inbox → Limits. **Accept new mail** pauses the inbox.
- An optional sender allow list. It’s secondary: auto-forwarded mail keeps the original sender, so it can’t be the main gate.
- Cloudflare rejects messages that fail the sender’s DMARC policy (or both SPF and DKIM) before they reach the Worker. Email Routing’s own size limit is 25 MiB.
- HSA Locker never sends email: no replies, no bounces. Everything is visible in the app.

## Optional: a vanity address on your main domain

To give people `hsalocker@example.com` without touching your main domain’s MX records, create an alias or forwarding rule **at your existing mail provider** that forwards it to the HSA Locker address. Tradeoffs: an extra hop, it depends on that provider’s forwarding and DMARC handling, and forwarded-from-forwarded mail can be rejected by strict senders. HSA Locker doesn’t need it.

## CPU limits

The `email()` handler only checks the recipient, size and limits, and streams the raw message to R2; parsing happens right after. On the Workers free plan (10 ms CPU per invocation) parsing larger messages can still run out of CPU and is retried by the sweeper, then marked failed. **Workers Paid is recommended if you use email.**

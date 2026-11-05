# HSA Locker

Keep every medical receipt and EOB for your HSA in one place, and always know how much you can still reimburse yourself. Forward a receipt by email or snap a photo; HSA Locker stores the original, reads it, and adds it to your ledger.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/tyler-class/HSA-Locker)

- **Every original, kept.** PDFs, photos and the emails they came in are stored privately in your own Cloudflare R2 bucket and open only through the app.
- **Read for you.** Each document is read by an AI model (Workers AI by default, inside your Cloudflare account) into dates, patient, provider, amount and card. Receipts become one entry; EOBs become one line per service.
- **Checked, not guessed.** An amount that isn’t printed in the document, an unknown patient, a likely duplicate or a date in the future goes to **Review** instead of into your totals.
- **What you can reimburse.** Home shows outstanding reimbursable, reimbursed and documented per year. EOB lines are kept for reference and never count as money. Receipts paid with your HSA card are excluded automatically.
- **Record reimbursements.** Select receipts, record the withdrawal, and compare the total with your HSA statement. Undo any time.
- **Email inbox.** Give HSA Locker a private address on a subdomain you own and set your mail to forward receipts and EOBs to it. Gmail’s forwarding confirmation code shows up right in the app.
- **People and providers.** “Olivia”, “Olivia Class” and “Class, Olivia” are one person; “Grand Rapids Surgical Suit” on an EOB can be the same provider as on the receipt.
- **Exports.** A CSV of the ledger (any filter), a JSON backup, and a ZIP of every original named by date, person, provider and amount: an audit packet.
- **AI assistants.** Connect Claude, ChatGPT or any MCP-capable assistant to ask what’s outstanding or record a reimbursement.
- **Yours.** It runs on your own Cloudflare account. No analytics, no third-party scripts.

One deployment is one household. HSA Locker isn’t tax advice and makes no HIPAA compliance claims.

## Deploy

### One click

1. Click **Deploy to Cloudflare** above and sign in to Cloudflare.
2. Cloudflare copies this repo to your GitHub or GitLab account, creates the database, file storage and AI binding, and asks for **APP_PASSWORD**: the password everyone in your household signs in with. Pick something long.
3. When the deploy finishes, open the `*.workers.dev` link and sign in.

**Before you click:**

- **R2 needs to be enabled on your account.** File storage uses Cloudflare R2. Its free tier (10 GB) is plenty, but Cloudflare asks you to add R2 to your account (Dashboard → R2) with a payment method on file before a bucket can be created. Do that first or the deploy can’t create the bucket.
- **Workers Paid ($5/month) is recommended if you’ll forward email or upload photos.** The free plan gives each request 10 ms of CPU. Reading text PDFs fits; parsing larger emails and preparing photos for the AI model often doesn’t. Uploading PDFs works on the free plan.

Cloudflare runs the database migrations on every deploy (`npm run deploy`), before the new version goes live.

### By hand

```sh
git clone https://github.com/tyler-class/HSA-Locker.git && cd HSA-Locker
npm install
npx wrangler login
npx wrangler secret put APP_PASSWORD
npm run deploy
```

`npm run deploy` builds the app, applies migrations to the remote database and deploys the Worker. Wrangler creates the D1 database, R2 bucket and KV namespace on the first deploy.

## Forward receipts by email

Inbound email needs a domain on your Cloudflare account. Use a **new subdomain** (for example `hsa-in.example.com`) so your normal email isn’t touched. In the app, open **Settings → Inbox** and follow the steps; the details, and what to do without a domain, are in [docs/email-setup.md](docs/email-setup.md).

No domain? Everything else works with uploads.

## Choose the AI model

By default documents are read with Workers AI inside your Cloudflare account; nothing to set up. To use your own Anthropic, OpenAI or Gemini key instead, add Worker secrets in the Cloudflare dashboard (**Workers & Pages → hsa-locker → Settings → Variables and Secrets**):

| Secret         | Value                                   |
| -------------- | --------------------------------------- |
| `LLM_PROVIDER` | `anthropic`, `openai` or `gemini`       |
| `LLM_API_KEY`  | your API key                            |
| `LLM_MODEL`    | optional, to override the default model |

With your own key, documents (which contain health information) are sent to that company. Keys live only in Worker secrets and can’t be seen or changed from the app. **Settings → Reading documents → Test extraction** checks the setup. Optional: set `AI_GATEWAY_ID` to route Workers AI calls through an [AI Gateway](https://developers.cloudflare.com/ai-gateway/).

Scanned PDFs (no text layer) can’t be read by Workers AI; they go to Review so you can type them in or upload photos of the pages. Anthropic, OpenAI and Gemini keys read scanned PDFs directly.

## Use it on your phone

Open your HSA Locker link on the phone, then:

- **iPhone:** in Safari, tap Share, then **Add to Home Screen**.
- **Android:** in Chrome, open the menu and tap **Install app**.

Upload has a **Take photo** button for paper receipts.

## Connect an AI assistant

HSA Locker includes an [MCP](https://modelcontextprotocol.io) server at `https://<your-hsa-locker>/mcp`. Open **Settings → Connect an AI assistant** to copy your URL and see steps for Claude, ChatGPT, Claude Code and others. When an assistant connects, HSA Locker shows a sign-in page; enter your household password to approve it. Assistants can read your ledger and totals and record reimbursements; they can’t open the documents.

## Change the password

Set a new `APP_PASSWORD` in the Cloudflare dashboard under **Workers & Pages → hsa-locker → Settings → Variables and Secrets**, or with `npx wrangler secret put APP_PASSWORD`. Everyone is signed out. Connected AI assistants keep working until you disconnect them.

## Back up and restore

**Settings → Backup:**

- **Download data backup (JSON)**: every record (people, providers, documents’ details, entries, reimbursements). Not the files.
- **Download all documents (ZIP)**: every original file plus `ledger.csv`. Built in your browser, one file at a time.
- **Restore data from backup** replaces everything with a backup’s contents. On a new deployment, restore the JSON first, then **Restore documents from ZIP** to put the files back.

## Coming from HSA Wizard (Google Sheets)

`npm run import:hsa-wizard` imports the old sheet and its Drive folder, collapsing duplicate rows and name variants. See [docs/importing-from-hsa-wizard.md](docs/importing-from-hsa-wizard.md).

## Update your copy

If you deployed with the button, your copy lives in your own GitHub account and updates itself: every Monday a GitHub Action takes the latest HSA Locker and pushes it to your copy, and Cloudflare migrates the database and redeploys. To update right away, open your copy on GitHub, go to **Actions → Update HSA Locker** and click **Run workflow**. Your data is in the database and R2, not the repo, so updates don’t touch it.

The update replaces the app’s code, so changes you made to your copy’s code are overwritten. Your `.github/workflows` and a `wrangler.jsonc` with your database id are kept.

If you deployed by hand, `git pull` and `npm run deploy`.

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars    # then set APP_PASSWORD
npm run db:migrate:local
npm run db:seed:sample:local      # optional: a made-up household
npm run dev
```

Workers AI has no local simulator: in `npm run dev` the `AI` binding calls Cloudflare (you’ll be asked to sign in with Wrangler) and may use your Workers AI allowance.

| Script                       | What it does                                       |
| ---------------------------- | -------------------------------------------------- |
| `npm run dev`                | Vite dev server with the Worker running in workerd |
| `npm run build` / `preview`  | Production build / serve the build locally         |
| `npm test`                   | Unit tests and Workers-runtime API tests (Vitest)  |
| `npm run typecheck` / `lint` | TypeScript, ESLint and Prettier                    |
| `npm run deploy`             | Build, migrate the remote database, deploy         |
| `npm run db:migrate:local`   | Apply migrations to the local database             |
| `npm run db:migrate:remote`  | Apply migrations to the deployed database          |
| `npm run sample:build`       | Regenerate `seed/sample.json`                      |
| `npm run import:hsa-wizard`  | Import an HSA Wizard sheet                         |

Tests never call a real model: they use a fake provider and synthetic documents. No real health information belongs in this repo.

### How it’s built

- **Cloudflare Workers** with static assets. **Hono** serves the API under `/api`; **D1** stores records; **R2** stores original files; **Workers AI** reads documents. SQL migrations live in `migrations/`.
- **D1 is the work queue.** Uploads and email insert a `pending` document and start reading it right away; a cron sweeper every 10 minutes retries failures with backoff and picks up anything stuck. The `email()` handler only stores the raw message; parsing happens afterwards, which keeps it within CPU limits.
- **Reading:** PDF text layers come from `toMarkdown()`; photos go to a vision model (`@cf/google/gemma-4-26b-a4b-it`) with a JSON schema. The model’s output is validated, then checked: amounts must appear in the document’s text, names are matched to people and aliases, duplicates are flagged.
- **React**, **TypeScript**, **Vite**, **Tailwind CSS**, **TanStack Query** and **React Router**, with a service worker from `vite-plugin-pwa`.
- `src/shared` holds the money rules (outstanding, reimbursed, pending review), name matching, duplicate detection and the extraction schema, used by both the Worker and the app and covered by unit tests.
- Sign-in uses one password per instance: a signed, HttpOnly session cookie, rate-limited attempts, and sessions that end when the password changes. AI assistants connect over MCP with OAuth 2.1 (`@cloudflare/workers-oauth-provider`).

## Support

HSA Locker is free and built by [Tyler Class](https://tylerclass.net). If you want to say thank you, coffee is my love language: [ko-fi.com/tylerclass](https://ko-fi.com/tylerclass) ☕

## License

[MIT](LICENSE)

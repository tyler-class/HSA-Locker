# How deploys and updates work

This is the shared setup behind HSA Locker, Duffel, Ratio and Nitrogen: self-hosted Cloudflare apps that anyone installs with one click and that then keep themselves up to date. It's written for the maintainer. The README tells users what they need to know.

## The moving parts

```
 tyler-class/<App> (source repo)                you push releases here
        │
        │  Deploy to Cloudflare button (once, per user)
        ▼
 <user>/<app> (their own copy on GitHub) ──push to main──▶ Workers Builds ──▶ their Worker
        ▲                                                (npm run build,       (+ their D1, R2,
        │                                                 then deploy script)   KV, secrets)
        │  update.yml, every Monday (or Run workflow):
        │  replace the code with the source repo's main, commit, push
 tyler-class/<App>
```

### 1. The Deploy to Cloudflare button

The README's button links to `https://deploy.workers.cloudflare.com/?url=https://github.com/tyler-class/<App>`. When someone clicks it, Cloudflare:

1. **Copies the repo** into their GitHub (or GitLab) account. It's a plain copy, not a fork, so GitHub's "Sync fork" doesn't exist for it.
2. **Creates the resources** in their Cloudflare account from `wrangler.jsonc`: D1, R2, KV, the Workers AI binding and cron triggers. `wrangler.jsonc` has **no ids** (no `database_id`, no `bucket_name`) so nothing points at your resources.
3. **Asks for secrets.** It lists the names in `.dev.vars.example` (for example `APP_PASSWORD`), with the help text from `package.json` → `cloudflare.bindings`.
4. **Connects Workers Builds** to their copy's `main` branch, and runs the first build and deploy.

After that, every push to `main` in their copy builds and deploys their Worker. Nobody configures this by hand.

### 2. The deploy script: migrate, then deploy

Workers Builds runs `npm run build`, then the deploy script. In HSA Locker and Duffel that's `npm run deploy` → `npm run build && npm run release`. `scripts/release.ts`:

1. Applies D1 migrations to the remote database first, so new code never runs against missing columns.
2. Deploys the Worker.
3. On a **first install** the database doesn't exist until `wrangler deploy` creates it, so the first migration fails with "couldn't find…". The script notices, deploys first, then migrates.

Migration rule that follows from this: **migrations must be safe for the version that is still running.** The old code keeps serving for the seconds between migrating and deploying. Add tables and columns freely; don't drop or rename something the previous version reads. Do that in a later release instead.

### 3. The weekly update workflow

`.github/workflows/update.yml` ships inside every copy. It:

- runs **every Monday** on a schedule, and any time from **Actions → Update <App> → Run workflow**;
- **skips itself in the source repo** (`if: github.repository != 'tyler-class/<App>'`);
- fetches the source repo's `main`, replaces the copy's files with it, and commits **only if something changed**. That push triggers Workers Builds, which migrates and deploys;
- **keeps** two things from the copy: its `.github/workflows` (see the limits below) and a `wrangler.jsonc` that has a `database_id` written in (from a hand install);
- finishes with a **keep-alive step**. GitHub turns off scheduled workflows in a repo with no activity for 60 days, and quiet months produce no commits. The step re-enables the workflow on every run (`gh api -X PUT …/actions/workflows/update.yml/enable`), which resets the timer. It needs `permissions: actions: write`.

User data lives in D1, R2 and KV, never in the repo, so updates don't touch it.

### 4. Your own instance

If you deployed with `npm run deploy` from your machine (not the button), your Worker isn't connected to the repo until you connect it once: **Workers & Pages → <app> → Settings → Builds → Connect**.

- Repository: `tyler-class/<App>`, branch `main`.
- Build command: `npm run build`.
- **Deploy command: `npm run release`** (not the default `npx wrangler deploy`, which skips migrations). For Ratio and Nitrogen, see the table below.
- **Turn off preview builds.** Preview versions share the production D1, R2 and KV, so a branch build would touch real data.

From then on, a push to `main` is a deploy. Treat it that way.

## Shipping a release

1. Make the change. `npm run typecheck`, `npm run lint`, `npm test`.
2. Bump `version` in `package.json` (and `src/shared/version.ts` in Nitrogen), one commit per version.
3. `git tag -a <version> -m "<App> <version>"` and `git push origin main --follow-tags`.
4. Your instance deploys within a couple of minutes (Workers Builds).
5. Everyone else's copy picks it up the next Monday, or sooner if they run the workflow.
6. Optional: publish a GitHub Release for the tag with short notes. People who use **Watch → Custom → Releases** on the repo get an email from GitHub; you never hold a list of addresses.

## What can't update automatically

- **Workflow files.** GitHub doesn't let an Action's token change files in `.github/workflows`. A change to `update.yml` itself (like adding the keep-alive step) only reaches copies made after it. Existing copies need it pasted in once by hand. The workflow prints a notice when the copy's workflows differ from the source.
- **Hand installs** (clone + `npm run deploy`). They have no copy on GitHub and no workflow. They update with `git pull && npm run deploy`.
- **New secrets.** If a release needs a new required secret, existing installs don't get prompted. Make new secrets optional, with a sensible default, and say so in the release notes.
- **Code someone changed in their copy.** The update replaces it. The README says so.

## The four projects

| Project    | Deploy script                        | update.yml | Keep-alive | Notes                                                                            |
| ---------- | ------------------------------------ | ---------- | ---------- | -------------------------------------------------------------------------------- |
| HSA Locker | build → `release.ts` (migrate first) | yes        | yes        | Reference implementation.                                                        |
| Duffel     | build → `release.ts` (migrate first) | yes        | **no**     | Add the keep-alive step and `actions: write`. Existing copies need it pasted in. |
| Ratio      | build → deploy → migrate             | **no**     | **no**     | Add `scripts/release.ts`, `release` script and `update.yml`.                     |
| Nitrogen   | build → deploy → migrate             | **no**     | **no**     | Same as Ratio. Remember `src/shared/version.ts`.                                 |

To bring a project in line: copy `scripts/release.ts`, set `"deploy": "npm run build && npm run release"` and `"release": "tsx scripts/release.ts"`, copy `.github/workflows/update.yml` with the repo name and app name replaced, and make sure `wrangler.jsonc` has no resource ids.

## Verify once with a real install

Some of this can only be confirmed end to end. With a second GitHub account and a free Cloudflare account:

1. Click **Deploy to Cloudflare** on the README. Check that the Worker deploys, the resources exist, and Workers Builds is connected (Settings → Builds). Note which deploy command it set.
2. Push a small release to the source repo.
3. In the copy, run **Actions → Update <App> → Run workflow**. Check that it commits, that Workers Builds deploys, and that the keep-alive step succeeds.
4. Check the app shows the new version (Settings → About).

# CI/CD for SmartPDF

How changes get from a laptop to production, and why each piece exists.

## The shape

Every pipeline in every tool is the same five beats:

```
trigger → fresh machine → install deps → run checks → (if main) deploy
```

GitHub Actions, GitLab CI, Jenkins, CircleCI — same shape, different dialect.

**CI** proves a change works on a machine that isn't yours. The point is not
"running tests"; it is killing *works on my machine*. A clean VM clones the
repo, installs strictly from the lockfile, and runs the checks. No stale
`node_modules`, no package you installed globally in March.

**CD** gets proven changes to users. *Delivery* = always ready to ship, a human
clicks the button. *Deployment* = green means live, no human.

## What runs here

Two systems, which **do not talk to each other**:

| System | Trigger | Does |
|---|---|---|
| GitHub Actions (`.github/workflows/ci.yml`) | push to `main`, any PR, manual | lint, test, build |
| Netlify (`netlify.toml`) | push to `main`, any PR | build and publish |

Netlify will cheerfully deploy a commit whose CI run is red. Nothing in either
config prevents it. The thing that prevents it is **branch protection** — see
below. Without it CI is advice; with it CI is a gate.

## The CI workflow, decision by decision

**Two jobs, not one.** `verify` (lint + test) and `build` run in parallel on
separate VMs. Jobs share nothing — `build` re-checks-out and re-installs. That
isolation is why you pass things between jobs with *artifacts*, never the
filesystem.

**A Node matrix.** `verify` runs on Node 24 and 26. 24 is what Netlify builds
with; 26 is what the project is developed on. `fail-fast: false` so a failure on
one version does not cancel the other — knowing whether a break is
version-specific is most of the diagnosis.

**`.nvmrc` is the single source of truth.** Netlify's precedence chain is
`.nvmrc` > `.node-version` > `NODE_VERSION` env var > UI setting > image
default. GitHub Actions reads the same file via `node-version-file`. One file,
both systems, no drift.

**`npm ci`, never `npm install`.** `ci` installs the lockfile exactly and fails
if `package.json` and the lockfile disagree, instead of quietly resolving
something new. Reproducibility is the whole point.

**`cache: npm`.** Install dominates the runtime. Real timings on this project:

| Step | Time |
|---|---|
| `npm run lint` | ~4s |
| `npm test` (371 tests / 56 suites) | ~22s |
| `npm run build` | ~5s |
| `npm ci` (cold) | 40–90s |

Caching the install is worth more than any test optimisation.

**An explicit `npm run sync:pdfjs`.** It normally runs via `postinstall`, but
the tests hard-depend on `public/pdfjs/{cmaps,standard_fonts}`, which is
gitignored and therefore absent from a fresh checkout. npm is progressively
restricting lifecycle scripts. Running it explicitly means a skipped hook fails
loudly here instead of surfacing as a baffling font error inside a test.

**`concurrency` with `cancel-in-progress`.** Push twice quickly and the older
run is cancelled rather than burning a runner on a commit nobody awaits.

**`permissions: contents: read`.** Least privilege. The default token can write
to the repo. On a public repo this matters: anything that executes during
`npm ci` inherits whatever that token can do.

**`timeout-minutes`.** A hung test should fail in 15 minutes, not run for six
hours.

## The missing gate: branch protection

This is the step people skip, and it is the one that makes CI mean something.

Settings → Branches → Add rule for `main`:

- Require a pull request before merging
- Require status checks to pass → select `Lint & test (Node 24)`,
  `Lint & test (Node 26)`, `Production build`
- Require branches to be up to date before merging

Now a red run physically blocks the merge, so every commit Netlify ever builds
has already passed. The CI file does not need to know Netlify exists.

> A status check only becomes selectable after it has run at least once. Open
> one PR first, then add the rule.

## Secrets

Three places, three audiences:

| Where | Visible to | Use for |
|---|---|---|
| `netlify.toml`, `ci.yml` | the whole internet (public repo) | nothing secret, ever |
| GitHub → Settings → Secrets → Actions | workflow runs | tokens CI itself needs |
| Netlify UI → Environment variables | Netlify builds and functions | `GEMINI_API_KEY`, `STRIPE_SECRET_KEY` |

Two rules worth internalising:

1. **Anything baked into a client bundle is public.** A `NEXT_PUBLIC_*` variable
   is not a secret, whatever you call it. This app runs its PDF work in the
   browser; only `/api/gemini` and `/api/checkout` hold real secrets.
2. **Give deploy previews test credentials.** Netlify's `[context.deploy-preview]`
   exists so a PR preview cannot charge a real card or burn real API quota.

## Debugging a red run

1. Actions tab → click the run → click the failing job → expand the red step.
2. Reproduce locally with the *same* commands, not your usual ones:
   `npm ci && npm run sync:pdfjs && npm run lint && npm test`
3. If it passes locally but fails in CI, the difference is almost always one of:
   something gitignored that CI does not have, a Node version gap, a lifecycle
   script that did not fire, or a test depending on wall-clock time or ordering.
4. Re-run with debug logging: re-run jobs → "Enable debug logging".

## Where to take it next

Roughly in order of value for this project:

1. **Branch protection.** Without it the rest is decoration.
2. **Dependabot** (`.github/dependabot.yml`) — automated dependency PRs, each
   one validated by the CI you now have.
3. **Cache the test fixtures.** `.claude/fixtures` is regenerated every run;
   `actions/cache` keyed on `make-fixtures.mjs` would skip it.
4. **Upload failure artifacts.** On a red test run, `actions/upload-artifact`
   the output so you can read it without re-running.
5. **CodeQL** — GitHub's free security scanning, a few lines for a public repo.
6. **A release workflow** — tag, changelog, GitHub Release on version bump.
7. **Smoke-test the deploy.** After Netlify publishes, hit the live URL and
   assert it returns 200 and renders. A build that succeeds and a site that
   works are different claims.

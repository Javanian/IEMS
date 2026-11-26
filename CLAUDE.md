# Working on IEMS

Instructions for Claude Code and other coding agents in this repository. They are the rules I give every agent before it touches the code. The workflow behind them is in [docs/ai-assisted-development.md](docs/ai-assisted-development.md).

## Before you change anything

- Check `git status`, the current branch and running services first. Work on your own branch or worktree. Never reset, clean, stash or stage everything in a checkout you did not create.
- Read the README of the folder you are about to change. `jobs/sap_staging/README.md` is required reading before any change to staging or posting: that code is the payroll path.
- A spec, an earlier report or an old green CI run is a claim, not proof of the current tree. Verify what your work depends on.

## Rules that must not break

- **SAP posting.** Do not change the md5 recipe of `source_key`, the `id` sequence of `sap_timesheet_staging`, or the safeguards listed in `jobs/sap_staging/README.md`. Retries are for network failures only, never SAP business rejections.
- **Migrations.** A migration that reached any database is never edited; a fix is a new file. Do not write `BEGIN`/`COMMIT`; the runner wraps each file. See `database/README.md`.
- **Money in `apps/portfolio-api`.** Amounts are fixed-scale decimal strings. Never convert money to a JavaScript `Number`.
- **Scope.** Every query in `apps/portfolio-api` filters on the session's tenant and plant. Never trust a tenant or plant from a header, query or body.
- **UI colors.** Use the CSS-variable tokens from `design-system/iems/MASTER.md`. CI rejects raw hex colors in classes.
- **Secrets.** Never commit `.env`, credentials, plant data exports, logs or generated binaries.

## How work is accepted

- Done means evidence on the current tree: the test command and its output, a browser check, or a database query. "Done" in a message is not evidence.
- A fault-injection test has to prove the injected path actually ran. A test that passes because the injection was never reached is a failure.
- When you fix a bug, show the test failing before the fix and passing after it.
- Keep test layers apart in your report: unit, simulator, real browser, live database. Do not call a simulator result a production result.
- Say what you did not verify.

## Commands

```bash
npm --prefix packages/contracts test          # domain contracts
npm --prefix apps/api test                    # plant API unit tests
npm --prefix apps/web run lint:tokens         # design-token lint
npm --prefix apps/web run build               # production build
npm --prefix apps/portfolio-api test          # portfolio API against a real MongoDB replica set
python -m unittest discover -s jobs/messaging/tests -p "test_unit.py"
node database/migrate.js --dry-run            # pending migrations, touches nothing
```

The Kafka end-to-end test needs Docker; see `jobs/messaging/README.md#tests`.

## Commits and pull requests

- One reviewable change per commit, with the code, the lockfile and the tests together.
- End the message with `Co-Authored-By: Claude <noreply@anthropic.com>` when an agent wrote or changed the code.
- Open a pull request. The PR says what changed, how it was verified (exact commands), and what is still missing. Never merge your own PR or force-push a shared branch.

## Writing

Code, comments, docs and UI text are in English. Shop-floor voice alerts stay in Indonesian. Write plainly: no marketing words, no em dashes, no claims the code or tests do not back up.

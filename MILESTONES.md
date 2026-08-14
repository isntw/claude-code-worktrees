# Milestones and progress

Where `ccwt` is against `SPEC.md` §10, and what was added along the way that the spec did not
anticipate. Everything marked **done** was verified by running it, not by reading the code — the
verification is named in each case.

Last updated 2026-08-12.

| Milestone | State |
|---|---|
| 1 — the loop works | ✅ **done** |
| 2 — Claude Code aware | 🟡 **half** — discovery and locks done, session launch and `.worktreeinclude` stubbed |
| 3 — configurable | ✅ **done**, and beyond the spec |
| 4 — polish | ⬜ **not started** — session-status hooks are the missing centrepiece |
| 5 — `WorktreeCreate` ownership | ⬜ **not started** (spec marks it optional) |
| — | File browser, zero-touch setup and after-start commands were added outside the plan |

---

## Milestone 1 — the loop works ✅

Register → create → provision → serve → logs → open → remove.

- `git worktree add/list/remove` over `--porcelain`, lock detection, per-worktree git config
- package manager and dev-script detection
- provisioning: copy, hardlink, install, `postCreate`
- deterministic port allocation, persisted in `git config --worktree`
- supervisor: spawn detached, capture logs, kill the process group, TCP reachability probe
- live dashboard over WebSocket

**Verified** against a scratch repo: `.env` copied (it is gitignored, so its presence proves the
copy ran), port persisted and reused across a restart, dev server serving, process group reaped on
stop and on quit with no strays, branch kept after removal.

## Milestone 2 — Claude Code aware 🟡

| Item | State |
|---|---|
| §5.1 discover and adopt Claude-created worktrees | ✅ done |
| §5.5 respect `git worktree lock` | ✅ done |
| launch a Claude Code session from the dashboard | ⬜ **stub** — `claude.launchSession` |
| §5.4 read `.worktreeinclude` | ⬜ **stub** — `provision.readWorktreeInclude` |

Discovery came free: `git worktree list --porcelain` returns every worktree whoever made it, so
Claude Code's `.claude/worktrees/*` appear tagged `claude` and can be started on demand. There is no
separate adopt step and no adopt endpoint.

**Verified**: a real `git worktree lock` is refused with git's own reason, and the card disables the
control.

**The gap that shows**: the *launch a session* button renders on every card and returns 501.

## Milestone 3 — configurable ✅

Delivered past what the spec asked for.

- **zod schema** shared by loader, write endpoint and editor; strict objects, so `"service"` for
  `"services"` is an error naming the key rather than a silently ignored block
- **recipe editor** at `/project/:id/config` — form ⇄ JSON, line-diff before saving, `detect` button
- **multi-service detection** — parses `concurrently` / `npm-run-all`, walks pnpm and npm workspaces
- **`dependsOn`** with reachability-based ordering; cycles and unknown names refused at validation
- **`postRemove`** teardown that can never block a removal
- **copy and link** as separate lists, because a hardlink is the same inode

**Reversed from the spec**: §6 called for a committed `ccwt.config.json`. Recipes live in
`~/.ccwt/state.json` instead and ccwt has **no code path that writes into a repository**. A
committed file is still read if a project ships one. The sharing that a committed file bought is a
team feature §2 puts out of scope, and detection reconstructs the recipe anyway.

**Verified**: detection produced `claude-code-manager`'s two services from its `concurrently` script
exactly, so the hand-written config could be deleted; a dependency taking four seconds to listen
delayed its dependent by exactly that.

## Milestone 4 — polish ⬜

| Item | State |
|---|---|
| §5.2 session-status hooks | ⬜ stub — `installHooks`, `applyHook`, `agentStatus` and two more |
| port map view | ⬜ nothing |
| git status per worktree | ⬜ nothing |
| `.env` diff | ⬜ nothing |
| drift detection and repair | ⬜ nothing |

**This is the most visible gap in the product.** `AgentBadge` renders on every card and always reads
"no agent", because `agent` is a hardcoded `IDLE` constant. Spec §5.2 calls session status *"the
feature that makes the dashboard worth leaving open"*; until the hooks land, that part of the UI is
inert.

## Milestone 5 — `WorktreeCreate` ownership ⬜

Not started. The spec marks it optional and notes the trade-off: installing the hook disables
`.worktreeinclude` processing.

---

## Added outside the plan

### After-start commands ✅

`postStart` on a service runs commands once its port answers, in the worktree, with the same
environment the service was spawned with. A failing command is retried for two minutes, because a
port answering does not mean everything behind it is ready; the first attempt streams, retries run
quiet, and the settling attempt prints its own output. `waitReachable` waits for them, so `dependsOn`
means reachable *and* prepared.

**Verified**: a service whose after-start command queried the service itself over HTTP and got 200;
a failing command reported its exit code, skipped the commands after it, and left the service
running.

### Ports reach a worktree as environment ✅

Every service is spawned with its own port and every other service's `CCWT_PORT_*` / `CCWT_URL_*`,
and ccwt writes the same values into a marker-delimited block in `.env.local`, which Vite, Next and
Nuxt all load. Where a project hardcodes an inter-service address, `inspect.ts` finds it and the **Setup** panel explains
in plain language what ccwt will do and what the optional change would be.

### Browse for a project ✅

`GET /api/fs/list` lists directories only, marks git repositories and already-registered ones, and
carries its own loopback-only gate on top of the Host check and token, because it is deliberately
outside §9's containment rule. `POST /api/projects/probe` validates a typed path as you type.

### Recipe staleness ✅

`RECIPE_REVISION` stamps a stored recipe. One saved under an older revision raises
`project.recipe-stale` telling you to press detect. It is **not** migrated — the stored recipe is
the user's, and guessing at intent is worse than saying so.

---

## Known gaps, ranked

1. **Session status (Milestone 4).** The agent badge and the launch button are both inert. This is
   the reason to leave the dashboard open, and it is the largest hole.
2. **No tests.** Zero. Every bug found so far was found by running the thing. For an open-source
   project this is the gap most likely to bite.
3. **Detection is Node-shaped.** A Django, Rails or Laravel project registers, provisions and
   removes fine, but detects no service. Agreed and unbuilt: replace the filename list in
   `inspect.ts` with a search over git-tracked files, infer a container's role from its port rather
   than its image name, add an ask-once fallback, and mark detected services with their provenance.
4. **`.worktreeinclude`** (§5.4) — `provision.copy` must *merge* with it, not replace it.
5. **Milestone 4's smaller items** — port map, per-worktree git status, `.env` diff, drift repair.

## Verifying a claim in this document

```bash
npm run typecheck && npm run build
npm start                       # or: node bin/ccwt.mjs --no-open --port 4600
grep -rn "stub('" server/lib    # everything still unimplemented, with its milestone
```

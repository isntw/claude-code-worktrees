# Telling a Claude Code session what is already running

Spec for an opt-in Claude Code integration, installed from the dashboard, that tells a session which
services ccwt runs for the repository it is working in — and stops it starting a second copy of one.
Not built.

Amends `SPEC.md` §5, which reads as though this whole area was decided against. It was not: §3 below
is the distinction, and §8 corrects §5.3, whose stdin contract does not match what Claude Code
actually sends.

Motivating case: you create a worktree, ccwt starts its dev server, you open a Claude Code session,
and the session starts a second dev server to check its own work.

> Facts below marked **(2.1.234)** were read out of the shipped Claude Code binary rather than the
> documentation, which is thinner than the behaviour. They are version-specific and worth re-checking
> when that version moves.

---

## 1. What is wrong today

A snapshot of this machine, taken while writing this document. Three `nuxt dev` processes, every one
orphaned — all three parent pids already dead:

| pid | port | where | age |
|---|---|---|---|
| 20849 | 5266 | `.claude/worktrees/link-never-copies` | 13 min — ccwt's allocated port |
| 77113 | **5600** | the root checkout, `nuxt dev` with no `--port` | 3 h 53 min |
| 66057 | 5275 | `.worktrees/ccwt-drop-session-status` — **directory no longer exists** | **2 d 7 h** |

The middle row is the reported symptom: a plain `npm run dev`, which for this project binds 5600 and
is therefore outside the 5200–5299 range ccwt allocates from, where ccwt cannot see it at all.

The bottom row is the part nobody reports. These servers outlive the session, the worktree and ccwt
itself. `supervisor.ts` holds `entries` in memory only, so a server ccwt did not spawn — or spawned
before a restart — is invisible to it while still holding a port `ports.isFree()` will refuse to hand
out. The cost is not one wasted minute of duplicate server. It is ports leaking out of the allocator,
one worktree at a time.

None of this is the session's fault. It has no way to know. `git worktree list` reports that an agent
is present (§5.5) but says nothing in the other direction, and no file inside the worktree mentions
the port.

---

## 2. Scope

### In scope

- A **plugin**, installed and removed from the dashboard, covering every project on the machine
- Tell the session what the **repository** runs — worktrees, services, ports, liveness
- Keep that picture fresh as services start, stop and move
- **Deny** a command that would duplicate a service already listening
- Route worktree creation through ccwt when asked, so a new worktree arrives provisioned and served
- Record ccwt's own host and port, so a session can reach the API at all

### Out of scope

- **An MCP server.** Tools for status, logs and restart would be the richest integration. It needs
  ccwt running, costs schema context in every session, and §9 gets most of the value for none of it.
  The plugin is the right container for one later.
- **A skill**, in the first pass. §5 injects the same facts deterministically; a skill fires when the
  model decides it is relevant. It earns its place when it carries a *procedure* the injected context
  cannot — how to verify a change here, what to do with a crashed service — not a second copy of the
  port table.
- **Reporting session state back to ccwt.** That is §5.2, and it stays dropped — see §3.
- **Killing what a session left behind.** §10 argues that belongs to ccwt, not to a hook.
- **Starting the session.** ccwt is not an agent runner (§5.2). Unchanged.

---

## 3. Why this is not the feature §5.2 dropped

§5.2 dropped session tracking, and the reason bears repeating exactly:

> It is the one feature that requires ccwt to **write into a repository it did not create**, which §6
> otherwise forbids outright.

That plan wrote hooks into **the project's `.claude/settings.json`** — a file inside a registered
repository. The rule in `CLAUDE.md` is absolute, and it stays absolute.

This feature ships a **plugin**, installed through Claude Code's own CLI (§4). It writes into no
repository, and — since the plugin carries its own hook scripts — it does not edit any configuration
file either. The rule needs no exception.

Machine-wide is therefore not a convenience. It is what makes this legal where its predecessor was
not, and it is also better: one install covers every project ccwt knows and every project it does
not, because a hook resolves everything at run time and prints nothing where ccwt has no answer.

The two features also point in opposite directions, which is easy to miss:

| | direction | answered by |
|---|---|---|
| §5.2, dropped | Claude → ccwt: *an agent is working here* | the worktree lock, for free |
| this | ccwt → Claude: *this is already running* | nothing at all |

The lock does not answer this one. Nothing does.

---

## 4. Shape: a plugin, not a configuration edit

Claude Code has a complete non-interactive plugin CLI, so the dashboard button spawns a process —
which is what ccwt does for a living — instead of performing surgery on a file it does not own:

```bash
claude plugin marketplace add <source>
claude plugin install ccwt@ccwt --scope user -y
claude plugin list --json          # id, version, scope, enabled, installPath, installedAt
claude plugin uninstall ccwt@ccwt
claude plugin enable|disable ccwt@ccwt
```

`-y` is **required when stdout is not a TTY**, which is exactly ccwt spawning it. `list --json` is
the panel's state, so nothing has to be inferred by parsing anyone's settings.

### Layout

The ccwt package is the marketplace; the plugin sits inside it. Both manifests validate with
`claude plugin validate`:

```
claude-code-worktrees/
  .claude-plugin/marketplace.json    name "ccwt"; plugins:[{ name:"ccwt", source:"./plugin" }]
  plugin/
    .claude-plugin/plugin.json
    hooks/hooks.json                 SessionStart · UserPromptSubmit · PreToolUse · WorktreeCreate …
    hooks/ccwt.mjs                   one zero-dependency entry point, dispatched by argv
```

`hooks.json` refers to the script as `node "${CLAUDE_PLUGIN_ROOT}/hooks/ccwt.mjs" <mode>`.
**`${CLAUDE_PLUGIN_ROOT}` is why there is no path to rot**: install copies the plugin into
`~/.claude/plugins/cache/ccwt/ccwt/<version>/` and the variable resolves there, so nothing points at
ccwt's checkout and moving or reinstalling ccwt breaks nothing.

### Two things this costs

- **`package.json` ships `files: ["bin", ".output"]`.** `plugin/` and `.claude-plugin/` must be added
  or the plugin is missing from the published package while working perfectly from a checkout.
- **Where the marketplace source points.** ccwt's own install directory is simplest but only as
  stable as how ccwt was installed — an `npx` run has no durable path. Preferred: ccwt materialises
  the plugin into `~/.ccwt/plugin/` at startup and registers *that*, which is immune to install
  method and stays in the directory ccwt already owns.

An install applies **at the next session**, not the current one. The panel says so.

---

## 5. What the session is told, and when

### There is no push (2.1.234)

`CwdChanged` and `FileChanged` share one dispatcher, and it harvests only `watchPaths` and
`systemMessage` from a hook's result — never `additionalContext`. So although a hook can register
watch paths and ccwt could touch a file on every status change, the resulting event can print a line
to the user's terminal and cannot tell the model anything.

**Three events carry context to the model**, and every one of them is Claude Code calling us:

| event | carries context | used for |
|---|---|---|
| `SessionStart` | yes | the opening picture |
| `UserPromptSubmit` | yes | the delta, when something moved |
| `PreToolUse` | yes | the denial, at the moment of the command |
| `CwdChanged` / `FileChanged` | **no** | nothing — cannot reach the model |

ccwt cannot initiate. The mechanism is emit-on-turn, and the design has to be honest about that
rather than wish for a socket.

### `SessionStart` describes the repository, not the directory

Describing `cwd` alone fails the ordinary case. Ports live in each **linked** worktree's git config,
so a session launched in the root checkout resolves a worktree with no ports and learns nothing — and
"work in the worktree at …" is a normal thing to be told.

So: walk `git worktree list --porcelain` for the repository containing `cwd`, read each worktree's
`ccwt.port.*`, probe each, and report the lot.

```
This repository has ccwt worktrees. ccwt owns these services and their ports:
  claude-hooks-install   dev → 5270   stopped
  link-never-copies      dev → 5266   running at http://localhost:5266
  (root)                 dev → —      no port allocated

Do not start your own dev server. Open the URL. Starting, stopping and restarting
a service is ccwt's job.
```

Outside a registered project, fall back to every ccwt service currently listening on the machine, and
say nothing at all if there are none.

### `UserPromptSubmit` carries the delta

Fires every turn with the current `cwd`. Build the same table, fingerprint it, compare against
`~/.ccwt/sessions/<session_id>.json`, and **emit only when it changed**:

```
ccwt: `dev` moved to port 5312 (was 5270) and is running at http://localhost:5312
```

`session_id` arrives in every hook's input, so the marker costs nothing. When nothing moved the hook
prints nothing and spends a few git reads and TCP probes.

**This is the honest use of `SessionEnd`** — deleting that marker. Not killing processes (§10). It
does not fire on a crash, so prune the directory by mtime as a backstop.

### `PreToolUse` cannot go stale

The guard reads live state at the moment of the command, so a delta missed or compacted away does not
matter: the reason the model gets always names the current port. §7.

---

## 6. How a hook resolves the picture

Entirely offline. No server, no token, no network — prototyped and confirmed against a real worktree
while ccwt was **not running**:

```
worktree  git rev-parse --show-toplevel
root      git worktree list --porcelain          first entry is the main worktree
project   ~/.ccwt/state.json, matched on rootPath    -> service names, commands, cwd
ports     git config --worktree --get ccwt.port.<service>   per worktree
liveness  TCP connect, 127.0.0.1 and ::1
```

This works because `ports.ts:108` already persists every allocation into the worktree's own git
config. It is durable, per-worktree, and survives ccwt being closed.

Two rules from `CLAUDE.md` get re-implemented in the plugin, and both have been gotten wrong before:

- the config key is lowercased with non-alphanumerics collapsed to dashes, because **a git config key
  may not contain an underscore**
- the probe tries **both address families**, because Vite binds `localhost`, which on macOS is `::1`

That duplication is the honest cost of a hook that answers with ccwt closed. §9 notes the shape that
would later collapse it.

**Liveness comes from the probe, never from "is ccwt running".** §1 is why: every process there
outlived its parent.

### When nothing matches

Not a repo, not a registered project, no recipe, no allocated port, unreadable `state.json`,
`~/.ccwt` absent — every one exits 0 and prints nothing. A hook that failed loudly outside ccwt's
world would be a machine-wide hook breaking every unrelated session, so **discovery must never
throw** applies here with more force than anywhere else in the codebase.

---

## 7. The guard

`PreToolUse` on `Bash` returns:

```json
{ "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "ccwt already runs `dev` for this worktree, listening on http://localhost:5270. Use that URL rather than starting a second one — ccwt owns this service's lifecycle." } }
```

`permissionDecisionReason` goes back to the model, so a denial teaches rather than merely blocks.

**It must not know what a dev server is.** `CLAUDE.md` forbids teaching ccwt about a particular
stack, and a hardcoded list of `npm run dev` / `pnpm dev` / `rails s` is exactly the convenience that
does the wrong thing for every project it was not written for. The match is derived from the recipe:
take `services[].command`, strip the `{{port}}` template, reduce to argv, compare shape. This
project's guard blocks `npm run dev`; `charactersheet`'s blocks `docker compose -f compose.ccwt.yml …
up`; a Django project's blocks whatever its recipe says.

### It resolves its own target

**`cwd` is the session's, not the Bash tool's** (2.1.234) — `PreToolUse` builds its input from the
same global cwd getter as every other event. So `cd ../worktrees/foo && npm run dev` would otherwise
be matched against the wrong worktree. Resolve a leading `cd <path> &&` out of the command first,
then fall back to `cwd`.

### Bounds, so it stays narrow

- Only when the target resolves to a ccwt worktree with a recipe
- Only against services that project declares
- Only when the service is **actually listening** — a stopped service is not a reason to block
- **Deny, never `updatedInput`.** Rewriting would fight the rtk hook already installed on this
  machine, which returns `updatedInput` of its own. Two hooks rewriting one string is a race worth
  never entering
- Nothing else, ever. It is not a general command filter and must not grow into one

---

## 8. Creating a worktree

Optional, off by default, and the one part that needs ccwt running. It replaces §5.3, whose stdin
contract is wrong.

### What `WorktreeCreate` actually sends and expects (2.1.234)

| §5.3 says | actually |
|---|---|
| stdin carries `worktree_path`, `worktree_reason`, `how_triggered` | stdin carries **`name`**, plus the common fields: `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `agent_id`, `agent_type`, `effort`. The other three do not exist — `worktree_path` is the *`WorktreeRemove`* field |
| "prints the final path on stdout" | correct. The **last non-empty line** is taken; a relative path resolves against `cwd` |

**Failure is fatal and there is no fallback to git.** A non-zero exit, a success that prints no path,
or a hook configured but not run — untrusted workspace, `disableAllHooks`, matcher mismatch — makes
worktree creation *throw*.

This is a machine-wide plugin, so that is severe: with ccwt down, `claude --worktree` would break in
every repository on the machine, including ones ccwt has never heard of.

### Therefore

- **The hook always exits 0 and always prints a path.** When ccwt is unreachable, or the repository
  is not a registered project, it performs the plain `git worktree add` itself and prints that. ccwt
  is the enhancement; plain git is the floor.
- **A subagent worktree gets the floor, never provisioning.** The event fires for
  `isolation: "worktree"` and background sessions too, and `agent_id` is present only for a subagent,
  which makes it the discriminator. Unbounded, a ten-way fan-out becomes ten provisions and ten dev
  servers, each hardlinking `node_modules` and running `postCreate` — which `CLAUDE.md` notes
  "generates keys, seeds databases and builds".

### What ccwt already does

`create()` takes `start: boolean` and, when true, provisions, allocates every port and starts every
service (`server/lib/worktrees.ts:292`). `POST /api/projects/<id>/worktrees` with
`{name, branch, start}` is the whole call. **Nothing new is needed server-side** — this hook is only
a trigger.

Branch naming stays Claude Code's (`worktree-<name>`) so existing worktrees and new ones agree; the
path becomes ccwt's `worktreesDir`, which is the point of §5.3.

`WorktreeRemove` receives `worktree_path`, is **non-blocking** — failures are logged in debug only —
and maps exactly onto the existing rule that **`postRemove` may never block a removal**.

### Both creation paths converge

| created by | ccwt running | outcome | how the session learns |
|---|---|---|---|
| ccwt dashboard | — | provisioned, ported, started if asked | §5 opening picture, or the delta |
| Claude, hook installed | yes | ccwt's `create()` — provisioned, ported, started | the delta, next turn |
| Claude, hook installed | **no** | plain `git worktree add` — creation never fails | the delta, saying *created without ccwt: no ports, no dependencies* |
| Claude, no hook | — | bare worktree | nothing until it is adopted in ccwt; then the delta |

Row three is the one that matters: the worktree is still made, and the session is told plainly that
it is bare instead of discovering it by failing.

### One ordering dependency

Installing `WorktreeCreate` replaces Claude Code's creation logic wholesale, which takes
`.worktreeinclude` handling with it. ccwt is meant to cover that — except **§5.4 is still the only
stub left in the codebase**. Shipping this before §5.4 silently drops `.worktreeinclude` with nothing
replacing it. §5.4 lands first, or this stays off.

---

## 9. `~/.ccwt/server.json`

`bin/ccwt.mjs:13` takes `--port`, defaults to 4600, and **writes it down nowhere**. Only the token is
persisted, so nothing outside the process can find the API.

Fix it where the token is already written, same mode 600:

```json
{ "host": "127.0.0.1", "port": 4600, "pid": 12345, "startedAt": "2026-08-17T…" }
```

Small, and it buys three things:

- **§8 can call `create()` at all.**
- **The session can read the running server's output** instead of starting one to get some.
  `logs.get.ts:7` already returns `supervisor.scrollbackFor(worktreeId)` as plain JSON,
  `x-ccwt-token` is already a valid header (`security.ts:37`), and `worktreeId` is
  `sha256(path).slice(0,12)` (`git.ts:24`) — computable offline.
- **The escape hatch for everything §5 cannot reach** — a worktree in another project the session has
  never been near — is `GET /api/overview`.

```bash
curl -s -H "x-ccwt-token: $(cat ~/.ccwt/token)" \
  http://127.0.0.1:4600/api/projects/<id>/worktrees/<worktreeId>/logs
```

Offered only when something answers on the recorded port: a stale `server.json` degrades to silence,
never to a broken instruction.

It also opens the better long-term shape — the supervisor writing live service state to disk on each
status change, collapsing §6's git walk and its two duplicated rules into one file read. Later, not
here.

---

## 10. Reclaiming a port ccwt did not start

`SessionEnd` is the obvious place to clean up the processes in §1, and it is the wrong one. It fires
only on a clean exit, and every orphan there had a dead parent — one had outlived its worktree by two
days. It also could not tell which processes to kill without the guard recording what it let through,
and ccwt's own services are *supposed* to outlive a session.

The machinery for the real answer already exists and is one step from useful.
`ServiceStatus.taken` (`shared/types.ts:80`) already means *stopped service, port occupied*, and
`WorktreeCard.vue:237` already renders `port 5266 taken`. Today it is a dead end — you can see the
orphan and do nothing about it.

Make it actionable: name what holds the port, offer to reclaim it. That covers every orphan whatever
its origin — session crash, ccwt restart, a hand-run `npm run dev` — which no hook can match.

Strictly, this is a separate change from the plugin. It is here because it is the other half of the
same problem, and because shipping the guard without it fixes the future and leaves the past running.

---

## 11. The panel

`/settings` — the machine-wide page, beside GitHub, for the same reason `ForgePanel` lives there.
The nav blurb reads *"The accounts and hosts ccwt talks to on your behalf."* which no longer covers
the page: widen it in `app/nav.ts`.

State comes from `claude plugin list --json`, so it is read rather than inferred:

| state | meaning | look |
|---|---|---|
| unavailable | no `claude` on PATH | plain, no install button |
| absent | available, not installed | offer install |
| installed | present and enabled | `--ccwt-live` — the machine confirmed it is usable |
| disabled | installed, switched off in Claude Code | offer enable |
| outdated | plugin version behind this ccwt | offer update |

`--ccwt-live` is right for *installed* on the existing rule: a satisfied host requirement is already
what that hue is for. Everything else is achromatic or one of the two warm hues.

What the panel must state before the first install: that it runs `claude plugin …` on your behalf,
that a denied command is a command that will not run, that worktree creation is **off by default**
and what it changes when on (§8), and that everything takes effect in the **next** session.

Per-hook `Toggle`, one row each, with one sentence saying what that hook does. Worktree creation is
its own row and stays off until §5.4 lands.

---

## 12. Inventory

| file | change |
|---|---|
| `plugin/.claude-plugin/plugin.json` | new |
| `plugin/hooks/hooks.json` | new — four events |
| `plugin/hooks/ccwt.mjs` | new — discovery, four handlers, zero dependencies |
| `.claude-plugin/marketplace.json` | new |
| `package.json` | `files` must include `plugin` and `.claude-plugin` |
| `bin/ccwt.mjs` | write `~/.ccwt/server.json`; materialise the plugin into `~/.ccwt/plugin/` |
| `shared/types.ts` | `PluginState`, `PluginHook`, `PluginReport` |
| `server/lib/plugin.ts` | drive the `claude plugin` CLI; no Nuxt, no H3 |
| `server/api/plugin.get.ts` · `.post.ts` · `.delete.ts` | report, install, remove |
| `app/composables/useApi.ts` | `getPlugin` / `installPlugin` / `removePlugin` |
| `app/components/PluginPanel.vue` | new |
| `app/pages/settings.vue` · `app/nav.ts` | mount it; widen the blurb |
| `docs/SPEC.md` | §5.3 contract corrected; §5.6 added |
| `docs/MILESTONES.md` | entry |

Diagnostic codes, namespaced `thing.problem` and stable: `plugin.no-claude`, `plugin.disabled`,
`plugin.outdated`, `plugin.install-failed`.

---

## 13. What must never happen

- **A write into a registered repository.** The whole feature is arranged around this (§3).
- **A hook that throws outside ccwt's world.** It runs in every session on the machine, including
  repositories ccwt has never heard of.
- **A `WorktreeCreate` that can fail.** Non-zero breaks worktree creation everywhere (§8).
- **Provisioning a subagent worktree.** Ten agents, ten installs, ten servers (§8).
- **A slow hook.** `PreToolUse` fires on every `Bash` call and `UserPromptSubmit` on every turn.
  Cheapest checks first; no work once the target fails to resolve.
- **A guard that grows.** Duplicates of declared services, and nothing else, forever.
- **Teaching ccwt a stack.** The recipe is the only source of what a service command looks like.

---

## 14. Verifying it

```bash
npm run typecheck && npm run build
claude plugin validate .            # marketplace
claude plugin validate ./plugin     # plugin
```

Each handler, driven by hand — every one must exit 0:

```bash
echo '{"cwd":"'"$PWD"'","session_id":"t","hook_event_name":"SessionStart","source":"startup"}' \
  | node plugin/hooks/ccwt.mjs session-start

echo '{"cwd":"'"$PWD"'","tool_name":"Bash","tool_input":{"command":"npm run dev"}}' \
  | node plugin/hooks/ccwt.mjs guard
```

Confirmed already, against a working prototype — manifests validated, handlers driven by hand:

| case | expected | result |
|---|---|---|
| `session-start` in a worktree | names the service, port and state | ✅ `dev — port 5270 — stopped` |
| `guard`, service listening | denies, naming the URL | ✅ |
| `guard`, service stopped | silence | ✅ |
| `guard`, unrelated command | silence | ✅ |
| `guard`, outside ccwt | silence | ✅ |

Still to prove: repository-scope output from the root checkout; the delta emitting once and then
staying quiet; `cd <path> &&` resolving to the right worktree; `WorktreeCreate` returning the plain
git path with ccwt stopped; a subagent worktree getting the floor; and an install landing beside the
rtk hook in `~/.claude/settings.json` without disturbing it.

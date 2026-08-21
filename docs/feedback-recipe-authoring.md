# Feedback: writing a recipe as an agent

From a session that wrote a recipe for an unrelated project (Nuxt 4 + Nitro, pnpm) and shipped it
broken. The recipe validated, the service started, `ccwt_status` said `running`, and the browser
showed `426 Upgrade Required`. Ordered by what would have caught it earliest.

## What happened

The recipe set the port four ways — `--port {{port}}` in the command, plus `NUXT_PORT`, `PORT` and
`NITRO_PORT` under `env`. `PORT` was the fatal one. `@nuxt/vite-builder` picks its HMR port with
`getPort({ portRange: [24678, 24698] })`, and `get-port-please` prefers `process.env.PORT` over the
range it was handed:

```js
const _port = Number(_userOptions.port ?? process.env.PORT)
```

So Vite's HMR WebSocket asked for the service's own port, found it free — config resolves before the
app binds — and took it on `[::]`. Nuxt then bound `0.0.0.0` only, because that project's
`nuxt.config.ts` sets `devServer.host: '0.0.0.0'`. Two listeners, one number, one pid:

```
node 90258  fd 14   IPv4  *:4511 (LISTEN)   the app
node 90258  fd 409  IPv6  *:4511 (LISTEN)   Vite's HMR WebSocket
```

`127.0.0.1:4511` served the app. `localhost` resolved to `::1`, hit the WebSocket server, and got
`426`. Writing four port variables when one was already verified to work was the author's error. The
notes below are about the four places ccwt could have made that error visible.

## 1. Lint the mirror of `portReaches` — highest value, lowest cost

`server/lib/lint.ts` warns when an allocated port reaches nothing. The opposite case is just as
mechanical and would have blocked this recipe before anything ran:

```ts
function portInjections(service: Service): string[] {
  const sites = service.command.includes(PORT_TOKEN) ? ['command'] : []
  for (const [name, value] of Object.entries(service.env ?? {})) {
    if (value.includes(PORT_TOKEN)) sites.push(`env.${name}`)
  }
  return sites
}
```

Warn at two or more, and say why it is not merely redundant:

> the port reaches `dev` four ways — `command`, `env.NUXT_PORT`, `env.PORT`, `env.NITRO_PORT`. Set
> it once. A second copy is not free: port-allocation libraries read `PORT` as the preferred port for
> *any* allocation in the process, so a sidecar socket can claim the service's own port.

This stays inside the recipe's own shape — no knowledge of any stack, nothing detected. Naming
`PORT` in the hint is the one line that brushes against "nothing may teach it about a particular
runtime"; it is a POSIX-era convention rather than a framework, and the check fires on the count,
not the name. Downgrade it to a generic hint if that still reads as too much.

## 2. `isListening` takes either family; `urlFor` advertises one

```ts
export async function isListening(port: number, timeoutMs = 1000): Promise<boolean> {
  const attempts = await Promise.all(LOOPBACK.map((host) => connectTo(port, host, timeoutMs)))
  return attempts.some(Boolean)
}
```
```ts
const urlFor = (port: number) => `http://localhost:${port}`
```

`isFree` requiring both families is right, and CLAUDE.md's "bind narrowly, probe broadly" is right.
But `.some()` plus a single advertised hostname means readiness can be true on a family the URL never
reaches: a service bound `127.0.0.1` only, on a machine where `localhost` is `::1`, reports `running`
behind a dead link. That is a real bug independent of this incident.

**Be aware this would not have caught the incident.** Something did answer on `localhost` — the wrong
server. No connect-level probe distinguishes that. Worth fixing on its own merits, not as a defense.

The smaller honest version: have `isListening` return which families answered and keep that on the
service entry, so `ccwt_status` and the dashboard can say `answering on ::1 only` when they disagree.

## 3. Two servers on one port number is invisible to ccwt

`isFree` was correct at allocation — 4511 was free on both families. The collision was created later,
by the service itself, and both sockets belonged to the same pid, so neither a process-group check nor
a re-probe would separate them. Node has no portable socket enumeration, so detecting this properly
means shelling out per platform, which is likely more than it is worth.

Surfacing the families from item 2 gets most of the value: a human or an agent reading
`answering on 127.0.0.1 and ::1` for a service that should have bound one of them has something to
pull on. Recommended as reporting, not enforcement.

## 4. The recipe author cannot test the fix

The MCP surface has `ccwt_worktree_start` but no stop or restart — those are dashboard-only. So the
loop after finding the bug was: edit the recipe, hand it back to the human, wait for them to restart,
re-probe. An agent that owns the recipe should be able to close that loop.

Either a `ccwt_worktree_restart`, or let `ccwt_worktree_start` re-apply the recipe to a service that
is already running. "ccwt owns the lifecycle" is the right principle; it does not require that the
author of a broken recipe be unable to prove the fix.

## 5. `ccwt_logs` takes a path, everything else takes a name

`ccwt_status` prints worktree names. `ccwt_worktree_start` accepts `worktree` by name. `ccwt_logs`
accepts only `path`. Given a status listing that said `test`, the obvious call was
`.claude/worktrees/test`, which returned:

> This directory is not inside a repository ccwt manages.

The real path was `.claude/worktrees/anime-downloader/test` — `worktreesDir` plus a project segment
that appears in no tool output. It took `git worktree list` to find. Add `worktree` to `ccwt_logs`,
or print paths in `ccwt_status`.

## 6. `ccwt-recipe-create` skill

- **The port example is `"env": { "PORT": "{{port}}" }`** — the single most side-effect-laden name
  available, offered as the model to copy. Use a neutral one, and carry item 1's hint in prose.
- **The skill has no verification step.** It ends at "say plainly what the recipe does ... and that it
  takes effect on the next worktree." It should end at: create a worktree, start it, fetch the
  advertised URL, and confirm the service answers — not merely that the port does. That is where this
  session stopped one step short, and it is the only item here that would have caught the bug without
  any change to ccwt.
- **Unanswered mechanics that had to be guessed at.** Does `copy` create parent directories? (The
  target project's `data/` is gitignored and absent from a fresh worktree; it worked.) Does `link`
  recurse into a directory, and what becomes of symlinks inside it? That last one is why this recipe
  chose `pnpm install` under `postCreate` over linking `node_modules` — pnpm's tree is symlinks into
  `.pnpm`, and nothing in the skill said what would happen. CLAUDE.md's `placeFiles` / `provision`
  split answers most of this; a few lines of it belong in the skill.
- **Worth adding to "what to read before you write anything":** gitlink entries with no
  `.gitmodules`. Git checks them out as **empty directories** in a worktree, silently. In the target
  project that is 124 MB of reference clones under `utils-lib/`, which its `CLAUDE.md` tells agents to
  grep instead of fetching from GitHub — present at the root, empty in the worktree, no warning
  anywhere. Same shape as the existing "what is gitignored but needed" bullet.

## The recipe this produced, after the fix

```json
{
  "command": "pnpm exec nuxt dev --port {{port}}",
  "portRange": [4450, 4549],
  "env": { "NUXT_PORT": "{{port}}" }
}
```

`NUXT_PORT` survives only because that project's copied `.env` hardcodes one, and `c12` will not
overwrite a variable already present in `process.env`. Under item 1 that is two injections and would
draw a warning — correctly, since it is worth a comment in the recipe rather than silence.

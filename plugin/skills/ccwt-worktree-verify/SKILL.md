---
name: ccwt-worktree-verify
description: Prove that a ccwt service serves the project rather than merely holding a port. Use after writing or changing a recipe, after starting a service, and whenever a service reports running but the page is wrong, empty, refused or asks to upgrade the connection.
---

# Proving a service runs

`ccwt_get_status` reporting `running` means one thing: **something accepted a TCP connection on that
port.** It does not mean the command started correctly, and it does not mean the thing answering is
this project. A recipe is not finished until you have read what comes back.

## The check

1. **`ccwt_get_status`** — the port, the URL, and the worktree's path. Take the path from here; never
   assemble one, because a worktree sits under a directory named for the project.
2. **Fetch the URL and read the body.** You want the project's own HTML or JSON. A status code alone
   proves nothing — `426`, `200` with an empty body, and someone else's page are all "the port
   answered".
3. **Fetch `http://127.0.0.1:<port>` too, not only `http://localhost:<port>`.** On macOS `localhost`
   is `::1` and those can be two different servers. ccwt reports `running` when **either** family
   answers, and advertises `localhost` only.
4. **`ccwt_get_logs`** — what the service actually printed, and any note ccwt added itself.

Say which of these you did. "The recipe validates and the service is running" is not a verification;
"`http://localhost:5241` returns the app's index page" is.

## What a wrong answer means

| What comes back | What it is |
|---|---|
| `426 Upgrade Required` | A WebSocket-only server holds the port — usually a dev server's own HMR socket, which took the port meant for the app. See below. |
| Refused on one host, served on the other | The command bound one address family. The port answers, so ccwt says `running`, but the advertised `localhost` URL may be the dead one. |
| An empty `200`, or a different project | Something else owns the port. `ccwt_get_status` in the other repository will say what. |
| ccwt logged `nothing is listening on port N` | The command never took the port ccwt assigned. The recipe passes it somewhere this command does not read — check the flag or variable name against the project's own docs. |
| The port answers but `postStart` failed | A port answering does not mean the thing behind it is ready. ccwt retries for two minutes, then names the command that kept failing. |

## Why a sidecar takes the app's own port

ccwt exports `PORT` to every service it spawns, set to that service's allocated port. Port-picking
libraries — `get-port-please`, `portfinder`, `detect-app-port` — read `process.env.PORT` as the
*preferred* port for **whatever they are asked to allocate**, not only for the app's own listener. A
dev server that allocates a second socket while resolving its config finds the app's port still free,
because the app has not bound yet, and takes it. Two listeners on one number, one pid: the app on one
address family, the sidecar on the other.

Vite's HMR WebSocket is the usual culprit, and `426 Upgrade Required` in a browser is what it looks
like.

**Give the sidecar a port of its own.** Declare `PORT` under the service's `ports` with the range the
sidecar documents for itself. A named port is allocated per worktree, reserved against every other
service, and overrides the `PORT` ccwt would otherwise export — so the sidecar takes a port intended
for it, and the app keeps the one the command was told:

```json
{
  "name": "dev",
  "command": "pnpm exec nuxt dev --port {{port}}",
  "portRange": [4450, 4549],
  "ports": { "PORT": [24678, 24698] }
}
```

Only do this when the app's own port arrives another way — a flag, or a variable the project reads. A
command that takes its port from `PORT` and nothing else needs `PORT` left as ccwt set it.

## Testing a change

What a recipe change reaches depends on what changed:

- **A service's `command`, `env`, `ports` or `portRange`** is read when the service starts.
  `ccwt_stop_worktree`, then `ccwt_start_worktree`. Starting a service that is already running
  re-applies nothing and still reports `running`.
- **A `copy`, `link` or `write` entry** — `ccwt_provision_worktree` puts it in an existing worktree.
- **A `postCreate` command** only ever runs on a worktree ccwt creates. Existing worktrees will never
  have it; make a new one with `ccwt_create_worktree`.

Removing a worktree is the dashboard's, not a tool's. If a test left one behind, say so and let the
person delete it — the confirmation there names the path and what it destroys.

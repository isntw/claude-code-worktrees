# Issue: status reports every worktree as up when they share a port

Found 2026-10-13 from a session in `kp_xv_portal`, a project whose recipe gives every worktree's
`dev` service port 3000 (only one runs at a time).

## What happened

`ccwt_get_status` returned `up: true, url: http://localhost:3000` for all ten worktrees of the
project. The SessionStart context said the same thing, one line per worktree: "dev -> 3000 running
at http://localhost:3000". Only one process was listening, and it was the root checkout:

```
$ lsof -nP -iTCP:3000 -sTCP:LISTEN -t      # 11114
$ lsof -a -p 11114 -d cwd -Fn              # n/Users/.../kp_xv_portal  (root, branch staging)
```

The agent needed the `mtech-6212-withdrawal` worktree running to test a change. Status said it
was already up, and `ccwt_start_worktree` on it would have reported `alreadyRunning` and left it
alone, so the change would have been checked against the staging build. Finding the real owner
took a manual `lsof` call. The fix was `ccwt_stop_worktree` on the root, then
`ccwt_start_worktree` on the worktree.

## Cause

`describe()` in `plugin/src/lib/discover.ts` decides `up` with a bare TCP probe of the port
allocated to that worktree:

```ts
up: port === null ? false : await isListening(port),
```

`isListening` only asks "does anything answer on this port". When worktrees share a port, the one
listener answers for all of them. `plugin/src/lib/report.ts` and the MCP `ccwt_get_status`
handler (`plugin/src/mcp/server.ts`) pass that value through unchanged.

## Expected

A service is `up` only when the listener on its port belongs to that worktree. The other
worktrees sharing the port should say they are down, ideally with the reason, e.g.
`port 3000 is held by worktree kp_xv_portal`.

## Suggested fix

`server/lib/holders.ts` already resolves the listening pids for a port and reads each one's
working directory (`describe(pid)` -> `cwd: await workingDir(pid)`). Status could do the same:

1. Probe the port as now. If nothing answers, `up: false`.
2. If something answers, look up the listener pids and their cwd (or, better, match against the
   process groups the supervisor spawned for each worktree).
3. Mark `up: true` only for the worktree whose path contains that cwd. Give the others
   `up: false` plus a `heldBy` field naming the worktree (or "unknown process") that has the port.

Then `ccwt_start_worktree` on a worktree whose port is held by a sibling should refuse with that
message, or offer to stop the sibling, instead of counting the sibling as already running.

## Also affected

- The SessionStart hook text lists every sharing worktree as "running at" the same URL.
- `ccwt_start_worktree`'s `alreadyRunning` check, if it uses the same probe.

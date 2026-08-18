# The recipe covers the project

**Status:** proposed, unbuilt. Branch `worktree-worktree-stacks-spec`.

Scope: three additions to `ccwt.config.json` that let a project describe an environment ccwt has
never seen — a container stack, a multi-port dev server, anything — without ccwt learning what any
of it is.

---

## 1. Why

ccwt runs a command, allocates it one port, probes that port, and kills its process group. That
covers a Node dev server. It does not cover a project whose environment is several processes holding
several ports at once — most often a container stack, but equally a Vite server with a separate HMR
port, or a service running under a debugger.

Docker support was built twice and removed both times. The two attempts differed in goal and failed
identically: **ccwt learned Docker in order to help with it.** The first parsed the compose file to
rewrite it, the second parsed it to validate the recipe against it. Between them that required an
image-name table calling `mysql` a database, a port-string parser reimplementing compose's own
grammar, a heuristic reading intent out of a path, a preference list of ten filenames, and finally a
drift detector policing a fact ccwt had itself copied into two places.

The rule that forbids all of it is already written down:

> ccwt is command-agnostic. It allocates a port, renders a template, spawns a process, probes the
> port, kills the process group. It does not know what any command does, and nothing may teach it
> about a particular stack, framework or runtime.

This spec does the opposite of both attempts. ccwt learns nothing. The recipe gains enough
expressive power that the user states what their project needs, once.

---

## 2. What was measured

Three things were established before any design, because the last two attempts were designed first.

### 2.1 Per-worktree isolation needs nothing from ccwt

Two stacks brought up from **one unmodified compose file**, differing only in environment
(`COMPOSE_PROJECT_NAME`, `WEB_PORT`, `CACHE_PORT`):

| check | result |
| --- | --- |
| two stacks from one file | 4 containers, no collision |
| four host ports at once | `28081` → 200, `28082` → 200, `26381` → `+PONG`, `26382` → `+PONG` |
| `cache` resolved inside each stack | A → `172.20.0.2`, B → `172.21.0.2` |
| where the ports came from | **no `.env` file existed** — read from the process environment |
| stop A only | A dead; B still 200 and `+PONG` |
| networks | namespaced per project, removed on `down` |

**Compose interpolates from the process environment in preference to `.env`.** That single fact is
the whole mechanism. ccwt writes nothing and parses nothing.

### 2.2 One port per service is not enough

The same test, with each stack given a unique web port and the second published port left to fall
back to the file's default — which is exactly what ccwt can express today:

```
Error response from daemon: ... Bind for 0.0.0.0:26379 failed: port is already allocated
```

The second worktree did not come up degraded. **It did not come up.** Its own web port was free and
unused; the stack aborts as a unit. This is the blocking gap, and it is not a Docker gap — it is
ccwt allocating one unique value where a project needs three.

### 2.3 Real projects are not worktree-ready

17 compose files across 10 repositories:

- **Every published port is a hard literal.** `5432:5432`, `3010:3010`, `8080:8080`, `8687:8687`,
  `8078:80`, `33064:3306`, `8077:80`, `8076:443`, `9090:9090`, `3100:3000`. Not one uses a variable.
- **Port counts per stack: 1, 2 and 3.**
- **9 of 10 pin `container_name`** — `sparkyfitness-db`, `v1-web`, `v1-db`, `admin-console-nginx`,
  `prometheus`, `grafana`. A pinned `container_name` **overrides `COMPOSE_PROJECT_NAME`**, so two
  worktrees collide on the container name even when the project name differs.

So the previous contract — *the project commits a compose file whose published ports read from the
environment* — asks every user to edit their repository before ccwt does anything at all. That is
why it cannot be "widely available", and why the recipe has to carry it instead.

---

## 3. Non-goals

- **ccwt does not read, parse, generate, validate or rewrite a compose file.** No YAML dependency
  returns.
- **No field is named after a runtime.** Nothing called `compose`, `docker`, `image`, `container` or
  `stack`. A field that only makes sense for one runtime is that runtime's support wearing a
  disguise, which is how both previous attempts began.
- **Detection is not extended.** It stays Node-shaped and keeps proposing what it can see. Guiding a
  user from a bad suggestion to a written recipe is a UI problem, not a detection problem.
- **No inference of readiness, roles, or which file to run.** The user says.

Each addition below must pass one test: *is it equally useful to a project with no containers?* If
not, it does not go in.

---

## 4. Design

### 4.1 `ports` — a service may hold more than one allocated port

```json
{
  "name": "app",
  "command": "docker compose -f .ccwt/stack.yml up",
  "portRange": [20080, 20179],
  "ports": { "DB_PORT": [33060, 33159], "MAIL_PORT": [8025, 8125] }
}
```

`portRange` stays the **primary** port: the one templated as `{{port}}`, the one probed for
reachability, the one the card links to. `ports` adds further ranges, each allocated per worktree
and persisted exactly like the primary.

Each is exported **under its own literal name** — `DB_PORT=33061` — because the user does not choose
what their file reads; `${DB_PORT}` is already written in it. That is the one thing `CCWT_PORT_*`
cannot do. Both forms are exported, so `CCWT_PORT_DB_PORT` is also present for consistency with
cross-service variables.

Allocation, persistence and collision handling are unchanged: `allocate()` hashes into the range and
linear-probes, and `ports.ts:KEY()` already lowercases and collapses non-alphanumerics, which is
what keeps `ccwt.port.app-db-port` legal — **a git config key may not contain an underscore.**

*Generic beyond containers:* a Vite HMR port, a `--inspect` debugger port, a second listener.

### 4.2 `provision.write` — the recipe may carry file content

A third materialisation mode beside the two that exist: `copy` (from the root checkout), `link`
(hardlink from the root checkout), and now `write` (content from the recipe).

```json
"provision": {
  "write": [{ "path": ".ccwt/stack.yml", "content": "services:\n  web:\n    ..." }]
}
```

This is what makes ccwt usable on a repository the user cannot or will not modify. The file is
authored by the user and stored on ccwt's project record — **ccwt still never writes into a
registered repository**; `path` is resolved inside the worktree and rejected if it escapes it.

Rendered with `{{project}}`, `{{slug}}`, `{{branch}}`, `{{rootPath}}`, `{{worktreePath}}`.

**`{{port}}` and `{{port.NAME}}` are rejected at validation** — see §5 — with a message pointing at
`${VAR}` plus `ports` instead.

The written path is added to the worktree's local git exclude, so a file ccwt put there never shows
as untracked and cannot be committed by accident.

`needsProvisioning` compares content, so editing the recipe rewrites the file on next start; that is
the same self-repair the `copy`/`link` lists already get.

*Generic beyond containers:* an nginx conf, a `Procfile`, a `.env` fragment, a k8s manifest.

### 4.3 `scripts` — commands the user runs on demand

Everything ccwt runs today is automatic: `postCreate`, `postStart`, `postRemove`, `stopCommand`.
There is no "run this now", and for an environment that has just come up that is exactly what is
wanted.

```json
"scripts": [
  { "name": "migrate", "service": "app", "command": "docker compose exec -T app php artisan migrate" },
  { "name": "seed",    "service": "app", "command": "docker compose exec -T app php artisan db:seed" }
]
```

`service` means *run in that service's `cwd`, with the environment it was spawned with* — so
`COMPOSE_PROJECT_NAME` and the allocated ports are not declared twice. Omitted, a script runs at the
worktree root with the ports but no service environment.

Output streams into the existing log pane under the script's own name; `supervisor.note()` already
writes under an arbitrary name, which is how provisioning streams before a card exists.

One run of a given script per worktree at a time. A script never blocks or fails a service.

*Generic beyond containers:* `npm run test:e2e`, `rails db:migrate`, `make build`.

---

## 5. The ordering constraint

**Provisioning always runs before port allocation.** Verified in all three call sites:

| path | provision | allocate |
| --- | --- | --- |
| `create()` | `worktrees.ts:194` | `worktrees.ts:210` |
| `reprovision()` | `worktrees.ts:255` | `worktrees.ts:280` |
| `startService()` | `worktrees.ts:301` | `worktrees.ts:306` |

So a file written by `provision.write` **cannot** contain a port — the ports do not exist yet.

This is not a limitation to work around; it forces the correct design. The written file stays
static and refers to `${WEB_PORT}`; the value arrives as environment when the command is spawned.
Nothing has to be rewritten when a port changes, and §2.1 proves compose reads it from there.

Reordering allocation before provisioning is explicitly rejected: it would let a file bake in a port,
and a baked-in port is the failure mode this whole design exists to avoid.

---

## 6. Schema delta

```
ServiceConfig
+ ports?:   Record<string, [number, number]>    // env var name -> range

ProvisionConfig
+ write:    { path: string; content: string }[]

CcwtConfig
+ scripts:  { name: string; command: string; service?: string; cwd?: string }[]
```

Validation:

- `ports` keys match `/^[A-Za-z_][A-Za-z0-9_]*$/` (a legal environment variable name).
- A `ports` key may not collide with another service's name, or `{{port.x}}` becomes ambiguous.
- `write[].path` is relative, contains no `..`, and resolves inside the worktree.
- `write[].content` containing `{{port` is a validation error naming the alternative.
- `scripts[].service`, when present, names a declared service — the same check `dependsOn` gets.
- `scripts[].name` is unique.

---

## 7. Diagnostics

Two failures are opaque today and both are cheap to name.

**A port ccwt does not control.** When a service crashes within seconds and its log matches
`/address already in use|port is already allocated/`, say so: *something already holds a port this
command asked for — ccwt only controls the ports it allocates.* Stack-agnostic; it helps a Node port
clash identically.

**A pinned container name.** Not detectable without parsing, so it is documentation: the starter
skeleton offered in the recipe editor omits `container_name` and says why. On the evidence in §2.3
this is the single most likely first failure for a new user.

---

## 8. Compatibility

`ports` is the same name and shape as the field removed in the Docker rollback. A recipe stored
before that rollback will therefore have its `ports` accepted — which is correct, it meant the same
thing — while `primary` still fails `strictObject`. That surfaces as `project.recipe-invalid`
naming the field, and detection is offered. Nothing is migrated silently.

`RECIPE_REVISION` is **not** bumped. It signals that detection learned to produce a new field; these
three fields are user-authored and detection will never emit them.

---

## 9. How this gets verified

Not "it typechecks". The claim is that two worktrees of one project run at once, so:

1. Two worktrees of a real repository, both started, **four or more host ports serving
   simultaneously**, verified by connecting to each.
2. An internal hostname resolving to a **different** address inside each environment.
3. Stopping one leaving the other serving.
4. Removing one, and the other still serving afterwards.
5. A `provision.write` file appearing in both worktrees, differing where it templates `{{slug}}`,
   and showing in neither worktree's `git status`.
6. A script run from the dashboard streaming into the log pane and exiting non-zero without
   affecting the running service.
7. The same recipe shape driving a project with **no containers at all** — otherwise §3 has failed.

---

## 10. Open questions

- **Is `portRange` still the right primary,** or should a service be allowed to declare *no* probed
  port? A stack behind a reverse proxy publishes nothing to probe, and today that logs "nothing is
  listening" for 25s and then claims `running` anyway.
- **Should `scripts` be per-project or per-service in the UI?** The schema above is per-project with
  an optional `service`; the card may want them grouped by service regardless.
- **Two bugs found while specifying this, both independent of it.** `postCreate` never renders
  templates (`provision.ts:226`) while `postRemove` does (`worktrees.ts:443`); and `postRemove`
  renders with `port: 0` and `ports: {}`, so `{{port}}` becomes `0` and `{{port.x}}` throws. Fix
  separately or fold in?
- **Does the recipe editor ship a starter skeleton?** It is text, not logic, so it does not breach
  §3 — but it is the difference between a working first run and an opaque one.

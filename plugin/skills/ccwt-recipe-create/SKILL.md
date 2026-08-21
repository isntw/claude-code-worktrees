---
name: ccwt-recipe-create
description: Write or revise the ccwt recipe for a repository — the declaration of what a worktree of this project needs to run. Use when asked to set up, create, fix or update a ccwt recipe or ccwt config for a project, or when ccwt reports a project has no recipe. Covers plain command services and container stacks.
---

# Writing a ccwt recipe

A recipe tells ccwt what a *worktree* of this project needs in order to run: which files to place,
what to install, and what to start on which port. ccwt is command-agnostic — it allocates a port,
renders a template, spawns a process and probes the port. Everything it knows about this project
comes from the recipe you write.

## Where the recipe lives

**In ccwt's own storage, never in the repository.** Do not create or edit `ccwt.config.json`. ccwt
has no code path that writes a file into a registered repository, and none that reads one either —
a committed recipe is a file nothing will ever look at. The recipe goes in through
`ccwt_recipe_write`, and comes back from `ccwt_recipe_read` as what is stored — or as nothing,
since ccwt detects nothing and a repository with no stored recipe has none.

Every one of these tools needs the ccwt dashboard running. If they report it is not reachable, say
so and stop — there is no fallback path.

## The order of work

1. `ccwt_recipe_read` — is there already a recipe, and did a person write it? If the source is *a
   recipe stored in ccwt*, treat it as deliberate: read it, say what you would change, and get
   agreement before passing `replace: true`.
2. **Read the repository.** This is the part no tool does for you — see below.
3. `ccwt_recipe_check` — validate. Fix everything it reports and check again.
4. `ccwt_recipe_write` — store it.

If the project is not registered yet, `ccwt_project_add` registers the repository the session is in.

A recipe only takes effect on a worktree ccwt creates next; existing ones keep what they have. To
see it actually run, create a worktree from the dashboard and start it with `ccwt_worktree_start` —
never by running the command yourself, which is the duplicate ccwt exists to prevent.

## What to read before you write anything

Look at what the project actually is, not what its language usually implies:

- **How a developer runs it.** `package.json` scripts, `Makefile`, `Procfile`, `justfile`,
  `composer.json`, `manage.py`, `bin/rails`, `docker-compose.yml`, the README's quickstart. Prefer
  what the README tells a human to type.
- **Which ports it wants**, and whether they can be changed from outside — a flag, an environment
  variable, a config file that reads one. A service whose port is baked in cannot be parallelised;
  pin its range (`[3000, 3000]`) and say so.
- **What is gitignored but needed**: `.env` and friends, credentials, local sqlite files.
- **What the install produces**: `node_modules`, `vendor`, `.venv`, `target`, `deps`.
- **Whether there is more than one process** — an API and a frontend, a worker, a queue.

When something is genuinely ambiguous — which of three dev scripts is *the* one, whether a stack is
the dev environment or a CI fixture — ask. A wrong guess is silently wrong in every worktree.

## Placing files

`copy` and `link` are two different jobs, and the difference bites:

- **`link` hardlinks — the same inode.** Editing a linked file in a worktree edits the root
  checkout. Right for `node_modules` and other install output nobody hand-edits; it costs no disk.
- **`copy` duplicates.** Right for anything a worktree will diverge on — `.env` above all, since
  each worktree gets its own ports and needs its own values.

Never link a directory a per-worktree install would mutate. A `pip install` inside a worktree with a
hardlinked `.venv`, or a `composer install` with a hardlinked `vendor`, rewrites the root checkout's
dependencies with nothing in git to explain it. If in doubt, put the install in `postCreate` instead.

Never link `node_modules/.cache`, `node_modules/.vite`, `.nuxt`, `.output`, `.turbo`, `.next` or
`dist` — build caches are always per-worktree, and ccwt refuses to link them.

`write` creates a file from literal content. Use it for something that belongs to ccwt rather than
the project — a compose file, an override config. **Ports are not allocated when a file is written**,
so a written file may never contain `{{port}}`; it reads `${SOME_PORT}` from the environment
instead, and the service declares `SOME_PORT` under `ports`.

`postCreate` runs **only on a worktree ccwt itself created** — that is where an install belongs. It
never runs on a worktree that already existed, so nothing later may assume it has run.

## Ports

ccwt allocates a port per service per worktree out of `portRange`, and it must reach the process:

- `{{port}}` in the command — `npm run dev -- --port {{port}}`
- or as an environment variable — `"env": { "PORT": "{{port}}" }`

A service needing more than one port declares them under `ports`, each with its own range; they
arrive as environment variables of that name. `{{port.other}}` and `{{url.other}}` interpolate
another service's allocation. A range whose ends are equal is a pinned port.

`dependsOn` waits for the dependency's port to answer before starting. `postStart` runs when the
port answers, and is retried for two minutes — a port answering does not mean the thing behind it is
ready.

## Container stacks

Set `kind` to `"stack"`. A stack is still just a command to ccwt, so the recipe carries everything
that makes it behave:

```json
{
  "name": "stack",
  "kind": "stack",
  "cwd": ".",
  "command": "docker compose -f compose.ccwt.yml --project-directory . up",
  "stopCommand": "docker compose -f compose.ccwt.yml --project-directory . down",
  "removeCommand": "docker compose -f compose.ccwt.yml --project-directory . down -v",
  "portRange": [20080, 20179],
  "ports": { "DB_PORT": [33060, 33159] },
  "env": {
    "COMPOSE_PROJECT_NAME": "ccwt-{{project}}-{{slug}}",
    "WEB_PORT": "{{port}}"
  },
  "postStart": [
    "docker compose -f compose.ccwt.yml --project-directory . exec -T app <migrate command>"
  ]
}
```

The rules that make this work, each of which fails quietly if you skip it:

- **`COMPOSE_PROJECT_NAME` must vary per worktree.** Without `{{slug}}` (or `{{branch}}`,
  `{{worktreePath}}`) in it, two worktrees address the same containers and volumes, and starting one
  tears down the other's.
- **`--project-directory .`** keeps relative paths in the compose file resolving against the
  worktree, not against wherever the compose file sits.
- **`stopCommand` is not optional.** ccwt stops a service by killing its process group; that leaves
  the containers running. `down` is what actually stops the stack.
- **`removeCommand` runs when the worktree is removed** — `down -v` so volumes go too. It may never
  block a removal, and its result is discarded.
- **Ports reach compose through the environment**: `"${WEB_PORT}:80"` in the YAML, `WEB_PORT` mapped
  to `{{port}}` under `env`, extra ones under `ports`. Never `{{port}}` inside the compose file.
- **`postStart` steps run on the host**, so anything that must happen inside a container is
  `docker compose … exec -T <service> …`.

The compose file may live in the repository, or ccwt may write its own under `provision.write` —
prefer writing one when the project's own compose file hardcodes host ports.

## Before you write

Run `ccwt_recipe_check` and clear every note. It catches the failures above that still parse: a
stack every worktree would share, an allocated port nothing passes on, a hardlink that would edit
the root checkout.

Then say plainly what the recipe does — which services, on which ports, what gets placed, what gets
installed — and that it takes effect on the next worktree, not on ones that already exist.

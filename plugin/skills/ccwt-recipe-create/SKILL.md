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
`ccwt_write_recipe`, and comes back from `ccwt_read_recipe` as what is stored — or as nothing,
since ccwt detects nothing and a repository with no stored recipe has none.

Every one of these tools needs the ccwt dashboard running. If they report it is not reachable, say
so and stop — there is no fallback path.

## The order of work

1. `ccwt_read_recipe` — is there already a recipe, and did a person write it? If the source is *a
   recipe stored in ccwt*, treat it as deliberate: read it, say what you would change, and get
   agreement before passing `replace: true`.
2. **Read the repository.** This is the part no tool does for you — see below.
3. `ccwt_check_recipe` — validate. Fix everything it reports and check again.
4. `ccwt_write_recipe` — store it.
5. **Prove it runs** — `ccwt_create_worktree`, `ccwt_start_worktree`, then fetch the URL. A recipe
   that validates has only been checked for shape.

If the project is not registered yet, `ccwt_add_project` registers the repository the session is in.

A recipe only takes effect on a worktree ccwt creates next; existing ones keep what they have. Never
run the project's command yourself to see whether it works — that is the duplicate ccwt exists to
prevent. **Removing a worktree is the one thing you cannot do**: it stays in the dashboard, so a
worktree you make for a test is one to mention when you are done.

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
- **Gitlinked directories with no `.gitmodules`.** Git checks those out as **empty directories** in a
  worktree, silently — `git ls-files -s | grep ^160000` lists them. If anything tells a developer to
  read what is inside one, a worktree does not have it and the recipe has to place it.

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

What the two actually do, so you do not have to guess:

- **`copy` creates missing parent directories**, and copies a directory whole. A gitignored directory
  absent from a fresh worktree arrives fine.
- **`link` on a file hardlinks it; on a directory it hardlinks the whole tree.** Symlinks inside are
  recreated as symlinks rather than followed, so a pnpm `node_modules` keeps its shape — though a
  symlink written as an absolute path still points back at the root checkout.
- **A path that is not in the root checkout is skipped** with nothing said at write time, so a typo
  looks like success. A path already in the worktree is left alone; a symlink standing where real
  content belongs is removed and replaced.
- **No globs.** `.env*` validates, then places nothing — the provision report says patterns are not
  supported, but `ccwt_check_recipe` will not warn you. Name real paths.

Because a hardlink is the same inode, anything that rewrites a linked file **in place** rewrites the
root checkout's copy. An install that replaces a file whole is harmless; one that patches it is not.

`postCreate` runs **only on a worktree ccwt itself created** — that is where an install belongs. It
never runs on a worktree that already existed, so nothing later may assume it has run.

## Ports

ccwt allocates a port per service per worktree out of `portRange`, and it must reach the process:

- `{{port}}` in the command — `npm run dev -- --port {{port}}`
- or as an environment variable the project already reads — `"env": { "NUXT_PORT": "{{port}}" }`

**Set it once, by the most specific knob the project has.** A flag on the command beats a variable,
and the project's own variable beats a generic one. ccwt already exports **`PORT`** for every service
it spawns, set to that service's allocated port, plus `CCWT_URL_<SERVICE>` so services can find each
other — so `"env": { "PORT": "{{port}}" }` adds nothing while reading as though it did.

**And `PORT` reaches the whole process tree, where a port-picking library will prefer it for any
socket.** `get-port-please`, `portfinder` and friends read `process.env.PORT` as the preferred port
for whatever they are asked to allocate, not only for the app's listener. A dev server that allocates
a second socket while resolving its config finds the app's port still free — the app has not bound yet
— and takes it. The port then answers, ccwt reports `running`, and the URL serves the wrong server;
`426 Upgrade Required` is a Vite HMR socket sitting where the app should be.

Where a service has a sidecar like that, give the sidecar a port of its own by declaring `PORT` under
the service's `ports` with the range that sidecar documents. A named port is allocated per worktree,
reserved against every other service, and overrides the `PORT` ccwt would otherwise export:

```json
{
  "name": "dev",
  "command": "pnpm exec nuxt dev --port {{port}}",
  "portRange": [4450, 4549],
  "ports": { "PORT": [24678, 24698] }
}
```

Only do that when the app's own port arrives another way. A command that reads `PORT` and nothing else
needs it left as ccwt set it.

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

Run `ccwt_check_recipe` and clear every note. It catches the failures above that still parse: a
stack every worktree would share, an allocated port nothing passes on, a hardlink that would edit
the root checkout.

A clean check means the recipe's shape is sound. It says nothing about whether the project runs.

## Then prove it

Storing the recipe is not the end of the job:

1. `ccwt_create_worktree` — a recipe only ever takes effect on a worktree created after it was
   stored. It arrives provisioned and stopped.
2. `ccwt_start_worktree`.
3. **Fetch the URL and read what comes back**, on `127.0.0.1` as well as `localhost`. A port
   answering is not the service answering. `ccwt_get_logs` says what the service printed.

The **`ccwt-worktree-verify`** skill covers this properly — what each wrong answer means, and how to
retest a change, since a `command` or `env` edit reaches a service only on the next start
(`ccwt_stop_worktree` first), a `copy` or `link` edit needs `ccwt_provision_worktree`, and a
`postCreate` edit needs a worktree that does not exist yet.

Then say plainly what the recipe does — which services, on which ports, what gets placed, what gets
installed — what you saw when you fetched it, and that it takes effect on the next worktree rather
than on ones that already exist. If a test left a worktree behind, say so: removing one is the
dashboard's job.

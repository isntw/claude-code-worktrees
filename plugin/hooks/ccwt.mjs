#!/usr/bin/env node

// plugin/src/hooks/ccwt.ts
import { resolve as resolve2 } from "node:path";

// plugin/src/lib/discover.ts
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { connect } from "node:net";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
var run = promisify(execFile);
var PROBE_MS = 400;
var CALL_MS = 3e3;
var LOOK_MS = 1500;
var ccwtDir = () => process.env.CCWT_HOME || join(homedir(), ".ccwt");
var git = async (cwd, args) => {
  const { stdout } = await run("git", args, { cwd }).catch(() => ({ stdout: "" }));
  return stdout.trim();
};
var portKey = (service) => `ccwt.port.${service.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase()}`;
var idFor = (path) => createHash("sha256").update(path).digest("hex").slice(0, 12);
var encodedName = (path) => path.replace(/[/._]/g, "-");
function underTranscript(paths, transcriptPath) {
  if (typeof transcriptPath !== "string" || !transcriptPath) return null;
  const parts = transcriptPath.split("/");
  const named = parts[parts.length - 2];
  if (!named) return null;
  return paths.find((path) => encodedName(path) === named) ?? null;
}
function reaches(port, host) {
  return new Promise((done) => {
    const socket = connect({ port, host });
    const finish = (answer) => {
      socket.destroy();
      done(answer);
    };
    socket.setTimeout(PROBE_MS);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}
var isListening = async (port) => (await Promise.all([reaches(port, "127.0.0.1"), reaches(port, "::1")])).some(Boolean);
async function readJson(path) {
  const raw = await readFile(path, "utf8").catch(() => null);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function reachServer() {
  const runtime = await readJson(
    join(ccwtDir(), "runtime.json")
  );
  if (!runtime?.port || typeof runtime.token !== "string") return null;
  const host = runtime.host === "::1" ? "[::1]" : runtime.host ?? "127.0.0.1";
  if (!await isListening(runtime.port)) return null;
  return { origin: `http://${host}:${runtime.port}`, token: runtime.token };
}
async function ask(path) {
  const server = await reachServer();
  if (!server) return null;
  const answered = await fetch(`${server.origin}${path}`, {
    headers: { "x-ccwt-token": server.token },
    signal: AbortSignal.timeout(CALL_MS)
  }).catch(() => null);
  if (!answered?.ok) return null;
  return answered.json().catch(() => null);
}
async function tell(path, body) {
  const server = await reachServer();
  if (!server) return null;
  const answered = await fetch(`${server.origin}${path}`, {
    method: "PUT",
    headers: { "x-ccwt-token": server.token, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CALL_MS)
  }).catch(() => null);
  return answered?.ok ? true : null;
}
var readState = () => ask("/api/plugin/state");
function parseWorktrees(porcelain) {
  const paths = [];
  let bare = false;
  let current = null;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current && !bare) paths.push(current);
      current = line.slice("worktree ".length);
      bare = false;
      continue;
    }
    if (line === "bare") bare = true;
  }
  if (current && !bare) paths.push(current);
  return paths;
}
async function allocatedPorts(worktreePath) {
  const raw = await git(worktreePath, ["config", "--worktree", "--get-regexp", "^ccwt\\.port\\."]);
  const found2 = /* @__PURE__ */ new Map();
  for (const line of raw.split("\n")) {
    const gap = line.indexOf(" ");
    if (gap === -1) continue;
    const port = Number.parseInt(line.slice(gap + 1), 10);
    if (Number.isFinite(port)) found2.set(line.slice(0, gap), port);
  }
  return found2;
}
function ownerOf(paths, cwd) {
  if (cwd === null) return null;
  const at = resolve(cwd);
  let best = null;
  for (const path of paths) {
    const root = resolve(path);
    const inside = at === root || at.startsWith(root.endsWith(sep) ? root : root + sep);
    if (inside && (best === null || root.length > resolve(best).length)) best = path;
  }
  return best;
}
async function look(command, args) {
  if (process.platform === "win32") return "";
  const { stdout } = await run(command, args, { timeout: LOOK_MS }).catch(() => ({ stdout: "" }));
  return stdout;
}
async function listeners(port) {
  const raw = await look("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"]);
  const pids = /* @__PURE__ */ new Set();
  for (const line of raw.split("\n")) {
    if (!line.startsWith("p")) continue;
    const pid = Number.parseInt(line.slice(1), 10);
    if (Number.isFinite(pid) && pid > 1) pids.add(pid);
  }
  return [...pids];
}
async function cwdOf(pid) {
  const raw = await look("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
  for (const line of raw.split("\n")) {
    if (line.startsWith("n")) return line.slice(1) || null;
  }
  return null;
}
async function nameOf(pid) {
  const raw = (await look("ps", ["-o", "comm=", "-p", String(pid)])).trim();
  return raw ? basename(raw) : null;
}
var actual = (path) => realpath(path).catch(() => path);
async function holderOf(port, paths) {
  const pids = await listeners(port);
  if (!pids.length) return { path: null, name: null };
  const real = await Promise.all(paths.map(actual));
  let name = null;
  for (const pid of pids) {
    const cwd = await cwdOf(pid);
    const owner = ownerOf(real, cwd === null ? null : await actual(cwd));
    if (owner !== null) return { path: paths[real.indexOf(owner)] ?? null, name: null };
    name ??= await nameOf(pid);
  }
  return { path: null, name };
}
var nameFor = (path) => path.split("/").pop() ?? path;
async function describe(cwd, transcriptPath) {
  const toplevel = await git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!toplevel) return null;
  const paths = parseWorktrees(await git(cwd, ["worktree", "list", "--porcelain"]));
  const rootPath = paths[0];
  if (!rootPath) return null;
  const state = await readState();
  const project = (state?.projects ?? []).find(
    (entry) => resolve(entry.rootPath) === resolve(rootPath)
  );
  const declared = project?.recipe?.services ?? [];
  if (!project || !declared.length) return null;
  const allocated = await Promise.all(paths.map(allocatedPorts));
  const sharers = /* @__PURE__ */ new Map();
  paths.forEach((path, index) => {
    for (const service of declared) {
      const port = allocated[index]?.get(portKey(service.name));
      if (port === void 0) continue;
      const known = sharers.get(port) ?? [];
      if (!known.includes(path)) known.push(path);
      sharers.set(port, known);
    }
  });
  const verdicts = /* @__PURE__ */ new Map();
  const verdictFor = (port) => {
    let pending = verdicts.get(port);
    if (!pending) {
      pending = (async () => {
        if (!await isListening(port)) return false;
        const using = sharers.get(port) ?? [];
        if (using.length < 2) return true;
        return holderOf(port, paths);
      })();
      verdicts.set(port, pending);
    }
    return pending;
  };
  const worktrees = await Promise.all(
    paths.map(async (path, index) => {
      const ports = allocated[index] ?? /* @__PURE__ */ new Map();
      const services = await Promise.all(
        declared.map(async (service) => {
          const port = ports.get(portKey(service.name)) ?? null;
          const seen = {
            name: service.name,
            command: service.command,
            primary: service.primary,
            port,
            up: false
          };
          if (port === null) return seen;
          const verdict = await verdictFor(port);
          if (typeof verdict === "boolean") return { ...seen, up: verdict };
          if (verdict.path !== null && resolve(verdict.path) === resolve(path)) {
            return { ...seen, up: true };
          }
          const heldBy = verdict.path !== null ? nameFor(verdict.path) : verdict.name ?? "another process";
          return { ...seen, heldBy };
        })
      );
      return {
        id: idFor(path),
        path,
        name: nameFor(path),
        root: resolve(path) === resolve(rootPath),
        services
      };
    })
  );
  const at = (path) => path ? worktrees.find((worktree) => resolve(worktree.path) === resolve(path)) ?? null : null;
  const walked = at(toplevel);
  const launched = at(underTranscript(worktrees.map((worktree) => worktree.path), transcriptPath));
  const here = (walked && !walked.root ? walked : null) ?? launched ?? walked ?? null;
  return {
    projectId: project.id,
    projectName: rootPath.split("/").pop() ?? rootPath,
    rootPath,
    worktrees,
    here
  };
}
var shapeOf = (command) => command.replace(/\{\{[^}]*\}\}/g, " ").split(/\s+/).filter((part) => part && part !== "--" && !part.startsWith("-"));
var WRAPPERS = /* @__PURE__ */ new Set(["nohup", "env", "exec", "time", "command", "sudo"]);
var ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
function heads(command) {
  return command.replace(/"[^"]*"/g, " ").replace(/'[^']*'/g, " ").split(/&&|\|\||;|\|/).map((segment) => {
    const parts = shapeOf(segment);
    let start = 0;
    while (start < parts.length) {
      const part = parts[start];
      if (part !== void 0 && (ASSIGNMENT.test(part) || WRAPPERS.has(part))) {
        start += 1;
        continue;
      }
      break;
    }
    return parts.slice(start);
  });
}
function duplicates(proposed, declared) {
  const want = shapeOf(declared);
  if (want.length < 2) return false;
  return heads(proposed).some(
    (got) => got.length >= want.length && want.every((part, index) => got[index] === part)
  );
}
function targetOf(command, fallback) {
  const match = /^\s*cd\s+("([^"]+)"|'([^']+)'|([^\s;&|]+))\s*(&&|;)/.exec(command);
  const path = match?.[2] ?? match?.[3] ?? match?.[4];
  if (!path) return fallback;
  return path.startsWith("/") ? path : resolve(fallback, path);
}

// plugin/src/lib/report.ts
var TITLE_PREFIX = "ccwt \xB7 ";
function snapshot(found2) {
  const rows = {};
  for (const worktree of found2.worktrees) {
    for (const service of worktree.services) {
      if (service.port === null) continue;
      rows[`${worktree.name}/${service.name}`] = {
        port: service.port,
        up: service.up,
        ...service.heldBy ? { heldBy: service.heldBy } : {}
      };
    }
  }
  return rows;
}
var held = (heldBy) => heldBy ? ` (port held by ${heldBy})` : "";
function changes(before, after) {
  const lines = [];
  for (const [key, now] of Object.entries(after)) {
    const then = before[key];
    const where = `http://localhost:${now.port}`;
    if (!then) {
      lines.push(`${key} \u2192 port ${now.port}${now.up ? `, running at ${where}` : `, stopped${held(now.heldBy)}`}`);
      continue;
    }
    if (then.port !== now.port) {
      lines.push(
        `${key} moved to port ${now.port} (was ${then.port})${now.up ? ` and is running at ${where}` : ` and is stopped${held(now.heldBy)}`}`
      );
      continue;
    }
    if (then.up !== now.up) {
      lines.push(now.up ? `${key} is now running at ${where}` : `${key} has stopped${held(now.heldBy)}`);
    }
  }
  for (const key of Object.keys(before)) {
    if (!after[key]) lines.push(`${key} is gone`);
  }
  return lines;
}
function renameTo(found2, current, ours) {
  if (!found2.here || found2.here.root) return null;
  const wanted = `${TITLE_PREFIX}${found2.projectName}/${found2.here.name}`;
  if (wanted === current) return null;
  if (!current) return ours === wanted ? null : wanted;
  if (!ours) return wanted;
  return current === ours ? wanted : null;
}
function overview(found2) {
  const rows = found2.worktrees.filter((worktree) => worktree.services.some((service) => service.port !== null)).map((worktree) => {
    const listed = worktree.services.filter((service) => service.port !== null);
    const many = listed.length > 1;
    const services = [...listed].sort((left, right) => Number(Boolean(right.primary)) - Number(Boolean(left.primary))).map(
      (service) => `${service.name}${many && service.primary ? " (main)" : ""} \u2192 ${service.port} ${service.up ? `running at http://localhost:${service.port}` : `stopped${held(service.heldBy)}`}`
    ).join(", ");
    return `  ${worktree.name}${worktree.root ? " (root)" : ""} \u2014 ${services}`;
  });
  if (!rows.length) return null;
  return [
    "ccwt manages this repository. It owns these services and the ports they run on:",
    ...rows,
    "",
    "Do not start a dev server yourself \u2014 open the URL above instead. Starting and stopping one is",
    "ccwt\u2019s job: ccwt_start_worktree and ccwt_stop_worktree. Call ccwt_get_logs to see what a running",
    "service has printed rather than building to find out."
  ].join("\n");
}
function payloadFor(event, context, title) {
  if (!context && !title) return {};
  return {
    hookSpecificOutput: {
      hookEventName: event,
      ...context ? { additionalContext: context } : {},
      ...title ? { sessionTitle: title } : {}
    }
  };
}

// plugin/src/hooks/ccwt.ts
var markerId = (sessionId) => encodeURIComponent(sessionId.replace(/[^A-Za-z0-9_-]/g, ""));
async function readMarker(sessionId) {
  if (!sessionId) return null;
  const held2 = await ask(`/api/plugin/session/${markerId(sessionId)}`);
  return held2 && typeof held2.at === "string" ? held2 : null;
}
async function writeMarker(sessionId, rows, title) {
  if (!sessionId) return;
  await tell(`/api/plugin/session/${markerId(sessionId)}`, { rows, title });
}
async function dropMarker(sessionId) {
  if (!sessionId) return;
  await tell(`/api/plugin/session/${markerId(sessionId)}`, { done: true });
}
var emit = (payload) => {
  if (Object.keys(payload).length) process.stdout.write(JSON.stringify(payload));
};
var read = () => new Promise((done) => {
  let text = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    text += chunk;
  });
  process.stdin.on("end", () => {
    try {
      done(JSON.parse(text));
    } catch {
      done(null);
    }
  });
  process.stdin.on("error", () => done(null));
});
var noticed = (lines) => lines.length ? `ccwt: ${lines.join("\nccwt: ")}` : null;
async function sessionStart(input2, found2) {
  const marker = await readMarker(input2?.session_id);
  const title = renameTo(found2, input2?.session_title, marker?.title);
  await writeMarker(input2?.session_id, snapshot(found2), title ?? marker?.title);
  emit(payloadFor("SessionStart", overview(found2), title));
}
async function prompt(input2, found2) {
  const rows = snapshot(found2);
  const marker = await readMarker(input2?.session_id);
  const title = renameTo(found2, input2?.session_title, marker?.title);
  const context = marker ? noticed(changes(marker.rows ?? {}, rows)) : overview(found2);
  await writeMarker(input2?.session_id, rows, title ?? marker?.title);
  emit(payloadFor("UserPromptSubmit", context, title));
}
function guard(input2, found2) {
  const command = input2?.tool_input?.command;
  if (typeof command !== "string" || !command) return;
  const target = targetOf(command, input2?.cwd ?? process.cwd());
  const worktree = found2.worktrees.find((entry) => resolve2(target) === resolve2(entry.path)) ?? found2.here;
  if (!worktree) return;
  const clash = worktree.services.find(
    (service) => service.up && service.port !== null && duplicates(command, service.command)
  );
  if (!clash) return;
  emit({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `ccwt already runs \`${clash.name}\` for ${worktree.name}, listening on http://localhost:${clash.port}. Open that rather than starting a second one \u2014 ccwt owns this service's lifecycle. Call ccwt_get_logs to read what it has printed.`
    }
  });
}
var mode = process.argv[2];
var input = await read();
if (mode === "end") {
  await dropMarker(input?.session_id);
  process.exit(0);
}
var found = await describe(input?.cwd ?? process.cwd(), input?.transcript_path).catch(() => null);
if (found) {
  if (mode === "session-start") await sessionStart(input, found);
  if (mode === "prompt") await prompt(input, found);
  if (mode === "guard") guard(input, found);
}
process.exit(0);

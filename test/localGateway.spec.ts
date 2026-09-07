// Spec 46 §4.2 — the port, the walk-up, and the one thing that must never happen.
//
// > **A busy port is never adopted.** If something already answers on 24334,
// > REX must not assume it is a LiteLLM of its own, and must never send it a
// > provider key.
//
// That is the claim this file exists for, and it is testable because REX's
// proof of ownership is a secret: the master key is random per launch and lives
// only in this process and its child, so a server that cannot answer 200 to it
// is not ours. A stranger's LiteLLM answers 400 to a key it does not know, and
// 500 when it has no key configured at all — both measured, spec 46 §18.
//
// Driven against real HTTP servers on real ports, because what is being
// asserted is what happens when a socket is already taken.
//
// Run: npm run test:local-gateway

import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { after, test } from "node:test";
import { FIRST_PORT, LAST_PORT, owns, portsToTry, startedOn } from "../src/main/gateway/local.ts";

const open: Server[] = [];
after(() => {
  for (const server of open) server.close();
});

/** A server on `port` that answers every request with `status`. */
function serveOn(port: number, status: number, body = "{}"): Promise<Server> {
  const server = createServer((_request, response) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(body);
  });
  open.push(server);
  return new Promise((settle, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => settle(server));
  });
}

/** A server that answers 200 only to the exact bearer token it was given. */
function serveKeyed(port: number, key: string): Promise<Server> {
  const server = createServer((request, response) => {
    const ok = request.headers.authorization === `Bearer ${key}`;
    response.writeHead(ok ? 200 : 400, { "Content-Type": "application/json" });
    response.end("{}");
  });
  open.push(server);
  return new Promise((settle, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => settle(server));
  });
}

// ── §4.2 — the ports ────────────────────────────────────────────

test("the walk-up is ten ports, starting at 24334", () => {
  const ports = portsToTry({});
  assert.equal(ports[0], FIRST_PORT);
  assert.equal(ports.at(-1), LAST_PORT);
  assert.equal(ports.length, 10);
});

test("REX_GATEWAY_PORT pins one port and disables the walk", () => {
  // A person who named a port meant that port. Silently using a different one
  // would make every URL they wrote down wrong.
  assert.deepEqual(portsToTry({ REX_GATEWAY_PORT: "24999" }), [24999]);
});

test("a nonsense REX_GATEWAY_PORT falls back to the walk rather than failing", () => {
  for (const bad of ["", "no", "0", "99999", "-1"]) {
    assert.equal(portsToTry({ REX_GATEWAY_PORT: bad }).length, 10, bad);
  }
});

// ── §4.2 — ownership, which is what stops a port being adopted ──

test("only the server that knows this launch's key answers the key check", async () => {
  const port = 24392;
  await serveKeyed(port, "sk-rex-the-real-one");
  assert.equal(await owns(port, "sk-rex-the-real-one"), true);
  assert.equal(await owns(port, "sk-rex-a-different-launch"), false);
});

test("a stranger that accepts ANY token is still not adopted", async () => {
  // The failure this whole check exists to prevent, and the reason the key
  // alone is not enough: a permissive server passes `owns` and would then be
  // sent a provider key. `startedOn` also asks who holds the socket.
  const port = 24391;
  await serveOn(port, 200, '{"data":[]}');
  assert.equal(await owns(port, "sk-rex-anything"), true, "it answers our key — that is the trap");

  // This process is not the child REX spawned, so the pid cannot match.
  const notOurChild = 999_999;
  assert.equal(await startedOn(port, "sk-rex-anything", notOurChild), false);
});

test("our own process passing as the child is accepted", async () => {
  // The other half: the pid check must accept the real case, or nothing starts.
  const port = 24394;
  await serveKeyed(port, "sk-rex-ours");
  assert.equal(await startedOn(port, "sk-rex-ours", process.pid), true);
});

test("a LiteLLM with no master key at all is not ours either", async () => {
  // Measured (§18): with no key configured, `/v1/models` answers 500, not 401.
  const port = 24393;
  await serveOn(port, 500);
  assert.equal(await owns(port, "sk-rex-secret"), false);
});

test("nothing listening is not ours, and does not throw", async () => {
  assert.equal(await owns(24399, "sk-rex-secret"), false);
});

// ── §13 — the packaged layout beats the development one ─────────
//
// Measured 2026-09-06 by getting it wrong: a packaged REX launched from inside
// the repository found `local-gateway/.venv` and spawned THAT. On a real
// install there is no such venv, so neither child would have started — and the
// first person to find out would have been somebody who installed REX rather
// than built it.

test("a packaged app runs the runtime that was staged into it", async () => {
  const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { interpreterFor, packageRoot } = await import("../src/main/python.ts");

  const resources = mkdtempSync(join(tmpdir(), "rex-resources-"));
  const leaf = process.platform === "win32" ? join("Scripts", "python.exe") : join("bin", "python");
  mkdirSync(join(resources, "python", leaf, ".."), { recursive: true });
  writeFileSync(join(resources, "python", leaf), "");

  const was = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = resources;
  try {
    assert.equal(interpreterFor("/anywhere"), join(resources, "python", leaf));
    // And the cwd is Resources, because the package lives in the runtime's
    // site-packages and there is no source tree to point at.
    assert.equal(packageRoot("local-gateway", "/anywhere"), resources);
  } finally {
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = was;
    rmSync(resources, { recursive: true, force: true });
  }
});

test("outside a packaged app the development venv is still used", async () => {
  const { interpreterFor } = await import("../src/main/python.ts");
  const { gatewayPackageRoot } = await import("../src/main/gateway/local.ts");
  // No `resourcesPath` in a test, so this is the development answer.
  assert.match(interpreterFor(gatewayPackageRoot()), /local-gateway\/\.venv\/bin\/python$/);
});

// ── §5.2 — the catalogue has to be STAGED, not just read ────────
//
// Found 2026-09-07 by installing the DMG: the app started, the built-in gateway
// served on 24334, and "Add a provider" listed nothing. `catalogue.json` is data
// read from disk (`src/main/gateway/catalogue.ts`), not a Python import, so
// `bundle-python.mjs` never carried it and nothing else did either.
//
// It fails quietly on purpose — an empty list beats taking Settings down over a
// missing file — which is exactly why it needs a test. The two halves are in
// different languages and different files, so nothing else can notice them
// disagreeing: the reader wants `packageRoot()/catalogue.json`, and in a
// packaged app `packageRoot()` is `Resources/`.
test("the provider catalogue is staged where the reader looks for it", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const builder = readFileSync(join(root, "electron-builder.yml"), "utf8");

  // A string check rather than a YAML parse: the repo has no YAML dependency,
  // and what matters is the pair of strings, not the document structure.
  assert.match(
    builder,
    /from:\s*local-gateway\/catalogue\.json\s*\n\s*to:\s*catalogue\.json/,
    "electron-builder.yml must stage local-gateway/catalogue.json to Resources/catalogue.json",
  );

  // And the file it stages must actually be there to stage.
  const staged = JSON.parse(readFileSync(join(root, "local-gateway", "catalogue.json"), "utf8"));
  assert.ok(Array.isArray(staged.providers), "catalogue.json must carry a providers array");
  assert.equal(staged.providers.length, 6, "spec 46 §5.1 — six providers");
});

// ── §18.1 item 4 — the two Windows layouts, which are NOT the same ──
//
// Spec 46 predicted `interpreterFor()` as the likeliest single line to break on
// Windows. It was right, and the reason is subtler than the prediction:
//
//   a VENV on Windows       → `.venv\Scripts\python.exe`
//   the STAGED runtime      → `python-dist\python.exe`   ← at the ROOT
//
// python-build-standalone puts the interpreter at its root on Windows;
// `Scripts\` holds pip and no interpreter at all. On POSIX both layouts are
// `bin/`, so one function served both and macOS could never tell them apart.
//
// **Measured 2026-09-07** on the first Windows arm64 package ever built:
// `resources\python\Scripts\python.exe` did not exist and
// `resources\python\python.exe` did, so a packaged REX would have spawned
// neither Python child. The first version of this test asserted
// `Scripts\python.exe` for BOTH cases — it encoded the same wrong assumption as
// the code, and passed while the bug shipped. Hence two leaves below, not one.
test("the packaged interpreter follows each platform's own layout", async () => {
  const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { dirname, join } = await import("node:path");
  const { interpreterFor } = await import("../src/main/python.ts");

  // Cast through `unknown` rather than intersecting `NodeJS.Process`: Electron
  // declares `resourcesPath` as a required string, so `& { resourcesPath?: … }`
  // stays required and `delete` will not typecheck against it.
  const proc = process as unknown as { resourcesPath?: string };
  const platformWas = Object.getOwnPropertyDescriptor(process, "platform");
  const resourcesWas = proc.resourcesPath;
  // `REX_PYTHON` wins over every branch below (§13), so a machine that happens
  // to have it set would pass without ever reaching the code under test.
  const overrideWas = process.env.REX_PYTHON;
  delete process.env.REX_PYTHON;

  // [platform, where the STAGED runtime keeps it, where a VENV keeps it]
  const cases = [
    ["win32", "python.exe", join("Scripts", "python.exe")],
    ["darwin", join("bin", "python"), join("bin", "python")],
    ["linux", join("bin", "python"), join("bin", "python")],
  ] as const;

  try {
    for (const [platform, bundledLeaf, venvLeaf] of cases) {
      Object.defineProperty(process, "platform", { value: platform, configurable: true });

      const resources = mkdtempSync(join(tmpdir(), `rex-${platform}-`));
      const staged = join(resources, "python", bundledLeaf);
      mkdirSync(dirname(staged), { recursive: true });
      writeFileSync(staged, "");
      proc.resourcesPath = resources;

      assert.equal(interpreterFor("/anywhere"), staged, `${platform}: wrong staged interpreter`);

      // With nothing staged, the development venv — which on Windows is the
      // OTHER layout, and the whole point of keeping two leaves.
      delete proc.resourcesPath;
      assert.equal(
        interpreterFor(join("/rex", "agent-runner")),
        join("/rex", "agent-runner", ".venv", venvLeaf),
        `${platform}: wrong development venv`,
      );

      rmSync(resources, { recursive: true, force: true });
    }

    // The regression itself, stated once so it cannot be re-broken quietly:
    // on Windows the two answers must DIFFER.
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    const res = mkdtempSync(join(tmpdir(), "rex-win-both-"));
    mkdirSync(join(res, "python", "Scripts"), { recursive: true });
    writeFileSync(join(res, "python", "python.exe"), "");
    proc.resourcesPath = res;
    assert.equal(
      interpreterFor("/anywhere"),
      join(res, "python", "python.exe"),
      "win32: the staged runtime is python.exe at the root, never Scripts\\python.exe",
    );
    rmSync(res, { recursive: true, force: true });
  } finally {
    if (platformWas) Object.defineProperty(process, "platform", platformWas);
    if (resourcesWas === undefined) delete proc.resourcesPath;
    else proc.resourcesPath = resourcesWas;
    if (overrideWas === undefined) delete process.env.REX_PYTHON;
    else process.env.REX_PYTHON = overrideWas;
  }
});

// ── The Windows installer's "already installed" page ────────────
//
// `build/installer.nsh` turns "run the setup again and it silently reinstalls"
// into a choice: Reinstall or Uninstall. electron-builder picks the file up BY
// NAME (`nsis.include` defaults to it), so nothing in `electron-builder.yml`
// refers to it, and without it the build still succeeds — with no page and no
// error. It can go missing two quiet ways: deleted, or swallowed by `build/*`
// in `.gitignore` so it never reaches a clone or a CI runner. Nothing else
// would notice either, hence this test.
test("the Windows installer's already-installed page is present and tracked", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const page = readFileSync(join(root, "build", "installer.nsh"), "utf8");
  assert.match(
    page,
    /^!macro customWelcomePage$/m,
    "the page hooks the assisted installer's customWelcomePage macro",
  );
  assert.match(
    page,
    /^\s*Page custom rexPageCreate rexPageLeave$/m,
    "the page declares its create and leave functions",
  );
  assert.match(
    page,
    /\$\{UNINSTALL_FILENAME\}/,
    "Uninstall runs electron-builder's own uninstaller, never a second one",
  );

  const ignore = readFileSync(join(root, ".gitignore"), "utf8");
  assert.match(
    ignore,
    /^!build\/installer\.nsh$/m,
    "`build/*` is ignored, so the include must be re-included by name or it never leaves this machine",
  );
});

// ── Linux ships packages, not an AppImage ───────────────────────
//
// Measured on Ubuntu 26.04 arm64 on 2026-09-07: the arm64 AppImage launcher
// wants an unversioned `libz.so` that only the zlib dev package provides
// (electron-builder #7835), and Ubuntu 24.04+ blocks Electron's sandbox inside
// an AppImage, so REX never started. The deb's post-install script sets the
// sandbox helper and installs an AppArmor profile; installed, REX ran with
// Node, npm and uv removed from the machine. The deb build also needs `author`
// (with an email) and `homepage` in package.json, and fails without them ONLY
// on Linux — so they are asserted here, where every platform runs the test.
test("Linux ships .deb and .rpm, and package.json carries what the deb needs", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const builder = readFileSync(join(root, "electron-builder.yml"), "utf8");
  const linux = builder.slice(builder.indexOf("\nlinux:"));
  assert.match(linux, /target:\s*deb\b/, "a .deb for the Debian and Ubuntu family");
  assert.match(linux, /target:\s*rpm\b/, "an .rpm for the Fedora and RHEL family");
  assert.doesNotMatch(
    linux,
    /target:\s*AppImage/,
    "no AppImage: its arm64 launcher does not start, and Ubuntu 24.04+ blocks its sandbox",
  );

  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.match(
    pkg.author ?? "",
    /<[^@\s]+@[^>\s]+>/,
    "the deb's maintainer is `author`, and needs the <email>",
  );
  assert.match(pkg.homepage ?? "", /^https?:\/\//, "the deb needs a homepage URL");
});

// ── Spec 49 — the Release workflow ──────────────────────────────
//
// One runner per platform AND architecture, because there is no cross-build;
// a Release only from a push to main; and Windows file names that carry the
// architecture, or the second upload replaces the first. String checks, like
// the ones above — a YAML parser is not a dependency this repo has — on the
// very file GitHub reads.
test("the Release workflow builds one installer per runner and publishes only from main", async () => {
  const { existsSync, readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const workflow = readFileSync(join(root, ".github", "workflows", "release.yml"), "utf8");
  const rows = [
    ["macos-latest", "--mac dmg --arm64"],
    ["windows-latest", "--win nsis --x64"],
    ["windows-11-arm", "--win nsis --arm64"],
    ["ubuntu-latest", "--linux deb rpm --x64"],
  ] as const;
  for (const [runner, args] of rows) {
    assert.ok(workflow.includes(`runner: ${runner}`), `${runner} builds`);
    assert.ok(workflow.includes(`args: ${args}`), `${runner} states its own architecture`);
  }
  assert.match(
    workflow,
    /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/,
    "a Release only from a merge to main",
  );
  assert.match(workflow, /contents: write/, "the publish job may write a Release");
  assert.match(
    workflow,
    /--notes-file \.github\/release-notes\.md/,
    "the install guide leads every Release body",
  );
  assert.ok(existsSync(join(root, ".github", "release-notes.md")), "and the guide exists");

  const builder = readFileSync(join(root, "electron-builder.yml"), "utf8");
  assert.match(
    builder,
    /artifactName: \$\{productName\}-Setup-\$\{version\}-\$\{arch\}\.\$\{ext\}/,
    "two Windows architectures need two file names",
  );
});

// `bundle-python.mjs` stages the host's CPython, and electron-builder.yml now
// lists both Windows architectures, so without this default the arm64 VM would
// also produce an x64 installer with arm64 Python inside.
test("`npm run package` builds the host's architecture unless told otherwise", async () => {
  const { execFileSync } = await import("node:child_process");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const run = (...args: string[]): string =>
    execFileSync(process.execPath, [join(root, "scripts", "package.mjs"), ...args], {
      env: { ...process.env, REX_PACKAGE_DRY_RUN: "1" },
      encoding: "utf8",
    }).trim();
  const host = process.arch === "arm64" ? "--arm64" : "--x64";

  assert.equal(run("--win", "nsis"), `--win nsis ${host}`);
  assert.equal(run("--dir"), `--dir ${host}`);
  assert.equal(
    run("--linux", "deb", "rpm", "--x64"),
    "--linux deb rpm --x64",
    "an explicit flag wins",
  );
});

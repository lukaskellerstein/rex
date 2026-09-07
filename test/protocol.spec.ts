// Spec 42 §4.3 — the drift guard. One contract, generated once.
//
// This is the direct answer to what Vex's contract did: prose in
// `contracts/*.md`, `dict`s published on the Python side, `Promise<any>` on the
// TypeScript side, and one subject published for two years to nobody. Here the
// Pydantic models are the source of truth, `src/shared/agent-protocol.ts` is
// generated from them, and this test fails the moment the two disagree.
//
// It runs the generator rather than parsing anything, so it cannot be fooled by
// a file that merely looks up to date.
//
// Run: npm run test:protocol

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildRoutes, validateGateway } from "../src/main/agent/bridge.ts";
import { CATALOGUE } from "../src/shared/agent-protocol.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = join(ROOT, "agent-runner");
const PYTHON = process.env.REX_PYTHON ?? join(PACKAGE, ".venv", "bin", "python");

/**
 * The package has to be installed before the contract can be regenerated.
 *
 * Skipped rather than failed when it is not: a fresh checkout has no `.venv`
 * until `uv sync` has run, and a test that fails on a setup step teaches people
 * to ignore it. `npm run test:library` runs `uv sync`'s tests too, so the gap
 * cannot last.
 */
const needsPackage = {
  skip: existsSync(PYTHON) ? (false as const) : `no .venv yet — run \`uv sync\` in ${PACKAGE}`,
};

function generate(flag: string): string {
  return execFileSync(PYTHON, ["-m", "agent_runner.protocol", flag], {
    cwd: PACKAGE,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

test("the committed TypeScript is what the models produce", needsPackage, () => {
  const committed = readFileSync(join(ROOT, "src/shared/agent-protocol.ts"), "utf8");
  assert.equal(
    committed,
    generate("--typescript"),
    "src/shared/agent-protocol.ts is stale — regenerate it with\n" +
      "  uv run python -m agent_runner.protocol --typescript > ../src/shared/agent-protocol.ts",
  );
});

test("the committed schema is what the models produce", needsPackage, () => {
  const committed = readFileSync(join(PACKAGE, "schema.json"), "utf8");
  assert.equal(committed, generate("--schema"), "agent-runner/schema.json is stale");
});

test("the committed catalogue is what the descriptor produces", needsPackage, () => {
  const committed = readFileSync(join(PACKAGE, "catalogue.json"), "utf8");
  assert.equal(committed, generate("--catalogue"), "agent-runner/catalogue.json is stale");
});

test("the generated module carries the catalogue the host renders from", () => {
  // §10 — the host previews a route with no round trip, so the data has to be
  // reachable from its own code. A missing constant would mean a sheet that
  // cannot draw itself until the child has answered.
  assert.ok(CATALOGUE.kinds.length > 0);
  assert.ok(CATALOGUE.sdks.length > 0);
});

// ── §10 — both sides, over the same fixtures ────────────────────
//
// `build_routes` and `validate_gateway` exist in Python and in `bridge.ts`, and
// the whole point of committing the catalogue as data is that the two cannot
// drift. These feed both the same answers and compare.

const FIXTURES: Array<Record<string, string>> = [
  {},
  { url: "http://localhost:24000" },
  { url: "  https://gw.example.com/  ", tokenEnv: "GATEWAY_KEY" },
  { unknown: "ignored" },
];

test("both sides build the same routes for the same answers", needsPackage, () => {
  for (const kind of CATALOGUE.kinds) {
    for (const values of FIXTURES) {
      const mine = buildRoutes(kind.id, values);
      const theirs = JSON.parse(
        execFileSync(
          PYTHON,
          [
            "-c",
            "import json,sys;from agent_runner import build_routes;" +
              "kind,values=json.loads(sys.argv[1]);" +
              "print(json.dumps({k: v.model_dump(by_alias=True) for k, v in build_routes(kind, values).items()}))",
            JSON.stringify([kind.id, values]),
          ],
          { cwd: PACKAGE, encoding: "utf8" },
        ),
      );
      assert.deepEqual(mine, theirs, `${kind.id} ${JSON.stringify(values)}`);
    }
  }
});

test("both sides refuse the same answers", needsPackage, () => {
  for (const kind of CATALOGUE.kinds) {
    for (const values of FIXTURES) {
      const mine = validateGateway(kind.id, values);
      const theirs = JSON.parse(
        execFileSync(
          PYTHON,
          [
            "-c",
            "import json,sys;from agent_runner import validate_gateway;" +
              "kind,values=json.loads(sys.argv[1]);" +
              "print(json.dumps([e.model_dump(by_alias=True) for e in validate_gateway(kind, values)]))",
            JSON.stringify([kind.id, values]),
          ],
          { cwd: PACKAGE, encoding: "utf8" },
        ),
      );
      assert.deepEqual(mine, theirs, `${kind.id} ${JSON.stringify(values)}`);
    }
  }
});

// Spec 57 — one version, one Release.
//
// Two halves keep one rule. A pull request into main must raise `version`
// (`scripts/check-version.ts`, run by `.github/workflows/version.yml`), and the
// Release workflow publishes a version only while its tag `v<version>` does not
// exist. If either half drifts, merges either stop shipping or ship twice, and
// neither failure is loud: a skipped Release is a green run.
//
// Run: npm run test:version

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  compareVersions,
  parseVersion,
  tagsFrom,
  versionProblems,
} from "../scripts/check-version.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...path: string[]): string => readFileSync(join(root, ...path), "utf8");

const NO_TAGS: ReadonlySet<string> = new Set();

test("a version is MAJOR.MINOR.PATCH and nothing else", () => {
  assert.deepEqual(parseVersion("0.2.0"), [0, 2, 0]);
  assert.deepEqual(parseVersion("10.0.12"), [10, 0, 12]);
  for (const wrong of ["v0.2.0", "0.2", "0.1.0-8", "0.2.0 ", ""]) {
    assert.equal(parseVersion(wrong), null, `"${wrong}" is not a version`);
  }
});

test("versions compare as numbers, not as text", () => {
  assert.ok(compareVersions("0.10.0", "0.9.0") > 0, "10 is more than 9");
  assert.ok(compareVersions("1.0.0", "0.99.99") > 0);
  assert.ok(compareVersions("0.2.0", "0.2.1") < 0);
  assert.equal(compareVersions("0.2.0", "0.2.0"), 0);
  assert.throws(() => compareVersions("0.2.0", "v0.1.0-8"), /v0\.1\.0-8/);
});

test("tags come from ls-remote with the peeled duplicates folded in", () => {
  const tags = tagsFrom(
    [
      "21ca68f\trefs/tags/v0.1.0-8",
      "9a1b2c3\trefs/tags/v0.2.0",
      "4d5e6f7\trefs/tags/v0.2.0^{}",
      "8a9b0c1\trefs/heads/main",
      "",
    ].join("\n"),
  );
  assert.deepEqual([...tags], ["v0.1.0-8", "v0.2.0"]);
});

test("a raised version with a matching lock and a new tag passes", () => {
  const facts = {
    version: "0.2.0",
    lockVersion: "0.2.0",
    baseVersion: "0.1.0",
    tags: new Set(["v0.1.0-8"]),
  };
  assert.deepEqual(versionProblems(facts), []);
});

test("the version left as main has it fails, and says what to run", () => {
  const [problem, ...rest] = versionProblems({
    version: "0.2.0",
    lockVersion: "0.2.0",
    baseVersion: "0.2.0",
    tags: NO_TAGS,
  });
  assert.equal(rest.length, 0);
  assert.match(problem ?? "", /the same as main \(0\.2\.0\)/);
  assert.match(
    problem ?? "",
    /npm version patch --no-git-tag-version/,
    "the fix is in the message",
  );
});

test("a lower version fails as lower, not as the same", () => {
  const problems = versionProblems({
    version: "0.1.9",
    lockVersion: "0.1.9",
    baseVersion: "0.2.0",
    tags: NO_TAGS,
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /lower than main/);
});

test("a lock file that disagrees fails even when the version was raised", () => {
  const problems = versionProblems({
    version: "0.3.0",
    lockVersion: "0.2.0",
    baseVersion: "0.2.0",
    tags: NO_TAGS,
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /package-lock\.json says 0\.2\.0/);
});

test("a version that is already tagged fails, because its merge would publish nothing", () => {
  const problems = versionProblems({
    version: "0.3.0",
    lockVersion: "0.3.0",
    baseVersion: "0.2.0",
    tags: new Set(["v0.3.0"]),
  });
  assert.deepEqual(problems, ["v0.3.0 is already released. Raise the version past it."]);
});

test("every broken rule is reported at once, not only the first", () => {
  const problems = versionProblems({
    version: "0.2.0",
    lockVersion: "0.1.0",
    baseVersion: "0.2.0",
    tags: new Set(["v0.2.0"]),
  });
  assert.equal(problems.length, 3);
});

test("a malformed version is one problem, not a crash", () => {
  const problems = versionProblems({
    version: "0.2",
    lockVersion: "0.2",
    baseVersion: "0.1.0",
    tags: NO_TAGS,
  });
  assert.deepEqual(problems, [`package.json's version "0.2" is not MAJOR.MINOR.PATCH.`]);
});

test("this repository's package.json and package-lock.json agree", () => {
  const version = (JSON.parse(read("package.json")) as { version: string }).version;
  const lock = JSON.parse(read("package-lock.json")) as {
    version: string;
    packages: Record<string, { version: string }>;
  };
  assert.ok(parseVersion(version), `package.json's version ${version} is MAJOR.MINOR.PATCH`);
  assert.equal(lock.version, version);
  assert.equal(lock.packages[""]?.version, version);
});

// String checks on the files GitHub reads, as spec 49's test does.
test("a pull request into main runs the check under the name the ruleset requires", () => {
  const workflow = read(".github", "workflows", "version.yml");
  assert.match(workflow, /pull_request:\n\s+branches: \[main\]/, "every pull request into main");
  assert.match(workflow, /name: Version bump\n/, "the required check's name");
  assert.match(workflow, /fetch-depth: 0/, "main's package.json must be readable");
  assert.match(workflow, /node scripts\/check-version\.ts "origin\/\$\{\{ github\.base_ref \}\}"/);
});

test("the Release workflow publishes a version once, tagged v<version>", () => {
  const workflow = read(".github", "workflows", "release.yml");
  assert.match(
    workflow,
    /git ls-remote --exit-code --tags origin "refs\/tags\/v\$\{version\}"/,
    "the tag is the gate",
  );
  assert.match(workflow, /"\$\{\{ github\.ref \}\}" != "refs\/heads\/main"/, "only main publishes");
  assert.match(
    workflow,
    /if: needs\.version\.outputs\.publish == 'true' \|\| github\.event_name == 'workflow_dispatch'/,
    "a released version builds nothing on push, and a manual run always builds",
  );
  assert.match(
    workflow,
    /release:[\s\S]*?if: needs\.version\.outputs\.publish == 'true'/,
    "and publishes only a new one",
  );
  assert.match(workflow, /gh release create "v\$\{VERSION\}"/, "tagged v<version>");
  assert.ok(!workflow.includes("run_number"), "spec 49's run-number suffix is gone");
});

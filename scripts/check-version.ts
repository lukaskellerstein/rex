#!/usr/bin/env node
/**
 * `node scripts/check-version.ts <base-ref>` — spec 57: a pull request into
 * `main` must raise `version`.
 *
 * Every version on `main` is exactly one Release, tagged `v<version>`, so a
 * pull request that leaves `version` where `main` has it would merge code that
 * never ships. This is the check that says so before the merge, in words a
 * person can act on. The Release workflow keeps the same rule from the other
 * side: a version whose tag already exists publishes nothing.
 *
 * Four things must hold, and every one that does not is reported, not just the
 * first:
 *
 * 1. `version` in `package.json` is `MAJOR.MINOR.PATCH`.
 * 2. `package-lock.json` says the same version. `npm version` keeps the two in
 *    step; a hand edit of one of them does not.
 * 3. It is higher than the version at `<base-ref>` — normally `origin/main`.
 * 4. No tag `v<version>` exists on `origin` yet.
 *
 * Tags are read with `git ls-remote`, so the answer is the remote's, and the
 * check needs no `git fetch --tags` to be true.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

type Version = [major: number, minor: number, patch: number];

export interface VersionFacts {
  /** `package.json` on the pull request. */
  version: string;
  /** `package-lock.json` on the pull request. */
  lockVersion: string;
  /** `package.json` on the branch the pull request merges into. */
  baseVersion: string;
  /** Every tag on `origin`. */
  tags: ReadonlySet<string>;
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** `[major, minor, patch]`, or `null` for anything that is not `MAJOR.MINOR.PATCH`. */
export function parseVersion(text: string): Version | null {
  const match = SEMVER.exec(text);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Negative when `a` is lower than `b`, zero when equal, positive when higher. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left) throw new Error(`not a MAJOR.MINOR.PATCH version: ${a}`);
  if (!right) throw new Error(`not a MAJOR.MINOR.PATCH version: ${b}`);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

/** Tag names from `git ls-remote --tags` output, with peeled `^{}` duplicates folded in. */
export function tagsFrom(lsRemote: string): Set<string> {
  const tags = new Set<string>();
  for (const line of lsRemote.split("\n")) {
    const ref = line.split("\t")[1];
    if (ref?.startsWith("refs/tags/"))
      tags.add(ref.slice("refs/tags/".length).replace(/\^\{\}$/, ""));
  }
  return tags;
}

/** Every rule the pull request breaks, as a sentence that says what to do. Empty is a pass. */
export function versionProblems({
  version,
  lockVersion,
  baseVersion,
  tags,
}: VersionFacts): string[] {
  if (!parseVersion(version)) {
    return [`package.json's version "${version}" is not MAJOR.MINOR.PATCH.`];
  }
  const problems: string[] = [];
  if (lockVersion !== version) {
    problems.push(
      `package-lock.json says ${lockVersion}, package.json says ${version}. ` +
        "Set the version with `npm version <x.y.z> --no-git-tag-version`, which changes both.",
    );
  }
  if (parseVersion(baseVersion) && compareVersions(version, baseVersion) <= 0) {
    const relation = version === baseVersion ? "the same as" : "lower than";
    problems.push(
      `package.json says ${version}, ${relation} main (${baseVersion}). Every merge to main is a Release, ` +
        "so raise the version in this pull request: `npm version patch --no-git-tag-version` " +
        "(or `minor`, or `major`).",
    );
  }
  if (tags.has(`v${version}`)) {
    problems.push(`v${version} is already released. Raise the version past it.`);
  }
  return problems;
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" });
}

function versionIn(json: string): string {
  return (JSON.parse(json) as { version: string }).version;
}

function main(baseRef: string | undefined): number {
  if (!baseRef) {
    console.error("usage: node scripts/check-version.ts <base-ref>   (for example origin/main)");
    return 2;
  }
  const facts: VersionFacts = {
    version: versionIn(readFileSync("package.json", "utf8")),
    lockVersion: versionIn(readFileSync("package-lock.json", "utf8")),
    baseVersion: versionIn(git("show", `${baseRef}:package.json`)),
    tags: tagsFrom(git("ls-remote", "--tags", "origin")),
  };

  const problems = versionProblems(facts);
  const verdict = problems.length
    ? problems.map((problem) => `- ${problem}`).join("\n")
    : `- ${facts.baseVersion} → ${facts.version}. Merging this publishes the Release \`v${facts.version}\`.`;

  console.log(verdict);
  // GitHub shows an `::error::` line on the pull request itself, beside the check.
  for (const problem of problems) console.log(`::error title=Version not raised::${problem}`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `## Version\n\n${verdict}\n`);
  return problems.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv[2]));
}

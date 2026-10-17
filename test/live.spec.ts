// Spec 59 §6 milestone 0 — the policy a page runs under in the Live frame.
//
// The sandbox keeps the page's script away from REX. This header is what keeps
// it from talking to anyone else, and a header nobody reads is one that can
// lose a directive in a refactor and still look fine on screen. So the
// directives that matter are asserted one by one, and so is the rule that only
// HTML carries the policy at all.
//
// No browser and no Electron: `docHeaders.ts` is a pure module.
//
// Run: npm run test:live

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { headersFor, LIVE_POLICY } from "../src/main/docHeaders.ts";
import { isHtmlPath } from "../src/shared/formats.ts";

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(";").map((part) => {
      const [name = "", ...sources] = part.trim().split(/\s+/);
      return [name, sources];
    }),
  );
}

test("an HTML page carries the Live policy, whatever the case of its extension", () => {
  for (const path of ["/a/index.html", "/a/page.htm", "/a/PAGE.HTML"]) {
    const headers = headersFor(path);
    assert.equal(headers["content-type"], "text/html", path);
    assert.equal(headers["content-security-policy"], LIVE_POLICY, path);
  }
});

test("nothing that is not HTML carries a policy", () => {
  for (const path of ["/a/figure.svg", "/a/app.js", "/a/notes.md", "/a/deck.pdf", "/a/x"]) {
    assert.equal(headersFor(path)["content-security-policy"], undefined, path);
  }
});

test("the page may run script and load its fonts, and may not connect, frame or post", () => {
  const policy = directives(LIVE_POLICY);
  assert.deepEqual(policy.get("default-src"), ["'none'"]);
  assert.ok(policy.get("script-src")?.includes("'unsafe-inline'"));
  assert.ok(policy.get("font-src")?.includes("https:"));
  assert.deepEqual(policy.get("connect-src"), ["'none'"]);
  assert.deepEqual(policy.get("frame-src"), ["'none'"]);
  assert.deepEqual(policy.get("form-action"), ["'none'"]);
});

test("Markdown is not a page the Live frame runs", () => {
  assert.equal(isHtmlPath("/a/README.md"), false);
  assert.equal(isHtmlPath("/a/.html"), false);
});

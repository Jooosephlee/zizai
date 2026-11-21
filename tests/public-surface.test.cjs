const assert = require("node:assert/strict");
const { test } = require("node:test");
const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
const html = readFileSync(join(root, "docs/index.html"), "utf8");

test("the public tree does not carry the internal store worksheet", () => {
  assert.equal(tracked.includes("store/listing.md"), false);
  assert.equal(tracked.some(path => /复核|审核/.test(path)), false);
  assert.equal(html.includes("archive/refs/heads/main.zip"), false);
  assert.equal(html.includes('href="https://github.com/Jooosephlee/zizai"'), true);
  assert.equal(html.includes("gicgnhlpofjobdoloefejjeaicijcbie"), true);
});

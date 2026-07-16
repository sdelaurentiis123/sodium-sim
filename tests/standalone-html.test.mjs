import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync("na-d-transport-lab.html", "utf8");
const source = readFileSync("app/standalone-engine.ts", "utf8");

test("standalone reactor lab contains a parseable inline engine and worker", () => {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
  assert.match(html, /__REACTOR_WORKER_SOURCE__/);
});

test("standalone reactor lab has unique and complete control IDs", () => {
  const identifiers = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(identifiers).size, identifiers.length);
  const existing = new Set(identifiers);
  const referenced = [...source.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(referenced.filter((id) => !existing.has(id)))], []);
});

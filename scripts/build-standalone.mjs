import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";

const output = await build({
  entryPoints: ["app/standalone-engine.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: false,
  write: false,
});
const bundle = new TextDecoder().decode(output.outputFiles[0].contents);
const workerOutput = await build({
  entryPoints: ["app/reactor-worker.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: false,
  write: false,
});
const workerBundle = new TextDecoder().decode(workerOutput.outputFiles[0].contents);
const path = "na-d-transport-lab.html";
const html = await readFile(path, "utf8");
const marked = `/* ENGINE_BUNDLE_START */\nglobalThis.__REACTOR_WORKER_SOURCE__ = ${JSON.stringify(workerBundle)};\n${bundle}\n/* ENGINE_BUNDLE_END */`;
const next = html.includes("/* ENGINE_BUNDLE_START */") ?
  html.replace(/\/\* ENGINE_BUNDLE_START \*\/[\s\S]*?\/\* ENGINE_BUNDLE_END \*\//, marked) :
  html.replace(/<script>[\s\S]*?<\/script>/, `<script>\n${marked}\n</script>`);
await writeFile(path, next);

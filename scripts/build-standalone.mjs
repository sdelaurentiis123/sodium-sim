import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const outFlag = process.argv.indexOf("--out");
const source = "na-d-transport-lab.html";
const target = outFlag >= 0 ? process.argv[outFlag + 1] : source;
if (!target) throw new Error("--out requires a path");

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
const html = await readFile(source, "utf8");
const marked = `/* ENGINE_BUNDLE_START */\nglobalThis.__REACTOR_WORKER_SOURCE__ = ${JSON.stringify(workerBundle)};\n${bundle}\n/* ENGINE_BUNDLE_END */`;
const next = html.includes("/* ENGINE_BUNDLE_START */") ?
  html.replace(/\/\* ENGINE_BUNDLE_START \*\/[\s\S]*?\/\* ENGINE_BUNDLE_END \*\//, marked) :
  html.replace(/<script>[\s\S]*?<\/script>/, `<script>\n${marked}\n</script>`);
if (!next.includes("/* ENGINE_BUNDLE_START */"))
  throw new Error(`no <script> injection point found in ${source}`);
await mkdir(dirname(target) || ".", { recursive: true });
await writeFile(target, next);

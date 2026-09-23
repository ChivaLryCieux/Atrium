#!/usr/bin/env node

/**
 * Atrium // Kernel runtime build (single-file dsh executable)
 *
 * Produces upstream's packaged single-file DeepSeek Harness runtime and stages
 * it where `bundle-runtime.mjs` picks it up:
 *
 *   .kernel-dist/deepseek-harness-sdk-runtime-<platform>-<arch>.exe     ~250 MB
 *   .kernel-dist/deepseek-harness-sdk-runtime-<platform>-<arch>-rg.exe  ~6 MB
 *
 * Why an isolated clone: upstream's build script runs
 * `pnpm deploy --legacy --prod`, which MOVES workspace packages out of the
 * checkout before restoring them. Running that against the vendored checkout
 * would mutate it (measured: 6467 files relocated) and violate Atrium's
 * zero-pollution policy, so the build always happens in a disposable local
 * clone under .kernel-build/.
 *
 * Why settings go into pnpm-workspace.yaml: pnpm 11 reads these keys ONLY from
 * the workspace YAML — CLI `--config.*` flags and `npm_config_*` environment
 * variables are silently ignored, which is how upstream's script (written for
 * pnpm 9/10 semantics) loses every switch it passes:
 *   nodeLinker: hoisted        junction-free staging (NSIS cannot build them)
 *   ignoreScripts: true        the root postinstall imports a devDependency at
 *                              module load and cannot survive --prod pruning
 *   verifyDepsBeforeRun: false no implicit production install mid-build (that
 *                              install prunes tsx/pkg and breaks the pipeline)
 *   confirmModulesPurge: false allow the linker switch without a TTY
 *
 * Usage:
 *   pnpm run build:kernel-exe            # build for the host target
 *   pnpm run build:kernel-exe -- --force # rebuild even if artifacts exist
 */

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DSH_DIR = resolve(ROOT_DIR, "deepseek-harness");
const WORK_DIR = resolve(ROOT_DIR, ".kernel-build");
const DIST_DIR = resolve(ROOT_DIR, ".kernel-dist");
const FORCE = process.argv.includes("--force");

const PNPM_SETTINGS = [
  "# Atrium kernel-runtime build overlay (pnpm 11 reads these only from YAML).",
  "nodeLinker: hoisted",
  "ignoreScripts: true",
  "verifyDepsBeforeRun: false",
  "confirmModulesPurge: false",
].join("\n");

function fail(message) {
  console.error(`\x1b[31m[FAIL] ${message}\x1b[0m`);
  process.exit(1);
}

function ok(message) {
  console.log(`\x1b[32m[PASS] ${message}\x1b[0m`);
}

function step(message) {
  console.log(`\n\x1b[36m[BUILD] ${message}\x1b[0m`);
}

/** pkg target triple for the host, e.g. `node24-win-x64`. */
function hostTarget() {
  const platform = process.platform === "win32" ? "win" : process.platform === "darwin" ? "macos" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (platform === "win" && arch !== "x64") fail(`unsupported Windows architecture: ${arch}`);
  return `node24-${platform}-${arch}`;
}

/**
 * Locate pnpm's JavaScript entrypoint. Upstream's script refuses to run on
 * Windows without one (`npm_execpath` or `PNPM_HOME`).
 */
function pnpmEntrypoint() {
  const candidates = [];
  const execpath = process.env.npm_execpath;
  if (execpath && /\.(mjs|cjs|js)$/i.test(execpath) && existsSync(execpath)) candidates.push(execpath);
  const beside = join(dirname(process.execPath), "node_modules", "pnpm", "bin", "pnpm.mjs");
  candidates.push(beside);
  if (process.env.APPDATA) {
    candidates.push(join(process.env.APPDATA, "npm", "node_modules", "pnpm", "bin", "pnpm.mjs"));
  }
  candidates.push(join(ROOT_DIR, "node_modules", "pnpm", "bin", "pnpm.mjs"));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  fail("pnpm entrypoint not found — expected APPDATA/npm/node_modules/pnpm/bin/pnpm.mjs or npm_execpath");
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

// 1. Workspace: disposable local clone of the vendored checkout -------------

console.log("\x1b[36m========================================================\x1b[0m");
console.log("\x1b[1m[ATRIUM 智役中庭] KERNEL RUNTIME BUILD\x1b[0m");
console.log(`\x1b[36m========================================================\x1b[0m`);

if (!existsSync(DSH_DIR)) fail(`vendored checkout missing: ${DSH_DIR} (run \`pnpm run sync:upstream\`)`);
const kernelCommit = git(["rev-parse", "HEAD"], DSH_DIR);
const target = hostTarget();
const runtimeName = `deepseek-harness-sdk-runtime-${target.replace(/^node24-/, "")}.exe`;
const sidecarName = runtimeName.replace(/\.exe$/, "-rg.exe");

if (!FORCE && existsSync(join(DIST_DIR, runtimeName)) && existsSync(join(DIST_DIR, sidecarName))) {
  const stamp = join(DIST_DIR, ".built-from");
  const builtFrom = existsSync(stamp) ? readFileSync(stamp, "utf8").trim() : "";
  if (builtFrom === kernelCommit) {
    ok(`kernel runtime already built from ${kernelCommit.slice(0, 10)} — pass --force to rebuild`);
    process.exit(0);
  }
  console.log(`[BUILD] kernel moved from ${builtFrom.slice(0, 10) || "(unknown)"} to ${kernelCommit.slice(0, 10)} — rebuilding`);
}

step(`preparing isolated build workspace (.kernel-build) from ${kernelCommit.slice(0, 10)}`);
if (!existsSync(join(WORK_DIR, ".git"))) {
  rmSync(WORK_DIR, { recursive: true, force: true });
  execFileSync("git", ["clone", "--local", "--quiet", DSH_DIR, WORK_DIR], { stdio: "inherit" });
}
execFileSync("git", ["checkout", "--quiet", kernelCommit], { cwd: WORK_DIR, stdio: "inherit" });
ok("build workspace ready (vendored checkout untouched)");

// 2. pnpm settings the upstream script cannot pass on pnpm 11 ----------------

const workspaceYaml = join(WORK_DIR, "pnpm-workspace.yaml");
const yaml = readFileSync(workspaceYaml, "utf8");
if (!yaml.includes("nodeLinker: hoisted") || !yaml.includes("verifyDepsBeforeRun: false")) {
  writeFileSync(workspaceYaml, `${yaml.replace(/\s*$/, "")}\n${PNPM_SETTINGS}\n`);
}
ok("pnpm 11 settings applied in the build workspace");

// 3. Install + build --------------------------------------------------------

const pnpm = pnpmEntrypoint();
step("installing workspace dependencies (hoisted, scripts skipped)");
execFileSync(process.execPath, [pnpm, "install"], { cwd: WORK_DIR, stdio: "inherit" });

step(`building single-file runtime for ${target} (this takes a while)`);
const build = spawnSync(
  process.execPath,
  [join(WORK_DIR, "node_modules", "tsx", "dist", "cli.mjs"), "scripts/build-exe-for-python-sdk.ts", `--targets=${target}`],
  {
    cwd: WORK_DIR,
    stdio: "inherit",
    env: { ...process.env, npm_execpath: pnpm },
  },
);
if (build.status !== 0) fail(`kernel runtime build failed with exit code ${build.status}`);

// 4. Stage the products where bundle-runtime picks them up ------------------

step("staging products into .kernel-dist");
const productsDir = join(WORK_DIR, "dist-exe");
const exes = existsSync(productsDir) ? readdirSync(productsDir).filter((name) => name.endsWith(".exe")) : [];
const runtime = exes.find((name) => !name.endsWith("-rg.exe"));
const sidecar = exes.find((name) => name.endsWith("-rg.exe"));
if (runtime === undefined) fail(`no runtime exe produced in ${productsDir}`);
if (sidecar === undefined) fail(`no ripgrep sidecar produced in ${productsDir}`);

rmSync(DIST_DIR, { recursive: true, force: true });
mkdirSync(DIST_DIR, { recursive: true });
cpSync(join(productsDir, runtime), join(DIST_DIR, runtime));
cpSync(join(productsDir, sidecar), join(DIST_DIR, sidecar));
writeFileSync(join(DIST_DIR, ".built-from"), `${kernelCommit}\n`);
writeFileSync(join(DIST_DIR, "README.txt"), "Built by `pnpm run build:kernel-exe`; consumed by `pnpm run bundle:runtime`.\n");

ok(`kernel runtime ready: .kernel-dist/${runtime} + ${sidecar}`);
console.log("\nNext: `pnpm tauri:build` (staging runs automatically, then bundles the kernel)\n");

#!/usr/bin/env node

/**
 * Atrium // Desktop Runtime Staging
 *
 * Stages everything `tauri build` bundles as resources (see
 * `bundle.resources` in src-tauri/tauri.conf.json, plus the kernel mapping in
 * src-tauri/tauri.build.conf.json) so the packaged app can boot the real
 * DeepSeek Harness kernel:
 *
 *   resources/bridge/index.cjs          self-contained kernel bridge (esbuild, ws bundled)
 *   resources/cordis/                   Cordis persona overlay patches
 *   resources/node/                     bundled node runtime (node.exe + license)
 *   resources/kernel/                   packaged single-file dsh runtime + ripgrep sidecar
 *   resources/kernel-manifest.json      staging metadata
 *
 * The dsh kernel is always staged — the product ships with the kernel or it
 * does not ship. A staged kernel that is missing the build product
 * (`.kernel-dist/`) fails the staging instead of silently producing a
 * kernel-less build; run `pnpm run build:kernel-exe` first.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STAGE_DIR = resolve(ROOT_DIR, "src-tauri/resources");

const DSH_DIR = resolve(ROOT_DIR, "deepseek-harness");
const SDK_CLIENT_SOURCE_FALLBACK = join(DSH_DIR, "packages", "sdk", "client", "lib", "index.js");
const BRIDGE_ENTRY = resolve(ROOT_DIR, "packages/atrium-desktop-host/src/index.js");
const CORDIS_PATCH = resolve(ROOT_DIR, "packages/atrium-core/profiles/atrium-desktop/atrium-sdk.cordis.patch.yml");
// Products of `pnpm run build:kernel-exe` (upstream's single-file runtime).
const KERNEL_DIST = resolve(ROOT_DIR, ".kernel-dist");

/**
 * The staged single-file runtime, identified the same way `daemon.rs` does:
 * upstream's `deepseek-harness-sdk-runtime-<platform>-<arch>.exe`, never the
 * `-rg` ripgrep sidecar that sits beside it.
 */
function kernelRuntimeIn(dir) {
  if (!existsSync(dir)) return null;
  for (const name of readdirSync(dir)) {
    if (
      name.startsWith("deepseek-harness-sdk-runtime-") &&
      name.endsWith(".exe") &&
      !name.endsWith("-rg.exe")
    ) {
      return name;
    }
  }
  return null;
}

function fail(message) {
  console.error(`\x1b[31m[FAIL] ${message}\x1b[0m`);
  process.exit(1);
}

function ok(message) {
  console.log(`\x1b[32m[PASS] ${message}\x1b[0m`);
}

function info(message) {
  console.log(`[STAGE] ${message}`);
}

function stageDir(...parts) {
  const dir = join(STAGE_DIR, ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Robust recursive delete for staged/installed trees. Two Windows traps, both
 * hit for real: `fs.rm` with `force: true` silently swallows the failures that
 * long paths and locked files produce (once leaving a 200k-file tree behind
 * while the script reported success), and even a correct delete is slow
 * because NTFS metadata work plus Defender scanning dominate. So: mirror
 * from an empty directory with robocopy (multithreaded bulk delete) and verify.
 */
function removeTree(dir) {
  if (!existsSync(dir)) return;
  if (process.platform === "win32") {
    const empty = join(STAGE_DIR, ".empty");
    mkdirSync(empty, { recursive: true });
    const mirrored = spawnSync(
      "robocopy",
      [empty, dir, "/MIR", "/MT:16", "/R:0", "/W:0", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"],
      { stdio: "ignore" },
    );
    rmSync(empty, { recursive: true, force: true });
    if (mirrored.status === null || mirrored.status > 7) {
      fail(`robocopy purge failed for ${dir} (code ${mirrored.status})`);
    }
  } else {
    spawnSync("rm", ["-rf", dir], { stdio: "ignore" });
  }
  if (existsSync(dir)) {
    const leftovers = readdirSync(dir);
    if (leftovers.length > 0) {
      fail(`could not clear ${dir} (${leftovers.length} entries left — files may be locked)`);
    }
  }
}

// 1. Preconditions ---------------------------------------------------------

console.log("\x1b[36m========================================================\x1b[0m");
console.log("\x1b[1m[ATRIUM 智役中庭] RUNTIME STAGING\x1b[0m");
console.log(`\x1b[36m========================================================\x1b[0m\n`);

if (!existsSync(resolve(ROOT_DIR, "dist/index.html"))) {
  info("dist/ missing — building frontend via `pnpm build`...");
  execFileSync("pnpm", ["run", "build"], { cwd: ROOT_DIR, stdio: "inherit" });
}
ok("frontend dist/ present");

if (!existsSync(BRIDGE_ENTRY)) fail(`kernel bridge entry missing: ${BRIDGE_ENTRY}`);
if (!existsSync(CORDIS_PATCH)) fail(`cordis patch missing: ${CORDIS_PATCH}`);

// The bridge drives the kernel through the official SDK client; bundling it
// into the bridge keeps packaged installs free of any kernel source tree.
const SDK_CLIENT_SOURCE = join(DSH_DIR, "packages", "sdk", "client", "lib", "index.js");

if (!existsSync(KERNEL_DIST)) {
  fail(
    `kernel runtime not built: ${KERNEL_DIST} is missing.\n` +
      "        Run `pnpm run build:kernel-exe` first (builds upstream's single-file runtime).",
  );
}
if (!existsSync(SDK_CLIENT_SOURCE)) {
  fail(`SDK client source missing: ${SDK_CLIENT_SOURCE} (is the vendored checkout present?)`);
}

// 2. Bridge bundle (self-contained; `ws` is the only non-builtin import) ---

const requireFromRoot = createRequire(join(ROOT_DIR, "package.json"));
const esbuild = requireFromRoot("esbuild");
const bridgeOut = stageDir("bridge");
await esbuild.build({
  entryPoints: [BRIDGE_ENTRY],
  outfile: join(bridgeOut, "index.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: false,
  minify: false,
  logLevel: "silent",
});
ok("kernel bridge bundled -> resources/bridge/index.cjs");

// The SDK client rides along so the packaged bridge needs no kernel checkout
// at runtime (the dev bridge loads the checkout copy instead).
if (existsSync(SDK_CLIENT_SOURCE)) {
  await esbuild.build({
    entryPoints: [SDK_CLIENT_SOURCE],
    outfile: join(bridgeOut, "sdk-client.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    sourcemap: false,
    minify: false,
    logLevel: "silent",
  });
  ok("dsh SDK client bundled -> resources/bridge/sdk-client.mjs");
}

// 3. Cordis persona overlay ------------------------------------------------

const cordisOut = stageDir("cordis");
cpSync(CORDIS_PATCH, join(cordisOut, "atrium-sdk.cordis.patch.yml"));
ok("cordis patch staged -> resources/cordis/");

// 4. Node runtime ----------------------------------------------------------

const nodeOut = stageDir("node");
const nodeBin = process.execPath;
cpSync(nodeBin, join(nodeOut, process.platform === "win32" ? "node.exe" : "node"));
const nodeLicense = join(dirname(nodeBin), "LICENSE");
if (existsSync(nodeLicense)) {
  cpSync(nodeLicense, join(nodeOut, "LICENSE"));
}
ok(`node runtime staged (${process.version})`);

// 5. Kernel payload (mandatory) --------------------------------------------
//
// The kernel ships as upstream's packaged single-file runtime — one ~250 MB
// executable with Node 24 and the whole closure embedded — plus its `-rg`
// (ripgrep) sidecar, which must sit beside it with the matching `-rg` suffix.
//
// Copying the workspace tree instead is NOT viable: pnpm links dependencies
// with NTFS junctions, a robocopy pass follows them, and the staged tree
// duplicates the store into millions of files (measured: 4.4M files), which
// also poisons `tauri dev` through the crate's dep-info. Do not reintroduce it.

const kernelOut = stageDir("kernel");

const products = readdirSync(KERNEL_DIST).filter((name) => name.endsWith(".exe"));
const runtime = products.find((name) => !name.endsWith("-rg.exe"));
const sidecar = products.find((name) => name.endsWith("-rg.exe"));
if (runtime === undefined) fail(`no kernel runtime exe found in ${KERNEL_DIST}`);
if (sidecar === undefined) {
  fail(`ripgrep sidecar (-rg.exe) missing in ${KERNEL_DIST} — the runtime requires it beside the exe`);
}

removeTree(kernelOut);
mkdirSync(kernelOut, { recursive: true });
cpSync(join(KERNEL_DIST, runtime), join(kernelOut, runtime));
cpSync(join(KERNEL_DIST, sidecar), join(kernelOut, sidecar));
ok(`kernel runtime staged -> resources/kernel/ (2 files, ~${treeSizeMb(kernelOut)} MB)`);

// 6. Manifest --------------------------------------------------------------

writeFileSync(
  join(STAGE_DIR, "kernel-manifest.json"),
  JSON.stringify(
    {
      kernelStaged: true,
      kernelPayload: "single-file-runtime",
      kernelRuntime: kernelRuntimeIn(kernelOut),
      nodeVersion: process.version,
      stagedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);

console.log("\n\x1b[32m[READY] runtime staged under src-tauri/resources/ (dsh kernel embedded)\x1b[0m\n");

function treeSizeMb(dir) {
  let total = 0;
  const walk = (entry) => {
    for (const name of readdirSync(entry)) {
      const full = join(entry, name);
      const stats = statSync(full);
      if (stats.isDirectory()) walk(full);
      else total += stats.size;
    }
  };
  try {
    walk(dir);
  } catch {
    return 0;
  }
  return Math.round(total / (1024 * 1024));
}

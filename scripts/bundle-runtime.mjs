#!/usr/bin/env node

/**
 * Atrium // Desktop Runtime Staging
 *
 * Stages everything `tauri build` bundles as resources (see
 * `bundle.resources` in src-tauri/tauri.conf.json) so the packaged app can
 * boot the real DeepSeek Harness kernel:
 *
 *   resources/bridge/index.cjs          self-contained kernel bridge (esbuild, ws bundled)
 *   resources/cordis/                   Cordis persona overlay patches
 *   resources/node/                     bundled node runtime (node.exe + license)
 *   resources/kernel/                   vendored deepseek-harness runtime tree
 *   resources/kernel-manifest.json      staging metadata
 *
 * Modes:
 *   pnpm run bundle:runtime               light: no kernel; the app degrades to
 *                                         the direct-API fallback at runtime
 *   pnpm run bundle:runtime -- --with-kernel
 *                                         heavy: also stages deepseek-harness/
 *                                         (~1.2 GB tree; release builds only)
 */

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STAGE_DIR = resolve(ROOT_DIR, "src-tauri/resources");
//   --with-kernel   stage the kernel tree (distribution builds)
//   --light         force the kernel out of the staged resources
//   (default)       auto: keep an already-staged kernel, otherwise stage light
//                   — this is what beforeBuildCommand runs, so a distribution
//                   build does not wipe the kernel staged just before it
const MODE = process.argv.includes("--with-kernel")
  ? "kernel"
  : process.argv.includes("--light")
    ? "light"
    : "auto";

const DSH_DIR = resolve(ROOT_DIR, "deepseek-harness");
const DSH_BIN = join(DSH_DIR, "apps", "cli", "lib", "bin.js");
const SDK_CLIENT = join(DSH_DIR, "packages", "sdk", "client", "lib", "index.js");
const BRIDGE_ENTRY = resolve(ROOT_DIR, "packages/aria-desktop-host/src/index.js");
const CORDIS_PATCH = resolve(ROOT_DIR, "packages/aria-core/profiles/aria-desktop/atrium-sdk.cordis.patch.yml");

// Kernel sub-trees that never participate in the runtime and would bloat the
// installer; everything else under deepseek-harness/ is staged verbatim.
const KERNEL_EXCLUDES = [
  ".git",
  "docs",
  "website",
  "benchmarks",
  "snapshots",
  "python",
  "coverage",
  "node_modules/.cache",
];

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

// 1. Preconditions ---------------------------------------------------------

console.log("\x1b[36m========================================================\x1b[0m");
console.log("\x1b[1m[ATRIUM // 智役中庭] RUNTIME STAGING\x1b[0m");
console.log(`\x1b[36m========================================================\x1b[0m\n`);

if (!existsSync(resolve(ROOT_DIR, "dist/index.html"))) {
  info("dist/ missing — building frontend via `pnpm build`...");
  execFileSync("pnpm", ["run", "build"], { cwd: ROOT_DIR, stdio: "inherit" });
}
ok("frontend dist/ present");

if (!existsSync(BRIDGE_ENTRY)) fail(`kernel bridge entry missing: ${BRIDGE_ENTRY}`);
if (!existsSync(CORDIS_PATCH)) fail(`cordis patch missing: ${CORDIS_PATCH}`);

if (MODE === "kernel" && !existsSync(DSH_BIN)) {
  fail("deepseek-harness kernel is not built. Run `pnpm run prepare:kernel` first.");
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

// 5. Kernel tree (opt-in) --------------------------------------------------

const kernelOut = stageDir("kernel");
// The kernel's own CLI entry marks a fully staged runtime tree.
const kernelPresent = existsSync(join(kernelOut, "apps", "cli", "lib", "bin.js"));

if (MODE === "kernel") {
  // pnpm's default layout links dependencies with NTFS junctions; following
  // them during staging duplicates the store several-fold, and the NSIS/MSI
  // extractors cannot recreate junctions anyway. Re-link with the hoisted
  // linker (npm-style real files) so the staged tree is plain files.
  //
  // pnpm 11 reads `nodeLinker` only from pnpm-workspace.yaml, so the setting
  // is appended temporarily and the tracked file restored right after — the
  // working tree stays pollution-free; only node_modules (untracked) changes.
  // A marker short-circuits repeat stagings while the layout stays hoisted.
  const hoistMarker = join(DSH_DIR, "node_modules", ".atrium-hoisted");
  const workspaceYaml = join(DSH_DIR, "pnpm-workspace.yaml");
  if (!existsSync(hoistMarker)) {
    info("relinking kernel node_modules with nodeLinker=hoisted (one-off)...");
    const originalYaml = readFileSync(workspaceYaml, "utf8");
    try {
      const settingsYaml = originalYaml.includes("nodeLinker:")
        ? originalYaml
        : `${originalYaml.replace(/\s*$/, "")}\nnodeLinker: hoisted\n`;
      writeFileSync(workspaceYaml, settingsYaml);
      rmSync(join(DSH_DIR, "node_modules"), { recursive: true, force: true });
      const relink = spawnSync("pnpm", ["install"], {
        cwd: DSH_DIR,
        stdio: "inherit",
        shell: true,
      });
      if (relink.status !== 0) {
        fail(`hoisted relink failed with exit code ${relink.status}`);
      }
    } finally {
      writeFileSync(workspaceYaml, originalYaml);
    }
    writeFileSync(hoistMarker, "hoisted by bundle-runtime\n");
    ok("kernel node_modules relinked (hoisted, junction-free)");
  } else {
    ok("kernel node_modules already hoisted");
  }

  // Re-stage from scratch so removed upstream files never linger.
  rmSync(kernelOut, { recursive: true, force: true });
  mkdirSync(kernelOut, { recursive: true });

  if (process.platform === "win32") {
    // robocopy mirrors the tree fast; exit codes 0-7 are success.
    const args = [join(DSH_DIR), kernelOut, "/E", "/MT:16", "/NFL", "/NDL", "/NJH", "/NP"];
    for (const exclude of KERNEL_EXCLUDES) {
      args.push("/XD", join(DSH_DIR, exclude));
    }
    const result = spawnSync("robocopy", args, { stdio: "ignore" });
    if (result.status === null || result.status > 7) {
      fail(`robocopy kernel staging failed with code ${result.status}`);
    }
  } else {
    execFileSync(
      "rsync",
      [
        "-a",
        "--delete",
        ...KERNEL_EXCLUDES.map((exclude) => `--exclude=${exclude}`),
        `${DSH_DIR}/`,
        `${kernelOut}/`,
      ],
      { stdio: "inherit" },
    );
  }
  ok(`dsh kernel staged -> resources/kernel/ (~${treeSizeMb(kernelOut)} MB)`);
} else if (MODE === "auto" && kernelPresent) {
  ok(`kernel already staged (auto mode) — keeping resources/kernel/ (~${treeSizeMb(kernelOut)} MB)`);
} else {
  // Light mode keeps the kernel dir present (so the tauri resources mapping
  // always resolves) but empty of runtime content; daemon.rs + bridge report
  // the kernel as missing at runtime and turns fall back to the direct API.
  rmSync(join(kernelOut, "apps"), { recursive: true, force: true });
  rmSync(join(kernelOut, "packages"), { recursive: true, force: true });
  rmSync(join(kernelOut, "node_modules"), { recursive: true, force: true });
  writeFileSync(
    join(kernelOut, "KERNEL_NOT_STAGED.txt"),
    "Light-mode build: the DeepSeek Harness kernel was not bundled.\n" +
      "Rebuild with `pnpm run bundle:runtime -- --with-kernel` to embed it.\n",
  );
  info("light mode: kernel NOT staged (direct-API fallback stays active)");
}

// 6. Manifest --------------------------------------------------------------

const kernelBundled = MODE === "kernel" || (MODE === "auto" && kernelPresent);

writeFileSync(
  join(STAGE_DIR, "kernel-manifest.json"),
  JSON.stringify(
    {
      kernelStaged: kernelBundled,
      nodeVersion: process.version,
      stagedAt: new Date().toISOString(),
      kernelExcludes: kernelBundled ? KERNEL_EXCLUDES : [],
    },
    null,
    2,
  ),
);

console.log(`\n\x1b[32m[READY] runtime staged under src-tauri/resources/ (${kernelBundled ? "with" : "without"} kernel)\x1b[0m\n`);

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

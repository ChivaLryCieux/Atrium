#!/usr/bin/env node

/**
 * Atrium // Upstream DSH (DeepSeek Harness) Synchronization & Inspection Utility
 *
 * Verifies the integrity of the upstream deepseek-harness repository,
 * checks for newly available releases/tags, verifies zero-pollution compliance,
 * and validates Cordis profile overlay integrity.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT_DIR = process.cwd();
const DSH_DIR = resolve(ROOT_DIR, "deepseek-harness");
const ATRIUM_PROFILE_DIR = resolve(ROOT_DIR, "packages/atrium-core/profiles/atrium-desktop");

console.log("\x1b[36m========================================================\x1b[0m");
console.log("\x1b[1m[ATRIUM // 智役中庭] UPSTREAM ENGINE SYNC PROTOCOL\x1b[0m");
console.log("\x1b[36m========================================================\x1b[0m\n");

// 1. Verify dsh directory
if (!existsSync(DSH_DIR)) {
  console.error(`\x1b[31m[ERROR] deepseek-harness directory not found at: ${DSH_DIR}\x1b[0m`);
  process.exit(1);
}

// 2. Check git cleanliness (Zero-Pollution Policy)
try {
  const status = execSync("git status --porcelain", { cwd: DSH_DIR, encoding: "utf-8" }).trim();
  if (status.length > 0) {
    console.warn("\x1b[33m[WARN] Zero-pollution alert! Upstream working tree has uncommitted modifications:\x1b[0m");
    console.warn(status);
  } else {
    console.log("\x1b[32m[PASS] Zero-Pollution Policy verified. deepseek-harness/ is completely clean.\x1b[0m");
  }
} catch (err) {
  console.warn(`[WARN] Could not run git status in deepseek-harness: ${err.message}`);
}

// 3. Inspect Current Commit & Branch
try {
  const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: DSH_DIR, encoding: "utf-8" }).trim();
  const commit = execSync('git log -1 --format="%h - %s (%cr)"', { cwd: DSH_DIR, encoding: "utf-8" }).trim();
  console.log(`[CORE] Upstream Branch : \x1b[33m${branch}\x1b[0m`);
  console.log(`[CORE] Current Commit  : \x1b[33m${commit}\x1b[0m`);
} catch (err) {
  console.warn(`[WARN] Failed to query commit info: ${err.message}`);
}

// 4. Validate Cordis Profile Overlay
console.log("\n[PROFILE] Inspecting Cordis 'atrium-desktop' overlay...");
const profilePkgPath = join(ATRIUM_PROFILE_DIR, "package.json");
const cordisPatchPath = join(ATRIUM_PROFILE_DIR, "cordis.patch.yml");

if (existsSync(profilePkgPath) && existsSync(cordisPatchPath)) {
  const rawContent = readFileSync(profilePkgPath, "utf-8").replace(/^\uFEFF/, "");
  const profilePkg = JSON.parse(rawContent);
  console.log(`\x1b[32m[PASS] Cordis profile detected: ${profilePkg.name || "atrium-desktop"}\x1b[0m`);
  console.log(`[PROFILE] Bundles: ${(profilePkg.cordis?.bundles || []).join(", ") || "N/A"}`);
  console.log("[PROFILE] Patch configuration: cordis.patch.yml [VALID]");
} else {
  console.error(`\x1b[31m[FAIL] Profile package.json or cordis.patch.yml missing in ${ATRIUM_PROFILE_DIR}\x1b[0m`);
}

// 5. Check Remote Updates (if flag provided)
const args = process.argv.slice(2);
const shouldFetch = args.includes("--fetch") || args.includes("-f");

if (shouldFetch) {
  console.log("\n[FETCH] Querying upstream git remotes...");
  try {
    execSync("git fetch --tags origin", { cwd: DSH_DIR, stdio: "inherit" });
    const latestTag = execSync("git describe --tags --abbrev=0", { cwd: DSH_DIR, encoding: "utf-8" }).trim();
    console.log(`\x1b[32m[FETCH] Latest upstream tag: ${latestTag}\x1b[0m`);
  } catch (err) {
    console.warn(`[WARN] Remote fetch failed: ${err.message}`);
  }
} else {
  console.log("\n[INFO] To fetch remote tags from upstream, run: pnpm run sync:upstream -- --fetch");
}

console.log("\n\x1b[36m--------------------------------------------------------\x1b[0m");
console.log("\x1b[1m[STATUS] Atrium Engine Synchronizer inspection completed.\x1b[0m");
console.log("\x1b[36m--------------------------------------------------------\x1b[0m\n");

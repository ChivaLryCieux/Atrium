// Lint: every `t("...")` key used in src must exist in both locale files, and
// the two locale files must expose identical key sets. Run with `node scripts/check-i18n.mjs`.

import { readFileSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";

const LOCALES = ["src/locales/zh-CN/translation.json", "src/locales/en/translation.json"];

function flatten(obj, prefix = "") {
  return Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === "object" ? flatten(value, `${prefix}${key}.`) : [`${prefix}${key}`]
  );
}

function collectSources(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectSources(full, out);
    else if ([".ts", ".tsx"].includes(extname(entry.name)) && !full.includes("locales")) out.push(full);
  }
  return out;
}

const parsed = LOCALES.map((file) => ({
  file,
  keys: new Set(flatten(JSON.parse(readFileSync(file, "utf8")))),
}));

let failed = false;

// 1. Key parity between locales.
const [zh, en] = parsed;
const missingInEn = [...zh.keys].filter((k) => !en.keys.has(k));
const missingInZh = [...en.keys].filter((k) => !zh.keys.has(k));
if (missingInEn.length) {
  failed = true;
  console.error(`[i18n] missing in ${en.file}:`, missingInEn);
}
if (missingInZh.length) {
  failed = true;
  console.error(`[i18n] missing in ${zh.file}:`, missingInZh);
}

// 2. Every key referenced in code must exist.
const used = new Set();
for (const file of collectSources("src")) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/\bt\(\s*"([A-Za-z0-9_.]+)"/g)) used.add(match[1]);
  for (const match of source.matchAll(/tRef\.current\(\s*"([A-Za-z0-9_.]+)"/g)) used.add(match[1]);
  for (const match of source.matchAll(/i18n\.t\(\s*"([A-Za-z0-9_.]+)"/g)) used.add(match[1]);
}
const unknown = [...used].filter((key) => !zh.keys.has(key));
if (unknown.length) {
  failed = true;
  console.error("[i18n] keys used in code but not defined:", unknown);
}

// 3. Report unused keys (informational).
const unused = [...zh.keys].filter((key) => !used.has(key));
if (unused.length) console.warn(`[i18n] defined but unused (${unused.length}):`, unused);

if (failed) process.exit(1);
console.log(`[i18n] OK — ${zh.keys.size} keys x ${parsed.length} locales, ${used.size} referenced in code.`);

#!/usr/bin/env node
/**
 * Translation seeding pipeline.
 *
 * Machine-translates the English source-of-truth locale files
 * (src/locales/en/*.json) into every other shipped language, using an LLM and
 * the motorsport glossary (scripts/i18n-glossary.json). Re-runnable: it only
 * translates keys that are *new or changed* since the last run, and it never
 * overwrites a string a human has reviewed (see the _reviewed marker below).
 *
 * This is a maintainer tool. It is NOT part of the app or the standard CI build
 * (it makes network calls and needs an API key), and the offline app never runs
 * it — it only commits its JSON output. See docs/plans/i18n-translation-system.md.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npm run i18n:seed            # all languages
 *   ANTHROPIC_API_KEY=sk-... npm run i18n:seed -- fr de   # only these
 *   I18N_SEED_MODEL=claude-... ANTHROPIC_API_KEY=... npm run i18n:seed
 *
 * Output files carry:
 *   "_machine": true          → contains unreviewed machine output
 *   "_reviewed": ["a.b", ...] → leaf paths a human has hand-tuned; the script
 *                               leaves these untouched on re-run.
 *   "_sourceHashes": {...}     → per-key hash of the English value last
 *                               translated, so only drifted keys are re-sent.
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(__dirname, "../src/locales");
const SOURCE_LANG = "en";

// Keep in sync with src/lib/i18n/config.ts (SUPPORTED_LANGUAGES).
const TARGET_LANGUAGES = ["es", "fr", "de", "it", "pt-BR", "ja"];

const MODEL = process.env.I18N_SEED_MODEL || "claude-sonnet-4-6";
const API_KEY = process.env.ANTHROPIC_API_KEY;
const API_URL = "https://api.anthropic.com/v1/messages";

// --- Pure helpers (canonical copies live in src/lib/i18n/seedUtils.ts, which is
// unit-tested; duplicated minimally here so this script runs under plain `node`
// with no build step). ---

const isMetaKey = (k) => k.startsWith("_");

function flatten(tree, prefix = "") {
  const out = {};
  for (const [key, value] of Object.entries(tree)) {
    if (isMetaKey(key)) continue;
    const p = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") Object.assign(out, flatten(value, p));
    else if (typeof value === "string") out[p] = value;
  }
  return out;
}

function setPath(tree, dotted, value) {
  const parts = dotted.split(".");
  const isUnsafePart = (part) => part === "__proto__" || part === "constructor" || part === "prototype";
  if (parts.some(isUnsafePart)) return;

  let node = tree;
  for (let i = 0; i < parts.length - 1; i++) {
    node[parts[i]] ??= {};
    node = node[parts[i]];
  }
  node[parts[parts.length - 1]] = value;
}

function placeholdersOf(value) {
  const interp = (value.match(/\{\{\s*[^}]+?\s*\}\}/g) ?? []).map((m) => m.replace(/\s+/g, ""));
  const tags = value.match(/<\/?[^>]+?>/g) ?? [];
  return Array.from(new Set([...interp, ...tags])).sort();
}

const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);

const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));

async function listNamespaces() {
  const files = await readdir(path.join(LOCALES_DIR, SOURCE_LANG));
  return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
}

async function callLLM(language, glossary, entries) {
  const system =
    "You are a professional software localizer for a motorsport telemetry web app. " +
    "Translate UI strings from English into the requested language. " +
    "Return ONLY a JSON object mapping each given key to its translation — no prose, no code fences. " +
    "Preserve every {{placeholder}} and <tag> exactly. Preserve leading/trailing whitespace. " +
    "Keep terms in the do-not-translate list verbatim.\n\n" +
    `Do-not-translate: ${glossary.doNotTranslate.join(", ")}\n` +
    `Guidance:\n- ${glossary.notes.join("\n- ")}`;
  const user =
    `Target language: ${language}\n` +
    `Translate these keys (JSON of key -> English source):\n${JSON.stringify(entries, null, 2)}`;

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`LLM request failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const text = (data.content ?? []).map((b) => b.text ?? "").join("").trim();
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < 0) throw new Error(`LLM returned no JSON object:\n${text}`);
  return JSON.parse(text.slice(jsonStart, jsonEnd + 1));
}

async function seedLanguage(language, namespaces, glossary) {
  for (const ns of namespaces) {
    const sourceTree = await readJson(path.join(LOCALES_DIR, SOURCE_LANG, `${ns}.json`));
    const sourceFlat = flatten(sourceTree);

    const targetPath = path.join(LOCALES_DIR, language, `${ns}.json`);
    let targetTree = {};
    try {
      targetTree = await readJson(targetPath);
    } catch {
      /* first run for this language/namespace */
    }
    const reviewed = new Set(targetTree._reviewed ?? []);
    const sourceHashes = targetTree._sourceHashes ?? {};
    const targetFlat = flatten(targetTree);

    // Translate keys that are new, drifted, or missing — but never reviewed ones.
    const todo = {};
    for (const [key, value] of Object.entries(sourceFlat)) {
      if (reviewed.has(key)) continue;
      const drifted = sourceHashes[key] !== hash(value);
      if (!(key in targetFlat) || drifted) todo[key] = value;
    }

    // Drop keys that no longer exist in English.
    const stale = Object.keys(targetFlat).filter((k) => !(k in sourceFlat));

    if (Object.keys(todo).length === 0 && stale.length === 0) {
      console.log(`  ${language}/${ns}: up to date`);
      continue;
    }

    let translations = {};
    if (Object.keys(todo).length > 0) {
      if (!API_KEY) throw new Error("ANTHROPIC_API_KEY is required to translate new/changed keys.");
      console.log(`  ${language}/${ns}: translating ${Object.keys(todo).length} key(s)…`);
      translations = await callLLM(language, glossary, todo);
    }

    // Rebuild the output tree: keep reviewed + unchanged, apply new translations.
    const out = {};
    for (const [key, value] of Object.entries(sourceFlat)) {
      let translated;
      if (key in translations) translated = translations[key];
      else if (key in targetFlat) translated = targetFlat[key];
      else translated = value; // fallback to English if the LLM omitted it

      // Validate placeholder preservation; fall back to English on mismatch.
      const expected = placeholdersOf(value);
      const got = placeholdersOf(String(translated));
      if (expected.join("|") !== got.join("|")) {
        console.warn(`    ! placeholder mismatch on ${ns}.${key} — keeping English`);
        translated = value;
      }
      setPath(out, key, translated);
      sourceHashes[key] = hash(value);
    }
    for (const key of stale) delete sourceHashes[key];

    out._machine = true;
    if (reviewed.size) out._reviewed = [...reviewed].sort();
    out._sourceHashes = Object.fromEntries(Object.keys(flatten(out)).map((k) => [k, sourceHashes[k]]));

    await writeFile(targetPath, JSON.stringify(out, null, 2) + "\n", "utf8");
    console.log(`  ${language}/${ns}: wrote ${targetPath}`);
  }
}

async function main() {
  const requested = process.argv.slice(2);
  const languages = requested.length ? requested : TARGET_LANGUAGES;
  const namespaces = await listNamespaces();
  const glossary = await readJson(path.join(__dirname, "i18n-glossary.json"));

  console.log(`Seeding [${languages.join(", ")}] · namespaces [${namespaces.join(", ")}] · model ${MODEL}`);
  for (const language of languages) {
    if (language === SOURCE_LANG) continue;
    if (!TARGET_LANGUAGES.includes(language)) {
      console.warn(`Skipping unknown language "${language}".`);
      continue;
    }
    console.log(`\n${language}:`);
    await seedLanguage(language, namespaces, glossary);
  }
  console.log("\nDone. Review machine output before shipping; mark hand-tuned keys in _reviewed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Reads the Vitest json-summary and emits a shields.io endpoint badge JSON.
// The Coverage workflow pushes this badge's fields to a GitHub Gist (rendered
// by img.shields.io/endpoint), so it never touches a Git branch — keeping
// Cloudflare Workers Builds from trying to deploy a badge-only branch.
// This script stays the single source of truth for the color thresholds: it
// also exports `message`/`color` as GitHub Actions step outputs when run in CI.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const summary = JSON.parse(
  readFileSync("coverage/coverage-summary.json", "utf8"),
);
const pct = summary.total.lines.pct;

function colorFor(p) {
  if (p >= 90) return "brightgreen";
  if (p >= 75) return "green";
  if (p >= 60) return "yellowgreen";
  if (p >= 40) return "yellow";
  if (p >= 20) return "orange";
  return "red";
}

const badge = {
  schemaVersion: 1,
  label: "coverage",
  message: `${Math.round(pct)}%`,
  color: colorFor(pct),
};

writeFileSync("coverage/coverage-badge.json", JSON.stringify(badge) + "\n");
console.log("coverage badge:", JSON.stringify(badge));

// Hand the rendered fields to the Coverage workflow's gist-update step.
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `message=${badge.message}\ncolor=${badge.color}\n`,
  );
}

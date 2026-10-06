// Plan CI: "the eval code never reads confirmations" (approved metric-table proof; eng T5).
// Recall comes from the hand-adjudicated cohort, so confirmations can't leak into the numbers.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const evalSources = ["scripts/eval.ts", ...readdirSync("eval/lib").filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => `eval/lib/${f}`)];

describe("eval isolation", () => {
  it.each(evalSources)("%s never touches the confirmations table", (file) => {
    // Code only: comments may say what the code doesn't do.
    const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bconfirmations\b/);
  });
});

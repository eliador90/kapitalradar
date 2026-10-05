import { describe, expect, it } from "vitest";
import { mulberry32, seededShuffle } from "./seeded";

describe("seeded", () => {
  it("mulberry32 is stable for a fixed seed", () => {
    const r = mulberry32(1);
    expect([r(), r(), r()]).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
  });

  it("shuffle is a deterministic permutation", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const a = seededShuffle(items, 2613906888);
    expect(a).toEqual(seededShuffle(items, 2613906888));
    expect([...a].sort((x, y) => x - y)).toEqual(items);
    expect(a).not.toEqual(items);
    expect(seededShuffle(items, 2613906889)).not.toEqual(a);
  });
});

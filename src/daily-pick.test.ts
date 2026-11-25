import { expect, test } from "bun:test";
import { pickDaily } from "../site/src/lib/daily-pick";

const POOL = Array.from({ length: 30 }, (_, i) => i);

test("a day always gives the same distinct picks", () => {
  const a = pickDaily(POOL, 20_000, 3);
  expect(pickDaily(POOL, 20_000, 3)).toEqual(a);
  expect(a).toHaveLength(3);
  expect(new Set(a).size).toBe(3);
  expect(a.every((x) => POOL.includes(x))).toBe(true);
});

test("the picks change from one day to the next", () => {
  const days = Array.from({ length: 10 }, (_, i) => pickDaily(POOL, 20_000 + i, 3).join());
  expect(new Set(days).size).toBeGreaterThan(7);
});

test("a small pool is returned whole, an empty one gives nothing, the input is untouched", () => {
  expect(pickDaily([1, 2], 5, 3).sort()).toEqual([1, 2]);
  expect(pickDaily([], 5, 3)).toEqual([]);
  const pool = [1, 2, 3, 4];
  pickDaily(pool, 7, 3);
  expect(pool).toEqual([1, 2, 3, 4]);
});

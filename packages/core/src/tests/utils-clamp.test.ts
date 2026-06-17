import { describe, expect, it } from "vitest";
import { clampNumber } from "../utils/clamp.js";

describe("clampNumber", () => {
  it("returns n when within range", () => {
    expect(clampNumber(5, 0, 10)).toBe(5);
  });

  it("clamps to min when n is below range", () => {
    expect(clampNumber(-3, 0, 10)).toBe(0);
  });

  it("clamps to max when n is above range", () => {
    expect(clampNumber(99, 0, 10)).toBe(10);
  });

  it("returns min when n equals min (lower boundary)", () => {
    expect(clampNumber(0, 0, 10)).toBe(0);
  });

  it("returns max when n equals max (upper boundary)", () => {
    expect(clampNumber(10, 0, 10)).toBe(10);
  });

  it("throws RangeError when min > max", () => {
    expect(() => clampNumber(5, 10, 0)).toThrow(RangeError);
  });
});

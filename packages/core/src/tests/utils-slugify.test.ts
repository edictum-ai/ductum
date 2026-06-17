import { describe, expect, it } from "vitest";
import { slugify } from "../utils/slugify.js";

describe("slugify", () => {
  // Case 1: Lowercase
  it("lowercases input (Hello World → hello-world)", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  // Case 2: Spaces → hyphens
  it("replaces spaces with hyphens (foo bar → foo-bar)", () => {
    expect(slugify("foo bar")).toBe("foo-bar");
  });

  // Case 3: Multiple consecutive spaces collapse to one hyphen
  it("collapses multiple spaces into one hyphen (foo   bar → foo-bar)", () => {
    expect(slugify("foo   bar")).toBe("foo-bar");
  });

  // Case 4: Leading and trailing whitespace stripped
  it("strips leading and trailing whitespace (  hello  → hello)", () => {
    expect(slugify("  hello  ")).toBe("hello");
  });

  // Case 5: Strip non-alphanumeric characters except hyphens
  it("strips punctuation (Hello, World! → hello-world)", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
  });

  // Case 6: Accented characters normalized to ASCII
  it("normalizes accented é to e (café → cafe)", () => {
    expect(slugify("café")).toBe("cafe");
  });

  it("normalizes accented ï to i (naïve → naive)", () => {
    expect(slugify("naïve")).toBe("naive");
  });

  // Case 7: Empty input
  it("returns empty string for empty input", () => {
    expect(slugify("")).toBe("");
  });

  // Case 8: Multiple punctuation collapses cleanly
  it("collapses multiple hyphens from punctuation (foo--bar → foo-bar)", () => {
    expect(slugify("foo--bar")).toBe("foo-bar");
  });
});

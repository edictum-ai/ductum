import { describe, expect, it } from "vitest";
import { parseCsvRow } from "../utils/csv.js";

describe("parseCsvRow", () => {
  it('parses "a,b,c" into three fields', () => {
    expect(parseCsvRow("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it('trims whitespace: "foo, bar, baz"', () => {
    expect(parseCsvRow("foo, bar, baz")).toEqual(["foo", "bar", "baz"]);
  });

  it('returns [""] for empty string', () => {
    expect(parseCsvRow("")).toEqual([""]);
  });

  it('returns ["only"] for single field without comma', () => {
    expect(parseCsvRow("only")).toEqual(["only"]);
  });

  it('preserves empty fields: "a,,c"', () => {
    expect(parseCsvRow("a,,c")).toEqual(["a", "", "c"]);
  });
});

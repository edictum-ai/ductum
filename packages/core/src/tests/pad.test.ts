import { describe, it, expect } from 'vitest';
import { padLeft, padRight } from '../utils/pad.js';

describe('padLeft', () => {
  it('pads "1" to length 4 with "0" → "0001"', () => {
    expect(padLeft('1', 4, '0')).toBe('0001');
  });

  it('returns "abc" unchanged when length is 3', () => {
    expect(padLeft('abc', 3)).toBe('abc');
  });

  it('pads "abc" to length 5 with default space → "  abc"', () => {
    expect(padLeft('abc', 5)).toBe('  abc');
  });

  it('pads empty string to length 3 with "x" → "xxx"', () => {
    expect(padLeft('', 3, 'x')).toBe('xxx');
  });

  it('returns "abcd" unchanged when target length is shorter', () => {
    expect(padLeft('abcd', 2)).toBe('abcd');
  });
});

describe('padRight', () => {
  it('pads "1" to length 4 with "0" → "1000"', () => {
    expect(padRight('1', 4, '0')).toBe('1000');
  });

  it('returns "abc" unchanged when length is 3', () => {
    expect(padRight('abc', 3)).toBe('abc');
  });

  it('pads "abc" to length 5 with default space → "abc  "', () => {
    expect(padRight('abc', 5)).toBe('abc  ');
  });

  it('pads empty string to length 3 with "x" → "xxx"', () => {
    expect(padRight('', 3, 'x')).toBe('xxx');
  });

  it('returns "abcd" unchanged when target length is shorter', () => {
    expect(padRight('abcd', 2)).toBe('abcd');
  });
});

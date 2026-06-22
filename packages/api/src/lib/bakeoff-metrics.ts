export function rate(part: number, total: number): number {
  return total <= 0 ? 0 : Math.round((part / total) * 1000) / 1000
}

export function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

export function roundMoney(value: number): number {
  return Number(value.toFixed(6))
}

export function minDate(values: string[]): string | null {
  return values.length === 0 ? null : values.reduce((min, value) => value < min ? value : min)
}

export function maxDate(values: string[]): string | null {
  return values.length === 0 ? null : values.reduce((max, value) => value > max ? value : max)
}

export function maxNullable(values: Array<number | null>): number | null {
  const numbers = values.filter((value): value is number => value != null)
  return numbers.length === 0 ? null : Math.max(...numbers)
}

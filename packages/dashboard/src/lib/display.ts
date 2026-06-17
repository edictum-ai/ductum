/** First N characters of an ID. Mirrors @ductum/core/display but avoids pulling Node-only deps into the browser bundle. */
export function shortId(id: string, len = 6): string {
  return id.slice(0, len)
}

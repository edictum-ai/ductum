/**
 * Convert a string to a URL slug.
 *
 * - Lowercases the input
 * - Normalizes accented characters to ASCII (e.g. café → cafe)
 * - Replaces spaces and non-alphanumeric characters (except hyphens) with hyphens
 * - Collapses consecutive hyphens into one
 * - Strips leading/trailing hyphens
 */
export function slugify(s: string): string {
  return (
    s
      // Normalize accented / composed characters to base + combining marks
      .normalize("NFD")
      // Strip combining diacritical marks
      .replace(/[\u0300-\u036f]/g, "")
      // Lowercase
      .toLowerCase()
      // Replace any non-alphanumeric (except hyphen) with hyphen
      .replace(/[^a-z0-9-]/g, "-")
      // Collapse multiple consecutive hyphens into one
      .replace(/-+/g, "-")
      // Strip leading/trailing hyphens
      .replace(/^-+|-+$/g, "")
  );
}

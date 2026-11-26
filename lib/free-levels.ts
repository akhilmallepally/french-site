// Which levels are free. Its own module, with no imports, so client code and the review server
// actions can use it without lib/lessons.ts (which reads the content folder from disk).

/**
 * Free levels are readable without signing in. Everything else, including any level added
 * later, needs a Google sign-in (default deny). Accepts "A1" or the URL slug "a1".
 */
const FREE_LEVELS: readonly string[] = ["a1", "a2"];
export function isFreeLevel(level: string): boolean {
  return FREE_LEVELS.includes(String(level).toLowerCase());
}

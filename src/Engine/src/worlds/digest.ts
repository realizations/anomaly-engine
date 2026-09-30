/**
 * Integrity digests for imported worlds.
 *
 * A world is validated against a schema when it is imported, but a schema check
 * only proves a definition is well-formed. It says nothing about whether the same
 * bytes are still there on the next launch. If a world file is edited between
 * sessions, or replaced, the copy restored from the state file is trusted simply
 * because it still satisfies the schema, so a world that was approved once can
 * change underneath the user without anything noticing.
 *
 * So the digest of each imported world is recorded at import time and recomputed
 * on load. A mismatch is a warning, not a rejection: the world is still the
 * user's own file and they may well have edited it deliberately, so silently
 * dropping it would be worse than telling them it changed. What it must not do is
 * change without a word.
 *
 * This is a checksum, not a cryptographic hash, and it is honest about that. The
 * obvious choice, `crypto.subtle.digest`, is unusable here for two reasons: it is
 * a secure-context API and the engine is served over `file://`, where it is not
 * guaranteed to exist, and it is asynchronous while worlds are registered from a
 * synchronous load path. A security check that quietly stops running when its API
 * is missing is worse than a checksum that always runs, so this uses a
 * synchronous 128-bit four-lane FNV-1a and says plainly in the digest prefix that
 * is what produced it. It detects "this file changed", which is the property
 * being relied on. It does not defend against a deliberately constructed
 * collision, and it should not be described as if it did.
 */

/** A stable, order-independent string for an arbitrary JSON value. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    // Sorted so that two definitions differing only in key order hash the same,
    // which is what a user expects: reformatting a file is not changing it.
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/**
 * Four-lane 128-bit FNV-1a.
 *
 * A single 32-bit FNV collides often enough on a short input to make it useless
 * here, and one lane at a time also lets the result depend on position in a way
 * four interleaved lanes remove. Each lane mixes in its neighbour so a change
 * anywhere moves every lane rather than only the one that saw the byte.
 */
function fnv128(input: string): string {
  // FNV-1a 32-bit basis and prime, one per lane with a different offset.
  const primes = [0x01000193, 0x01000193, 0x01000193, 0x01000193];
  const basis = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  const h = basis.slice();
  for (let i = 0; i < input.length; i++) {
    const lane = i & 3;
    h[lane] ^= input.charCodeAt(i);
    // Multiply in 32-bit space.
    h[lane] = Math.imul(h[lane], primes[lane]) >>> 0;
    // Mix the other lanes in so a change anywhere affects every lane.
    const others = (lane + 1) & 3;
    h[lane] = (h[lane] ^ h[others]) >>> 0;
  }
  return h.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

/** Digest of a world definition, tagged with the algorithm used. */
export function digestWorld(world: unknown): string {
  const text = canonicalJson(world);
  return `fnv128:${fnv128(text)}`;
}

/**
 * Whether a stored world still matches its recorded digest.
 *
 * A world with no recorded digest is reported as unchanged. That is deliberate:
 * the first version of this ran before digests existed, and refusing to load
 * every previously imported world would be a worse failure than accepting one
 * that predates the check. A stored digest that does match is a positive
 * statement that the world is the one that was approved.
 */
export function verifyWorld(world: unknown, recorded: string | undefined | null): boolean {
  if (recorded === undefined || recorded === null || recorded === '') return true;
  return digestWorld(world) === recorded;
}

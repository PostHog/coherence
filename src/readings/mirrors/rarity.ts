/**
 * Rarity: how much a written value says, in bits, so a restatement is judged
 * by what its copies share rather than by how long it is. A value is cut into
 * tokens (identifiers and words, runs of digits, single marks), and each
 * token carries its surprisal, -log2 p(token), under a background of the
 * project's own code (every identifier and every string it writes, tests
 * aside) together with a prior: the identifiers TypeScript's own library
 * typings use. `"id"` or `"type"` is common in both and says almost nothing;
 * `PostInvocation` or `.mts` is rare in both and says a great deal.
 *
 * A group of copies is weighed by the summed bits of what its sites share:
 * the one value a literal restatement writes, the members two sets share,
 * the literal atoms two predicates are made of. One threshold, RARITY_MIN,
 * replaces the fixed lengths the reading used to cut at (a string of 16
 * characters or more), so a short rare value counts and a long common word
 * never did anything to earn its place.
 *
 * Pure: the counts are handed in; mirrors.ts gathers them from the parse it
 * already makes and from the compiler's library files.
 */

/** A group of copies shares at least this many bits, about one chance in sixteen million under the background. */
export const RARITY_MIN = 18;

/** A mark (a dot, a dash, a bracket) says little wherever it is: its cost is fixed rather than counted. */
const MARK_BITS = 2;
/** A run of digits: a number written in a value, cheap on its own. */
const DIGITS_BITS = 3;
/** Laplace's smoothing, so a token neither background holds is rare, never infinitely so. */
const SMOOTHING = 0.5;

const TOKEN = /\$?[A-Za-z_][\w$]*|\d+|\S/g;
const WORD = /^\$?[A-Za-z_]/;

/** The tokens a value is made of: identifiers and words whole (camelCase is one token, as code names it), digits, and each mark. */
export function tokensOf(value: string): string[] {
  return value.match(TOKEN) ?? [];
}

/** Every identifier or word in a text: what the backgrounds count. */
export function wordsOf(text: string): string[] {
  return (text.match(TOKEN) ?? []).filter((t) => WORD.test(t));
}

/** Token counts: the project's, or the prior's. */
export class Counts {
  readonly counts = new Map<string, number>();
  total = 0;

  add(token: string, n = 1): void {
    this.counts.set(token, (this.counts.get(token) ?? 0) + n);
    this.total += n;
  }

  addText(text: string): void {
    for (const w of wordsOf(text)) this.add(w);
  }

  get(token: string): number {
    return this.counts.get(token) ?? 0;
  }
}

/** The surprisal of tokens and values under the project's counts and the prior together. */
export class Rarity {
  private readonly denominator: number;
  private readonly cache = new Map<string, number>();
  private readonly project: Counts;
  private readonly prior: Counts;

  constructor(project: Counts, prior: Counts) {
    this.project = project;
    this.prior = prior;
    const unique = new Set([...project.counts.keys(), ...prior.counts.keys()]).size;
    this.denominator = project.total + prior.total + SMOOTHING * Math.max(unique, 1);
  }

  /** One token's bits. */
  token(token: string): number {
    if (!WORD.test(token)) return /^\d/.test(token) ? DIGITS_BITS : MARK_BITS;
    let bits = this.cache.get(token);
    if (bits === undefined) {
      bits = -Math.log2((this.project.get(token) + this.prior.get(token) + SMOOTHING) / this.denominator);
      this.cache.set(token, bits);
    }
    return bits;
  }

  /** A value's bits: the sum over its tokens. */
  value(value: string): number {
    let bits = 0;
    for (const t of tokensOf(value)) bits += this.token(t);
    return bits;
  }

  /** What several values say together: the sum of each one's bits. */
  shared(values: readonly string[]): number {
    let bits = 0;
    for (const v of values) bits += this.value(v);
    return bits;
  }
}

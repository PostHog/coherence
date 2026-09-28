/**
 * Two instruments in one project: a dbt project whose orchestration and
 * engines are Python, say. The composite asks each member adapter to
 * resolve a spec name, and the one that answers owns the definition from
 * then on: its references, its visibility, and its refutation all come from
 * that member. A name more than one member resolves is ambiguous, with every
 * answer listed, never a silent pick. The composite is ready only when every
 * member is, because a check it cannot route is a check it cannot run.
 */

import type { ChokedGrade, Definition, Ladder, LanguageAdapter, ReferenceSite, Refutation, Resolved, ResolveHint, Rung, Visibility } from "./adapter.ts";

const STRENGTH: readonly ChokedGrade[] = ["closure-choked", "visibility-choked", "checker-choked", "reference-choked", "convention"];

/** Every member's rungs, strongest first, one per grade; the top is the strongest any member reaches. */
function mergedLadder(members: readonly LanguageAdapter[]): Ladder {
  const rungs = new Map<ChokedGrade, Rung>();
  for (const member of members) for (const rung of member.ladder.rungs ?? []) if (!rungs.has(rung.grade)) rungs.set(rung.grade, rung);
  const whenVacuous = members.map((m) => m.ladder.whenVacuous).find((g) => g !== undefined);
  return {
    top: members.some((m) => m.ladder.top === "visibility-choked") ? "visibility-choked" : "reference-choked",
    because: members.map((m) => `${m.language}: ${m.ladder.because}`).join("; "),
    rungs: STRENGTH.flatMap((grade) => (rungs.has(grade) ? [rungs.get(grade)!] : [])),
    ...(whenVacuous === undefined ? {} : { whenVacuous }),
  };
}

function keyOf(definition: Definition): string {
  return `${definition.kind}\0${definition.file}\0${definition.name}`;
}

export class CompositeAdapter implements LanguageAdapter {
  readonly language: string;
  readonly ladder: Ladder;
  private readonly members: readonly LanguageAdapter[];
  private readonly owners = new Map<string, LanguageAdapter>();

  constructor(members: readonly LanguageAdapter[]) {
    if (members.length === 0) throw new Error("a composite adapter needs at least one member");
    this.members = members;
    this.language = members.map((m) => m.language).join("+");
    this.ladder = mergedLadder(members);
  }

  async ready(): Promise<{ ok: true } | { ok: false; reason: string }> {
    const states = await Promise.all(this.members.map(async (m) => ({ language: m.language, state: await m.ready() })));
    const down = states.flatMap(({ language, state }) => (state.ok ? [] : [`${language}: ${state.reason}`]));
    return down.length === 0 ? { ok: true } : { ok: false, reason: down.join("; ") };
  }

  async resolve(name: string, hint: ResolveHint): Promise<Resolved> {
    const answers: { member: LanguageAdapter; resolved: Resolved }[] = [];
    for (const member of this.members) {
      let resolved: Resolved;
      try {
        resolved = await member.resolve(name, hint);
      } catch (error) {
        resolved = { ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
      answers.push({ member, resolved });
    }
    const found = answers.filter((a): a is { member: LanguageAdapter; resolved: { ok: true; definition: Definition } } => a.resolved.ok);
    if (found.length === 1) {
      const { member, resolved } = found[0]!;
      this.owners.set(keyOf(resolved.definition), member);
      return resolved;
    }
    if (found.length > 1) {
      return { ok: false, reason: `resolves through ${found.length} instruments (${found.map((f) => f.member.language).join(", ")})`, candidates: found.map((f) => `${f.member.language}: ${f.resolved.definition.file}`) };
    }
    return { ok: false, reason: answers.map((a) => `${a.member.language}: ${a.resolved.ok ? "" : a.resolved.reason}`).join("; ") };
  }

  /** The member that resolved the definition; a definition this composite never resolved has no owner and no answer. */
  private owner(definition: Definition): LanguageAdapter {
    const member = this.owners.get(keyOf(definition));
    if (member === undefined) throw new Error(`no instrument resolved ${definition.name} (${definition.file}) in this composite`);
    return member;
  }

  async references(definition: Definition): Promise<ReferenceSite[]> {
    return this.owner(definition).references(definition);
  }

  async visibility(definition: Definition, chokepoint?: Definition): Promise<Visibility> {
    return this.owner(definition).visibility(definition, chokepoint);
  }

  /** The first member's filter: the run routes each via to its runner before it asks. */
  testFilter(via: string): string {
    return this.members[0]!.testFilter(via);
  }

  async refute(protectedThing: Definition, outsideOf: Definition | undefined): Promise<Refutation> {
    return this.owner(protectedThing).refute(protectedThing, outsideOf);
  }

  async forget(files?: readonly string[]): Promise<void> {
    await Promise.all(this.members.map((m) => m.forget(files)));
  }

  async close(): Promise<void> {
    await Promise.all(this.members.map((m) => m.close()));
  }

  serverPid(): number | undefined {
    for (const member of this.members) {
      const pid = member.serverPid?.();
      if (pid !== undefined) return pid;
    }
    return undefined;
  }
}

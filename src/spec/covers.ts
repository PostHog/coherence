/**
 * Which entrances an invariant covers: the ones its entrances: line names,
 * and no other. A crossing says which trust an invariant checks, never where
 * that trust enters, so an invariant enforced by a test alone is credited as
 * a control on an entrance only when it names that entrance. Before the
 * line existed, such an invariant counted on every entrance its component
 * declared or handled whose trust its crossing matched (PR #4), so one
 * signature check stood for a crawler file and a sign-in route alike; the
 * entrances that lost that credit are named where the agent reads them
 * (creditedByCrossingAlone), never dropped in silence.
 *
 * Pure, with no Node import: the spec model, the Structure map and the
 * browser bundle all read it.
 */

/** A declared entrance, by the folder of the component whose spec declares it and its name. */
export interface NamedEntrance {
  component: string;
  name: string;
}

interface Declaring {
  folder: string;
  entrances: readonly { name: string }[];
}

interface Naming {
  component: string;
  crossing?: { from: string; to: string } | undefined;
  enforcements: readonly { form: string }[];
  entrances?: { names: readonly string[] | "none" } | undefined;
}

/** The qualified form, for a name more than one spec declares: `<name> in <folder>`. */
const QUALIFIED = /^(.+?)\s+in\s+(\S+)$/;

/**
 * One name from an entrances: line written in `component`'s spec, resolved:
 * an entrance its own spec declares, else the one entrance of that name
 * another spec declares, else `<name> in <folder>`; or why it names none.
 */
export function resolveCovered(name: string, component: string, components: readonly Declaring[]): { entrance: NamedEntrance } | { problem: string } {
  if (components.some((c) => c.folder === component && c.entrances.some((e) => e.name === name))) return { entrance: { component, name } };
  const elsewhere = components.filter((c) => c.entrances.some((e) => e.name === name));
  if (elsewhere.length === 1) return { entrance: { component: elsewhere[0]!.folder, name } };
  if (elsewhere.length > 1) return { problem: `${name} is declared in ${elsewhere.map((c) => c.folder).join(" and ")}; name it as ${name} in <folder>` };
  const qualified = QUALIFIED.exec(name);
  if (qualified !== null && components.some((c) => c.folder === qualified[2] && c.entrances.some((e) => e.name === qualified[1]))) return { entrance: { component: qualified[2]!, name: qualified[1]! } };
  return { problem: `no spec declares an entrance named ${name}` };
}

/** The entrances an invariant names as covered and that resolve; none when it names none or says none. */
export function coveredEntrances(invariant: Naming, components: readonly Declaring[]): NamedEntrance[] {
  const names = invariant.entrances?.names;
  if (names === undefined || names === "none") return [];
  return names.flatMap((name) => {
    const resolved = resolveCovered(name, invariant.component, components);
    return "entrance" in resolved ? [resolved.entrance] : [];
  });
}

/** Whether an invariant names this entrance among those it covers. */
export function namesEntrance(invariant: Naming, entrance: NamedEntrance, components: readonly Declaring[]): boolean {
  return coveredEntrances(invariant, components).some((e) => e.component === entrance.component && e.name === entrance.name);
}

/** Whether a crossing checks what a trust sends: it enters from a level the trust holds, or enters one. */
export function crossingChecksTrust(crossing: { from: string; to: string } | undefined, trust: readonly string[]): boolean {
  return crossing !== undefined && (trust.includes(crossing.from) || trust.includes(crossing.to));
}

/**
 * Whether an invariant was credited to an entrance by its crossing alone, the
 * rule before entrances: (PR #4), and is no longer: enforced by a
 * totality oracle alone, with no entrances: line, owned by a component that
 * declares or handles the entrance (`owners`), its crossing checking the
 * entrance's trust. The caller decides whether it was verified, which the credit also
 * needed.
 */
export function creditedByCrossingAlone(invariant: Naming, owners: readonly string[], trust: readonly string[]): boolean {
  if (invariant.entrances !== undefined || !owners.includes(invariant.component)) return false;
  if (invariant.enforcements.some((e) => e.form === "chokepoint") || !invariant.enforcements.some((e) => e.form === "totality oracle")) return false;
  return crossingChecksTrust(invariant.crossing, trust);
}

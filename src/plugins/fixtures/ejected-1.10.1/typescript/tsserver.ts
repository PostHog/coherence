/**
 * Which tsserver the TypeScript language server drives, and the one line a
 * session start says when it is not the project's own: the project's
 * typescript/lib/tsserver.js while it ships one (TypeScript below 7), else
 * Coherence's own. Packages are found through installed.ts, by the resolver.
 */

import { COHERENCE_FROM, installedPackage, packageFile, projectFrom } from "@posthog/coherence/plugin";

/** The first number of a version. */
function major(version: string): number {
  return Number.parseInt(version, 10);
}

/** The tsserver the TypeScript language server drives, whose it is, and, when it is Coherence's, the project's TypeScript it stands in for. */
export interface TsserverChoice {
  path: string;
  version: string;
  whose: "project" | "coherence";
  /** The project's own TypeScript when it is installed but ships no tsserver (TypeScript 7 and later). */
  passedOver: string | undefined;
}

/**
 * The tsserver to drive: the project's own typescript/lib/tsserver.js when
 * that file exists and is a tsserver (TypeScript below 7: from 7 the language
 * service is native and ships none), otherwise Coherence's own, resolved from
 * its module; undefined when neither holds one.
 */
export function locateTsserver(root: string, coherenceFrom: string = COHERENCE_FROM): TsserverChoice | undefined {
  const project = installedPackage("typescript", projectFrom(root));
  const own = project === undefined ? undefined : packageFile(project, "lib/tsserver.js");
  if (project !== undefined && own !== undefined && major(project.version) < 7) return { path: own, version: project.version, whose: "project", passedOver: undefined };
  const passedOver = project === undefined ? undefined : project.version;
  const coherence = installedPackage("typescript", coherenceFrom);
  const theirs = coherence === undefined ? undefined : packageFile(coherence, "lib/tsserver.js");
  if (coherence !== undefined && theirs !== undefined && major(coherence.version) < 7) return { path: theirs, version: coherence.version, whose: "coherence", passedOver };
  return undefined;
}

/**
 * The line an agent reads when the project's TypeScript ships no tsserver and
 * Coherence reads with its own; empty otherwise.
 */
export function tsserverNotice(root: string, coherenceFrom: string = COHERENCE_FROM): string {
  const project = installedPackage("typescript", projectFrom(root));
  if (project === undefined || major(project.version) < 7) return "";
  const choice = locateTsserver(root, coherenceFrom);
  if (choice === undefined) return `TypeScript: this project's TypeScript ${project.version} ships no tsserver and Coherence has no TypeScript of its own installed, so no TypeScript reading can be made; install Coherence with its optional dependencies (its typescript is one).`;
  return `TypeScript: this project's TypeScript ${project.version} ships no tsserver, so Coherence is using its own TypeScript ${choice.version} for readings (references, symbols and the compiler's refusals).`;
}

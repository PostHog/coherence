/**
 * The plugin interface as a plugin imports it: `@posthog/coherence/plugin`.
 * Every name of Coherence's a plugin's code may use is exported here, and a
 * plugin uses no other: the bundled plugins import the core only through this
 * module (a structural test holds them to it), so a plugin ejected into a
 * project (coherence plugin eject) reads from the installed package exactly
 * what it read bundled. A name a plugin needs that is not here is exported
 * here, never reached for in the core's own modules.
 *
 * The core never imports this module: it would load every helper below into
 * every hook.
 */

export * from "./plugin.ts";
export {
  isTestPath,
  outsideOfFolder,
  parseName,
  rangeContains,
  statementStartLine,
  withinFolder,
  type AdapterBounds,
  type CheckerBoundary,
  type Definition,
  type Ladder,
  type LanguageAdapter,
  type Position,
  type Range,
  type ReferenceSite,
  type Refutation,
  type ResolveHint,
  type Resolved,
  type Rung,
  type SiteForm,
  type StagedSite,
  type Visibility,
} from "../adapters/adapter.ts";
export { declaredInstrument, declaredLanguageOf, type DeclaredLanguage } from "../adapters/declared-config.ts";
export { escape, handlerName, lineOf, NEXT_ROUTE_METHODS, REMIX_ROUTE_EXPORTS, spanOf, throughOf, type EntranceCandidate, type EntranceSyntax } from "../adapters/entrance-candidates.ts";
export { COHERENCE_FROM, installedPackage, locateServer, packageFile, projectFrom, type ServerLocation } from "../adapters/installed.ts";
export { JsonRpcClient, RpcError } from "../adapters/jsonrpc.ts";
export { languageOfFile } from "../adapters/language-files.ts";
export { fileIdentity, horizonFolders, keepHorizonFiles, keepProjectFiles, nestedCheckouts, nestedFolder, neverWalkedName, projectListing, repositoryTop, walkBounds, walkedProjectFiles, type ProjectListing } from "../adapters/project-files.ts";
// TOML's line lookup is exported under its own name: entrance detection has a lineOf of its own.
export { lineOf as tomlLineOf, parseToml, TomlError, type TomlTable, type TomlValue } from "../adapters/toml.ts";
export { isSourceFile, toRelative, type SourceSyntax } from "../economy/source.ts";
export { spawnSync } from "../lifecycle/work-meter.ts";
export { typescriptCompiler } from "./specifiers.ts";
export type { InterfaceSymbol } from "../observation/interfaces.ts";
export type { InterfaceSyntax } from "../readings/scope/component-interfaces.ts";
export { readOwners, type BoundaryModule, type BoundarySource, type Exposure } from "../scaffold/boundaries.ts";
export { ScaffoldError } from "../scaffold/scaffold.ts";

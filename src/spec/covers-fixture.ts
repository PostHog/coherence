/**
 * An adopter's shape for which entrances an invariant covers (covers.ts),
 * cut down from praetorium.gg's specs (richardsolomou/praetorium.gg#832):
 * public routes in src/routes, a link-preview child component, and a server
 * function declared among the routes whose handler lies in src/server. The
 * signature check on Apple's notifications is a totality oracle whose
 * crossing (visitor -> account store) matches every visitor entrance; only
 * the notification route is what its test checks. src/server holds a
 * test-backed invariant of its own that names no entrance.
 *
 * Files only: a test writes them into a folder of its own and removes it.
 */

/** The entrance the signature check covers, as its entrances: line names it. */
export const APPLE = "route api/apple-notifications";

/** The fixture's files by project-relative path. `named` false writes the signature check as the adopter had it, with no entrances: line. */
export function adopterFiles(options: { named?: boolean; entrances?: string } = {}): Record<string, string> {
  const entrances = options.entrances ?? (options.named === false ? undefined : APPLE);
  return {
    "coherence.config.json": JSON.stringify({ name: "praetorium", entryDir: ".", language: "typescript" }),
    "Praetorium.spec.md": [
      "# Praetorium",
      "",
      "A list builder and battle tracker.",
      "",
      "## trust levels",
      "- visitor (outside): what anyone on the web sends, signed in or not",
      "- player: a signed-in player's own requests",
      "- account store: the accounts, sessions and linked providers",
      "",
      "## invariants",
      "",
    ].join("\n"),
    "src/routes/Routes.spec.md": [
      "# Routes",
      "",
      "The server routes that answer outside callers directly.",
      "",
      "## entrances",
      `- ${APPLE}: Apple posts a signed account event, and a verified deletion removes the linked account`,
      "  handler: Route in src/routes/api/apple-notifications.ts",
      "  trust: visitor",
      "- route api/auth.$: a browser or native shell signs in through Better Auth",
      "  handler: Route in src/routes/api/auth.$.ts",
      "  trust: visitor",
      "- route robots[.]txt: a crawler reads which paths it may index",
      "  handler: Route in src/routes/robots[.]txt.ts",
      "  trust: visitor",
      "- server fn listRosters: a browser lists a player's rosters through a server function",
      "  handler: listRosters in src/server/rosters.ts",
      "  trust: visitor",
      "",
      "## invariants",
      "- signed apple notifications: An Apple account notification changes an account only when its payload verifies against Apple's signing key for this app.",
      "  over: the notification payloads appleNotificationResponse receives, signed by the expected key and by an unrelated one",
      "  via: rejects unsigned notifications and acknowledges email relay changes",
      "  because: the endpoint is public and a verified account-delete event deletes the player's account; an unsigned or foreign payload must change nothing",
      "  crossing: visitor -> account store",
      ...(entrances === undefined ? [] : [`  entrances: ${entrances}`]),
      "  kinds: none",
      "",
    ].join("\n"),
    "src/routes/api/previews/LinkPreviews.spec.md": [
      "# Link previews",
      "",
      "The preview images link unfurlers fetch.",
      "",
      "## entrances",
      "- route api/previews/battles.$token: a link unfurler reads a battle's preview card as a signed-out spectator",
      "  handler: Route in battles.$token.ts",
      "  trust: visitor",
      "",
      "## invariants",
      "",
    ].join("\n"),
    "src/server/Server.spec.md": [
      "# Server",
      "",
      "Server functions and the account session they read.",
      "",
      "## invariants",
      "- session-scoped rosters: A roster read returns only rosters the session's player owns.",
      "  over: the rosters listRosters returns for two players' sessions",
      "  via: lists only the session player's rosters",
      "  because: a roster id in a request must not reveal another player's list",
      "  crossing: visitor -> account store",
      "  kinds: none",
      "",
    ].join("\n"),
    "src/routes/api/apple-notifications.ts": "export const Route = { post: (): number => 200 };\n",
    "src/routes/api/auth.$.ts": "export const Route = { get: (): number => 200 };\n",
    "src/routes/robots[.]txt.ts": "export const Route = { get: (): string => \"User-agent: *\" };\n",
    "src/routes/api/previews/battles.$token.ts": "export const Route = { get: (): string => \"card\" };\n",
    "src/server/rosters.ts": "export function listRosters(): string[] {\n  return [];\n}\n",
  };
}

/** The entrances the reading would resolve, by component and name, with their handler files. */
export const ADOPTER_ENTRANCES = [
  { component: "src/routes", name: APPLE, file: "src/routes/api/apple-notifications.ts" },
  { component: "src/routes", name: "route api/auth.$", file: "src/routes/api/auth.$.ts" },
  { component: "src/routes", name: "route robots[.]txt", file: "src/routes/robots[.]txt.ts" },
  { component: "src/routes", name: "server fn listRosters", file: "src/server/rosters.ts" },
  { component: "src/routes/api/previews", name: "route api/previews/battles.$token", file: "src/routes/api/previews/battles.$token.ts" },
];

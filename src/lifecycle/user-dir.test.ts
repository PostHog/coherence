import assert from "node:assert/strict";
import { isAbsolute, join } from "node:path";
import { test } from "node:test";
import { userConfigDir } from "./user-dir.ts";

test("Coherence's folder in the user's configuration is always an absolute path: XDG_CONFIG_HOME where it is absolute, else ~/.config under a home that is absolute, HOME's, the account's or Node's, else one in the temporary folder, so the machine key never lands in whatever folder a process starts in", () => {
  assert.equal(userConfigDir({ XDG_CONFIG_HOME: "/xdg", HOME: "/home/u" }), join("/xdg", "coherence"));
  for (const relative of ["", "config", "./config", "../elsewhere"]) assert.equal(userConfigDir({ XDG_CONFIG_HOME: relative, HOME: "/home/u" }), join("/home/u", ".config", "coherence"), `XDG_CONFIG_HOME=${JSON.stringify(relative)} is ignored`);
  assert.equal(userConfigDir({ HOME: "/home/u" }), join("/home/u", ".config", "coherence"));
  // A HOME that is empty, relative or missing is no home: the folder is still an absolute path, never one under the current folder.
  for (const home of ["", "rel", "./rel", undefined]) {
    const dir = userConfigDir({ HOME: home, XDG_CONFIG_HOME: "config" });
    assert.ok(isAbsolute(dir) && dir.endsWith(join(".config", "coherence")), `HOME=${JSON.stringify(home)}: ${dir} is absolute`);
  }
  // No account entry and no home Node can find (a container's bare uid): still absolute, never a throw.
  const none = { account: (): string => { throw new Error("ENOENT uv_os_get_passwd"); }, home: (): string => { throw new Error("ENOENT uv_os_homedir"); } };
  const bare = userConfigDir({ HOME: "rel" }, none);
  assert.ok(isAbsolute(bare), `with no home anywhere: ${bare} is absolute`);
  assert.equal(userConfigDir({ HOME: "rel" }, { account: () => "/acct", home: () => "/node" }), join("/acct", ".config", "coherence"), "the account's home before Node's");
});

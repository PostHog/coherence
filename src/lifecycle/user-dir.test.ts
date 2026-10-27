import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { userConfigDir } from "./user-dir.ts";

test("Coherence's folder in the user's configuration is always an absolute path: XDG_CONFIG_HOME where it is absolute, else ~/.config, so the machine key never lands in whatever folder a process starts in", () => {
  assert.equal(userConfigDir({ XDG_CONFIG_HOME: "/xdg", HOME: "/home/u" }), join("/xdg", "coherence"));
  for (const relative of ["", "config", "./config", "../elsewhere"]) assert.equal(userConfigDir({ XDG_CONFIG_HOME: relative, HOME: "/home/u" }), join("/home/u", ".config", "coherence"), `XDG_CONFIG_HOME=${JSON.stringify(relative)} is ignored`);
  assert.equal(userConfigDir({ HOME: "/home/u" }), join("/home/u", ".config", "coherence"));
});

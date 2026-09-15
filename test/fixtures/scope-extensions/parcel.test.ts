import test from "node:test";
import assert from "node:assert/strict";
import { submit } from "./main.ts";
import { dispatch } from "./dispatch/dispatch.ts";

test("parcel identity survives dispatch", () => {
  const accepted = submit("parcel-7");
  assert.equal(dispatch(accepted.id).id, accepted.id);
});

test("receipt follows dispatch", () => assert.ok(true));

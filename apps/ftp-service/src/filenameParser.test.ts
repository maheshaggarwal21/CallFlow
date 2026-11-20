import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFilename } from "./filenameParser";

test("line = the client's own line between the dashes, else the PBX line", () => {
  for (const [f, line, phone] of [
    ["03--B-09465658112---20261119165643-Unknown.wav", "03", "09465658112"],   // old shape: PBX line
    ["04-04-B-09666727211---20261120133619-Unknown.wav", "04", "09666727211"], // office 1
    ["01-05-B-09465658112---20261120144739-Unknown.wav", "05", "09465658112"], // office 2: PBX 01 = his line 05
    ["04-08-A-09465658112---20261119165643-Unknown.wav", "08", "09465658112"],
    ["02-10-B-09465658112---20261119165643-Unknown.wav", "10", "09465658112"],
    ["03-03-B----20261120133731-Unknown.wav", "03", "Unknown"],
  ]) {
    const p = parseFilename(f);
    assert.ok(p, f);
    assert.equal(p.lineNumber, line, f);
    assert.equal(p.callerPhone, phone, f);
  }
  assert.equal(parseFilename("04-04-B-09666727211---20261120133619-Unknown.wav")!.calledAt.toISOString(), "2026-11-20T08:06:19.000Z");
  assert.equal(parseFilename("04-08-A-1---20261119165643-Unknown.wav")!.direction, "inbound");
  assert.equal(parseFilename("garbage.wav"), null);
});

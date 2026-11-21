import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, officeOfFile } from "./uploadWatch";

const M = 60_000;
const start = Date.parse("2026-11-21T09:00:00+05:30");
const at = (hhmm: string) => Date.parse(`2026-11-21T${hhmm}:00+05:30`);

test("21 Nov replay: Office 2 quiet after 09:44 while Office 1 calls → one alert at 10:04, back at 15:36", () => {
  assert.deepEqual(decide(at("10:03"), start, at("10:02"), at("09:44"), {}), []);
  assert.deepEqual(decide(at("10:04"), start, at("10:02"), at("09:44"), {}), [{ kind: "silent", who: "2", since: at("09:44") }]);
  assert.deepEqual(decide(at("12:00"), start, at("11:59"), at("09:44"), { "2": true }), []); // no repeat
  assert.deepEqual(decide(at("15:37"), start, at("15:35"), at("15:36"), { "2": true }), [{ kind: "back", who: "2", since: at("15:36") }]);
});

test("lunch or a holiday (both offices quiet) is not an office alert; 30 min of nothing is the 'both' alert", () => {
  assert.deepEqual(decide(at("13:25"), start, at("13:00"), at("13:01"), {}), []);
  assert.deepEqual(decide(at("13:31"), start, at("13:00"), at("13:01"), {}), [{ kind: "silent", who: "both", since: at("13:01") }]);
  assert.deepEqual(decide(at("13:40"), start, at("13:39"), at("13:01"), { both: true }), [{ kind: "back", who: "both", since: at("13:39") }]);
});

test("the night doesn't count: quiet time starts at 09:00", () => {
  // Office 2's last upload was yesterday; Office 1 busy since 09:05
  assert.deepEqual(decide(at("09:19"), start, at("09:18"), at("08:00") - 13 * 60 * M, {}), []);
  assert.deepEqual(decide(at("09:20"), start, at("09:18"), null, {}), [{ kind: "silent", who: "2", since: start }]);
  assert.deepEqual(decide(at("09:29"), start, null, null, {}), []);
});

test("a file's office: the own line between the dashes, else the PBX line", () => {
  assert.equal(officeOfFile("202611/20261121/03-07-B-09465658112---20261121153539-Unknown.wav"), 2);
  assert.equal(officeOfFile("01-05-A-0919465658112---20261120145515-Unknown.wav"), 2);
  assert.equal(officeOfFile("04-08-B----20261121154434-Unknown.wav"), 2);
  assert.equal(officeOfFile("04-04-B-09666727211---20261120133619-Unknown.wav"), 1);
  assert.equal(officeOfFile("03--B-09465658112---20261119165643-Unknown.wav"), 1);
});

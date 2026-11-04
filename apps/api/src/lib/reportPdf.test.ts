// Run: npm run build && node --test dist/lib/reportPdf.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { findChrome, htmlToPdf, reportHtml, type PdfPerson } from "./reportPdf";

const person = (name: string, calls: number, hourAt = 14): PdfPerson => ({
  name, code: "1001", line: "01", calls, inb: Math.floor(calls / 10), out: calls - Math.floor(calls / 10),
  dur: calls * 45, avg: calls ? 45 : 0, lt10: Math.floor(calls / 20), gapMin: calls ? 3 : null, gapMax: calls ? 900 : null,
  invalid: Math.floor(calls / 12), len: [[0, 1], [0, calls - 1], [0, 0], [0, 0]],
  b: [Math.floor(calls / 2), calls - Math.floor(calls / 2), 0, 0, 0, 0, 0, 0],
  hours: Array.from({ length: 24 }, (_, h) => (h === hourAt ? calls : 0)),
});
const pages = (html: string) => (html.match(/<section class="pg/g) ?? []).length;
const clean = (html: string) => assert.ok(!/NaN|undefined|Infinity/.test(html), "no broken numbers");

test("overview + team + one page per active person; idle people listed, not paged", () => {
  const html = reportHtml({ title: "Daily Call Report", period: "03 Nov 2026", people: [person("A B", 300), person("C D", 150), person("Idle One", 0)] });
  assert.equal(pages(html), 4);
  assert.match(html, /No calls: Idle One/);
  assert.match(html, /BUSIEST HOUR/);
  clean(html);
});

test("names are escaped and a 7pm call widens the hour axis", () => {
  const html = reportHtml({ title: "Daily", period: "x", people: [person("<b>X</b> & Y", 40, 19), person("Z", 25)] });
  assert.ok(!html.includes("<b>X</b> & Y") && html.includes("&lt;b&gt;X&lt;/b&gt; &amp; Y"));
  assert.match(html, />7pm</);
  clean(html);
});

test("single person gets only their own page; nobody calling still renders", () => {
  const solo = reportHtml({ title: "Daily", period: "x", people: [person("Solo", 30)] });
  assert.equal(pages(solo), 1);
  assert.ok(!/led with|of team|Active staff/.test(solo), "no team framing in a one-person report");
  const none = reportHtml({ title: "Daily", period: "x", people: [person("A", 0), person("B", 0)] });
  assert.equal(pages(none), 1);
  assert.match(none, /No calls were recorded/);
  clean(none);
});

test("Chrome prints a real PDF", { skip: !findChrome() && "Chrome not installed" }, async () => {
  const pdf = await htmlToPdf(reportHtml({ title: "Daily Call Report", period: "03 Nov 2026", people: [person("A", 120), person("B", 60)] }));
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.match(pdf.toString("latin1"), /\/Count 4/);
});

test("invalid % is out of outbound calls, not all calls", () => {
  const p = { ...person("Mixed", 100), inb: 50, out: 50, invalid: 6 }; // 6/50 = 12% (6/100 would be 6%)
  const html = reportHtml({ title: "Daily", period: "x", people: [person("Other", 200), p] }); // Other has more talk time, so Mixed isn't the top performer
  assert.match(html, /12% of outbound/);
  assert.match(html, /Needs attention/); // 12% > 10% limit; 6% would have passed
});

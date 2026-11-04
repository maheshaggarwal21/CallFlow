// Run: npm run build && node --test dist/lib/reportEmail.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { dropCharts, reportEmailHtml } from "./reportEmail";
import { findChrome, svgToPng, type PdfPerson } from "./reportPdf";

const person = (name: string, calls: number): PdfPerson => ({
  name, code: "1001", line: "01", calls, inb: Math.floor(calls / 10), out: calls - Math.floor(calls / 10),
  dur: calls * 45, avg: calls ? 45 : 0, lt10: 1, gapMin: calls ? 3 : null, gapMax: calls ? 900 : null, invalid: Math.floor(calls / 12),
  len: [[0, 0], [0, calls], [0, 0], [0, 0]], b: [Math.floor(calls / 2), calls - Math.floor(calls / 2), 0, 0, 0, 0, 0, 0],
  hours: Array.from({ length: 24 }, (_, h) => (h === 14 ? calls : 0)),
});
const emailSafe = (html: string) => {
  assert.ok(!/<svg|<style|NaN|undefined|Infinity/.test(html), "no SVG/<style> (Gmail drops them) and no broken numbers");
};

test("combined mail: team section, one chart per active person plus the team chart, idle listed", () => {
  const { html, charts } = reportEmailHtml({ title: "Daily Call Report", period: "03 Nov", people: [person("A", 300), person("B <x>", 150), person("Idle", 0)] });
  emailSafe(html);
  assert.equal(charts.length, 3);
  charts.forEach((c) => assert.ok(html.includes(`src="cid:${c.cid}"`) && c.svg.startsWith("<svg")));
  assert.match(html, /Team at a glance/);
  assert.match(html, /No calls: <b>Idle<\/b>/);
  assert.ok(html.includes("B &lt;x&gt;") && !html.includes("B <x>"));
});

test("single-person mail has no team section; no calls at all still renders", () => {
  const one = reportEmailHtml({ title: "Daily", period: "x", people: [person("Solo", 40)] });
  emailSafe(one.html);
  assert.equal(one.charts.length, 1);
  assert.ok(!one.html.includes("Team at a glance"));
  const none = reportEmailHtml({ title: "Daily", period: "x", people: [person("Solo", 0)] });
  emailSafe(none.html);
  assert.equal(none.charts.length, 0);
  assert.match(none.html, /No calls were recorded/);
});

test("dropCharts removes only the failed chart", () => {
  const { html, charts } = reportEmailHtml({ title: "Daily", period: "x", people: [person("A", 30), person("B", 30)] });
  const out = dropCharts(html, [charts[0].cid]);
  assert.ok(!out.includes(`cid:${charts[0].cid}"`) && out.includes(`cid:${charts[1].cid}"`));
});

test("Chrome turns a chart into a 2x PNG", { skip: !findChrome() && "Chrome not installed" }, async () => {
  const { charts } = reportEmailHtml({ title: "Daily", period: "x", people: [person("A", 30)] });
  const png = await svgToPng(charts[0].svg, charts[0].width, charts[0].height);
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), charts[0].width * 2); // IHDR width
});

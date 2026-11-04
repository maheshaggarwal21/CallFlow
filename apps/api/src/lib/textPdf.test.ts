// Run: npm run build && node --test dist/lib/textPdf.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { textToPdf } from "./textPdf";

test("xref offsets point at each object and every section starts a page", () => {
  const long = Array.from({ length: 120 }, (_, i) => `Line ${i}`).join("\n"); // overflows onto 3 pages
  const pdf = textToPdf(["Name: A (x) \\ – 03 Nov", long]).toString("latin1");

  assert.ok(pdf.startsWith("%PDF-1.4\n") && pdf.endsWith("%%EOF\n"));
  const xrefAt = Number(pdf.match(/startxref\n(\d+)/)![1]);
  assert.equal(pdf.slice(xrefAt, xrefAt + 4), "xref");
  const offsets = [...pdf.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offsets.forEach((o, i) => assert.ok(pdf.startsWith(`${i + 1} 0 obj\n`, o), `object ${i + 1}`));

  assert.match(pdf, /\/Count 4 >>/);
  assert.ok(pdf.includes("(Name: A \\(x\\) \\\\ \\226 03 Nov) '")); // escaped parens/backslash, en dash as WinAnsi
  assert.ok(/^[\x00-\x7f]*$/.test(pdf)); // pure ASCII, so string length == byte length
});

test("long lines wrap and non-Latin characters degrade to ?", () => {
  const pdf = textToPdf([`${"word ".repeat(40)}\nनाम`]).toString("latin1");
  assert.equal(pdf.match(/\) '/g)!.length, 4); // 200 chars → 3 wrapped lines + 1
  assert.ok(pdf.includes("(???) '")); // 3 code points
});

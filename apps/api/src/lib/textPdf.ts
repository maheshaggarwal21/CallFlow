// Plain-text → PDF (A4, Helvetica 11pt) without a PDF library: each section starts a
// new page, long lines wrap, overflow continues on the next page.
// shortcut: the built-in Helvetica only covers Latin (WinAnsi); other scripts print as "?". Embed a TTF via pdfkit if non-Latin names appear.

const W = 595, H = 842, MARGIN = 50, SIZE = 11, LEAD = 15, MAX_CHARS = 90;
const PER_PAGE = Math.floor((H - 2 * MARGIN) / LEAD);

// Unicode punctuation the report templates use, mapped to its WinAnsi byte
const WIN_ANSI: Record<string, number> = {
  "–": 0x96, "—": 0x97, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "…": 0x85, "€": 0x80,
};

/** PDF string literal body: ASCII kept, ( ) \ escaped, other bytes as octal, so the file stays pure ASCII. */
function encode(line: string): string {
  let out = "";
  for (const ch of line) {
    const c = ch.codePointAt(0)!;
    const b = WIN_ANSI[ch] ?? ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) ? c : 0x3f);
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += "\\" + String.fromCharCode(b);
    else out += b > 0x7e ? "\\" + b.toString(8).padStart(3, "0") : String.fromCharCode(b);
  }
  return out;
}

function wrap(line: string): string[] {
  const out: string[] = [];
  let rest = line.replace(/\t/g, "    ");
  while (rest.length > MAX_CHARS) {
    const space = rest.lastIndexOf(" ", MAX_CHARS);
    const at = space > 0 ? space : MAX_CHARS;
    out.push(rest.slice(0, at));
    rest = rest.slice(at).trimStart();
  }
  out.push(rest);
  return out;
}

export function textToPdf(sections: string[]): Buffer {
  const pages: string[][] = [];
  for (const s of sections) {
    const lines = s.replace(/\r/g, "").split("\n").flatMap(wrap);
    for (let i = 0; i === 0 || i < lines.length; i += PER_PAGE) pages.push(lines.slice(i, i + PER_PAGE));
  }

  // Object n is objs[n - 1]; object 2 (the page tree) is filled in once the kids are known
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  const kids: string[] = [];
  for (const p of pages) {
    const stream = `BT /F1 ${SIZE} Tf ${LEAD} TL ${MARGIN} ${H - MARGIN} Td\n` +
      p.map((l) => `(${encode(l)}) '`).join("\n") + "\nET";
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${objs.length} 0 R >>`);
    kids.push(`${objs.length} 0 R`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = objs.map((o, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

/**
 * Generates the deterministic PDF fixture corpus used by the test suite.
 *
 * These are BUILT, never copied from anyone's disk: the suite must be
 * reproducible on any machine, must not depend on personal files, and must
 * cover the cases real-world documents rarely provide (inline images with the
 * bytes "EI" in the payload, page rotations, CMYK fills, sub-2-character runs).
 *
 *   node .claude/testkit/make-fixtures.mjs
 */
import { PDFDocument, StandardFonts, rgb, degrees, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.join(process.cwd(), '.claude', 'fixtures');

/** Replace a page's content stream with raw bytes (uncompressed). */
function setRawContent(pdfDoc, page, bytes) {
  const stream = PDFRawStream.of(
    pdfDoc.context.obj({ Length: PDFNumber.of(bytes.length) }),
    new Uint8Array(bytes)
  );
  page.node.set(PDFName.of('Contents'), pdfDoc.context.register(stream));
}

const fixtures = {
  // Non-embedded standard-14 fonts: needs standardFontDataUrl to render.
  async 'standard14.pdf'() {
    const d = await PDFDocument.create();
    const helv = await d.embedFont(StandardFonts.Helvetica);
    const times = await d.embedFont(StandardFonts.TimesRoman);
    const cour = await d.embedFont(StandardFonts.Courier);
    const p = d.addPage([612, 792]);
    p.drawText('Helvetica heading', { x: 50, y: 700, size: 24, font: helv, color: rgb(0.1, 0.1, 0.6) });
    p.drawText('Times body text', { x: 50, y: 660, size: 14, font: times });
    p.drawText('Courier mono', { x: 50, y: 630, size: 11, font: cour, color: rgb(0.8, 0.1, 0.1) });
    for (let i = 0; i < 10; i++) p.drawText(`Body line ${i}`, { x: 50, y: 590 - i * 18, size: 10, font: helv });
    return d.save();
  },

  // Fill colours in all three spaces — exercises colour harvesting.
  async 'colors.pdf'() {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    const p = d.addPage([400, 300]);
    p.drawText('Pure red', { x: 30, y: 250, size: 18, font: f, color: rgb(1, 0, 0) });
    p.drawText('Pure green', { x: 30, y: 220, size: 18, font: f, color: rgb(0, 1, 0) });
    p.drawText('Pure blue', { x: 30, y: 190, size: 18, font: f, color: rgb(0, 0, 1) });
    p.drawText('Mid grey', { x: 30, y: 160, size: 18, font: f, color: rgb(0.5, 0.5, 0.5) });
    p.drawText('Black default', { x: 30, y: 130, size: 18, font: f });
    return d.save();
  },

  // Single characters and very small type — the old editor dropped both.
  async 'tiny-and-single-char.pdf'() {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    const p = d.addPage([300, 300]);
    'ABCDEFGH'.split('').forEach((c, i) => p.drawText(c, { x: 20 + i * 22, y: 250, size: 12, font: f }));
    p.drawText('4pt footnote text', { x: 20, y: 200, size: 4, font: f });
    p.drawText('x', { x: 20, y: 170, size: 6, font: f });
    return d.save();
  },

  // Every page rotation, so the Viewport is exercised end to end.
  async 'rotations.pdf'() {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    for (const angle of [0, 90, 180, 270]) {
      const p = d.addPage([612, 792]);
      p.setRotation(degrees(angle));
      p.drawText(`Rotation ${angle}`, { x: 60, y: 700, size: 22, font: f });
      p.drawText('anchor bottom-left', { x: 20, y: 20, size: 9, font: f });
    }
    return d.save();
  },

  async 'multipage.pdf'() {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < 40; i++) {
      const p = d.addPage([612, 792]);
      p.drawText(`Page ${i + 1} of 40`, { x: 60, y: 700, size: 20, font: f });
      for (let j = 0; j < 12; j++) p.drawText(`p${i} line ${j}`, { x: 60, y: 650 - j * 16, size: 10, font: f });
    }
    return d.save();
  },

  // No text layer at all — the scanned-document shape.
  async 'no-text.pdf'() {
    const d = await PDFDocument.create();
    const p = d.addPage([400, 400]);
    p.drawRectangle({ x: 40, y: 40, width: 320, height: 320, color: rgb(0.85, 0.85, 0.9) });
    p.drawCircle({ x: 200, y: 200, size: 90, color: rgb(0.4, 0.4, 0.6) });
    return d.save();
  },

  // THE case the real-world corpus never provided: an inline image whose binary
  // payload contains the literal bytes "EI", plus a second one declaring /L.
  async 'inline-images.pdf'() {
    const d = await PDFDocument.create();
    const p = d.addPage([200, 200]);
    const parts = [];
    parts.push(Buffer.from('q 100 0 0 50 20 130 cm\nBI /W 4 /H 1 /CS /G /BPC 8 ID ', 'latin1'));
    parts.push(Buffer.from([0x45, 0x49, 0x20, 0xff]));            // "EI " inside the data
    parts.push(Buffer.from('\nEI\nQ\n', 'latin1'));
    parts.push(Buffer.from('q 100 0 0 50 20 60 cm\nBI /W 4 /H 1 /L 4 /CS /G /BPC 8 ID ', 'latin1'));
    parts.push(Buffer.from([0x00, 0x45, 0x49, 0xff]));            // "EI" again, with /L declared
    parts.push(Buffer.from('\nEI\nQ\n', 'latin1'));
    parts.push(Buffer.from('0 0 1 RG 2 w 10 10 m 190 10 l S\n', 'latin1'));
    const doc = d;
    setRawContent(doc, p, Buffer.concat(parts));
    return d.save();
  },

  // Content stream exercising the awkward corners of the tokenizer.
  async 'tricky-syntax.pdf'() {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    const p = d.addPage([400, 300]);
    p.drawText('placeholder', { x: 20, y: 260, size: 10, font: f });
    const fontKey = Object.keys(p.node.normalizedEntries().Font?.dict ? {} : {});
    void fontKey;
    const body = [
      '% comment with ( [ << /delimiters',
      'BT /F1 12 Tf 20 240 Td (nested (parens) here) Tj ET',
      'BT /F1 12 Tf 20 220 Td (escaped \\) paren) Tj ET',
      'BT /F1 12 Tf 20 200 Td (trailing backslash \\\\) Tj ET',
      'BT /F1 12 Tf 20 180 Td <48656C6C6F> Tj ET',
      'BT /F1 12 Tf 20 160 Td [(kerned) -200 (array)] TJ ET',
      '4. .5 +2 -3 0 0 m',
      '<</MCID 0>> BDC 20 140 100 20 re S EMC',
      'BX /UndefinedOp EX',
      '',
    ].join('\n');
    // keep the existing font resource; just swap the stream
    setRawContent(d, p, Buffer.from(body, 'latin1'));
    return d.save();
  },

  // Side-by-side labelled blanks on ONE line — must resolve to TWO fields,
  // not a single merged line. This is the case that breaks naive line grouping.
  async 'form-underlines.pdf'() {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    const p = d.addPage([612, 400]);
    const rule = (x, y, w) => p.drawLine({
      start: { x, y }, end: { x: x + w, y }, thickness: 0.8, color: rgb(0.2, 0.2, 0.2),
    });
    // row 1: two independent blanks on the same baseline
    p.drawText('Name:', { x: 40, y: 320, size: 11, font: f });
    rule(80, 316, 180);
    p.drawText('Phone:', { x: 300, y: 320, size: 11, font: f });
    rule(345, 316, 150);
    // row 2: three blanks
    p.drawText('City:', { x: 40, y: 280, size: 11, font: f });
    rule(75, 276, 120);
    p.drawText('State:', { x: 220, y: 280, size: 11, font: f });
    rule(258, 276, 60);
    p.drawText('Zip:', { x: 340, y: 280, size: 11, font: f });
    rule(368, 276, 90);
    // row 3: a single full-width blank
    p.drawText('Address:', { x: 40, y: 240, size: 11, font: f });
    rule(95, 236, 460);
    return d.save();
  },

  // Boxed fields: text must be centred inside the box, respecting padding.
  async 'form-boxes.pdf'() {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    const p = d.addPage([612, 400]);
    const box = (x, y, w, h) => p.drawRectangle({
      x, y, width: w, height: h, borderWidth: 1,
      borderColor: rgb(0.25, 0.25, 0.25), color: undefined,
    });
    p.drawText('Full name', { x: 40, y: 340, size: 9, font: f });
    box(40, 300, 250, 28);
    p.drawText('Email', { x: 320, y: 340, size: 9, font: f });
    box(320, 300, 240, 28);
    p.drawText('Notes', { x: 40, y: 270, size: 9, font: f });
    box(40, 190, 520, 70);          // tall box
    return d.save();
  },

  // Comb field: a row of equal cells for one character each.
  async 'form-comb.pdf'() {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    const p = d.addPage([612, 300]);
    p.drawText('Reference number', { x: 40, y: 240, size: 9, font: f });
    const cellW = 26, cellH = 30, x0 = 40, y0 = 200;
    for (let i = 0; i < 12; i++) {
      p.drawRectangle({
        x: x0 + i * cellW, y: y0, width: cellW, height: cellH,
        borderWidth: 0.8, borderColor: rgb(0.3, 0.3, 0.3),
      });
    }
    // a second, differently-sized comb lower down
    p.drawText('Date', { x: 40, y: 160, size: 9, font: f });
    for (let i = 0; i < 8; i++) {
      p.drawRectangle({
        x: 40 + i * 20, y: 120, width: 20, height: 24,
        borderWidth: 0.8, borderColor: rgb(0.3, 0.3, 0.3),
      });
    }
    return d.save();
  },

  // Real AcroForm widgets — when a PDF declares its fields, use them.
  async 'acroform.pdf'() {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    const p = d.addPage([612, 400]);
    const form = d.getForm();
    p.drawText('Applicant', { x: 40, y: 350, size: 10, font: f });
    const name = form.createTextField('applicant.name');
    name.setText('');
    name.addToPage(p, { x: 40, y: 320, width: 240, height: 22 });
    const phone = form.createTextField('applicant.phone');
    phone.addToPage(p, { x: 320, y: 320, width: 200, height: 22 });
    const notes = form.createTextField('applicant.notes');
    notes.enableMultiline();
    notes.addToPage(p, { x: 40, y: 220, width: 480, height: 70 });
    return d.save();
  },

  // Words split across many show-ops — the granularity problem.
  async 'fragmented-words.pdf'() {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    const p = d.addPage([400, 200]);
    // draw each glyph as its own operation, with correct advances
    const draw = (str, x, y, size) => {
      let cx = x;
      for (const ch of str) {
        p.drawText(ch, { x: cx, y, size, font: f });
        cx += f.widthOfTextAtSize(ch, size);
      }
    };
    draw('Fragmented', 30, 150, 14);
    draw('Words', 140, 150, 14);
    draw('SecondLine', 30, 120, 14);
    return d.save();
  },

  // A REFERENCE TABLE, not a form: rules with text sitting right on them.
  // These must NOT be mistaken for blanks to type into.
  async 'table-rules.pdf'() {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    const p = d.addPage([612, 500]);
    p.drawText('Keyboard reference', { x: 40, y: 460, size: 14, font: f });
    for (let i = 0; i < 12; i++) {
      const y = 420 - i * 28;
      // a rule with its row text immediately above it — table furniture
      p.drawLine({ start: { x: 40, y }, end: { x: 560, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
      p.drawText(`Shortcut ${i}`, { x: 44, y: y + 6, size: 9, font: f });
      p.drawText(`Does something useful number ${i}`, { x: 220, y: y + 6, size: 9, font: f });
    }
    return d.save();
  },

  // Opens, but page content is destroyed.
  async 'corrupt-content.pdf'() {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    const p = d.addPage([300, 300]);
    p.drawText('will be destroyed', { x: 20, y: 200, size: 12, font: f });
    setRawContent(d, p, Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02, 0x03, 0xde, 0xad, 0xbe, 0xef]));
    return d.save();
  },

  // Truncated file — must fail cleanly at open, never hang.
  async 'truncated.pdf'() {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    const p = d.addPage([300, 300]);
    p.drawText('truncated', { x: 20, y: 200, size: 12, font: f });
    const full = await d.save();
    return full.slice(0, Math.floor(full.length * 0.4));
  },
};

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

let n = 0;
for (const [name, build] of Object.entries(fixtures)) {
  const bytes = await build();
  await writeFile(path.join(OUT, name), bytes);
  console.log(`  ${name.padEnd(28)} ${String(bytes.length).padStart(7)} bytes`);
  n++;
}
console.log(`\n${n} fixtures written to .claude/fixtures/`);

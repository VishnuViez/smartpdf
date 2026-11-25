# Testing rules for this repository

**These are binding. They override convenience, time pressure, and "it's obviously fine".**

## The rule

```
npm test
```

Run it **before claiming any work is complete, fixed, or working** — and before
asking the human to look at anything. A claim without a green run is a guess.

If a change touches `app/lib/pdf/**` or `app/tools/edit/**`, run `npm run verify`
(lint + tests) instead.

## Never ask the human to be the test harness

Do not ship a change and ask "does it work now?". That wastes their time and
defeats the point of automation. If a behaviour matters, there is a test for it.
If you cannot test it, say so explicitly and explain why — do not quietly
substitute the human's eyes for a test.

Driving the browser by hand is for **exploration and diagnosis**, never for
verification. Anything confirmed by hand must be converted into a test in
`.claude/tests/` before the work is called done.

## When you fix a bug

Add a test that fails without the fix, in the suite that covers that area, and
name it so the intent survives:

```js
test('REGRESSION: single-character runs are editable (old code dropped <2 chars)', ...)
```

Every `REGRESSION:` test in this suite corresponds to a defect that actually
shipped. Do not delete them.

## Layout

| Path | Purpose |
|---|---|
| `.claude/testkit/run.mjs` | entry point; regenerates fixtures then runs every suite |
| `.claude/testkit/make-fixtures.mjs` | builds the deterministic PDF corpus |
| `.claude/fixtures/` | generated, gitignored — never edit by hand |
| `.claude/tests/*.test.mjs` | the suites (node:test, no external deps) |
| `.claude/tests/_helpers.mjs` | fixture/corpus loading, pdf.js in Node, timeouts |

## Fixtures are built, never borrowed

`make-fixtures.mjs` generates every PDF it needs. Do not copy files from a
user's disk into the repo: it breaks reproducibility on other machines and puts
personal documents into version control.

Fixtures deliberately cover what real documents rarely do:
inline images whose payload contains the bytes `EI`, all four page rotations,
sub-2-character runs, 4pt type, non-embedded standard-14 fonts, pages with no
text layer, destroyed content streams, and truncated files.

For coverage fixtures genuinely cannot provide — embedded subset fonts, unusual
producers — point the suite at real files without committing them:

```bash
SMARTPDF_CORPUS=~/some/pdfs npm test
```

## Non-negotiable invariants

These encode bugs that already cost real debugging time:

1. **Content-stream tokens tile the buffer exactly and reassemble byte-for-byte.**
   Byte-identity alone is NOT sufficient — object *boundaries* must also be
   correct. An inline-image bug once preserved every byte while putting the
   boundary in the wrong place, which would corrupt any splice.
2. **The model stores PDF user-space units only.** Never screen pixels. Storing
   screen units is what collapsed text to 3px and made it unclickable.
3. **The loader may fail, but must never hang,** and every loader error carries a
   `phase` label naming the step that broke.
4. **No run ever carries non-finite geometry or a malformed colour.**
5. **Glyph coverage is read from the font, never measured with `measureText`** —
   canvas silently falls back per character and reports success for glyphs the
   font does not contain.

## Trust the assertion, not the UI

A UI can mask a broken value. `<input type="color">` silently displays
`#000000` when handed an invalid string, which hid `#NaNNaNNaN` colour
extraction through an entire round of hand-verification. Assert on the model,
not on what the screen appears to show.

## A passing check is not a working feature

Move/resize was reported working on the strength of a synthetic pointer drag
that returned "+60,+30 exact". It was not working. Two defects were live at the
time and the check found neither:

- **Selection died on click.** The element stopped propagation of `pointerdown`,
  but `click` is a separate event that bubbles afterwards — straight into the
  stage handler that clears selection. Grips appeared and vanished. The check
  never dispatched `click`, only `pointerdown`/`pointerup`.
- **The grips were physically unusable.** On a 57.9 x 11px run, three 9px grips
  sat 4.5px apart. The check asserted geometry changed; it never asked whether a
  human could hit the target.

And the check passed for the wrong reason: it used `pointerId: 1`, which Chrome
treats as the live mouse pointer, so `setPointerCapture` happened to succeed.
With any other id it throws `NotFoundError` — which aborted the handler before
drag state was assigned, so no drag began at all.

Rules that follow:

1. **Simulate the WHOLE interaction**, not the convenient part of it.
   `pointerdown → pointermove → pointerup → click`, because the browser fires all
   of them and later ones can undo earlier ones.
2. **Assert usability, not just change.** Minimum hit size, minimum separation
   between controls, target still present after the gesture completes.
3. **Never let a browser API be the first statement in a handler.** Record state
   first; treat `setPointerCapture` and friends as optimisations that may throw.
4. **Vary the incidental parameters.** If a check only passes with one pointer
   id, one zoom level or one page rotation, it is testing that constant.

## The preview and the file are produced by ONE function

What the editor draws and what the exporter writes must come from the same
code, not from two implementations that happen to agree. They did not:

- the preview let CSS centre text inside a line box that the click-target
  padding had inflated — a 1px font in an 11px box, displacing the baseline by
  several percent of page height;
- the preview rendered the document's embedded face while the export
  substituted a standard font, an ~8% width difference.

A hit target may be padded for clickability. It must never decide where text is
DRAWN. Edited text is rendered on a canvas with `textBaseline = "alphabetic"`,
which has the same semantics as a PDF text-showing operator, from coordinates
produced by `model/placement.js` — the same function the exporter calls.

Any new surface that draws or writes edited text uses `resolveTextPlacement`
and `resolvePreviewFont`. Do not recompute either.

`placement.test.mjs` asserts the exported coordinates equal the shared
placement for unmoved, moved, resized, and moved+resized edits.

## Export fidelity is a permanent suite, not a one-off check

`fidelity.test.mjs` asserts that what the editor WOULD DRAW is exactly what the
saved file CONTAINS — position, baseline and fitted size — across seven kinds of
edit, to 0.01pt. Run it against real documents before trusting any change to the
rewriter:

```bash
SMARTPDF_CORPUS=~/pdfs npm test
```

It exists because an ad-hoc version of it found two bugs the rest of the suite
could not see: appended text inheriting a page-level CTM, and a page being
destroyed when its content stream could not be decoded.

## Appended content inherits the page's transform

Converter-produced PDFs routinely open a page with a device-space transform —
`q .24 0 0 -.24 0 792 cm`, scaled and Y-flipped — and never unwind it before the
stream ends. Anything appended afterwards inherits it: text written at
(204, 562) at 12pt landed at (49, 657) at 2.88pt. Every number was exactly the
ambient CTM applied once.

Balancing `q`/`Q` does NOT fix this — the streams measured as balanced and the
transform was still live, because producers nest state in ways that survive a
naive count. PDF has no operator to reset the CTM. So `content-editor.js`
MEASURES the transform in effect at the end of the stream (`endCTM`) and cancels
it with its own inverse before appending.

Generated fixtures are written by pdf-lib, which emits no page-level CTM, so
this class of bug is INVISIBLE to them. It only appears on real-world documents.
Run the positional audit against a real corpus before trusting export geometry.

## Never destroy a page you cannot read

`decodePDFRawStream` throws on compression this build does not support. The
decode failure was being swallowed into an empty buffer, and the rewrite then
replaced the page with only the newly appended text — silently destroying every
original glyph. On a real certificate PDF the export came back blank.

If any content stream on a page fails to decode, or decodes to nothing, that
page is LEFT UNTOUCHED and reported as `unreadable`. Never write a page whose
original content could not be read.

## Never destroy what you cannot replace

Export hid the original glyphs BEFORE knowing whether a replacement could be
written. When the page's font could not encode the new text, the original was
removed and only the encodable characters were drawn — "REPLACED" came out as
"EE", and text with no encodable characters vanished entirely. To the user this
looks like text moving or disappearing.

The ordering is the invariant, not an implementation detail:

1. Resolve the replacement fully — including any font substitution.
2. Only once a drawable replacement exists, hide the original.
3. If nothing can be written, leave the original ALONE and say so.

A wrong glyph is bad. A blank where the user's content used to be is worse.

Fixtures use non-subset standard-14 fonts, which can encode anything, so this
never appeared in the suite. Tests that need subset behaviour force it:
`restrictFont(model, 'allowed chars')` in `save.test.mjs`.

## Verify the test before trusting the result

A failing measurement may be the measurement's fault. Two analysis scripts in
this project produced confident, completely wrong numbers — one compared
`getTextContent` to operator-list output by index (they have different
chunking), another read `.y` on objects whose field is `.baseline`, making every
comparison `NaN`. When a result is surprising, check the tool first.

## Known gap: React component rendering

The suites cover the model, parsers, geometry and fonts — everything that
decides *what* the UI displays. They do not yet render the React components,
because the `.js` component files contain JSX and `node --test` has no JSX
transform, which would mean adding a build dependency to the test path.

Consequence: a bug purely in JSX wiring (a prop passed to the wrong element)
would not be caught.

The mitigation is architectural, and preferred over adding a transform: keep
display logic in plain modules under `app/lib/pdf/` where it is directly
testable, and keep components as thin wiring over them. When a component starts
holding logic worth testing, move that logic out rather than reaching for a
heavier harness.

Until then, UI-level checks are exploratory only and must be backed by a
model-level assertion — see "Trust the assertion, not the UI".

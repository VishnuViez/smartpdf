"use client";
import { useEffect, useRef } from "react";
import { resolvePreviewFont } from "../../../lib/pdf/model/preview-font.js";
import { resolveTextPlacement, originalRect } from "../../../lib/pdf/model/placement.js";
import { availableWidth, fitText } from "../../../lib/pdf/model/fitting.js";

/**
 * Draws edited text exactly the way the exported PDF will.
 *
 * Rendering this with HTML meant the browser decided where the baseline went —
 * and the click-target padding that keeps tiny text selectable was inflating the
 * line box, pushing text far from where the model said it was. Canvas removes
 * the guesswork: `fillText` with an alphabetic baseline has the same semantics
 * as a PDF text-showing operator, so the same numbers produce the same result.
 *
 * The font choice also mirrors the exporter: if the page's own font cannot
 * encode the new text, both sides fall back to the same standard family.
 */

export default function EditedTextLayer({ viewport, runs, edits, fontFor, model }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !viewport) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(viewport.width * dpr);
    canvas.height = Math.round(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewport.width, viewport.height);
    if (!edits.size) return;

    for (const run of runs) {
      const edit = edits.get(run.id);
      if (!edit) continue;

      // 1. cover the original glyphs, at their ORIGINAL rect
      const orig = viewport.rectToScreen(originalRect(run));
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(orig.x - 1, orig.y - 1, orig.w + 2, orig.h + 2);

      // 2. draw the replacement using the SAME placement the exporter will use
      const place = resolveTextPlacement(run, edit);
      if (!place.text) continue;

      const fontRecord = fontFor(edit.fontKey ?? run.fontKey);

      // Identical fitting to the exporter, so the preview shows the condensing
      // and tracking that the saved file will actually contain.
      const room = availableWidth({ ...run, x: place.x, baseline: place.baseline }, model);
      const fit = fitText({ text: place.text, fontRecord, fontSize: place.fontSize, available: room });

      const pt = viewport.toScreen(place.x, place.baseline);
      const sizePx = viewport.fontSizeToScreen(fit.fontSize);
      const { css } = resolvePreviewFont(place.text, fontRecord, sizePx);

      ctx.save();
      ctx.font = css;
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
      ctx.fillStyle = place.colorHex;
      if (typeof ctx.letterSpacing === "string") {
        ctx.letterSpacing = `${viewport.fontSizeToScreen(fit.charSpacing)}px`;
      }
      if (Math.abs(fit.hScale - 1) > 1e-6) {
        ctx.translate(pt.x, pt.y);
        ctx.scale(fit.hScale, 1);
        ctx.fillText(place.text, 0, 0);
      } else {
        ctx.fillText(place.text, pt.x, pt.y);
      }
      ctx.restore();
    }
  }, [viewport, runs, edits, fontFor, model]);

  if (!viewport) return null;
  return <canvas ref={ref} className="ed-edited-layer" />;
}

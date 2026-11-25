"use client";
import { selectionFrame, handlesFor } from "../../../lib/pdf/model/transform.js";

/**
 * The selection frame for the currently selected element.
 *
 * Rendered ONCE, above every other layer — deliberately not as a child of the
 * element. Text runs are routinely 11px tall, and grips placed inside one
 * overlap each other and the element, which made resizing impossible. Here the
 * frame is inflated to a size a pointer can work with and the grips sit outside
 * its edges, so they stay reachable no matter how small the element is.
 *
 * Inflation is visual only: drag deltas are unaffected, so the resize maths
 * still applies to the element's true rect.
 */
export default function SelectionFrame({ box, onBeginMove, onBeginResize, dragging }) {
  if (!box) return null;

  const frame = selectionFrame(box);
  const handles = handlesFor(frame);

  return (
    <div
      className={`ed-frame${dragging ? " is-dragging" : ""}`}
      style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }}
      onPointerDown={onBeginMove}
      onDoubleClick={e => e.stopPropagation()}
    >
      {/* the element's true bounds, so the inflation isn't misleading */}
      <span
        className="ed-frame-bounds"
        style={{
          left: box.x - frame.x, top: box.y - frame.y,
          width: Math.max(box.w, 2), height: Math.max(box.h, 2),
        }}
      />
      {handles.map(h => (
        <span
          key={h}
          className={`ed-handle ed-handle-${h}`}
          onPointerDown={e => { e.stopPropagation(); onBeginResize(e, h); }}
        />
      ))}
    </div>
  );
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyDrag, isValidGeometry, HANDLES } from "../../../lib/pdf/model/transform.js";

export { HANDLES };

/**
 * Pointer plumbing for move/resize. Every geometry decision lives in
 * `lib/pdf/model/transform.js`; this only turns pointer events into deltas.
 *
 * Two things this has to get right, both learned the hard way:
 *
 *  1. Drag state is recorded BEFORE anything that can throw. `setPointerCapture`
 *     raises NotFoundError when the pointer isn't active, and calling it first
 *     aborted the handler so no drag ever began.
 *  2. Capture is an optimisation, not the mechanism. Window-level listeners run
 *     for the duration of the drag, so a failed capture — or a pointer that
 *     leaves the element — cannot strand a drag half-finished.
 */
export function useDragTransform({ viewport, onChange, onCommit }) {
  const drag = useRef(null);
  const [active, setActive] = useState(null);

  const begin = useCallback((e, { id, mode, handle, base }) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    // Record state FIRST — nothing below may prevent the drag from starting.
    drag.current = {
      id, mode, handle, base,
      startX: e.clientX, startY: e.clientY,
      moved: false,
      target: e.currentTarget,
      pointerId: e.pointerId,
      captured: false,
    };
    setActive({ id, mode, handle });

    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      drag.current.captured = true;
    } catch {
      // Capture is unavailable for this pointer; window listeners cover us.
    }
  }, []);

  // Depends on viewport/onChange directly: the drag effect re-registers its
  // window listeners whenever this changes, so a drag never sees stale values.
  const handleMove = useCallback((e) => {
    const d = drag.current;
    if (!d || !viewport) return;
    const dxScreen = e.clientX - d.startX;
    const dyScreen = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dxScreen, dyScreen) < 3) return;   // ignore jitter
    d.moved = true;
    const patch = applyDrag({
      base: d.base, mode: d.mode, handle: d.handle,
      viewport, dxScreen, dyScreen,
      proportional: e.shiftKey, minW: 2, minH: 2,
    });
    if (isValidGeometry(patch)) onChange(d.id, patch);
  }, [viewport, onChange]);

  const handleEnd = useCallback(() => {
    const d = drag.current;
    if (!d) return;
    if (d.captured) {
      try { d.target?.releasePointerCapture?.(d.pointerId); } catch { /* already gone */ }
    }
    drag.current = null;
    setActive(null);
    onCommit?.(d.id, d.moved);
  }, [onCommit]);

  // Window listeners for the life of the drag: a drag can end anywhere,
  // including outside the window, and must never be left hanging.
  useEffect(() => {
    if (!active) return;
    const move = e => handleMove(e);
    const up = () => handleEnd();
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
  }, [active, handleMove, handleEnd]);

  // Escape abandons a drag rather than leaving the element mid-move.
  useEffect(() => {
    if (!active) return;
    const onKey = e => { if (e.key === "Escape") handleEnd(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, handleEnd]);

  return {
    activeDrag: active,
    isDragging: !!active,
    dragProps: {},          // movement is handled at the window level now
    beginDrag: begin,
  };
}

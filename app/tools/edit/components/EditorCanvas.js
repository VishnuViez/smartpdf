"use client";
import { useEffect, useMemo, useRef } from "react";
import { useDragTransform } from "./useDragTransform";
import SelectionFrame from "./SelectionFrame";
import EditedTextLayer from "./EditedTextLayer";

/**
 * Renders one PDF page and lays the interactive elements over it.
 *
 * Every position comes from `viewport`. Nothing is derived from the container's
 * pixel width — that was the defect that collapsed text to 3px.
 *
 * A selected element is a standalone object: drag its body to move it, drag a
 * grip to resize it. Geometry overrides are stored in PDF units, so moving an
 * element then zooming keeps it exactly where it was put.
 */
// A 5pt footnote is 5px tall at 100%. Keep a floor so small text stays
// reachable by a real pointer without moving the underlying geometry.
const MIN_HIT = 11;

function geometryOf(run, edit) {
  return {
    x: edit?.x ?? run.x,
    y: edit?.y ?? run.y,
    w: edit?.w ?? run.w,
    h: edit?.h ?? run.h,
  };
}

export default function EditorCanvas({
  pageModel, viewport, runs, edits, selectedId, editingId,
  onSelect, onBeginEdit, onCommitEdit, onCancelEdit, onGeometryChange, fontFor, children,
}) {
  const canvasRef = useRef(null);
  const taskRef = useRef(null);
  const inputRef = useRef(null);

  const { dragProps, beginDrag, isDragging, activeDrag } = useDragTransform({
    viewport,
    onChange: onGeometryChange,
  });

  // The selected element's on-screen box, derived rather than captured during
  // render — the frame is drawn from this, above every other layer.
  const selection = useMemo(() => {
    if (!selectedId || !viewport) return null;
    const run = runs.find(r => r.id === selectedId);
    if (!run) return null;
    const edit = edits.get(run.id);
    const geom = geometryOf(run, edit);
    const box = viewport.rectToScreen(geom);
    const padY = Math.max(0, (MIN_HIT - box.h) / 2);
    return {
      box: { x: box.x, y: box.y - padY, w: Math.max(box.w, 4), h: box.h + padY * 2 },
      base: { ...geom, fontSize: edit?.fontSize ?? run.fontSize },
    };
  }, [selectedId, runs, edits, viewport]);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas || !pageModel || !viewport) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pdfViewport = pageModel.page.getViewport({
      scale: viewport.scale * dpr,
      rotation: viewport.rotation,
    });
    canvas.width = Math.round(pdfViewport.width);
    canvas.height = Math.round(pdfViewport.height);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    taskRef.current?.cancel();
    const task = pageModel.page.render({
      canvasContext: canvas.getContext("2d", { alpha: false }),
      viewport: pdfViewport,
      background: "#ffffff",
    });
    taskRef.current = task;
    task.promise.catch(err => {
      if (!cancelled && err?.name !== "RenderingCancelledException") {
        console.error("page render failed", err);
      }
    });
    return () => { cancelled = true; task.cancel(); };
  }, [pageModel, viewport]);

  useEffect(() => {
    if (editingId && inputRef.current) {
      const el = inputRef.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editingId]);

  if (!pageModel || !viewport) return null;

  return (
    <div
      className={`ed-canvas-stack${isDragging ? " is-dragging" : ""}`}
      style={{ width: viewport.width, height: viewport.height }}
      {...dragProps}
    >
      <canvas ref={canvasRef} className="ed-canvas" />

      <EditedTextLayer viewport={viewport} runs={runs} edits={edits} fontFor={fontFor} model={pageModel} />

      <div className="ed-overlay" style={{ width: viewport.width, height: viewport.height }}>
        {runs.map(run => {
          const edit = edits.get(run.id);
          const text = edit?.text ?? run.text;
          const fontSize = edit?.fontSize ?? run.fontSize;
          const colorHex = edit?.colorHex ?? run.colorHex;
          const font = fontFor(edit?.fontKey ?? run.fontKey);

          // Geometry override wins — this is what makes the element movable.
          const geom = geometryOf(run, edit);
          const box = viewport.rectToScreen(geom);
          const padY = Math.max(0, (MIN_HIT - box.h) / 2);
          const sizePx = viewport.fontSizeToScreen(fontSize);
          const isEditing = editingId === run.id;
          const isSelected = selectedId === run.id;
          const moved = !!(edit && (edit.x !== undefined || edit.w !== undefined));

          if (isEditing) {
            return (
              <input
                key={run.id}
                ref={inputRef}
                className="ed-run-input"
                defaultValue={text}
                style={{
                  left: box.x, top: box.y - padY,
                  minWidth: Math.max(box.w + 12, 40),
                  height: box.h + padY * 2,
                  ...(font ? font.cssFontParts(sizePx) : { fontSize: `${sizePx}px` }),
                  color: colorHex,
                }}
                onKeyDown={e => {
                  e.stopPropagation();
                  if (e.key === "Enter") { e.preventDefault(); onCommitEdit(run.id, e.currentTarget.value); }
                  if (e.key === "Escape") { e.preventDefault(); onCancelEdit(); }
                }}
                onBlur={e => onCommitEdit(run.id, e.currentTarget.value)}
              />
            );
          }


          return (
            <div
              key={run.id}
              className={
                "ed-run" +
                (isSelected ? " is-selected" : "") +
                (edit ? " is-edited" : "") +
                (moved ? " is-moved" : "") +
                (activeDrag?.id === run.id ? " is-grabbing" : "")
              }
              style={{ left: box.x, top: box.y - padY, width: Math.max(box.w, 4), height: box.h + padY * 2 }}
              title={`${font ? font.label() : "?"} · ${fontSize.toFixed(1)}pt — drag to move`}
              onPointerDown={e => { e.stopPropagation(); onSelect(run.id); }}
              onDoubleClick={e => { e.stopPropagation(); onBeginEdit(run.id); }}
            >

            </div>
          );
        })}
      </div>

      {children}

      {selection && !editingId && (
        <SelectionFrame
          box={selection.box}
          dragging={!!activeDrag}
          onBeginMove={e =>
            beginDrag(e, { id: selectedId, mode: "move", base: selection.base })}
          onBeginResize={(e, handle) =>
            beginDrag(e, { id: selectedId, mode: "resize", handle, base: selection.base })}
        />
      )}
    </div>
  );
}

"use client";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  ArrowLeft, Download, ZoomIn, ZoomOut, Maximize2,
  ChevronLeft, ChevronRight, Loader2, RotateCw, Undo2, Redo2,
} from "lucide-react";
import Dropzone from "../../components/Dropzone";
import EditorCanvas from "./components/EditorCanvas";
import Inspector from "./components/Inspector";
import FieldLayer from "./components/FieldLayer";
import { createViewport, scaleToFitWidth, scaleToFitBox } from "../../lib/pdf/model/geometry.js";
import { loadPageModel } from "../../lib/pdf/parse/document-loader.js";
import { savePdf } from "../../lib/pdf/rewrite/save-pdf.js";
import { loadPdfjs, PDFJS_ASSETS } from "../../lib/pdf/pdfjs.js";
import {
  createHistoryState, pushHistory, undo as undoHistory, redo as redoHistory,
  canUndo, canRedo,
} from "../../lib/pdf/model/history.js";
import { availableWidth, fitText } from "../../lib/pdf/model/fitting.js";
import { resolveTextPlacement } from "../../lib/pdf/model/placement.js";
import { downloadBlob } from "../../lib/pdf-utils";

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];

export default function EditPage() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const [pdf, setPdf] = useState(null);
  const [ops, setOps] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageModel, setPageModel] = useState(null);
  const [modelError, setModelError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [rotation, setRotation] = useState(0);

  const [zoom, setZoom] = useState("fit-width");
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });

  const [selectedId, setSelectedId] = useState(null);
  const [activeFieldId, setActiveFieldId] = useState(null);
  // The editable state lives on a history stack so every action is undoable.
  const [history, setHistory] = useState(() => createHistoryState());
  const edits = history.present.edits;
  const fieldValues = history.present.fieldValues;
  const [saving, setSaving] = useState(false);

  /** Record a change. `label` + `coalesce` keep a drag or a typed word to one step. */
  const commit = useCallback((mutate, label, coalesce = false) => {
    setHistory(h => {
      const nextEdits = new Map(h.present.edits);
      const nextFields = new Map(h.present.fieldValues);
      mutate(nextEdits, nextFields);
      return pushHistory(h, { edits: nextEdits, fieldValues: nextFields }, { label, coalesce });
    });
  }, []);
  const [saveResult, setSaveResult] = useState(null);
  // Models for every page visited, so edits made on page 3 still export.
  const modelsRef = useRef(new Map());
  const [editingId, setEditingId] = useState(null);

  const stageRef = useRef(null);

  // ---- stage measurement (drives fit-to-width, never the model) ----
  // A zero measurement must never be able to persist: if the element reports 0
  // (mid-layout, hidden ancestor, transition) we retry, and fall back to the
  // window so `viewport` can never stay null and hang the screen.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let raf = 0, tries = 0;

    const measure = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (w > 0 && h > 0) { setStageSize({ w, h }); return; }
      if (tries++ < 20) { raf = requestAnimationFrame(measure); return; }
      setStageSize({
        w: Math.max(320, window.innerWidth - 280),
        h: Math.max(320, window.innerHeight - 82),
      });
    };

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      if (w > 0 && h > 0) setStageSize({ w, h });
    });
    ro.observe(el);
    measure();
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, [pdf]);

  // ---- load ----
  const handleFiles = useCallback(async (files) => {
    const f = files?.[0];
    if (!f) return;
    setFile(f); setLoading(true); setLoadError(null); setModelError(null);
    setHistory(createHistoryState()); setSelectedId(null); setEditingId(null);
    try {
      const pdfjsLib = await loadPdfjs();
      const buf = await f.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: buf, ...PDFJS_ASSETS }).promise;
      setPdf(doc);
      setOps(pdfjsLib.OPS);
      setNumPages(doc.numPages);
      setPageIndex(0);
    } catch (err) {
      setLoadError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // ---- page model ----
  useEffect(() => {
    if (!pdf || !ops) return;
    let cancelled = false;
    let timer = 0;

    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(Object.assign(new Error("timed out after 30s"), { phase: "timeout" })),
        30000
      );
    });

    Promise.race([loadPageModel(pdf, pageIndex, ops), timeout])
      .then(m => {
        if (cancelled) return;
        setPageModel(m);
        setRotation(m.rotation || 0);
        setModelError(null);
        modelsRef.current.set(pageIndex, m);
      })
      .catch(err => {
        if (cancelled) return;
        console.error("[pdf] page model failed", err);
        setModelError({
          message: err?.message || String(err),
          phase: err?.phase || "unknown",
          page: pageIndex + 1,
        });
      })
      .finally(() => clearTimeout(timer));

    return () => { cancelled = true; clearTimeout(timer); };
  }, [pdf, ops, pageIndex, reloadKey]);

  // ---- viewport: the single conversion authority ----
  const viewport = useMemo(() => {
    if (!pageModel || pageModel.index !== pageIndex || !stageSize.w) return null;
    const pad = 48;
    const availW = Math.max(120, stageSize.w - pad);
    const availH = Math.max(120, stageSize.h - pad);
    const dims = { pageWidth: pageModel.width, pageHeight: pageModel.height, rotation };
    let scale;
    if (zoom === "fit-width") scale = scaleToFitWidth(dims, availW);
    else if (zoom === "fit-page") scale = scaleToFitBox(dims, availW, availH);
    else scale = zoom;
    return createViewport({ ...dims, scale: Math.max(0.05, Math.min(scale, 12)) });
  }, [pageModel, pageIndex, stageSize, zoom, rotation]);

  const fontFor = useCallback(
    key => (pageModel && key ? pageModel.fonts.get(key) || null : null),
    [pageModel]
  );

  // The model is stale until its index matches the page we're showing.
  const modelReady = !!pageModel && pageModel.index === pageIndex;
  // Segments are the selection unit: raw runs may be single glyphs.
  const runs = useMemo(() => (modelReady ? (pageModel.segments?.length ? pageModel.segments : pageModel.runs) : []), [modelReady, pageModel]);
  const fields = useMemo(() => (modelReady ? pageModel.fields || [] : []), [modelReady, pageModel]);
  const selectedRun = runs.find(r => r.id === selectedId) || null;
  const selectedEdit = selectedId ? edits.get(selectedId) : null;

  // How the selected element's text will be fitted into its space — the same
  // calculation the exporter performs, surfaced so it is never a surprise.
  const selectedFit = useMemo(() => {
    if (!selectedRun || !modelReady) return null;
    const place = resolveTextPlacement(selectedRun, selectedEdit || {});
    const room = availableWidth({ ...selectedRun, x: place.x, baseline: place.baseline }, pageModel);
    return fitText({
      text: place.text,
      fontRecord: fontFor(selectedEdit?.fontKey ?? selectedRun.fontKey),
      fontSize: place.fontSize,
      available: room,
    });
  }, [selectedRun, selectedEdit, modelReady, pageModel, fontFor]);

  // ---- editing ----
  const applyEdit = useCallback((runId, patch) => {
    const run = runs.find(r => r.id === runId);
    if (!run) return;
    const kind = patch.text !== undefined ? "text" : Object.keys(patch)[0] || "edit";
    commit((next) => {
      const base = next.get(runId) || {
        text: run.text, fontSize: run.fontSize, colorHex: run.colorHex, fontKey: run.fontKey,
      };
      next.set(runId, { ...base, ...patch });
    }, `${kind}:${runId}`, true);       // typing a word is one undo
  }, [runs, commit]);

  const applyGeometry = useCallback((runId, patch) => {
    const run = runs.find(r => r.id === runId);
    if (!run) return;
    commit((next) => {
      const base = next.get(runId) || {
        text: run.text, fontSize: run.fontSize, colorHex: run.colorHex, fontKey: run.fontKey,
      };
      next.set(runId, { ...base, ...patch });
    }, `geometry:${runId}`, true);      // a whole drag is one undo
  }, [runs, commit]);

  const commitEdit = useCallback((runId, value) => {
    const run = runs.find(r => r.id === runId);
    setEditingId(null);
    if (!run) return;
    if (value === run.text && !edits.has(runId)) return;
    applyEdit(runId, { text: value });
  }, [runs, edits, applyEdit]);

  const resetEdit = useCallback(() => {
    if (!selectedId) return;
    commit((next) => { next.delete(selectedId); }, `revert:${selectedId}`);
  }, [selectedId, commit]);

  // ---- zoom ----
  const currentScale = viewport?.scale ?? 1;
  const zoomBy = dir => {
    const i = ZOOM_STEPS.findIndex(s => s > currentScale + 1e-6);
    const next = dir > 0
      ? ZOOM_STEPS[i === -1 ? ZOOM_STEPS.length - 1 : i]
      : ZOOM_STEPS[Math.max(0, (i === -1 ? ZOOM_STEPS.length : i) - 2 + 1) - 1] ?? ZOOM_STEPS[0];
    setZoom(next ?? ZOOM_STEPS[0]);
  };

  const doUndo = useCallback(() => setHistory(h => undoHistory(h)), []);
  const doRedo = useCallback(() => setHistory(h => redoHistory(h)), []);

  useEffect(() => {
    const onKey = e => {
      const mod = e.metaKey || e.ctrlKey;
      // Undo must work even while typing in an element, which is exactly when
      // people reach for it.
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) doRedo(); else doUndo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); doRedo(); return; }
      if (editingId) return;
      if (e.key === "Escape") { setSelectedId(null); return; }
      if (e.key === "Enter" && selectedId) { setEditingId(selectedId); return; }
      if ((e.metaKey || e.ctrlKey) && (e.key === "=" || e.key === "+")) { e.preventDefault(); zoomBy(1); }
      if ((e.metaKey || e.ctrlKey) && e.key === "-") { e.preventDefault(); zoomBy(-1); }
      if ((e.metaKey || e.ctrlKey) && e.key === "0") { e.preventDefault(); setZoom("fit-width"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const handleSave = useCallback(async () => {
    if (!file || saving) return;
    setSaving(true);
    setSaveResult(null);
    try {
      // Group every edit and field value by the page it belongs to.
      const byPage = new Map();
      const bucket = idx => {
        if (!byPage.has(idx)) {
          byPage.set(idx, { pageIndex: idx, model: modelsRef.current.get(idx), edits: new Map(), fieldValues: new Map() });
        }
        return byPage.get(idx);
      };
      for (const [id, patch] of edits) {
        const idx = Number(String(id).match(/^(?:seg|r)(\d+)_/)?.[1] ?? pageIndex);
        bucket(idx).edits.set(id, patch);
      }
      for (const [id, value] of fieldValues) {
        if (value) bucket(pageIndex).fieldValues.set(id, value);
      }

      const specs = [...byPage.values()].filter(s => s.model);
      if (!specs.length) { setSaveResult({ error: "Nothing to save yet." }); return; }

      const bytes = await file.arrayBuffer();
      const { bytes: out, warnings, changed } = await savePdf(bytes, specs);
      downloadBlob(new Blob([out], { type: "application/pdf" }),
        file.name.replace(/\.pdf$/i, "") + "_edited.pdf");
      setSaveResult({ changed, warnings });
    } catch (err) {
      console.error("[pdf] save failed", err);
      setSaveResult({ error: err?.message || String(err) });
    } finally {
      setSaving(false);
    }
  }, [file, edits, fieldValues, pageIndex, saving]);

  const reset = () => {
    setFile(null); setPdf(null); setPageModel(null); setNumPages(0);
    setHistory(createHistoryState()); setSelectedId(null); setEditingId(null);
    setLoadError(null); setModelError(null); setActiveFieldId(null);
    setSaveResult(null); modelsRef.current = new Map();
  };

  // ================= intake =================
  if (!pdf) {
    return (
      <div className="ed-intake">
        <Link href="/" className="back-link"><ArrowLeft size={14} /> Back to all tools</Link>
        <div className="ed-intake-inner">
          <h1>Edit PDF</h1>
          <p>Click any text to inspect its real font, size and colour — then change it.</p>
          {loading ? (
            <div className="ed-loading"><Loader2 size={18} className="ed-spin" /> Reading document…</div>
          ) : (
            <Dropzone
              onFiles={handleFiles}
              accept=".pdf"
              multiple={false}
              label="Drop your PDF here"
              sublabel="Fonts are identified automatically"
            />
          )}
          {loadError && <div className="ed-error">Could not open this PDF: {loadError}</div>}
        </div>
      </div>
    );
  }

  // ================= workspace =================
  const editCount = edits.size + [...fieldValues.values()].filter(v => v && v.length).length;
  return (
    <div className="ed-shell">
      <header className="ed-topbar">
        <Link href="/" className="ed-brand"><ArrowLeft size={15} /> Tools</Link>
        <span className="ed-filename" title={file?.name}>{file?.name}</span>

        <div className="ed-topbar-group">
          <button className="ed-btn" onClick={doUndo} disabled={!canUndo(history)} title="Undo (⌘Z)">
            <Undo2 size={15} />
          </button>
          <button className="ed-btn" onClick={doRedo} disabled={!canRedo(history)} title="Redo (⇧⌘Z)">
            <Redo2 size={15} />
          </button>
        </div>

        <div className="ed-topbar-group">
          <button className="ed-btn" onClick={() => zoomBy(-1)} title="Zoom out (⌘−)"><ZoomOut size={15} /></button>
          <span className="ed-zoom-readout">{Math.round(currentScale * 100)}%</span>
          <button className="ed-btn" onClick={() => zoomBy(1)} title="Zoom in (⌘+)"><ZoomIn size={15} /></button>
          <button className={"ed-btn" + (zoom === "fit-width" ? " is-on" : "")} onClick={() => setZoom("fit-width")} title="Fit width (⌘0)"><Maximize2 size={15} /></button>
          <button className="ed-btn" onClick={() => setRotation(r => (r + 90) % 360)} title="Rotate view"><RotateCw size={15} /></button>
        </div>

        <div className="ed-topbar-group">
          <button className="ed-btn" disabled={pageIndex <= 0} onClick={() => { setPageIndex(p => p - 1); setSelectedId(null); }}><ChevronLeft size={15} /></button>
          <span className="ed-page-readout">{pageIndex + 1} / {numPages}</span>
          <button className="ed-btn" disabled={pageIndex >= numPages - 1} onClick={() => { setPageIndex(p => p + 1); setSelectedId(null); }}><ChevronRight size={15} /></button>
        </div>

        <div className="ed-topbar-spacer" />
        <button className="ed-btn ghost" onClick={reset}>Close</button>
        <button className="ed-btn primary" disabled={!editCount || saving} onClick={handleSave}>
          {saving ? <Loader2 size={15} className="ed-spin" /> : <Download size={15} />}
          {saving ? "Saving…" : `Save${editCount ? ` (${editCount})` : ""}`}
        </button>
      </header>

      <div className="ed-body">
        <div
          className="ed-stage"
          ref={stageRef}
          onPointerDown={e => {
            if (e.target.closest(".ed-run, .ed-field, .ed-frame, .ed-run-input")) return;
            setSelectedId(null);
            setEditingId(null);
          }}
        >
          {modelError ? (
            <div className="ed-stage-error" onClick={e => e.stopPropagation()}>
              <h3>Couldn&apos;t build page {modelError.page}</h3>
              <p>{modelError.message}</p>
              <code>failed during: {modelError.phase}</code>
              <div className="ed-stage-error-actions">
                <button className="ed-btn ghost" onClick={() => { setModelError(null); setReloadKey(k => k + 1); }}>Retry</button>
                {numPages > 1 && pageIndex < numPages - 1 && (
                  <button className="ed-btn ghost" onClick={() => { setModelError(null); setPageIndex(p => p + 1); }}>Skip to page {pageIndex + 2}</button>
                )}
                <button className="ed-btn ghost" onClick={reset}>Choose another file</button>
              </div>
            </div>
          ) : !modelReady || !viewport ? (
            <div className="ed-loading"><Loader2 size={18} className="ed-spin" /> Building page model…</div>
          ) : (
            <EditorCanvas
              pageModel={pageModel}
              viewport={viewport}
              runs={runs}
              edits={edits}
              selectedId={selectedId}
              editingId={editingId}
              fontFor={fontFor}
              onSelect={setSelectedId}
              onBeginEdit={id => { setSelectedId(id); setEditingId(id); }}
              onCommitEdit={commitEdit}
              onCancelEdit={() => setEditingId(null)}
              onGeometryChange={applyGeometry}
            >
              <FieldLayer
                fields={fields}
                viewport={viewport}
                values={fieldValues}
                activeId={activeFieldId}
                onActivate={setActiveFieldId}
                onChange={(id, v) => commit((_, fields) => { fields.set(id, v); }, `field:${id}`, true)}
                onCommit={() => setActiveFieldId(null)}
              />
            </EditorCanvas>
          )}
        </div>

        <Inspector
          run={selectedRun}
          edit={selectedEdit}
          fit={selectedFit}
          font={selectedRun ? fontFor(selectedEdit?.fontKey ?? selectedRun.fontKey) : null}
          onChange={patch => selectedId && applyEdit(selectedId, patch)}
          onReset={resetEdit}
        />
      </div>

      <footer className="ed-statusbar">
        <span>{runs.length} selectable elements</span>
        {fields.length > 0 && <span>{fields.length} input field{fields.length === 1 ? "" : "s"} detected</span>}
        <span>{modelReady ? `${pageModel.fonts.size} fonts identified` : ""}</span>
        {modelReady && pageModel.degraded && (
          <span className="ed-degraded" title="This page's text layer failed to parse, so runs were reconstructed from the content stream. Positions are accurate; some spacing may differ.">
            reconstructed
          </span>
        )}
        {saveResult?.error && <span className="ed-save-error">Save failed: {saveResult.error}</span>}
        {saveResult && !saveResult.error && (
          <span className={saveResult.warnings?.length ? "ed-save-warn" : "ed-save-ok"}>
            {saveResult.warnings?.length
              ? `Saved ${saveResult.changed} change${saveResult.changed === 1 ? "" : "s"} — ${saveResult.warnings.length} warning${saveResult.warnings.length === 1 ? "" : "s"}: ${saveResult.warnings[0].reason}`
              : `Saved ${saveResult.changed} change${saveResult.changed === 1 ? "" : "s"}`}
          </span>
        )}
        <span className="ed-status-hint">Drag to move · grips to resize · ⌘Z undo · double-click to edit</span>
      </footer>
    </div>
  );
}

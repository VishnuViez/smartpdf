"use client";
import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft, Highlighter, CheckCircle, Download, Loader2, Trash2,
  ChevronLeft, ChevronRight, ShieldCheck, AlertTriangle, Search,
} from "lucide-react";
import Header from "../../components/Header";
import Dropzone from "../../components/Dropzone";
import { formatFileSize, downloadBlob } from "../../lib/pdf-utils";
import { loadPdfjs, PDFJS_ASSETS } from "../../lib/pdf/pdfjs.js";
import { redactPdf } from "../../lib/pdf/redact/redact.js";
import { loadPageModel } from "../../lib/pdf/parse/document-loader.js";
import { findInSegments, sameRegion } from "../../lib/pdf/redact/find.js";

const PREVIEW_WIDTH = 560;
const MIN_DRAG = 4;           // px — below this it was a click, not a selection

export default function RedactPage() {
  const [file, setFile] = useState(null);
  const [pages, setPages] = useState([]);       // [{url, width, height}] PDF units
  const [pageIndex, setPageIndex] = useState(0);
  const [loadingPages, setLoadingPages] = useState(false);

  const [regions, setRegions] = useState([]);   // PDF units, y from bottom
  const [drag, setDrag] = useState(null);       // live rectangle in preview px
  const [colour, setColour] = useState("black");

  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState(null);

  const [result, setResult] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const pageRef = useRef(null);
  // Kept open so the exact glyph geometry can be handed to the redactor.
  // Without it run widths are guessed and more text is erased than selected.
  const docRef = useRef(null);
  const runCache = useRef(new Map());
  const modelCache = useRef(new Map());

  const handleFiles = useCallback(async (files) => {
    const f = files?.[0];
    if (!f) return;
    setFile(f); setResult(null); setError(null); setRegions([]); setPages([]);
    setLoadingPages(true);
    try {
      const pdfjsLib = await loadPdfjs();
      const doc = await pdfjsLib.getDocument({ data: await f.arrayBuffer(), ...PDFJS_ASSETS }).promise;
      docRef.current = { doc, OPS: pdfjsLib.OPS };
      runCache.current = new Map();
      modelCache.current = new Map();
      const out = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: PREVIEW_WIDTH / base.width });
        const c = document.createElement("canvas");
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        await page.render({ canvasContext: c.getContext("2d"), viewport: vp, background: "#fff" }).promise;
        out.push({ url: c.toDataURL("image/jpeg", 0.74), width: base.width, height: base.height });
      }
      setPages(out);
      setPageIndex(0);
    } catch (e) {
      setError(e?.name === "EncryptedDocumentError"
        ? "This PDF is password-protected. Unlock it first, then redact."
        : (e?.message || String(e)));
    } finally {
      setLoadingPages(false);
    }
  }, []);

  const localPos = (e) => {
    const r = pageRef.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(e.clientX - r.left, r.width)),
      y: Math.max(0, Math.min(e.clientY - r.top, r.height)),
      w: r.width, h: r.height,
    };
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const p = localPos(e);
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!drag) return;
    const p = localPos(e);
    setDrag(d => (d ? { ...d, x1: p.x, y1: p.y } : d));
  };

  const onPointerUp = (e) => {
    if (!drag) return;
    const box = {
      left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1),
      w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0),
    };
    setDrag(null);
    if (box.w < MIN_DRAG || box.h < MIN_DRAG) return;   // a stray click

    // Preview px -> PDF units. The preview may be laid out narrower than it was
    // rendered, so scale off the element's measured size, never the constant.
    const r = pageRef.current.getBoundingClientRect();
    const page = pages[pageIndex];
    const sx = page.width / r.width;
    const sy = page.height / r.height;
    setRegions(rs => [...rs, {
      id: `${Date.now()}-${rs.length}`,
      pageIndex,
      x: box.left * sx,
      // PDF y counts from the bottom of the page, the preview from the top
      y: (r.height - box.top - box.h) * sy,
      w: box.w * sx,
      h: box.h * sy,
    }]);
    void e;
  };

  /** A stored region, back in preview px for drawing. */
  const toPreview = (rg) => {
    const page = pages[rg.pageIndex];
    if (!page) return null;
    return {
      left: (rg.x / page.width) * 100,
      top: ((page.height - rg.y - rg.h) / page.height) * 100,
      width: (rg.w / page.width) * 100,
      height: (rg.h / page.height) * 100,
    };
  };

  const modelFor = async (p) => {
    if (modelCache.current.has(p)) return modelCache.current.get(p);
    const { doc, OPS } = docRef.current;
    const model = await loadPageModel(doc, p, OPS);
    modelCache.current.set(p, model);
    runCache.current.set(p, model.runs);
    return model;
  };

  /**
   * Searching the whole document, not just the page on screen.
   *
   * Blacking out a name on page one and missing it in an appendix is the
   * commonest way a redacted file still leaks, so this sweeps every page.
   */
  const handleSearch = async () => {
    const q = query.trim();
    if (!q || searching || !docRef.current) return;
    setSearching(true); setSearchNote(null); setError(null);
    try {
      const found = [];
      for (let p = 0; p < pages.length; p++) {
        const model = await modelFor(p);
        for (const hit of findInSegments(model.segments, q, { caseSensitive })) {
          found.push({ ...hit, pageIndex: p });
        }
      }
      // Searching twice for the same term must not stack duplicate boxes.
      //
      // The new list is built HERE rather than inside a setRegions updater.
      // React may defer an updater until render, so a counter incremented
      // inside one is still zero when the next line reads it — which reported
      // "2 already selected" for two areas that had just been added.
      const next = [...regions];
      let added = 0;
      for (const hit of found) {
        if (next.some(r => sameRegion(r, hit))) continue;
        next.push({
          id: `f${Date.now()}-${next.length}`,
          pageIndex: hit.pageIndex,
          x: hit.x, y: hit.y, w: hit.w, h: hit.h,
          found: q,
        });
        added++;
      }
      setRegions(next);
      const pagesHit = new Set(found.map(h => h.pageIndex)).size;
      setSearchNote(found.length === 0
        ? `No match for “${q}”.`
        : `${found.length} match${found.length === 1 ? "" : "es"} on ${pagesHit} page${pagesHit === 1 ? "" : "s"}` +
          (added < found.length ? ` — ${found.length - added} already selected.` : "."));
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setSearching(false);
    }
  };

  const handleProcess = async () => {
    if (!file || processing || !regions.length) return;
    setProcessing(true); setError(null);
    try {
      const { bytes, report } = await redactPdf(
        new Uint8Array(await file.arrayBuffer()),
        regions.map(({ pageIndex: p, x, y, w, h }) => ({ pageIndex: p, x, y, w, h })),
        {
          colour: colour === "white" ? { r: 1, g: 1, b: 1 } : { r: 0, g: 0, b: 0 },
          pageRuns: async (p) => {
            if (runCache.current.has(p)) return runCache.current.get(p);
            const { doc, OPS } = docRef.current;
            const model = await loadPageModel(doc, p, OPS);
            runCache.current.set(p, model.runs);
            return model.runs;
          },
        },
      );
      setResult({ blob: new Blob([bytes], { type: "application/pdf" }), report });
    } catch (e) {
      setError(e?.name === "EncryptedDocumentError"
        ? "This PDF is password-protected. Unlock it first, then redact."
        : (e?.message || String(e)));
    } finally {
      setProcessing(false);
    }
  };

  const reset = () => {
    setFile(null); setPages([]); setRegions([]); setResult(null); setError(null);
    docRef.current = null; runCache.current = new Map(); modelCache.current = new Map();
    setQuery(""); setSearchNote(null);
  };

  const onThisPage = regions.filter(r => r.pageIndex === pageIndex);
  const live = drag && {
    left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1),
    width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0),
  };

  return (
    <>
      <Header />
      <div className="tool-page" style={{ maxWidth: 1060 }}>
        <Link href="/" className="back-link"><ArrowLeft size={14} /> Back to all tools</Link>
        <div className="tool-page-header">
          <h1><Highlighter size={28} strokeWidth={2} /> Redact PDF</h1>
          <p>Permanently remove text and images — not just cover them up</p>
        </div>

        {result ? (
          <div className="result-card">
            <CheckCircle size={40} color="var(--success)" />
            <h3>Redaction Applied</h3>
            <p>
              {result.report.textOpsErased} text {result.report.textOpsErased === 1 ? "run" : "runs"} erased
              {result.report.imagesRemoved ? ` • ${result.report.imagesRemoved} image${result.report.imagesRemoved === 1 ? "" : "s"} removed` : ""}
              {" "}• {result.report.pages} {result.report.pages === 1 ? "page" : "pages"} • {formatFileSize(result.blob.size)}
            </p>
            <p className="rd-assurance">
              <ShieldCheck size={14} /> The removed text is gone from the file itself. It cannot be
              selected, copied, searched or recovered with a hex editor.
            </p>
            {result.report.boxesWidened > 0 && (
              <p className="rd-assurance">
                <AlertTriangle size={14} /> {result.report.boxesWidened}{" "}
                {result.report.boxesWidened === 1 ? "box was" : "boxes were"} widened. A line of text
                can only be removed whole, so the box grew to cover everything that went with it.
              </p>
            )}
            {result.report.warnings?.length ? (
              <div className="ed-error rd-warn">
                <AlertTriangle size={14} />
                <div>
                  {result.report.warnings.map((w, i) => (
                    <div key={i}>
                      {Number.isFinite(w.pageIndex) ? `Page ${w.pageIndex + 1}: ` : ""}{w.reason}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <button className="btn-primary"
              onClick={() => downloadBlob(result.blob, file.name.replace(/\.pdf$/i, "") + "_redacted.pdf")}>
              <Download size={16} /> Download Redacted PDF
            </button>
            <button className="btn-secondary" onClick={reset}>Redact Another</button>
          </div>
        ) : !file ? (
          <>
            <Dropzone onFiles={handleFiles} accept=".pdf" multiple={false}
              label="Drop your PDF file here"
              sublabel="Redacted in your browser — nothing is uploaded" />
            {error && <div className="ed-error">{error}</div>}
          </>
        ) : (
          <div className="sign-layout">
            <div className="sign-pad">
              <h3 className="rd-h">Find text</h3>
              <div className="rd-search">
                <input
                  className="text-input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
                  placeholder="A name, number or phrase"
                  aria-label="Text to find and redact"
                />
                <button className="btn-secondary" onClick={handleSearch}
                  disabled={!query.trim() || searching}>
                  {searching ? <Loader2 size={14} className="ed-spin" /> : <Search size={14} />}
                  Find all
                </button>
              </div>
              <label className="rd-check">
                <input type="checkbox" checked={caseSensitive}
                  onChange={(e) => setCaseSensitive(e.target.checked)} />
                Match case
              </label>
              {searchNote && <p className="rd-note rd-found">{searchNote}</p>}

              <h3 className="rd-h rd-h-areas">Areas to redact</h3>
              {regions.length === 0 ? (
                <p className="sign-hint">
                  Drag a box over anything that must go — a name, an address, a number.
                  Everything inside it is deleted from the document.
                </p>
              ) : (
                <ul className="rd-list">
                  {regions.map((rg, i) => (
                    <li key={rg.id}>
                      <button className="rd-goto" onClick={() => setPageIndex(rg.pageIndex)}>
                        #{i + 1} · page {rg.pageIndex + 1} ·{" "}
                        {rg.found ? `“${rg.found}”` : `${Math.round(rg.w)}×${Math.round(rg.h)}pt`}
                      </button>
                      <button className="rd-del" aria-label={`Remove area ${i + 1}`}
                        onClick={() => setRegions(rs => rs.filter(x => x.id !== rg.id))}>
                        <Trash2 size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="control-group">
                <label>Box colour</label>
                <div className="sign-modes">
                  <button className={colour === "black" ? "is-on" : ""} onClick={() => setColour("black")}>Black</button>
                  <button className={colour === "white" ? "is-on" : ""} onClick={() => setColour("white")}>White</button>
                </div>
              </div>

              <button className="btn-primary" onClick={handleProcess}
                disabled={!regions.length || processing}>
                {processing
                  ? <><Loader2 size={16} className="ed-spin" /> Redacting…</>
                  : <>Redact {regions.length || ""} {regions.length === 1 ? "area" : "areas"}</>}
              </button>
              {regions.length > 0 && (
                <button className="btn-secondary" onClick={() => setRegions([])}>Clear all areas</button>
              )}
              <p className="rd-note">
                This cannot be undone in the downloaded file — that is the point.
                Your original stays untouched on your device.
              </p>
              {error && <div className="ed-error">{error}</div>}
            </div>

            <div className="sign-preview">
              {loadingPages ? (
                <div className="ed-loading"><Loader2 size={18} className="ed-spin" /> Rendering pages…</div>
              ) : pages.length ? (
                <>
                  <div className="sign-pager">
                    <button onClick={() => setPageIndex(i => Math.max(0, i - 1))}
                      disabled={pageIndex === 0} aria-label="Previous page"><ChevronLeft size={15} /></button>
                    <span>Page {pageIndex + 1} of {pages.length}</span>
                    <button onClick={() => setPageIndex(i => Math.min(pages.length - 1, i + 1))}
                      disabled={pageIndex >= pages.length - 1} aria-label="Next page"><ChevronRight size={15} /></button>
                    {onThisPage.length > 0 && <span className="rd-count">{onThisPage.length} on this page</span>}
                  </div>
                  <div
                    ref={pageRef}
                    className="sign-page rd-page"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={() => setDrag(null)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={pages[pageIndex].url} alt={`Page ${pageIndex + 1}`} draggable={false} />
                    {onThisPage.map((rg) => {
                      const p = toPreview(rg);
                      return p ? (
                        <span key={rg.id} className="rd-rect"
                          style={{ left: `${p.left}%`, top: `${p.top}%`, width: `${p.width}%`, height: `${p.height}%` }} />
                      ) : null;
                    })}
                    {live && (
                      <span className="rd-rect rd-rect-live"
                        style={{ left: live.left, top: live.top, width: live.width, height: live.height }} />
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

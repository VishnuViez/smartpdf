"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft, PenLine, CheckCircle, Download, Eraser, Loader2,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import Header from "../../components/Header";
import Dropzone from "../../components/Dropzone";
import { embedSignature, formatFileSize, downloadBlob } from "../../lib/pdf-utils";
import { loadPdfjs, PDFJS_ASSETS } from "../../lib/pdf/pdfjs.js";

const PREVIEW_WIDTH = 520;
const SIG_CANVAS = { width: 420, height: 130 };

export default function SignPage() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);

  const [mode, setMode] = useState("draw");
  const [typedSig, setTypedSig] = useState("");
  const [hasInk, setHasInk] = useState(false);
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);

  // page preview + placement
  const [pages, setPages] = useState([]);          // [{url, width, height}] in PDF units
  const [pageIndex, setPageIndex] = useState(0);
  const [loadingPages, setLoadingPages] = useState(false);
  const [placement, setPlacement] = useState(null); // { xPct, yPct } within the page
  const [sigWidth, setSigWidth] = useState(180);    // PDF units

  const handleFiles = useCallback(async (files) => {
    const f = files?.[0];
    if (!f) return;
    setFile(f); setResult(null); setError(null); setPlacement(null); setPages([]);
    setLoadingPages(true);
    try {
      const pdfjsLib = await loadPdfjs();
      const doc = await pdfjsLib.getDocument({ data: await f.arrayBuffer(), ...PDFJS_ASSETS }).promise;
      const out = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: PREVIEW_WIDTH / base.width });
        const c = document.createElement("canvas");
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        await page.render({ canvasContext: c.getContext("2d"), viewport: vp, background: "#fff" }).promise;
        out.push({ url: c.toDataURL("image/jpeg", 0.72), width: base.width, height: base.height });
      }
      setPages(out);
      setPageIndex(0);
    } catch (e) {
      setError(e?.name === "EncryptedDocumentError" ? e.message : (e?.message || String(e)));
    } finally {
      setLoadingPages(false);
    }
  }, []);

  // keep the signature pad on a light background so what you draw is what you get
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
  }, [file, mode]);

  const posOf = (e, el) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const startDraw = (e) => {
    drawingRef.current = true;
    const ctx = canvasRef.current.getContext("2d");
    const p = posOf(e, canvasRef.current);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const draw = (e) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    const p = posOf(e, canvasRef.current);
    ctx.lineTo(p.x, p.y);
    // Ink must be DARK. Drawing in white produced a signature that was
    // invisible once placed on a white page.
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    setHasInk(true);
  };
  const stopDraw = () => { drawingRef.current = false; };

  const clearCanvas = () => {
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    setHasInk(false);
  };

  /** Render the signature to transparent PNG bytes, trimmed to its ink. */
  const getSignatureBytes = async () => {
    const src = canvasRef.current;
    const work = document.createElement("canvas");
    work.width = src.width; work.height = src.height;
    const wctx = work.getContext("2d");

    if (mode === "type") {
      wctx.font = "italic 54px Georgia, 'Times New Roman', serif";
      wctx.fillStyle = "#111111";
      wctx.textBaseline = "middle";
      wctx.fillText(typedSig, 16, work.height / 2);
    } else {
      wctx.drawImage(src, 0, 0);
    }

    // drop the white background so the signature sits on the page, not in a box
    const img = wctx.getImageData(0, 0, work.width, work.height);
    const d = img.data;
    let minX = work.width, minY = work.height, maxX = 0, maxY = 0, found = false;
    for (let y = 0; y < work.height; y++) {
      for (let x = 0; x < work.width; x++) {
        const i = (y * work.width + x) * 4;
        const dark = d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200;
        if (dark && d[i + 3] > 0) {
          found = true;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        } else {
          d[i + 3] = 0;                      // make the paper transparent
        }
      }
    }
    wctx.putImageData(img, 0, 0);
    if (!found) return null;

    const pad = 6;
    const cropW = Math.min(work.width, maxX - minX + pad * 2);
    const cropH = Math.min(work.height, maxY - minY + pad * 2);
    const out = document.createElement("canvas");
    out.width = cropW; out.height = cropH;
    out.getContext("2d").drawImage(work, Math.max(0, minX - pad), Math.max(0, minY - pad), cropW, cropH, 0, 0, cropW, cropH);

    const blob = await new Promise(res => out.toBlob(res, "image/png"));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), aspect: cropH / cropW };
  };

  const placeOnPage = (e) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    setPlacement({
      xPct: (e.clientX - r.left) / r.width,
      yPct: (e.clientY - r.top) / r.height,
    });
  };

  const handleProcess = async () => {
    if (!file || processing) return;
    setProcessing(true); setError(null);
    try {
      const sig = await getSignatureBytes();
      if (!sig) throw new Error("Draw or type a signature first.");
      if (!placement) throw new Error("Click on the page preview to choose where the signature goes.");

      const page = pages[pageIndex];
      const height = sigWidth * sig.aspect;
      // placement is the CENTRE of the signature; PDF y counts from the bottom
      const x = placement.xPct * page.width - sigWidth / 2;
      const y = (1 - placement.yPct) * page.height - height / 2;

      setResult(await embedSignature(file, sig.bytes, {
        x: Math.max(0, Math.min(x, page.width - sigWidth)),
        y: Math.max(0, Math.min(y, page.height - height)),
        width: sigWidth, height, pageIndex,
      }));
    } catch (e) {
      setError(e?.name === "EncryptedDocumentError" ? e.message : (e?.message || String(e)));
    } finally {
      setProcessing(false);
    }
  };

  const reset = () => {
    setFile(null); setResult(null); setError(null);
    setPages([]); setPlacement(null); setTypedSig(""); setHasInk(false);
  };

  const ready = file && placement && (mode === "type" ? typedSig.trim().length > 0 : hasInk);

  return (
    <>
      <Header />
      <div className="tool-page" style={{ maxWidth: 1000 }}>
        <Link href="/" className="back-link"><ArrowLeft size={14} /> Back to all tools</Link>
        <div className="tool-page-header">
          <h1><PenLine size={28} strokeWidth={2} /> Sign PDF</h1>
          <p>Draw or type your signature, then click where it should go</p>
        </div>

        {result ? (
          <div className="result-card">
            <CheckCircle size={40} color="var(--success)" />
            <h3>PDF Signed</h3>
            <p>{result.pageCount} pages • {formatFileSize(result.blob.size)}</p>
            <button className="btn-primary"
              onClick={() => downloadBlob(result.blob, file.name.replace(/\.pdf$/i, "") + "_signed.pdf")}>
              <Download size={16} /> Download Signed PDF
            </button>
            <button className="btn-secondary" onClick={reset}>Sign Another</button>
          </div>
        ) : !file ? (
          <>
            <Dropzone onFiles={handleFiles} accept=".pdf" multiple={false}
              label="Drop your PDF file here"
              sublabel="Signed in your browser — nothing is uploaded" />
            {error && <div className="ed-error">{error}</div>}
          </>
        ) : (
          <div className="sign-layout">
            <div className="sign-pad">
              <div className="sign-modes">
                <button className={mode === "draw" ? "is-on" : ""} onClick={() => setMode("draw")}>Draw</button>
                <button className={mode === "type" ? "is-on" : ""} onClick={() => setMode("type")}>Type</button>
              </div>

              {mode === "draw" ? (
                <>
                  <canvas
                    ref={canvasRef}
                    width={SIG_CANVAS.width} height={SIG_CANVAS.height}
                    className="sign-canvas"
                    onMouseDown={startDraw} onMouseMove={draw}
                    onMouseUp={stopDraw} onMouseLeave={stopDraw}
                  />
                  <button className="btn-secondary sign-clear" onClick={clearCanvas}>
                    <Eraser size={14} /> Clear
                  </button>
                </>
              ) : (
                <input
                  className="text-input sign-type"
                  value={typedSig}
                  onChange={(e) => setTypedSig(e.target.value)}
                  placeholder="Type your name"
                  aria-label="Typed signature"
                />
              )}

              <div className="control-group">
                <label htmlFor="sigw">Signature width: {sigWidth}pt</label>
                <input id="sigw" type="range" min="60" max="360" value={sigWidth}
                  onChange={(e) => setSigWidth(Number(e.target.value))} />
              </div>

              <button className="btn-primary" onClick={handleProcess} disabled={!ready || processing}>
                {processing ? <><Loader2 size={16} className="ed-spin" /> Signing…</> : "Sign PDF"}
              </button>
              {!placement && <p className="sign-hint">Click the page on the right to place your signature.</p>}
              {error && <div className="ed-error">{error}</div>}
            </div>

            <div className="sign-preview">
              {loadingPages ? (
                <div className="ed-loading"><Loader2 size={18} className="ed-spin" /> Rendering pages…</div>
              ) : pages.length ? (
                <>
                  <div className="sign-pager">
                    <button onClick={() => { setPageIndex(i => Math.max(0, i - 1)); setPlacement(null); }}
                      disabled={pageIndex === 0} aria-label="Previous page"><ChevronLeft size={15} /></button>
                    <span>Page {pageIndex + 1} of {pages.length}</span>
                    <button onClick={() => { setPageIndex(i => Math.min(pages.length - 1, i + 1)); setPlacement(null); }}
                      disabled={pageIndex >= pages.length - 1} aria-label="Next page"><ChevronRight size={15} /></button>
                  </div>
                  <div className="sign-page" onClick={placeOnPage}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={pages[pageIndex].url} alt={`Page ${pageIndex + 1}`} />
                    {placement && (
                      <span className="sign-marker"
                        style={{ left: `${placement.xPct * 100}%`, top: `${placement.yPct * 100}%`,
                                 width: `${(sigWidth / pages[pageIndex].width) * 100}%` }} />
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

"use client";
import { useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft, RotateCw, RotateCcw, CheckCircle, Download, Loader2, Undo2,
} from "lucide-react";
import Header from "../../components/Header";
import Dropzone from "../../components/Dropzone";
import { rotatePDF, formatFileSize, downloadBlob } from "../../lib/pdf-utils";
import { loadPdfjs, PDFJS_ASSETS } from "../../lib/pdf/pdfjs.js";

const THUMB_WIDTH = 150;

export default function RotatePage() {
  const [file, setFile] = useState(null);
  const [thumbs, setThumbs] = useState([]);
  const [angles, setAngles] = useState({});      // pageIndex -> accumulated degrees
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleFiles = useCallback(async (files) => {
    const f = files?.[0];
    if (!f) return;
    setFile(f); setResult(null); setError(null); setAngles({}); setThumbs([]);
    setLoading(true);
    try {
      const pdfjsLib = await loadPdfjs();
      const doc = await pdfjsLib.getDocument({ data: await f.arrayBuffer(), ...PDFJS_ASSETS }).promise;
      const out = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport, background: "#fff" }).promise;
        out.push({ index: i - 1, url: canvas.toDataURL("image/jpeg", 0.7), baseRotation: page.rotate });
      }
      setThumbs(out);
    } catch (e) {
      setError(e?.name === "EncryptedDocumentError" ? e.message : (e?.message || String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  const turn = (index, delta) =>
    setAngles(a => {
      const next = { ...a, [index]: ((((a[index] || 0) + delta) % 360) + 360) % 360 };
      if (next[index] === 0) delete next[index];
      return next;
    });

  const turnAll = (delta) =>
    setAngles(a => {
      const next = {};
      for (const t of thumbs) {
        const v = ((((a[t.index] || 0) + delta) % 360) + 360) % 360;
        if (v !== 0) next[t.index] = v;
      }
      return next;
    });

  const changed = Object.keys(angles).length;

  const handleProcess = async () => {
    if (!file || !changed || processing) return;
    setProcessing(true); setError(null);
    try {
      setResult(await rotatePDF(file, angles));
    } catch (e) {
      setError(e?.name === "EncryptedDocumentError" ? e.message : (e?.message || String(e)));
    } finally {
      setProcessing(false);
    }
  };

  const reset = () => {
    setFile(null); setThumbs([]); setAngles({}); setResult(null); setError(null);
  };

  return (
    <>
      <Header />
      <div className="tool-page" style={{ maxWidth: 1000 }}>
        <Link href="/" className="back-link"><ArrowLeft size={14} /> Back to all tools</Link>
        <div className="tool-page-header">
          <h1><RotateCw size={28} strokeWidth={2} /> Rotate Pages</h1>
          <p>Turn any page individually, or all of them at once</p>
        </div>

        {result ? (
          <div className="result-card">
            <CheckCircle size={40} color="var(--success)" />
            <h3>Pages Rotated</h3>
            <p>{result.rotated} of {result.pageCount} pages • {formatFileSize(result.blob.size)}</p>
            <button className="btn-primary"
              onClick={() => downloadBlob(result.blob, file.name.replace(/\.pdf$/i, "") + "_rotated.pdf")}>
              <Download size={16} /> Download PDF
            </button>
            <button className="btn-secondary" onClick={reset}>Rotate Another</button>
          </div>
        ) : !file ? (
          <>
            <Dropzone onFiles={handleFiles} accept=".pdf" multiple={false}
              label="Drop your PDF file here"
              sublabel="Rotated in your browser — nothing is uploaded" />
            {error && <div className="ed-error">{error}</div>}
          </>
        ) : loading ? (
          <div className="ed-loading"><Loader2 size={18} className="ed-spin" /> Rendering pages…</div>
        ) : (
          <>
            <div className="rotate-bulk">
              <span>All pages:</span>
              <button className="btn-secondary" onClick={() => turnAll(-90)}><RotateCcw size={15} /> Left</button>
              <button className="btn-secondary" onClick={() => turnAll(90)}><RotateCw size={15} /> Right</button>
              <button className="btn-secondary" onClick={() => turnAll(180)}>180°</button>
              {changed > 0 && (
                <button className="btn-secondary" onClick={() => setAngles({})}>
                  <Undo2 size={15} /> Reset
                </button>
              )}
              <span className="rotate-count">
                {changed ? `${changed} page${changed === 1 ? "" : "s"} will be rotated` : "No changes yet"}
              </span>
            </div>

            <div className="rotate-grid">
              {thumbs.map(t => {
                const applied = angles[t.index] || 0;
                return (
                  <div key={t.index} className={`rotate-card${applied ? " is-changed" : ""}`}>
                    <div className="rotate-thumb">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={t.url} alt={`Page ${t.index + 1}`}
                        style={{ transform: `rotate(${applied}deg)` }} />
                    </div>
                    <div className="rotate-controls">
                      <button onClick={() => turn(t.index, -90)} title="Rotate left" aria-label={`Rotate page ${t.index + 1} left`}>
                        <RotateCcw size={14} />
                      </button>
                      <span>{t.index + 1}{applied ? ` · ${applied}°` : ""}</span>
                      <button onClick={() => turn(t.index, 90)} title="Rotate right" aria-label={`Rotate page ${t.index + 1} right`}>
                        <RotateCw size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rotate-actions">
              <button className="btn-primary" onClick={handleProcess} disabled={!changed || processing}>
                {processing ? <><Loader2 size={16} className="ed-spin" /> Rotating…</> : `Apply to ${changed} page${changed === 1 ? "" : "s"}`}
              </button>
              <button className="btn-secondary" onClick={reset}>Start Over</button>
            </div>
            {error && <div className="ed-error">{error}</div>}
          </>
        )}
      </div>
    </>
  );
}

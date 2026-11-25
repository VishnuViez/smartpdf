"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Minimize2, CheckCircle, Download, Loader2 } from "lucide-react";
import Header from "../../components/Header";
import Dropzone from "../../components/Dropzone";
import { compressPDF, formatFileSize, downloadBlob } from "../../lib/pdf-utils";

const PRESETS = [
  { key: "light", title: "Light", detail: "Visually lossless. Best when the file will be printed." },
  { key: "balanced", title: "Balanced", detail: "Recommended. Large savings, no visible difference on screen." },
  { key: "strong", title: "Strong", detail: "Smallest file. Images are noticeably softer up close." },
];

export default function CompressPage() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [preset, setPreset] = useState("balanced");
  const [progress, setProgress] = useState({ pct: 0, note: "" });

  const handleFiles = (files) => { setFile(files[0]); setResult(null); setError(null); };

  const handleProcess = async () => {
    if (!file || processing) return;
    setProcessing(true);
    setError(null);
    setProgress({ pct: 0, note: "starting" });
    try {
      setResult(await compressPDF(file, {
        preset,
        onProgress: (pct, note) => setProgress({ pct, note }),
      }));
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setProcessing(false);
    }
  };

  const reset = () => { setFile(null); setResult(null); setError(null); setProgress({ pct: 0, note: "" }); };

  return (
    <>
      <Header />
      <div className="tool-page">
        <Link href="/" className="back-link"><ArrowLeft size={14} /> Back to all tools</Link>
        <div className="tool-page-header">
          <h1><Minimize2 size={28} strokeWidth={2} /> Compress PDF</h1>
          <p>Make your PDF smaller without breaking it</p>
        </div>

        {!result ? (
          <>
            <Dropzone onFiles={handleFiles} accept=".pdf" multiple={false}
              label="Drop your PDF file here"
              sublabel="Compressed in your browser — the file never leaves your device" />

            {file && (
              <div className="tool-controls">
                <div className="control-group">
                  <label>Compression level</label>
                  <div className="preset-list">
                    {PRESETS.map(p => (
                      <label key={p.key} className={`preset-row${preset === p.key ? " is-on" : ""}`}>
                        <input type="radio" name="preset" value={p.key}
                          checked={preset === p.key} onChange={() => setPreset(p.key)} />
                        <span>
                          <strong>{p.title}</strong>
                          <em>{p.detail}</em>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <button className="btn-primary" onClick={handleProcess} disabled={processing}>
                  {processing
                    ? <><Loader2 size={16} className="ed-spin" /> {progress.note || "Compressing"}…</>
                    : "Compress PDF"}
                </button>

                {processing && (
                  <div className="progress-track" role="progressbar" aria-valuenow={progress.pct}
                       aria-valuemin={0} aria-valuemax={100}>
                    <div className="progress-fill" style={{ width: `${progress.pct}%` }} />
                  </div>
                )}
                {error && <div className="ed-error">Could not compress this file: {error}</div>}
              </div>
            )}
          </>
        ) : (
          <div className="result-card">
            <CheckCircle size={40} color="var(--success)" />
            <h3>{result.unchanged ? "Already as small as it can be" : "PDF Compressed"}</h3>
            <p>
              {formatFileSize(result.originalSize)} → {formatFileSize(result.compressedSize)}
              {!result.unchanged && <strong className="saving"> · {Math.round(result.ratio * 100)}% smaller</strong>}
            </p>
            {result.unchanged ? (
              <p className="result-detail-muted">
                Nothing could be removed safely, so your original file is returned untouched.
              </p>
            ) : (
              <p className="result-detail-muted">
                {result.stats.imagesRecompressed > 0 &&
                  `${result.stats.imagesRecompressed} image${result.stats.imagesRecompressed === 1 ? "" : "s"} recompressed · `}
                {result.stats.streamsDeflated > 0 &&
                  `${result.stats.streamsDeflated} stream${result.stats.streamsDeflated === 1 ? "" : "s"} compressed · `}
                {result.pageCount} pages preserved
              </p>
            )}
            <button className="btn-primary"
              onClick={() => downloadBlob(result.blob, file.name.replace(/\.pdf$/i, "") + "_compressed.pdf")}>
              <Download size={16} /> Download PDF
            </button>
            <button className="btn-secondary" onClick={reset}>Compress Another</button>
          </div>
        )}
      </div>
    </>
  );
}

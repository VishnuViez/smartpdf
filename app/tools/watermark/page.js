"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Droplets, CheckCircle, Download } from "lucide-react";
import Header from "../../components/Header";
import Dropzone from "../../components/Dropzone";
import { addWatermark, formatFileSize, downloadBlob } from "../../lib/pdf-utils";

export default function WatermarkPage() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [text, setText] = useState("CONFIDENTIAL");
  const [opacity, setOpacity] = useState(15);
  const [fontSize, setFontSize] = useState(60);
  const [rotation, setRotation] = useState(45);

  const handleFiles = (files) => { setFile(files[0]); setResult(null); };

  const handleProcess = async () => {
    if (!file || !text.trim()) return;
    setProcessing(true);
    try {
      const res = await addWatermark(file, text, { opacity: opacity / 100, fontSize, rotation });
      setResult(res);
    } catch (e) { alert("Error: " + e.message); }
    setProcessing(false);
  };

  return (
    <>
      <Header />
      <div className="tool-page">
        <Link href="/" className="back-link"><ArrowLeft size={14} /> Back to all tools</Link>
        <div className="tool-page-header">
          <h1><Droplets size={28} strokeWidth={2} /> Watermark PDF</h1>
          <p>Stamp text watermark over your PDF pages</p>
        </div>

        {!result ? (
          <>
            <Dropzone onFiles={handleFiles} accept=".pdf" multiple={false} label="Drop your PDF file here" sublabel="or click to browse" />
            {file && (
              <div className="tool-controls">
                <div className="control-group">
                  <label>Watermark Text</label>
                  <input type="text" value={text} onChange={(e) => setText(e.target.value)} className="text-input" placeholder="e.g. CONFIDENTIAL, DRAFT" />
                </div>
                <div className="control-group">
                  <label>Opacity: {opacity}%</label>
                  <input type="range" min="5" max="90" value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
                </div>
                <div className="control-group">
                  <label>Font Size: {fontSize}px</label>
                  <input type="range" min="20" max="120" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} />
                </div>
                <div className="control-group">
                  <label>Rotation: {rotation}°</label>
                  <input type="range" min="0" max="90" value={rotation} onChange={(e) => setRotation(Number(e.target.value))} />
                </div>
                <button className="btn-primary" onClick={handleProcess} disabled={processing}>
                  {processing ? "Adding watermark..." : "Add Watermark"}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="result-card">
            <CheckCircle size={40} color="var(--success)" />
            <h3>Watermark Added!</h3>
            <p>{result.pageCount} pages • {formatFileSize(result.blob.size)}</p>
            <button className="btn-primary" onClick={() => downloadBlob(result.blob, file.name.replace(".pdf", "_watermarked.pdf"))}>
              <Download size={16} /> Download PDF
            </button>
            <button className="btn-secondary" onClick={() => { setFile(null); setResult(null); }}>Process Another</button>
          </div>
        )}
      </div>
    </>
  );
}

"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Hash, CheckCircle, Download } from "lucide-react";
import Header from "../../components/Header";
import Dropzone from "../../components/Dropzone";
import { addPageNumbers, formatFileSize, downloadBlob } from "../../lib/pdf-utils";

export default function PageNumbersPage() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [position, setPosition] = useState("bottom-center");
  const [format, setFormat] = useState("1");
  const [fontSize, setFontSize] = useState(12);
  const [skipFirst, setSkipFirst] = useState(false);

  const handleFiles = (files) => { setFile(files[0]); setResult(null); };

  const handleProcess = async () => {
    if (!file) return;
    setProcessing(true);
    try {
      const res = await addPageNumbers(file, {
        position, format, fontSize,
        startPage: skipFirst ? 1 : 0,
      });
      setResult(res);
    } catch (e) { setError(e?.name === "EncryptedDocumentError" ? e.message : (e?.message || String(e))); }
    setProcessing(false);
  };

  return (
    <>
      <Header />
      <div className="tool-page">
        <Link href="/" className="back-link"><ArrowLeft size={14} /> Back to all tools</Link>
        <div className="tool-page-header">
          <h1><Hash size={28} strokeWidth={2} /> Add Page Numbers</h1>
          <p>Add page numbers to your PDF with custom position and format</p>
        </div>

        {!result ? (
          <>
            <Dropzone onFiles={handleFiles} accept=".pdf" multiple={false} label="Drop your PDF file here" sublabel="or click to browse" />
            {file && (
              <div className="tool-controls">
                <div className="control-group">
                  <label>Position</label>
                  <select value={position} onChange={(e) => setPosition(e.target.value)} className="select-input">
                    <option value="bottom-center">Bottom Center</option>
                    <option value="bottom-left">Bottom Left</option>
                    <option value="bottom-right">Bottom Right</option>
                    <option value="top-center">Top Center</option>
                  </select>
                </div>
                <div className="control-group">
                  <label>Format</label>
                  <select value={format} onChange={(e) => setFormat(e.target.value)} className="select-input">
                    <option value="1">1, 2, 3...</option>
                    <option value="Page N">Page 1, Page 2...</option>
                    <option value="N of M">1 of 10, 2 of 10...</option>
                    <option value="- N -">- 1 -, - 2 -...</option>
                  </select>
                </div>
                <div className="control-group">
                  <label>Font Size: {fontSize}px</label>
                  <input type="range" min="8" max="24" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} />
                </div>
                <div className="control-group">
                  <label className="checkbox-label">
                    <input type="checkbox" checked={skipFirst} onChange={(e) => setSkipFirst(e.target.checked)} />
                    Skip first page (cover page)
                  </label>
                </div>
                <button className="btn-primary" onClick={handleProcess} disabled={processing}>
                  {processing ? "Adding numbers..." : "Add Page Numbers"}
                </button>
                {error && <div className="ed-error">{error}</div>}
              </div>
            )}
          </>
        ) : (
          <div className="result-card">
            <CheckCircle size={40} color="var(--success)" />
            <h3>Page Numbers Added!</h3>
            <p>{result.pageCount} pages • {formatFileSize(result.blob.size)}</p>
            <button className="btn-primary" onClick={() => downloadBlob(result.blob, file.name.replace(".pdf", "_numbered.pdf"))}>
              <Download size={16} /> Download PDF
            </button>
            <button className="btn-secondary" onClick={() => { setFile(null); setResult(null); }}>Process Another</button>
          </div>
        )}
      </div>
    </>
  );
}

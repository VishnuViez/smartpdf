"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { Minimize2, CheckCircle, Download, ArrowLeft } from "lucide-react";
import Header from "../../components/Header";
import Dropzone from "../../components/Dropzone";
import FileList from "../../components/FileList";
import { compressPDF, formatFileSize, downloadBlob } from "../../lib/pdf-utils";

export default function CompressPage() {
  const [file, setFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);

  const handleFilesAdded = useCallback((newFiles) => {
    const pdfFile = newFiles.find(
      (f) => f.type === "application/pdf" || f.name.endsWith(".pdf")
    );
    if (pdfFile) {
      setFile(pdfFile);
      setResult(null);
    }
  }, []);

  const handleCompress = async () => {
    if (!file) return;
    setProcessing(true);
    setResult(null);

    try {
      const res = await compressPDF(file);
      setResult(res);
    } catch (err) {
      alert("Error compressing PDF: " + err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = () => {
    if (result) {
      downloadBlob(result.blob, `compressed_${file.name}`);
    }
  };

  const handleReset = () => {
    setFile(null);
    setResult(null);
  };

  const savings = result
    ? Math.max(0, Math.round((1 - result.compressedSize / result.originalSize) * 100))
    : 0;

  return (
    <>
      <Header />
      <div className="tool-page">
        <Link href="/" className="back-link">
          <ArrowLeft size={14} /> Back to all tools
        </Link>

        <div className="tool-page-header">
          <h1><Minimize2 size={28} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} /> Compress PDF</h1>
          <p>Reduce file size while maintaining quality</p>
        </div>

        {!result && (
          <>
            {!file ? (
              <Dropzone
                onFilesAdded={handleFilesAdded}
                accept=".pdf"
                multiple={false}
                label="Drop your PDF file here"
                sublabel="or click to browse"
              />
            ) : (
              <>
                <FileList files={[file]} onRemove={() => setFile(null)} />
                <button
                  className="btn-primary process-btn"
                  onClick={handleCompress}
                  disabled={processing}
                  id="compress-btn"
                >
                  {processing ? (
                    <>
                      <span className="spinner"></span> Compressing...
                    </>
                  ) : (
                    "Compress PDF →"
                  )}
                </button>
              </>
            )}
          </>
        )}

        {result && (
          <div className="result-card">
            <div className="result-icon"><CheckCircle size={48} color="var(--success)" /></div>
            <h3>Compression Complete!</h3>
            <p>
              {savings > 0
                ? `Reduced by ${savings}% — nice!`
                : "File is already well-optimized."}
            </p>
            <div className="result-stats">
              <div className="result-stat">
                <div className="label">Original</div>
                <div className="value">
                  {formatFileSize(result.originalSize)}
                </div>
              </div>
              <div className="result-stat">
                <div className="label">Compressed</div>
                <div className="value" style={{ color: "var(--success)" }}>
                  {formatFileSize(result.compressedSize)}
                </div>
              </div>
              <div className="result-stat">
                <div className="label">Savings</div>
                <div className="value">{savings}%</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button
                className="btn-primary download-btn"
                onClick={handleDownload}
                id="download-btn"
              >
                <Download size={16} /> Download Compressed PDF
              </button>
              <button className="btn-secondary" onClick={handleReset}>
                Compress Another
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

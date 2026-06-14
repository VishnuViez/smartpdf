"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { FileText, CheckCircle, Download, ArrowLeft } from "lucide-react";
import Header from "../../components/Header";
import Dropzone from "../../components/Dropzone";
import FileList from "../../components/FileList";
import { mergePDFs, formatFileSize, downloadBlob } from "../../lib/pdf-utils";

export default function MergePage() {
  const [files, setFiles] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);

  const handleFilesAdded = useCallback((newFiles) => {
    const pdfFiles = newFiles.filter(
      (f) => f.type === "application/pdf" || f.name.endsWith(".pdf")
    );
    setFiles((prev) => [...prev, ...pdfFiles]);
    setResult(null);
  }, []);

  const handleRemove = useCallback((index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setResult(null);
  }, []);

  const handleReorder = useCallback((newFiles) => {
    setFiles(newFiles);
    setResult(null);
  }, []);

  const handleMerge = async () => {
    if (files.length < 2) return;
    setProcessing(true);
    setProgress(0);
    setResult(null);

    try {
      const res = await mergePDFs(files, setProgress);
      setResult(res);
    } catch (err) {
      alert("Error merging PDFs: " + err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = () => {
    if (result) {
      downloadBlob(result.blob, "merged.pdf");
    }
  };

  const handleReset = () => {
    setFiles([]);
    setResult(null);
    setProgress(0);
  };

  const totalInputSize = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <>
      <Header />
      <div className="tool-page">
        <Link href="/" className="back-link">
          <ArrowLeft size={14} /> Back to all tools
        </Link>

        <div className="tool-page-header">
          <h1><FileText size={28} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} /> Merge PDF</h1>
          <p>Combine multiple PDF files into a single document</p>
        </div>

        {!result && (
          <>
            <Dropzone
              onFilesAdded={handleFilesAdded}
              accept=".pdf"
              multiple={true}
              label="Drop your PDF files here"
              sublabel="or click to browse • You can add multiple files"
            />

            <FileList
              files={files}
              onRemove={handleRemove}
              onReorder={handleReorder}
            />

            {files.length >= 2 && (
              <button
                className="btn-primary process-btn"
                onClick={handleMerge}
                disabled={processing}
                id="merge-btn"
              >
                {processing ? (
                  <>
                    <span className="spinner"></span> Merging...
                  </>
                ) : (
                  `Merge ${files.length} Files →`
                )}
              </button>
            )}

            {files.length === 1 && (
              <p
                style={{
                  textAlign: "center",
                  color: "var(--text-muted)",
                  marginTop: 16,
                  fontSize: "0.88rem",
                }}
              >
                Add at least 2 PDF files to merge
              </p>
            )}

            {processing && (
              <div className="progress-container">
                <div className="progress-bar-bg">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
                <div className="progress-text">Processing... {progress}%</div>
              </div>
            )}
          </>
        )}

        {result && (
          <div className="result-card">
            <div className="result-icon"><CheckCircle size={48} color="var(--success)" /></div>
            <h3>Merge Complete!</h3>
            <p>Your PDFs have been merged successfully.</p>
            <div className="result-stats">
              <div className="result-stat">
                <div className="label">Pages</div>
                <div className="value">{result.pageCount}</div>
              </div>
              <div className="result-stat">
                <div className="label">Original</div>
                <div className="value">{formatFileSize(totalInputSize)}</div>
              </div>
              <div className="result-stat">
                <div className="label">Output</div>
                <div className="value">{formatFileSize(result.size)}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button
                className="btn-primary download-btn"
                onClick={handleDownload}
                id="download-btn"
              >
                <Download size={16} /> Download Merged PDF
              </button>
              <button className="btn-secondary" onClick={handleReset}>
                Merge More
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

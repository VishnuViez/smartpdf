"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { ImagePlus, CheckCircle, Download, ArrowLeft } from "lucide-react";
import Header from "../../components/Header";
import Dropzone from "../../components/Dropzone";
import FileList from "../../components/FileList";
import { imagesToPDF, formatFileSize, downloadBlob } from "../../lib/pdf-utils";

export default function ImagesToPDFPage() {
  const [files, setFiles] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);

  const handleFilesAdded = useCallback((newFiles) => {
    const imageFiles = newFiles.filter((f) => f.type.startsWith("image/"));
    setFiles((prev) => [...prev, ...imageFiles]);
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

  const handleConvert = async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setProgress(0);
    setResult(null);

    try {
      const res = await imagesToPDF(files, setProgress);
      setResult(res);
    } catch (err) {
      alert("Error converting images: " + err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = () => {
    if (result) {
      downloadBlob(result.blob, "images_combined.pdf");
    }
  };

  const handleReset = () => {
    setFiles([]);
    setResult(null);
    setProgress(0);
  };

  return (
    <>
      <Header />
      <div className="tool-page">
        <Link href="/" className="back-link">
          <ArrowLeft size={14} /> Back to all tools
        </Link>

        <div className="tool-page-header">
          <h1><ImagePlus size={28} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} /> Images to PDF</h1>
          <p>Convert JPG, PNG, or WebP images into a single PDF</p>
        </div>

        {!result && (
          <>
            <Dropzone
              onFilesAdded={handleFilesAdded}
              accept="image/*"
              multiple={true}
              label="Drop your images here"
              sublabel="JPG, PNG, WebP supported"
            />

            <FileList
              files={files}
              onRemove={handleRemove}
              onReorder={handleReorder}
            />

            {files.length > 0 && (
              <button
                className="btn-primary process-btn"
                onClick={handleConvert}
                disabled={processing}
                id="convert-btn"
              >
                {processing ? (
                  <>
                    <span className="spinner"></span> Converting...
                  </>
                ) : (
                  `Convert ${files.length} Image${files.length > 1 ? "s" : ""} to PDF →`
                )}
              </button>
            )}

            {processing && (
              <div className="progress-container">
                <div className="progress-bar-bg">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
                <div className="progress-text">Converting... {progress}%</div>
              </div>
            )}
          </>
        )}

        {result && (
          <div className="result-card">
            <div className="result-icon"><CheckCircle size={48} color="var(--success)" /></div>
            <h3>Conversion Complete!</h3>
            <p>
              {result.pageCount} image{result.pageCount > 1 ? "s" : ""} combined
              into a single PDF.
            </p>
            <div className="result-stats">
              <div className="result-stat">
                <div className="label">Pages</div>
                <div className="value">{result.pageCount}</div>
              </div>
              <div className="result-stat">
                <div className="label">File Size</div>
                <div className="value">{formatFileSize(result.size)}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button
                className="btn-primary download-btn"
                onClick={handleDownload}
                id="download-btn"
              >
                <Download size={16} /> Download PDF
              </button>
              <button className="btn-secondary" onClick={handleReset}>
                Convert More
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

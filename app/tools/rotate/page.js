"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { RotateCw, CheckCircle, Download, ArrowLeft } from "lucide-react";
import Header from "../../components/Header";
import Dropzone from "../../components/Dropzone";
import FileList from "../../components/FileList";
import { rotatePDF, downloadBlob } from "../../lib/pdf-utils";

export default function RotatePage() {
  const [file, setFile] = useState(null);
  const [angle, setAngle] = useState(90);
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

  const handleRotate = async () => {
    if (!file) return;
    setProcessing(true);
    setResult(null);

    try {
      const res = await rotatePDF(file, angle);
      setResult(res);
    } catch (err) {
      alert("Error rotating PDF: " + err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = () => {
    if (result) {
      downloadBlob(result.blob, `rotated_${file.name}`);
    }
  };

  const handleReset = () => {
    setFile(null);
    setResult(null);
  };

  const angles = [
    { value: 90, label: "90° Clockwise" },
    { value: 180, label: "180°" },
    { value: 270, label: "90° Counter-clockwise" },
  ];

  return (
    <>
      <Header />
      <div className="tool-page">
        <Link href="/" className="back-link">
          <ArrowLeft size={14} /> Back to all tools
        </Link>

        <div className="tool-page-header">
          <h1><RotateCw size={28} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} /> Rotate Pages</h1>
          <p>Rotate all pages in your PDF document</p>
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

                <div
                  style={{
                    marginTop: 24,
                    padding: 24,
                    background: "var(--bg-card)",
                    borderRadius: "var(--radius-lg)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <h3 style={{ marginBottom: 16, fontSize: "1rem" }}>
                    Rotation Angle
                  </h3>
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    {angles.map((a) => (
                      <button
                        key={a.value}
                        onClick={() => setAngle(a.value)}
                        style={{
                          padding: "10px 20px",
                          background:
                            angle === a.value
                              ? "var(--accent)"
                              : "var(--bg-elevated)",
                          border: `1px solid ${angle === a.value ? "var(--accent)" : "var(--border)"}`,
                          borderRadius: "var(--radius-sm)",
                          color: "var(--text-primary)",
                          fontSize: "0.88rem",
                          fontWeight: angle === a.value ? 600 : 400,
                          cursor: "pointer",
                          transition: "all 0.2s",
                        }}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  className="btn-primary process-btn"
                  onClick={handleRotate}
                  disabled={processing}
                  id="rotate-btn"
                >
                  {processing ? (
                    <>
                      <span className="spinner"></span> Rotating...
                    </>
                  ) : (
                    "Rotate Pages →"
                  )}
                </button>
              </>
            )}
          </>
        )}

        {result && (
          <div className="result-card">
            <div className="result-icon"><CheckCircle size={48} color="var(--success)" /></div>
            <h3>Rotation Complete!</h3>
            <p>
              All {result.pageCount} pages rotated by {angle}°.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button
                className="btn-primary download-btn"
                onClick={handleDownload}
                id="download-btn"
              >
                <Download size={16} /> Download Rotated PDF
              </button>
              <button className="btn-secondary" onClick={handleReset}>
                Rotate Another
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

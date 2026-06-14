"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { Scissors, CheckCircle, Download, ArrowLeft } from "lucide-react";
import Header from "../../components/Header";
import Dropzone from "../../components/Dropzone";
import FileList from "../../components/FileList";
import { splitPDF, downloadBlob } from "../../lib/pdf-utils";
import JSZip from "jszip";

export default function SplitPage() {
  const [file, setFile] = useState(null);
  const [splitMode, setSplitMode] = useState("all");
  const [rangeStr, setRangeStr] = useState("");
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

  const handleSplit = async () => {
    if (!file) return;
    setProcessing(true);
    setResult(null);

    try {
      const range = splitMode === "all" ? "all" : rangeStr;
      const res = await splitPDF(file, range);
      setResult(res);
    } catch (err) {
      alert("Error splitting PDF: " + err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownloadAll = async () => {
    if (!result || result.blobs.length === 0) return;

    if (result.blobs.length === 1) {
      downloadBlob(result.blobs[0].blob, result.blobs[0].name);
      return;
    }

    const zip = new JSZip();
    result.blobs.forEach((item) => {
      zip.file(item.name, item.blob);
    });
    const zipBlob = await zip.generateAsync({ type: "blob" });
    downloadBlob(zipBlob, `${file.name.replace(".pdf", "")}_split.zip`);
  };

  const handleReset = () => {
    setFile(null);
    setResult(null);
    setRangeStr("");
  };

  return (
    <>
      <Header />
      <div className="tool-page">
        <Link href="/" className="back-link">
          <ArrowLeft size={14} /> Back to all tools
        </Link>

        <div className="tool-page-header">
          <h1><Scissors size={28} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} /> Split PDF</h1>
          <p>Extract pages or split into multiple documents</p>
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
                <FileList
                  files={[file]}
                  onRemove={() => setFile(null)}
                />

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
                    Split Mode
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        cursor: "pointer",
                        fontSize: "0.9rem",
                      }}
                    >
                      <input
                        type="radio"
                        name="splitMode"
                        value="all"
                        checked={splitMode === "all"}
                        onChange={() => setSplitMode("all")}
                        style={{ accentColor: "var(--accent)" }}
                      />
                      Split every page into a separate PDF
                    </label>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        cursor: "pointer",
                        fontSize: "0.9rem",
                      }}
                    >
                      <input
                        type="radio"
                        name="splitMode"
                        value="range"
                        checked={splitMode === "range"}
                        onChange={() => setSplitMode("range")}
                        style={{ accentColor: "var(--accent)" }}
                      />
                      Extract specific page ranges
                    </label>

                    {splitMode === "range" && (
                      <input
                        type="text"
                        value={rangeStr}
                        onChange={(e) => setRangeStr(e.target.value)}
                        placeholder="e.g. 1-3, 5, 7-10"
                        style={{
                          marginTop: 8,
                          padding: "10px 14px",
                          background: "var(--bg-elevated)",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-sm)",
                          color: "var(--text-primary)",
                          fontSize: "0.9rem",
                          outline: "none",
                          fontFamily: "inherit",
                        }}
                        id="page-range-input"
                      />
                    )}
                  </div>
                </div>

                <button
                  className="btn-primary process-btn"
                  onClick={handleSplit}
                  disabled={processing || (splitMode === "range" && !rangeStr.trim())}
                  id="split-btn"
                >
                  {processing ? (
                    <>
                      <span className="spinner"></span> Splitting...
                    </>
                  ) : (
                    "Split PDF →"
                  )}
                </button>
              </>
            )}
          </>
        )}

        {result && (
          <div className="result-card">
            <div className="result-icon"><CheckCircle size={48} color="var(--success)" /></div>
            <h3>Split Complete!</h3>
            <p>
              Created {result.blobs.length} file
              {result.blobs.length > 1 ? "s" : ""} from {result.totalPages}{" "}
              pages.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button
                className="btn-primary download-btn"
                onClick={handleDownloadAll}
                id="download-btn"
              >
                <Download size={16} /> Download{" "}
                {result.blobs.length > 1 ? "All (ZIP)" : "PDF"}
              </button>
              <button className="btn-secondary" onClick={handleReset}>
                Split Another
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { Camera, CheckCircle, Download, ArrowLeft } from "lucide-react";
import Header from "../../components/Header";
import Dropzone from "../../components/Dropzone";
import FileList from "../../components/FileList";
import { downloadBlob } from "../../lib/pdf-utils";
import JSZip from "jszip";

export default function PDFToImagesPage() {
  const [file, setFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
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

  const handleConvert = async () => {
    if (!file) return;
    setProcessing(true);
    setProgress(0);
    setResult(null);

    try {
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const images = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const scale = 2; // High quality
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");

        await page.render({ canvasContext: ctx, viewport }).promise;

        const blob = await new Promise((resolve) =>
          canvas.toBlob(resolve, "image/png")
        );
        images.push({
          blob,
          name: `${file.name.replace(".pdf", "")}_page_${i}.png`,
        });

        setProgress(Math.round((i / pdf.numPages) * 100));
      }

      setResult({ images, pageCount: pdf.numPages });
    } catch (err) {
      alert("Error converting PDF: " + err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownloadAll = async () => {
    if (!result) return;

    if (result.images.length === 1) {
      downloadBlob(result.images[0].blob, result.images[0].name);
      return;
    }

    const zip = new JSZip();
    result.images.forEach((img) => {
      zip.file(img.name, img.blob);
    });
    const zipBlob = await zip.generateAsync({ type: "blob" });
    downloadBlob(zipBlob, `${file.name.replace(".pdf", "")}_images.zip`);
  };

  const handleReset = () => {
    setFile(null);
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
          <h1><Camera size={28} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} /> PDF to Images</h1>
          <p>Convert each page of your PDF into high-quality PNG images</p>
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
                  onClick={handleConvert}
                  disabled={processing}
                  id="convert-btn"
                >
                  {processing ? (
                    <>
                      <span className="spinner"></span> Converting...
                    </>
                  ) : (
                    "Convert to Images →"
                  )}
                </button>

                {processing && (
                  <div className="progress-container">
                    <div className="progress-bar-bg">
                      <div
                        className="progress-bar-fill"
                        style={{ width: `${progress}%` }}
                      ></div>
                    </div>
                    <div className="progress-text">
                      Rendering pages... {progress}%
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {result && (
          <div className="result-card">
            <div className="result-icon"><CheckCircle size={48} color="var(--success)" /></div>
            <h3>Conversion Complete!</h3>
            <p>
              {result.pageCount} page{result.pageCount > 1 ? "s" : ""} converted
              to PNG images.
            </p>

            {/* Preview grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                gap: 8,
                margin: "20px 0",
                maxHeight: 300,
                overflowY: "auto",
                padding: 8,
              }}
            >
              {result.images.map((img, i) => (
                <div
                  key={i}
                  style={{
                    background: "white",
                    borderRadius: "var(--radius-sm)",
                    overflow: "hidden",
                    aspectRatio: "3/4",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={URL.createObjectURL(img.blob)}
                    alt={`Page ${i + 1}`}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                  />
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button
                className="btn-primary download-btn"
                onClick={handleDownloadAll}
                id="download-btn"
              >
                <Download size={16} /> Download{" "}
                {result.images.length > 1 ? "All (ZIP)" : "Image"}
              </button>
              <button className="btn-secondary" onClick={handleReset}>
                Convert Another
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

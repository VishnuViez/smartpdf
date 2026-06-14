"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Layers, CheckCircle, Download, Trash2, GripVertical } from "lucide-react";
import Header from "../../components/Header";
import Dropzone from "../../components/Dropzone";
import { organizePDF, formatFileSize, downloadBlob } from "../../lib/pdf-utils";

export default function OrganizePage() {
  const [file, setFile] = useState(null);
  const [pages, setPages] = useState([]);
  const [thumbnails, setThumbnails] = useState([]);
  const [result, setResult] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleFiles = useCallback(async (files) => {
    setFile(files[0]);
    setResult(null);
    setLoading(true);

    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

    const arrayBuffer = await files[0].arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pageCount = pdf.numPages;
    const thumbs = [];
    const pageOrder = [];

    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 0.3 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;
      thumbs.push(canvas.toDataURL("image/jpeg", 0.6));
      pageOrder.push(i - 1);
    }

    setThumbnails(thumbs);
    setPages(pageOrder);
    setLoading(false);
  }, []);

  const removePage = (idx) => {
    setPages((prev) => prev.filter((_, i) => i !== idx));
    setThumbnails((prev) => prev.filter((_, i) => i !== idx));
  };

  const movePage = (from, to) => {
    if (to < 0 || to >= pages.length) return;
    const newPages = [...pages];
    const newThumbs = [...thumbnails];
    [newPages[from], newPages[to]] = [newPages[to], newPages[from]];
    [newThumbs[from], newThumbs[to]] = [newThumbs[to], newThumbs[from]];
    setPages(newPages);
    setThumbnails(newThumbs);
  };

  const handleProcess = async () => {
    if (!file || pages.length === 0) return;
    setProcessing(true);
    try {
      const res = await organizePDF(file, pages);
      setResult(res);
    } catch (e) { alert("Error: " + e.message); }
    setProcessing(false);
  };

  return (
    <>
      <Header />
      <div className="tool-page" style={{ maxWidth: 900 }}>
        <Link href="/" className="back-link"><ArrowLeft size={14} /> Back to all tools</Link>
        <div className="tool-page-header">
          <h1><Layers size={28} strokeWidth={2} /> Organize PDF</h1>
          <p>Reorder, delete, and rearrange pages in your PDF</p>
        </div>

        {!result ? (
          <>
            {!file && <Dropzone onFiles={handleFiles} accept=".pdf" multiple={false} label="Drop your PDF file here" sublabel="or click to browse" />}
            {loading && <div className="result-card"><p>Loading pages...</p></div>}
            {file && !loading && thumbnails.length > 0 && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 12, marginBottom: 24 }}>
                  {thumbnails.map((thumb, idx) => (
                    <div key={idx} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 8, textAlign: "center", position: "relative" }}>
                      <img src={thumb} alt={`Page ${pages[idx] + 1}`} style={{ width: "100%", borderRadius: 4, marginBottom: 6 }} />
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: "0.75rem" }}>
                        <button onClick={() => movePage(idx, idx - 1)} disabled={idx === 0} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: "1rem" }}>←</button>
                        <span style={{ color: "var(--text-muted)" }}>P{pages[idx] + 1}</span>
                        <button onClick={() => movePage(idx, idx + 1)} disabled={idx === thumbnails.length - 1} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: "1rem" }}>→</button>
                      </div>
                      <button onClick={() => removePage(idx)} style={{ position: "absolute", top: 4, right: 4, background: "rgba(220,38,38,0.8)", border: "none", borderRadius: "50%", width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "white" }}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <button className="btn-primary" onClick={handleProcess} disabled={processing}>
                    {processing ? "Organizing..." : `Save PDF (${pages.length} pages)`}
                  </button>
                  <button className="btn-secondary" onClick={() => { setFile(null); setPages([]); setThumbnails([]); }}>Start Over</button>
                </div>
              </>
            )}
          </>
        ) : (
          <div className="result-card">
            <CheckCircle size={40} color="var(--success)" />
            <h3>PDF Organized!</h3>
            <p>{result.pageCount} pages • {formatFileSize(result.blob.size)}</p>
            <button className="btn-primary" onClick={() => downloadBlob(result.blob, file.name.replace(".pdf", "_organized.pdf"))}>
              <Download size={16} /> Download PDF
            </button>
            <button className="btn-secondary" onClick={() => { setFile(null); setResult(null); setPages([]); setThumbnails([]); }}>Process Another</button>
          </div>
        )}
      </div>
    </>
  );
}

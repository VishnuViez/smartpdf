"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ScanText, CheckCircle, Download, Bot, Loader2, Copy, Check } from "lucide-react";
import Header from "../../components/Header";
import Dropzone from "../../components/Dropzone";
import CloudNotice from "../../components/CloudNotice";
import { loadPdfjs, PDFJS_ASSETS } from "../../lib/pdf/pdfjs.js";

export default function OcrPage() {
  const [file, setFile] = useState(null);
  const [extractedText, setExtractedText] = useState("");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState("");
  const [copied, setCopied] = useState(false);

  const handleFiles = (files) => { setFile(files[0]); setExtractedText(""); };

  const handleProcess = async () => {
    if (!file) return;
    setProcessing(true);
    setProgress("Rendering PDF pages...");
    try {
      const pdfjsLib = await loadPdfjs();

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, ...PDFJS_ASSETS }).promise;
      const allText = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        setProgress(`OCR processing page ${i} of ${pdf.numPages}...`);
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;

        const base64 = canvas.toDataURL("image/png").split(",")[1];
        const res = await fetch("/api/gemini", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: base64, operation: "ocr" }),
        });

        if (!res.ok) {
          // surface what the server actually said — a missing API key is the
          // common case and the user can do something about it
          const detail = await res.json().catch(() => null);
          throw new Error(detail?.error || `The OCR service returned ${res.status}`);
        }
        const data = await res.json();
        allText.push(`--- Page ${i} ---\n${data.text}`);
      }

      setExtractedText(allText.join("\n\n"));
    } catch (e) { setError(e?.message || String(e)); }
    setProcessing(false);
    setProgress("");
  };

  const copyText = () => {
    navigator.clipboard.writeText(extractedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadText = () => {
    const blob = new Blob([extractedText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name.replace(".pdf", "_ocr.txt");
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Header />
      <div className="tool-page" style={{ maxWidth: 800 }}>
        <Link href="/" className="back-link"><ArrowLeft size={14} /> Back to all tools</Link>
        <div className="tool-page-header">
          <h1><ScanText size={28} strokeWidth={2} /> OCR PDF</h1>
          <p>Extract text from scanned PDFs and images using AI vision</p>
          <span className="tool-tag tag-ai"><Bot size={12} /> AI-Powered</span>
        </div>

        <CloudNotice />

        <Dropzone onFiles={handleFiles} accept=".pdf" multiple={false} label="Drop your scanned PDF here" sublabel="AI will read and extract all text" />

        {file && !extractedText && (
          <div className="tool-controls">
            <button className="btn-primary" onClick={handleProcess} disabled={processing}>
              {processing ? <><Loader2 size={16} className="spin" /> {progress}</> : "Extract Text (OCR)"}
            </button>
            {error && <div className="ed-error">{error}</div>}
          </div>
        )}

        {extractedText && (
          <div style={{ marginTop: 20 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button className="btn-primary" onClick={copyText} style={{ padding: "8px 16px", fontSize: "0.85rem" }}>
                {copied ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Copy Text</>}
              </button>
              <button className="btn-secondary" onClick={downloadText} style={{ padding: "8px 16px", fontSize: "0.85rem" }}>
                <Download size={14} /> Download .txt
              </button>
            </div>
            <textarea readOnly value={extractedText} style={{ width: "100%", minHeight: 400, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 16, color: "var(--text-primary)", fontFamily: "monospace", fontSize: "0.85rem", resize: "vertical" }} />
            <button className="btn-secondary" onClick={() => { setFile(null); setExtractedText(""); }} style={{ marginTop: 12 }}>Process Another</button>
          </div>
        )}
      </div>
    </>
  );
}

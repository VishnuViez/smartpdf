"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, CheckCircle, Download, Bot, Loader2 } from "lucide-react";
import Header from "../../components/Header";
import Dropzone from "../../components/Dropzone";
import CloudNotice from "../../components/CloudNotice";
import { formatFileSize, downloadBlob } from "../../lib/pdf-utils";
import { loadPdfjs, PDFJS_ASSETS } from "../../lib/pdf/pdfjs.js";

export default function PdfToWordPage() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState("");

  const handleFiles = (files) => { setFile(files[0]); setResult(null); };

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
        setProgress(`Processing page ${i} of ${pdf.numPages}...`);
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
          body: JSON.stringify({ imageBase64: base64, operation: "to-word" }),
        });

        if (!res.ok) {
          const detail = await res.json().catch(() => null);
          throw new Error(detail?.error || `The conversion service returned ${res.status}`);
        }
        const data = await res.json();
        allText.push(data.text);
      }

      setProgress("Generating Word document...");
      const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");

      const paragraphs = [];
      for (const pageText of allText) {
        const lines = pageText.split("\n").filter((l) => l.trim());
        for (const line of lines) {
          if (line.startsWith("### ")) {
            paragraphs.push(new Paragraph({ text: line.replace("### ", ""), heading: HeadingLevel.HEADING_3 }));
          } else if (line.startsWith("## ")) {
            paragraphs.push(new Paragraph({ text: line.replace("## ", ""), heading: HeadingLevel.HEADING_2 }));
          } else if (line.startsWith("# ")) {
            paragraphs.push(new Paragraph({ text: line.replace("# ", ""), heading: HeadingLevel.HEADING_1 }));
          } else if (line.startsWith("- ") || line.startsWith("* ")) {
            paragraphs.push(new Paragraph({ children: [new TextRun(line.replace(/^[-*] /, ""))], bullet: { level: 0 } }));
          } else if (line.startsWith("**") && line.endsWith("**")) {
            paragraphs.push(new Paragraph({ children: [new TextRun({ text: line.replace(/\*\*/g, ""), bold: true })] }));
          } else {
            paragraphs.push(new Paragraph({ children: [new TextRun(line)] }));
          }
        }
        paragraphs.push(new Paragraph({ text: "" }));
      }

      const doc = new Document({ sections: [{ children: paragraphs }] });
      const blob = await Packer.toBlob(doc);
      setResult({ blob, size: blob.size });
    } catch (e) { setError(e?.message || String(e)); }
    setProcessing(false);
    setProgress("");
  };

  return (
    <>
      <Header />
      <div className="tool-page">
        <Link href="/" className="back-link"><ArrowLeft size={14} /> Back to all tools</Link>
        <div className="tool-page-header">
          <h1><FileText size={28} strokeWidth={2} /> PDF to Word</h1>
          <p>Convert PDF to editable Word document using AI</p>
          <span className="tool-tag tag-ai"><Bot size={12} /> AI-Powered</span>
        </div>

        {!result ? (
          <>
            <CloudNotice />
            <Dropzone onFiles={handleFiles} accept=".pdf" multiple={false} label="Drop your PDF file here" sublabel="AI will extract and format the content" />
            {file && (
              <div className="tool-controls">
                <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: 16 }}>
                  Our AI will intelligently extract text, headings, lists, and tables from your PDF and create a properly formatted Word document.
                </p>
                <button className="btn-primary" onClick={handleProcess} disabled={processing}>
                  {processing ? <><Loader2 size={16} className="spin" /> {progress}</> : "Convert to Word"}
                </button>
                {error && <div className="ed-error">{error}</div>}
              </div>
            )}
          </>
        ) : (
          <div className="result-card">
            <CheckCircle size={40} color="var(--success)" />
            <h3>Converted to Word!</h3>
            <p>{formatFileSize(result.size)}</p>
            <button className="btn-primary" onClick={() => downloadBlob(result.blob, file.name.replace(".pdf", ".docx"))}>
              <Download size={16} /> Download .docx
            </button>
            <button className="btn-secondary" onClick={() => { setFile(null); setResult(null); }}>Convert Another</button>
          </div>
        )}
      </div>
    </>
  );
}

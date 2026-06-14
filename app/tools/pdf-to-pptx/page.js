"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Presentation, CheckCircle, Download, Bot, Loader2 } from "lucide-react";
import Header from "../../components/Header";
import Dropzone from "../../components/Dropzone";
import { formatFileSize, downloadBlob } from "../../lib/pdf-utils";

export default function PdfToPptxPage() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState("");

  const handleFiles = (files) => { setFile(files[0]); setResult(null); };

  const handleProcess = async () => {
    if (!file) return;
    setProcessing(true);
    setProgress("Rendering PDF pages...");
    try {
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

      const PptxGenJS = (await import("pptxgenjs")).default;
      const pres = new PptxGenJS();

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      for (let i = 1; i <= pdf.numPages; i++) {
        setProgress(`Converting page ${i} of ${pdf.numPages}...`);
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;

        const imgData = canvas.toDataURL("image/jpeg", 0.85);
        const slide = pres.addSlide();
        slide.addImage({ data: imgData, x: 0, y: 0, w: "100%", h: "100%", sizing: { type: "contain", w: 10, h: 7.5 } });
      }

      setProgress("Generating PowerPoint...");
      const pptxBlob = await pres.write({ outputType: "blob" });
      setResult({ blob: pptxBlob, size: pptxBlob.size, slides: pdf.numPages });
    } catch (e) { alert("Error: " + e.message); }
    setProcessing(false);
    setProgress("");
  };

  return (
    <>
      <Header />
      <div className="tool-page">
        <Link href="/" className="back-link"><ArrowLeft size={14} /> Back to all tools</Link>
        <div className="tool-page-header">
          <h1><Presentation size={28} strokeWidth={2} /> PDF to PowerPoint</h1>
          <p>Convert PDF pages into PowerPoint slides</p>
          <span className="tool-tag tag-ai"><Bot size={12} /> AI-Powered</span>
        </div>

        {!result ? (
          <>
            <Dropzone onFiles={handleFiles} accept=".pdf" multiple={false} label="Drop your PDF file here" sublabel="Each page becomes a slide" />
            {file && (
              <div className="tool-controls">
                <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: 16 }}>
                  Each PDF page will be converted into a high-quality PowerPoint slide, preserving the exact visual layout.
                </p>
                <button className="btn-primary" onClick={handleProcess} disabled={processing}>
                  {processing ? <><Loader2 size={16} className="spin" /> {progress}</> : "Convert to PowerPoint"}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="result-card">
            <CheckCircle size={40} color="var(--success)" />
            <h3>Converted to PowerPoint!</h3>
            <p>{result.slides} slides • {formatFileSize(result.size)}</p>
            <button className="btn-primary" onClick={() => downloadBlob(result.blob, file.name.replace(".pdf", ".pptx"))}>
              <Download size={16} /> Download .pptx
            </button>
            <button className="btn-secondary" onClick={() => { setFile(null); setResult(null); }}>Convert Another</button>
          </div>
        )}
      </div>
    </>
  );
}

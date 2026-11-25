"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Table, CheckCircle, Download, Bot, Loader2 } from "lucide-react";
import Header from "../../components/Header";
import Dropzone from "../../components/Dropzone";
import CloudNotice from "../../components/CloudNotice";
import { formatFileSize, downloadBlob } from "../../lib/pdf-utils";
import { loadPdfjs, PDFJS_ASSETS } from "../../lib/pdf/pdfjs.js";

export default function PdfToExcelPage() {
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
      const allTables = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        setProgress(`Extracting tables from page ${i} of ${pdf.numPages}...`);
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
          body: JSON.stringify({ imageBase64: base64, operation: "to-excel" }),
        });

        if (!res.ok) {
          const detail = await res.json().catch(() => null);
          throw new Error(detail?.error || `The conversion service returned ${res.status}`);
        }
        const data = await res.json();
        try {
          const cleaned = data.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          const tables = cleaned.split("---TABLE_BREAK---");
          for (const t of tables) {
            const parsed = JSON.parse(t.trim());
            if (Array.isArray(parsed) && parsed.length > 0) allTables.push(parsed);
          }
        } catch { allTables.push([[data.text]]); }
      }

      setProgress("Generating Excel file...");
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();

      allTables.forEach((table, idx) => {
        const ws = XLSX.utils.aoa_to_sheet(table);
        XLSX.utils.book_append_sheet(wb, ws, `Sheet${idx + 1}`);
      });

      if (allTables.length === 0) {
        const ws = XLSX.utils.aoa_to_sheet([["No tabular data found"]]);
        XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      }

      const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      const blob = new Blob([excelBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      setResult({ blob, size: blob.size, sheets: allTables.length });
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
          <h1><Table size={28} strokeWidth={2} /> PDF to Excel</h1>
          <p>Extract tables from PDF and convert to Excel spreadsheet using AI</p>
          <span className="tool-tag tag-ai"><Bot size={12} /> AI-Powered</span>
        </div>

        {!result ? (
          <>
            <CloudNotice />
            <Dropzone onFiles={handleFiles} accept=".pdf" multiple={false} label="Drop your PDF with tables" sublabel="AI will detect and extract table data" />
            {file && (
              <div className="tool-controls">
                <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: 16 }}>
                  Our AI intelligently detects tables in your PDF and exports each as a separate sheet in the Excel file.
                </p>
                <button className="btn-primary" onClick={handleProcess} disabled={processing}>
                  {processing ? <><Loader2 size={16} className="spin" /> {progress}</> : "Convert to Excel"}
                </button>
                {error && <div className="ed-error">{error}</div>}
              </div>
            )}
          </>
        ) : (
          <div className="result-card">
            <CheckCircle size={40} color="var(--success)" />
            <h3>Converted to Excel!</h3>
            <p>{result.sheets} sheet(s) • {formatFileSize(result.size)}</p>
            <button className="btn-primary" onClick={() => downloadBlob(result.blob, file.name.replace(".pdf", ".xlsx"))}>
              <Download size={16} /> Download .xlsx
            </button>
            <button className="btn-secondary" onClick={() => { setFile(null); setResult(null); }}>Convert Another</button>
          </div>
        )}
      </div>
    </>
  );
}

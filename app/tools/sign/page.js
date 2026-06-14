"use client";
import { useState, useRef } from "react";
import Link from "next/link";
import { ArrowLeft, PenLine, CheckCircle, Download, Type, Eraser } from "lucide-react";
import Header from "../../components/Header";
import Dropzone from "../../components/Dropzone";
import { embedSignature, formatFileSize, downloadBlob } from "../../lib/pdf-utils";

export default function SignPage() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [mode, setMode] = useState("draw");
  const [typedSig, setTypedSig] = useState("");
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);

  const handleFiles = (files) => { setFile(files[0]); setResult(null); };

  const startDraw = (e) => {
    setDrawing(true);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };

  const draw = (e) => {
    if (!drawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.stroke();
  };

  const stopDraw = () => setDrawing(false);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const getSignatureBytes = async () => {
    const canvas = canvasRef.current;
    if (mode === "type") {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = "italic 36px Georgia, serif";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(typedSig, 20, 55);
    }
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    return new Uint8Array(await blob.arrayBuffer());
  };

  const handleProcess = async () => {
    if (!file) return;
    setProcessing(true);
    try {
      const sigBytes = await getSignatureBytes();
      const res = await embedSignature(file, sigBytes, { x: 50, y: 50, width: 200, height: 50, pageIndex: 0 });
      setResult(res);
    } catch (e) { alert("Error: " + e.message); }
    setProcessing(false);
  };

  return (
    <>
      <Header />
      <div className="tool-page">
        <Link href="/" className="back-link"><ArrowLeft size={14} /> Back to all tools</Link>
        <div className="tool-page-header">
          <h1><PenLine size={28} strokeWidth={2} /> Sign PDF</h1>
          <p>Draw or type your signature and place it on your PDF</p>
        </div>

        {!result ? (
          <>
            <Dropzone onFiles={handleFiles} accept=".pdf" multiple={false} label="Drop your PDF file here" sublabel="or click to browse" />
            {file && (
              <div className="tool-controls">
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  <button className={mode === "draw" ? "btn-primary" : "btn-secondary"} onClick={() => setMode("draw")} style={{ padding: "8px 16px", fontSize: "0.85rem" }}>
                    <PenLine size={14} /> Draw
                  </button>
                  <button className={mode === "type" ? "btn-primary" : "btn-secondary"} onClick={() => setMode("type")} style={{ padding: "8px 16px", fontSize: "0.85rem" }}>
                    <Type size={14} /> Type
                  </button>
                </div>
                <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 16, marginBottom: 16 }}>
                  {mode === "draw" ? (
                    <>
                      <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: 8 }}>Draw your signature below:</p>
                      <canvas ref={canvasRef} width={400} height={80} style={{ border: "1px dashed var(--border)", borderRadius: 4, cursor: "crosshair", display: "block", width: "100%", maxWidth: 400 }}
                        onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw} />
                      <button onClick={clearCanvas} className="btn-secondary" style={{ marginTop: 8, padding: "6px 12px", fontSize: "0.8rem" }}>
                        <Eraser size={12} /> Clear
                      </button>
                    </>
                  ) : (
                    <>
                      <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: 8 }}>Type your signature:</p>
                      <input type="text" value={typedSig} onChange={(e) => setTypedSig(e.target.value)} className="text-input" placeholder="Your Name" style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: "1.2rem" }} />
                      <canvas ref={canvasRef} width={400} height={80} style={{ display: "none" }} />
                    </>
                  )}
                </div>
                <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: 16 }}>Signature will be placed at the bottom-left of the first page.</p>
                <button className="btn-primary" onClick={handleProcess} disabled={processing}>
                  {processing ? "Signing..." : "Sign PDF"}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="result-card">
            <CheckCircle size={40} color="var(--success)" />
            <h3>PDF Signed!</h3>
            <p>{result.pageCount} pages • {formatFileSize(result.blob.size)}</p>
            <button className="btn-primary" onClick={() => downloadBlob(result.blob, file.name.replace(".pdf", "_signed.pdf"))}>
              <Download size={16} /> Download Signed PDF
            </button>
            <button className="btn-secondary" onClick={() => { setFile(null); setResult(null); }}>Process Another</button>
          </div>
        )}
      </div>
    </>
  );
}

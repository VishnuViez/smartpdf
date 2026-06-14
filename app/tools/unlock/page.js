"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Unlock, CheckCircle, Download } from "lucide-react";
import Header from "../../components/Header";
import Dropzone from "../../components/Dropzone";
import { unlockPDF, formatFileSize, downloadBlob } from "../../lib/pdf-utils";

export default function UnlockPage() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [password, setPassword] = useState("");

  const handleFiles = (files) => { setFile(files[0]); setResult(null); };

  const handleProcess = async () => {
    if (!file) return;
    setProcessing(true);
    try {
      const res = await unlockPDF(file, password);
      setResult(res);
    } catch (e) { alert("Incorrect password or unsupported encryption: " + e.message); }
    setProcessing(false);
  };

  return (
    <>
      <Header />
      <div className="tool-page">
        <Link href="/" className="back-link"><ArrowLeft size={14} /> Back to all tools</Link>
        <div className="tool-page-header">
          <h1><Unlock size={28} strokeWidth={2} /> Unlock PDF</h1>
          <p>Remove password protection from your PDF (password required)</p>
        </div>

        {!result ? (
          <>
            <Dropzone onFiles={handleFiles} accept=".pdf" multiple={false} label="Drop your locked PDF here" sublabel="or click to browse" />
            {file && (
              <div className="tool-controls">
                <div className="control-group">
                  <label>PDF Password</label>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="text-input" placeholder="Enter the PDF password" />
                </div>
                <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: 16 }}>
                  You must know the password to unlock the PDF. We don&apos;t crack passwords.
                </p>
                <button className="btn-primary" onClick={handleProcess} disabled={processing}>
                  {processing ? "Unlocking..." : "Unlock PDF"}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="result-card">
            <CheckCircle size={40} color="var(--success)" />
            <h3>PDF Unlocked!</h3>
            <p>{result.pageCount} pages • {formatFileSize(result.blob.size)}</p>
            <button className="btn-primary" onClick={() => downloadBlob(result.blob, file.name.replace(".pdf", "_unlocked.pdf"))}>
              <Download size={16} /> Download Unlocked PDF
            </button>
            <button className="btn-secondary" onClick={() => { setFile(null); setResult(null); setPassword(""); }}>Process Another</button>
          </div>
        )}
      </div>
    </>
  );
}

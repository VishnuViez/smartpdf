"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Lock, CheckCircle, Download } from "lucide-react";
import Header from "../../components/Header";
import Dropzone from "../../components/Dropzone";
import { protectPDF, formatFileSize, downloadBlob } from "../../lib/pdf-utils";

export default function ProtectPage() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const handleFiles = (files) => { setFile(files[0]); setResult(null); };

  const handleProcess = async () => {
    if (!file || !password) return;
    if (password !== confirmPassword) { alert("Passwords don't match!"); return; }
    setProcessing(true);
    try {
      const res = await protectPDF(file, password);
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
          <h1><Lock size={28} strokeWidth={2} /> Protect PDF</h1>
          <p>Add password protection to your PDF document</p>
        </div>

        {!result ? (
          <>
            <Dropzone onFiles={handleFiles} accept=".pdf" multiple={false} label="Drop your PDF file here" sublabel="or click to browse" />
            {file && (
              <div className="tool-controls">
                <div className="control-group">
                  <label>Password</label>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="text-input" placeholder="Enter password" />
                </div>
                <div className="control-group">
                  <label>Confirm Password</label>
                  <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="text-input" placeholder="Confirm password" />
                </div>
                <button className="btn-primary" onClick={handleProcess} disabled={processing || !password || password !== confirmPassword}>
                  {processing ? "Protecting..." : "Protect PDF"}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="result-card">
            <CheckCircle size={40} color="var(--success)" />
            <h3>PDF Protected!</h3>
            <p>{result.pageCount} pages • {formatFileSize(result.blob.size)}</p>
            <button className="btn-primary" onClick={() => downloadBlob(result.blob, file.name.replace(".pdf", "_protected.pdf"))}>
              <Download size={16} /> Download Protected PDF
            </button>
            <button className="btn-secondary" onClick={() => { setFile(null); setResult(null); setPassword(""); setConfirmPassword(""); }}>Process Another</button>
          </div>
        )}
      </div>
    </>
  );
}

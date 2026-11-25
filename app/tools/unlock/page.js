"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Unlock, CheckCircle, Download, Loader2, ShieldOff } from "lucide-react";
import Header from "../../components/Header";
import Dropzone from "../../components/Dropzone";
import { unlockPDF, formatFileSize, downloadBlob } from "../../lib/pdf-utils";

const CIPHER_LABEL = {
  V2: "RC4",
  AESV2: "AES-128",
  AESV3: "AES-256",
  none: "none",
  Identity: "none",
};

export default function UnlockPage() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);

  const handleFiles = (files) => { setFile(files[0]); setResult(null); setError(null); };

  const handleProcess = async () => {
    if (!file || processing) return;
    setProcessing(true);
    setError(null);
    try {
      setResult(await unlockPDF(file, password));
    } catch (e) {
      // A wrong password is the common case and deserves a plain sentence,
      // not a stack trace or an alert box.
      setError(
        e?.name === "WrongPasswordError"
          ? "That password doesn't open this document. Check it and try again."
          : e?.name === "UnsupportedEncryptionError"
            ? e.message
            : `Could not unlock this file: ${e?.message || e}`
      );
    } finally {
      setProcessing(false);
    }
  };

  const reset = () => { setFile(null); setResult(null); setPassword(""); setError(null); };

  return (
    <>
      <Header />
      <div className="tool-page">
        <Link href="/" className="back-link"><ArrowLeft size={14} /> Back to all tools</Link>
        <div className="tool-page-header">
          <h1><Unlock size={28} strokeWidth={2} /> Unlock PDF</h1>
          <p>Remove the password from a PDF you can already open</p>
        </div>

        {!result ? (
          <>
            <Dropzone onFiles={handleFiles} accept=".pdf" multiple={false}
              label="Drop your protected PDF here"
              sublabel="Unlocked in your browser — nothing is uploaded" />

            {file && (
              <div className="tool-controls">
                <div className="control-group">
                  <label htmlFor="pw">Password</label>
                  <input id="pw" type="password" value={password} autoComplete="current-password"
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleProcess(); }}
                    className="text-input" placeholder="Leave blank if the file opens without one" />
                  <span className="label-hint">
                    Many PDFs are encrypted only to restrict printing or copying and open
                    with an empty password. Try it blank first.
                  </span>
                </div>
                <button className="btn-primary" onClick={handleProcess} disabled={processing}>
                  {processing ? <><Loader2 size={16} className="ed-spin" /> Unlocking…</> : "Unlock PDF"}
                </button>
                {error && <div className="ed-error">{error}</div>}
              </div>
            )}
          </>
        ) : (
          <div className="result-card">
            <CheckCircle size={40} color="var(--success)" />
            <h3>{result.wasEncrypted ? "Password Removed" : "This file wasn't encrypted"}</h3>
            <p>{result.pageCount} pages • {formatFileSize(result.blob.size)}</p>
            {result.wasEncrypted && (
              <p className="result-detail">
                <ShieldOff size={14} /> {CIPHER_LABEL[result.cipher] || result.cipher} encryption removed
                {result.revision ? ` (revision ${result.revision})` : ""}
              </p>
            )}
            <button className="btn-primary"
              onClick={() => downloadBlob(result.blob, file.name.replace(/\.pdf$/i, "") + "_unlocked.pdf")}>
              <Download size={16} /> Download Unlocked PDF
            </button>
            <button className="btn-secondary" onClick={reset}>Unlock Another</button>
          </div>
        )}
      </div>
    </>
  );
}

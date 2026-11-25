"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Lock, CheckCircle, Download, ShieldCheck, Loader2 } from "lucide-react";
import Header from "../../components/Header";
import Dropzone from "../../components/Dropzone";
import { protectPDF, formatFileSize, downloadBlob } from "../../lib/pdf-utils";

/** What the owner may allow a reader to do. Everything is granted by default. */
const RIGHTS = [
  { key: "print", label: "Printing" },
  { key: "copy", label: "Copying text and images" },
  { key: "modify", label: "Editing the document" },
  { key: "annotate", label: "Adding comments and annotations" },
  { key: "fillForms", label: "Filling in form fields" },
  { key: "extractForAccessibility", label: "Access by screen readers" },
];

export default function ProtectPage() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [allow, setAllow] = useState(() =>
    Object.fromEntries(RIGHTS.map(r => [r.key, true]))
  );

  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const ready = file && password.length > 0 && password === confirmPassword;

  const handleFiles = (files) => { setFile(files[0]); setResult(null); setError(null); };

  const handleProcess = async () => {
    if (!ready || processing) return;
    setProcessing(true);
    setError(null);
    try {
      setResult(await protectPDF(file, password, {
        ownerPassword: ownerPassword || undefined,
        allow,
      }));
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setProcessing(false);
    }
  };

  const reset = () => {
    setFile(null); setResult(null); setError(null);
    setPassword(""); setConfirmPassword(""); setOwnerPassword("");
    setAllow(Object.fromEntries(RIGHTS.map(r => [r.key, true])));
  };

  return (
    <>
      <Header />
      <div className="tool-page">
        <Link href="/" className="back-link"><ArrowLeft size={14} /> Back to all tools</Link>
        <div className="tool-page-header">
          <h1><Lock size={28} strokeWidth={2} /> Protect PDF</h1>
          <p>Encrypt your document so it cannot be opened without the password</p>
        </div>

        {!result ? (
          <>
            <Dropzone onFiles={handleFiles} accept=".pdf" multiple={false}
              label="Drop your PDF file here" sublabel="Encrypted in your browser — the file never leaves your device" />

            {file && (
              <div className="tool-controls">
                <div className="control-group">
                  <label htmlFor="pw">Password to open the document</label>
                  <input id="pw" type="password" value={password} autoComplete="new-password"
                    onChange={(e) => setPassword(e.target.value)}
                    className="text-input" placeholder="Choose a password" />
                </div>
                <div className="control-group">
                  <label htmlFor="pw2">Confirm password</label>
                  <input id="pw2" type="password" value={confirmPassword} autoComplete="new-password"
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="text-input" placeholder="Type it again"
                    aria-invalid={mismatch || undefined} />
                  {mismatch && <span className="field-error">The passwords don&apos;t match</span>}
                </div>

                <div className="control-group">
                  <label htmlFor="ow">Owner password <span className="label-hint">optional</span></label>
                  <input id="ow" type="password" value={ownerPassword} autoComplete="new-password"
                    onChange={(e) => setOwnerPassword(e.target.value)}
                    className="text-input" placeholder="Grants full rights regardless of the restrictions below" />
                </div>

                <fieldset className="control-group perm-group">
                  <legend>What readers may do</legend>
                  {RIGHTS.map(r => (
                    <label key={r.key} className="perm-row">
                      <input type="checkbox" checked={allow[r.key]}
                        onChange={e => setAllow(a => ({ ...a, [r.key]: e.target.checked }))} />
                      <span>{r.label}</span>
                    </label>
                  ))}
                  <p className="perm-note">
                    Permissions are recorded in the document and respected by conforming
                    readers. They are not a substitute for the password, which is what
                    actually protects the contents.
                  </p>
                </fieldset>

                <button className="btn-primary" onClick={handleProcess} disabled={!ready || processing}>
                  {processing ? <><Loader2 size={16} className="ed-spin" /> Encrypting…</> : <>Protect PDF</>}
                </button>

                {error && <div className="ed-error">Could not protect this file: {error}</div>}
              </div>
            )}
          </>
        ) : (
          <div className="result-card">
            <CheckCircle size={40} color="var(--success)" />
            <h3>PDF Encrypted</h3>
            <p>{result.pageCount} pages • {formatFileSize(result.blob.size)}</p>
            <p className="result-detail">
              <ShieldCheck size={14} /> AES-256 · the document cannot be opened without the password
            </p>
            <button className="btn-primary"
              onClick={() => downloadBlob(result.blob, file.name.replace(/\.pdf$/i, "") + "_protected.pdf")}>
              <Download size={16} /> Download Protected PDF
            </button>
            <button className="btn-secondary" onClick={reset}>Protect Another</button>
          </div>
        )}
      </div>
    </>
  );
}

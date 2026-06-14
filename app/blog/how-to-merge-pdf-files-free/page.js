import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";

export const metadata = {
  title: "How to Merge PDF Files for Free in 2026 — Complete Guide | SmartPDF",
  description:
    "Learn how to merge and combine multiple PDF files into one document. Free, no signup, works in your browser. Step-by-step guide with screenshots.",
  keywords: "merge PDF, combine PDF, merge PDF files free, join PDF online, PDF combiner",
};

export default function MergeBlogPost() {
  return (
    <div className="tool-page" style={{ maxWidth: 720 }}>
      <Link href="/blog" className="back-link">
        <ArrowLeft size={14} /> Back to blog
      </Link>

      <article>
        <div style={{ marginBottom: 32 }}>
          <span className="tool-tag tag-free" style={{ marginBottom: 12, display: "inline-block" }}>
            Guide
          </span>
          <h1 style={{ fontSize: "2rem", fontWeight: 800, letterSpacing: -1, lineHeight: 1.2, marginBottom: 12 }}>
            How to Merge PDF Files for Free in 2026
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: "0.88rem" }}>
            June 6, 2026 · 5 min read
          </p>
        </div>

        <div className="blog-content" style={{ color: "var(--text-secondary)", lineHeight: 1.8, fontSize: "1rem" }}>
          <p style={{ fontSize: "1.1rem", color: "var(--text-primary)", marginBottom: 24 }}>
            Need to combine multiple PDFs into a single file? Whether you&apos;re merging invoices,
            combining reports, or putting together a portfolio — this guide covers the fastest,
            free ways to merge PDF files in 2026.
          </p>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.4rem", fontWeight: 700, margin: "32px 0 12px", letterSpacing: -0.5 }}>
            Method 1: Use SmartPDF (Fastest — 10 Seconds)
          </h2>
          <p style={{ marginBottom: 16 }}>
            <Link href="/tools/merge" style={{ color: "var(--accent-light)", fontWeight: 500 }}>SmartPDF&apos;s Merge Tool</Link> is
            the fastest way to combine PDFs. Here&apos;s how:
          </p>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
            <li><strong style={{ color: "var(--text-primary)" }}>Open the Merge Tool</strong> — Go to SmartPDF&apos;s merge page. No signup required.</li>
            <li><strong style={{ color: "var(--text-primary)" }}>Upload your PDFs</strong> — Drag and drop your files, or click to browse. Add as many files as you need.</li>
            <li><strong style={{ color: "var(--text-primary)" }}>Reorder if needed</strong> — Use the arrow buttons to arrange files in the right order.</li>
            <li><strong style={{ color: "var(--text-primary)" }}>Click &quot;Merge&quot;</strong> — Your files are combined instantly, right in your browser.</li>
            <li><strong style={{ color: "var(--text-primary)" }}>Download</strong> — Save the merged PDF to your device.</li>
          </ol>

          <div style={{
            padding: 24, background: "rgba(108,92,231,0.08)", border: "1px solid rgba(108,92,231,0.2)",
            borderRadius: "var(--radius-md)", marginBottom: 32
          }}>
            <p style={{ margin: 0, fontWeight: 500, color: "var(--text-primary)" }}>
              💡 <strong>Why SmartPDF?</strong> Unlike other tools, SmartPDF processes everything in your browser.
              Your files never leave your device — making it the most private PDF merger available.
            </p>
          </div>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.4rem", fontWeight: 700, margin: "32px 0 12px", letterSpacing: -0.5 }}>
            Method 2: Using Preview on Mac
          </h2>
          <p style={{ marginBottom: 16 }}>
            Mac users can use the built-in Preview app to merge PDFs, though it&apos;s more manual:
          </p>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
            <li>Open the first PDF in Preview</li>
            <li>Go to View → Thumbnails to show the sidebar</li>
            <li>Drag additional PDFs into the sidebar</li>
            <li>Rearrange pages as needed</li>
            <li>Save with File → Export as PDF</li>
          </ol>
          <p style={{ marginBottom: 24 }}>
            <em>Limitation:</em> This method can be slow with large files and doesn&apos;t support batch processing.
          </p>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.4rem", fontWeight: 700, margin: "32px 0 12px", letterSpacing: -0.5 }}>
            Method 3: Command Line (for Developers)
          </h2>
          <p style={{ marginBottom: 12 }}>
            If you prefer the terminal, tools like <code style={{ background: "var(--bg-elevated)", padding: "2px 6px", borderRadius: 4, fontSize: "0.9em" }}>pdftk</code> or <code style={{ background: "var(--bg-elevated)", padding: "2px 6px", borderRadius: 4, fontSize: "0.9em" }}>qpdf</code> can merge PDFs:
          </p>
          <div style={{ background: "var(--bg-elevated)", padding: 16, borderRadius: "var(--radius-sm)", marginBottom: 24, fontFamily: "monospace", fontSize: "0.88rem", overflowX: "auto" }}>
            <code>pdftk file1.pdf file2.pdf file3.pdf cat output merged.pdf</code>
          </div>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.4rem", fontWeight: 700, margin: "32px 0 12px", letterSpacing: -0.5 }}>
            Frequently Asked Questions
          </h2>

          <h3 style={{ color: "var(--text-primary)", fontSize: "1.1rem", fontWeight: 600, margin: "20px 0 8px" }}>
            Is it safe to merge PDFs online?
          </h3>
          <p style={{ marginBottom: 16 }}>
            With SmartPDF, yes — your files are processed entirely in your browser using JavaScript.
            No data is uploaded to any server. For other online tools, check their privacy policy.
          </p>

          <h3 style={{ color: "var(--text-primary)", fontSize: "1.1rem", fontWeight: 600, margin: "20px 0 8px" }}>
            Is there a limit on file size or number of files?
          </h3>
          <p style={{ marginBottom: 16 }}>
            SmartPDF has no hard limits on the number of files. Since processing happens in your browser,
            performance depends on your device — most modern devices handle files up to 100MB easily.
          </p>

          <h3 style={{ color: "var(--text-primary)", fontSize: "1.1rem", fontWeight: 600, margin: "20px 0 8px" }}>
            Can I reorder pages before merging?
          </h3>
          <p style={{ marginBottom: 24 }}>
            Yes! SmartPDF lets you reorder files before merging using simple up/down arrows.
            For page-level reordering within a single file, use the Rotate Pages tool.
          </p>

          <div style={{
            padding: 24, background: "var(--bg-card)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)", textAlign: "center", marginTop: 40
          }}>
            <h3 style={{ color: "var(--text-primary)", marginBottom: 8 }}>Ready to merge your PDFs?</h3>
            <p style={{ marginBottom: 16, fontSize: "0.9rem" }}>
              Free, instant, and private. No signup required.
            </p>
            <Link href="/tools/merge" className="btn-primary" style={{ padding: "12px 32px" }}>
              Merge PDFs Now <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </article>
    </div>
  );
}

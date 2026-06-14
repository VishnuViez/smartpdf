import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";

export const metadata = {
  title: "How to Convert Images to PDF — JPG, PNG to PDF Free | SmartPDF",
  description:
    "Convert JPG, PNG, and WebP images into a PDF document. Free, instant conversion in your browser. Combine multiple photos into one PDF.",
  keywords: "images to PDF, JPG to PDF, PNG to PDF, convert photos to PDF, image converter",
};

export default function ImagesToPDFBlogPost() {
  return (
    <div className="tool-page" style={{ maxWidth: 720 }}>
      <Link href="/blog" className="back-link">
        <ArrowLeft size={14} /> Back to blog
      </Link>

      <article>
        <div style={{ marginBottom: 32 }}>
          <span className="tool-tag tag-free" style={{ marginBottom: 12, display: "inline-block" }}>
            Tutorial
          </span>
          <h1 style={{ fontSize: "2rem", fontWeight: 800, letterSpacing: -1, lineHeight: 1.2, marginBottom: 12 }}>
            How to Convert Images to PDF — JPG, PNG, WebP to PDF Free
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: "0.88rem" }}>
            June 6, 2026 · 3 min read
          </p>
        </div>

        <div className="blog-content" style={{ color: "var(--text-secondary)", lineHeight: 1.8, fontSize: "1rem" }}>
          <p style={{ fontSize: "1.1rem", color: "var(--text-primary)", marginBottom: 24 }}>
            Need to turn photos, screenshots, or scanned documents into a PDF? Here&apos;s the fastest
            way to convert images to PDF — free, in your browser, with no software to install.
          </p>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.4rem", fontWeight: 700, margin: "32px 0 12px" }}>
            When You Need Images to PDF
          </h2>
          <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
            <li>Combining scanned document pages into one file</li>
            <li>Creating a photo portfolio or lookbook</li>
            <li>Submitting homework or assignments as a single PDF</li>
            <li>Archiving receipts and invoices</li>
            <li>Creating a presentation handout</li>
          </ul>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.4rem", fontWeight: 700, margin: "32px 0 12px" }}>
            Convert with SmartPDF (3 Steps)
          </h2>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
            <li>Open <Link href="/tools/images-to-pdf" style={{ color: "var(--accent-light)", fontWeight: 500 }}>SmartPDF Images to PDF</Link></li>
            <li>Drag and drop your images (JPG, PNG, or WebP) — add as many as you need</li>
            <li>Reorder if needed, then click &quot;Convert&quot; — download your PDF</li>
          </ol>

          <div style={{
            padding: 24, background: "rgba(108,92,231,0.08)", border: "1px solid rgba(108,92,231,0.2)",
            borderRadius: "var(--radius-md)", marginBottom: 32
          }}>
            <p style={{ margin: 0, fontWeight: 500, color: "var(--text-primary)" }}>
              ✨ <strong>Pro tip:</strong> Each image becomes one page in the PDF. The page size
              automatically matches the image dimensions, so your content is never cropped or distorted.
            </p>
          </div>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.4rem", fontWeight: 700, margin: "32px 0 12px" }}>
            Supported Image Formats
          </h2>
          <div style={{ overflowX: "auto", marginBottom: 24 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "10px 12px", color: "var(--text-primary)" }}>Format</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", color: "var(--text-primary)" }}>Support</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", color: "var(--text-primary)" }}>Best For</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["JPG / JPEG", "✅ Full", "Photos, scans"],
                  ["PNG", "✅ Full", "Screenshots, graphics"],
                  ["WebP", "✅ Full", "Web images"],
                  ["GIF", "✅ Converted", "Simple graphics"],
                  ["HEIC", "⚠️ Convert first", "iPhone photos"],
                ].map(([format, support, best]) => (
                  <tr key={format} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 500, color: "var(--text-primary)" }}>{format}</td>
                    <td style={{ padding: "10px 12px" }}>{support}</td>
                    <td style={{ padding: "10px 12px" }}>{best}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.4rem", fontWeight: 700, margin: "32px 0 12px" }}>
            Tips for Best Results
          </h2>
          <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
            <li>Use JPG for photos to keep file sizes small</li>
            <li>Use PNG for screenshots and text-heavy images (sharper)</li>
            <li>Name your files in order (1.jpg, 2.jpg...) before uploading</li>
            <li>After converting, use the Compress tool if the PDF is too large</li>
          </ul>

          <div style={{
            padding: 24, background: "var(--bg-card)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)", textAlign: "center", marginTop: 40
          }}>
            <h3 style={{ color: "var(--text-primary)", marginBottom: 8 }}>Convert your images now</h3>
            <p style={{ marginBottom: 16, fontSize: "0.9rem" }}>
              Free, instant, private. Supports JPG, PNG, and WebP.
            </p>
            <Link href="/tools/images-to-pdf" className="btn-primary" style={{ padding: "12px 32px" }}>
              Convert Images to PDF <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </article>
    </div>
  );
}

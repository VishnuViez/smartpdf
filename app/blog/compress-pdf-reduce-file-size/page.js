import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";

export const metadata = {
  title: "How to Compress PDF & Reduce File Size (2026 Guide) | SmartPDF",
  description:
    "Reduce PDF file size without losing quality. Free, instant compression that works in your browser. Perfect for email attachments and uploads.",
  keywords: "compress PDF, reduce PDF size, shrink PDF, PDF compressor free, make PDF smaller",
};

export default function CompressBlogPost() {
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
            How to Compress PDF & Reduce File Size Without Losing Quality
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: "0.88rem" }}>
            June 6, 2026 · 4 min read
          </p>
        </div>

        <div className="blog-content" style={{ color: "var(--text-secondary)", lineHeight: 1.8, fontSize: "1rem" }}>
          <p style={{ fontSize: "1.1rem", color: "var(--text-primary)", marginBottom: 24 }}>
            Is your PDF too large for email? Can&apos;t upload it because of a 5MB limit? Here&apos;s how to
            compress any PDF file instantly — for free, without installing software.
          </p>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.4rem", fontWeight: 700, margin: "32px 0 12px" }}>
            Why Are PDF Files So Large?
          </h2>
          <p style={{ marginBottom: 16 }}>
            PDFs can become large due to embedded images, fonts, metadata, and formatting. A document
            with high-resolution images can easily exceed 50MB. Common reasons include:
          </p>
          <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
            <li><strong style={{ color: "var(--text-primary)" }}>High-resolution images</strong> — Photos scanned at 300+ DPI</li>
            <li><strong style={{ color: "var(--text-primary)" }}>Embedded fonts</strong> — Multiple font families embedded in full</li>
            <li><strong style={{ color: "var(--text-primary)" }}>Metadata bloat</strong> — Edit history, comments, and annotations</li>
            <li><strong style={{ color: "var(--text-primary)" }}>Unoptimized export</strong> — Software that doesn&apos;t optimize output</li>
          </ul>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.4rem", fontWeight: 700, margin: "32px 0 12px" }}>
            How to Compress with SmartPDF (3 Steps)
          </h2>
          <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
            <li>Open <Link href="/tools/compress" style={{ color: "var(--accent-light)", fontWeight: 500 }}>SmartPDF Compress Tool</Link></li>
            <li>Drop your PDF file onto the upload zone</li>
            <li>Click &quot;Compress PDF&quot; — download your smaller file</li>
          </ol>
          <p style={{ marginBottom: 24 }}>
            SmartPDF optimizes your PDF by removing unused objects, compressing streams, and restructuring
            the internal data — all without touching image quality.
          </p>

          <div style={{
            padding: 24, background: "rgba(0,210,160,0.08)", border: "1px solid rgba(0,210,160,0.2)",
            borderRadius: "var(--radius-md)", marginBottom: 32
          }}>
            <p style={{ margin: 0, fontWeight: 500, color: "var(--text-primary)" }}>
              🔒 <strong>Privacy first:</strong> Your PDF never leaves your browser. All compression
              happens locally using WebAssembly — no server upload needed.
            </p>
          </div>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.4rem", fontWeight: 700, margin: "32px 0 12px" }}>
            Compression Tips for Maximum Size Reduction
          </h2>
          <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
            <li>Remove unnecessary pages before compressing</li>
            <li>If you created the PDF, export with &quot;Optimize for web&quot; enabled</li>
            <li>Convert to grayscale if color isn&apos;t needed</li>
            <li>Use SmartPDF&apos;s Images to PDF tool to re-create from lower-res images</li>
          </ul>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.4rem", fontWeight: 700, margin: "32px 0 12px" }}>
            Common File Size Limits by Platform
          </h2>
          <div style={{ overflowX: "auto", marginBottom: 24 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "10px 12px", color: "var(--text-primary)" }}>Platform</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", color: "var(--text-primary)" }}>Max File Size</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Gmail", "25 MB"],
                  ["Outlook", "20 MB"],
                  ["WhatsApp", "100 MB"],
                  ["Slack", "1 GB (free: varies)"],
                  ["Google Forms", "10 MB"],
                  ["Most job portals", "2–5 MB"],
                ].map(([platform, size]) => (
                  <tr key={platform} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 12px" }}>{platform}</td>
                    <td style={{ padding: "10px 12px" }}>{size}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{
            padding: 24, background: "var(--bg-card)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)", textAlign: "center", marginTop: 40
          }}>
            <h3 style={{ color: "var(--text-primary)", marginBottom: 8 }}>Compress your PDF now</h3>
            <p style={{ marginBottom: 16, fontSize: "0.9rem" }}>
              Free, instant, private. No limits.
            </p>
            <Link href="/tools/compress" className="btn-primary" style={{ padding: "12px 32px" }}>
              Compress PDF <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </article>
    </div>
  );
}

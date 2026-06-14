import Link from "next/link";
import { ArrowLeft, Clock, ArrowRight } from "lucide-react";

export const metadata = {
  title: "Blog — SmartPDF Tips, Guides & PDF Tutorials",
  description:
    "Learn how to merge, split, compress, and convert PDFs. Free guides, tips, and tutorials for working with PDF files.",
};

const posts = [
  {
    slug: "how-to-merge-pdf-files-free",
    title: "How to Merge PDF Files for Free in 2026 — The Complete Guide",
    excerpt:
      "Learn 5 ways to combine PDF files into one document. No software needed — merge PDFs instantly in your browser.",
    date: "June 6, 2026",
    readTime: "5 min read",
    category: "Guide",
  },
  {
    slug: "compress-pdf-reduce-file-size",
    title: "How to Compress PDF & Reduce File Size Without Losing Quality",
    excerpt:
      "Sending PDFs via email? Need to upload a PDF under 5MB? Here's how to shrink any PDF file in seconds.",
    date: "June 6, 2026",
    readTime: "4 min read",
    category: "Tutorial",
  },
  {
    slug: "convert-images-to-pdf",
    title: "How to Convert Images to PDF — JPG, PNG, WebP to PDF Free",
    excerpt:
      "Turn your photos, screenshots, and scanned documents into a single PDF file. Works on any device, no app needed.",
    date: "June 6, 2026",
    readTime: "3 min read",
    category: "Tutorial",
  },
];

export default function BlogIndex() {
  return (
    <>
      <div className="tool-page" style={{ maxWidth: 800 }}>
        <Link href="/" className="back-link">
          <ArrowLeft size={14} /> Back to home
        </Link>

        <div className="tool-page-header" style={{ marginBottom: 48 }}>
          <h1>Blog</h1>
          <p>Tips, guides, and tutorials for working with PDFs</p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {posts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="tool-card"
              style={{ display: "block" }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <span className="tool-tag tag-free">{post.category}</span>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: "0.78rem",
                    color: "var(--text-muted)",
                  }}
                >
                  <Clock size={12} /> {post.readTime}
                </span>
                <span
                  style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}
                >
                  {post.date}
                </span>
              </div>
              <h3 style={{ fontSize: "1.15rem", marginBottom: 8 }}>
                {post.title}
              </h3>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: 12 }}>
                {post.excerpt}
              </p>
              <span
                style={{
                  color: "var(--accent-light)",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                Read more <ArrowRight size={14} />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}

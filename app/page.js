"use client";

import Link from "next/link";
import {
  FileText,
  Scissors,
  Minimize2,
  ImagePlus,
  Camera,
  RotateCw,
  Shield,
  Zap,
  Gift,
  Bot,
  Monitor,
  Globe,
  Sparkles,
  ArrowRight,
  Hash,
  Droplets,
  Lock,
  Unlock,
  Layers,
  PenLine,
  Edit3,
  Table,
  Presentation,
  ScanText,
  Highlighter,
} from "lucide-react";

const tools = [
  // Row 1 — Core tools
  { name: "Merge PDF", description: "Combine multiple PDFs into a single document in seconds.", Icon: FileText, iconClass: "icon-merge", href: "/tools/merge", tag: "free" },
  { name: "Split PDF", description: "Extract specific pages or split a PDF into multiple files.", Icon: Scissors, iconClass: "icon-split", href: "/tools/split", tag: "free" },
  { name: "Compress PDF", description: "Reduce PDF file size while maintaining quality.", Icon: Minimize2, iconClass: "icon-compress", href: "/tools/compress", tag: "free" },
  { name: "Images to PDF", description: "Convert JPG, PNG, or WebP images into a single PDF.", Icon: ImagePlus, iconClass: "icon-img2pdf", href: "/tools/images-to-pdf", tag: "free" },
  // Row 2 — More core tools
  { name: "PDF to Images", description: "Convert each page of a PDF into high-quality images.", Icon: Camera, iconClass: "icon-pdf2img", href: "/tools/pdf-to-images", tag: "free" },
  { name: "Rotate Pages", description: "Rotate individual or all pages in your PDF document.", Icon: RotateCw, iconClass: "icon-rotate", href: "/tools/rotate", tag: "free" },
  { name: "Add Page Numbers", description: "Add page numbers with custom position, format, and style.", Icon: Hash, iconClass: "icon-pagenums", href: "/tools/page-numbers", tag: "free" },
  { name: "Watermark PDF", description: "Stamp text watermark over your PDF with custom opacity.", Icon: Droplets, iconClass: "icon-watermark", href: "/tools/watermark", tag: "free" },
  // Row 3 — Security & Organization
  { name: "Protect PDF", description: "Password-protect your PDF to prevent unauthorized access.", Icon: Lock, iconClass: "icon-protect", href: "/tools/protect", tag: "free" },
  { name: "Unlock PDF", description: "Remove password security from your PDF documents.", Icon: Unlock, iconClass: "icon-unlock", href: "/tools/unlock", tag: "free" },
  { name: "Organize PDF", description: "Reorder, delete, and rearrange pages visually.", Icon: Layers, iconClass: "icon-organize", href: "/tools/organize", tag: "free" },
  { name: "Sign PDF", description: "Draw or type your signature and place it on any PDF.", Icon: PenLine, iconClass: "icon-sign", href: "/tools/sign", tag: "free" },
  { name: "Redact PDF", description: "Permanently delete text and images — not just cover them with a box.", Icon: Highlighter, iconClass: "icon-redact", href: "/tools/redact", tag: "free" },
  // Row 4 — Edit & AI
  { name: "Edit PDF", description: "Add text, shapes, and annotations to your PDF document.", Icon: Edit3, iconClass: "icon-edit", href: "/tools/edit", tag: "free" },
  { name: "PDF to Word", description: "Convert PDF to editable Word documents using AI.", Icon: FileText, iconClass: "icon-toword", href: "/tools/pdf-to-word", tag: "ai" },
  { name: "PDF to Excel", description: "Extract tables from PDF into Excel spreadsheets with AI.", Icon: Table, iconClass: "icon-toexcel", href: "/tools/pdf-to-excel", tag: "ai" },
  { name: "PDF to PowerPoint", description: "Turn PDF pages into editable PowerPoint slides.", Icon: Presentation, iconClass: "icon-topptx", href: "/tools/pdf-to-pptx", tag: "ai" },
  // Row 5 — AI
  { name: "OCR PDF", description: "Extract text from scanned PDFs using AI-powered OCR.", Icon: ScanText, iconClass: "icon-ocr", href: "/tools/ocr", tag: "ai" },
];

const features = [
  {
    Icon: Shield,
    title: "100% Private",
    description:
      "Every editing and conversion tool runs in your browser — your files never leave your device. The AI tools are marked where they don't.",
  },
  {
    Icon: Zap,
    title: "Blazing Fast",
    description:
      "Client-side processing means no upload wait times. Results in milliseconds.",
  },
  {
    Icon: Gift,
    title: "Free Forever",
    description:
      "Core PDF tools are free with no limits, no signup, and no watermarks.",
  },
  {
    Icon: Bot,
    title: "AI-Powered",
    description:
      "Summarize, chat with, and extract data from PDFs using advanced AI.",
  },
  {
    Icon: Monitor,
    title: "Works Everywhere",
    description:
      "Fully responsive — works perfectly on desktop, tablet, and mobile.",
  },
  {
    Icon: Globe,
    title: "No Installation",
    description:
      "No software to download. Open your browser and start working.",
  },
];

export default function Home() {
  return (
    <>
      {/* Header */}
      <header className="header">
        <Link href="/" className="header-logo">
          <span className="logo-icon">
            <FileText size={20} />
          </span>
          <span>SmartPDF</span>
        </Link>
        <nav className="header-nav">
          <a href="#tools">Tools</a>
          <a href="#features">Features</a>
          <Link href="/tools/merge" className="btn-primary">
            Get Started
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="hero">
        <div className="hero-badge">
          <Sparkles size={14} /> 100% free &bull; No signup required
        </div>
        <h1>
          PDF tools that
          <br />
          <span className="gradient-text">just work.</span>
        </h1>
        <p className="hero-subtitle">
          Merge, split, compress, convert, and transform your PDFs instantly — right in
          your browser. Private, fast, and powered by AI.
        </p>
        <div className="hero-actions">
          <Link href="/tools/merge" className="btn-primary" id="hero-cta">
            Start for Free <ArrowRight size={16} />
          </Link>
          <a href="#tools" className="btn-secondary">
            Explore All Tools
          </a>
        </div>
        <div className="hero-stats">
          <div className="hero-stat">
            <div className="stat-value">17+</div>
            <div className="stat-label">Free Tools</div>
          </div>
          <div className="hero-stat">
            <div className="stat-value">0</div>
            <div className="stat-label">Files Uploaded</div>
          </div>
          <div className="hero-stat">
            <div className="stat-value">100%</div>
            <div className="stat-label">Browser-Based</div>
          </div>
        </div>
      </section>

      {/* Tools Grid */}
      <section className="tools-section" id="tools">
        <div className="section-header">
          <h2>All PDF Tools</h2>
          <p>
            Everything you need to work with PDFs. Free, fast, and private.
          </p>
        </div>
        <div className="tools-grid">
          {tools.map((tool) => (
            <Link
              href={tool.href}
              key={tool.name}
              className="tool-card"
              id={`tool-${tool.href.split("/").pop()}`}
            >
              <div className={`tool-card-icon ${tool.iconClass}`}>
                <tool.Icon size={24} strokeWidth={1.8} />
              </div>
              <h3>{tool.name}</h3>
              <p>{tool.description}</p>
              <span className={`tool-tag tag-${tool.tag}`}>
                {tool.tag === "free" ? "Free" : tool.tag === "ai" ? "✨ AI" : "Pro"}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="features-section" id="features">
        <div className="section-header">
          <h2>Why SmartPDF?</h2>
          <p>Built for speed, privacy, and simplicity.</p>
        </div>
        <div className="features-grid">
          {features.map((feat) => (
            <div className="feature-card" key={feat.title}>
              <div className="feature-icon">
                <feat.Icon size={28} strokeWidth={1.8} />
              </div>
              <h3>{feat.title}</h3>
              <p>{feat.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <p>© 2026 SmartPDF. All rights reserved.</p>
        <div className="footer-links">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
          <Link href="/contact">Contact</Link>
        </div>
      </footer>
    </>
  );
}

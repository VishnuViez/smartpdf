"use client";

import Link from "next/link";
import { FileText } from "lucide-react";

export default function Header() {
  return (
    <header className="header">
      <Link href="/" className="header-logo">
        <span className="logo-icon">
          <FileText size={20} />
        </span>
        <span>SmartPDF</span>
      </Link>
      <nav className="header-nav">
        <Link href="/#tools">Tools</Link>
        <Link href="/pricing">Pricing</Link>
        <Link href="/blog">Blog</Link>
        <Link href="/tools/merge" className="btn-primary">
          Get Started
        </Link>
      </nav>
    </header>
  );
}

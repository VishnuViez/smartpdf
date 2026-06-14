import "./globals.css";

export const metadata = {
  title: "SmartPDF — Free AI-Powered PDF Tools | Merge, Split, Compress & More",
  description:
    "The free PDF toolkit that actually works. Merge, split, compress, and convert PDFs instantly in your browser. AI-powered features like summarize and chat with PDF. No signup required.",
  keywords: "PDF merge, PDF split, compress PDF, PDF tools, free PDF editor, AI PDF, convert PDF",
  openGraph: {
    title: "SmartPDF — Free AI-Powered PDF Tools",
    description: "Merge, split, compress PDFs instantly. Free, private, browser-based.",
    type: "website",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import Link from "next/link";
import { ArrowLeft, Mail, Bug, Code2 } from "lucide-react";
import Header from "../components/Header";

export const metadata = {
  title: "Contact | SmartPDF",
  description: "How to report a problem or ask a question about SmartPDF.",
};

export default function ContactPage() {
  return (
    <>
      <Header />
      <div className="tool-page legal-page">
        <Link href="/" className="back-link"><ArrowLeft size={14} /> Back to all tools</Link>
        <div className="tool-page-header">
          <h1><Mail size={28} strokeWidth={2} /> Contact</h1>
          <p>Found something broken? That is worth hearing about.</p>
        </div>

        <section>
          <h2><Bug size={17} /> Reporting a problem with a document</h2>
          <p>
            PDF is an old format with a great many producers, and files vary enormously. If a tool
            mangles a document or refuses one it should handle, the most useful report includes:
          </p>
          <ul>
            <li>which tool you were using</li>
            <li>what you expected, and what happened instead</li>
            <li>what produced the PDF, if you know (Word, a scanner, InDesign, a converter)</li>
            <li>whether the file is password-protected</li>
          </ul>
          <p>
            You do not need to send us the document — and if it is confidential, please don&apos;t.
            A description is usually enough to reproduce the problem.
          </p>
        </section>

        <section>
          <h2><Code2 size={17} /> Source</h2>
          <p>
            SmartPDF runs in your browser, so everything it does is inspectable with your
            browser&apos;s developer tools. Nothing is hidden behind a server.
          </p>
        </section>
      </div>
    </>
  );
}

import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import Header from "../components/Header";

export const metadata = {
  title: "Terms of Service | SmartPDF",
  description: "The terms under which SmartPDF is provided.",
};

export default function TermsPage() {
  return (
    <>
      <Header />
      <div className="tool-page legal-page">
        <Link href="/" className="back-link"><ArrowLeft size={14} /> Back to all tools</Link>
        <div className="tool-page-header">
          <h1><FileText size={28} strokeWidth={2} /> Terms of Service</h1>
          <p>Plain terms for a tool that runs on your own machine.</p>
        </div>

        <section>
          <h2>Using SmartPDF</h2>
          <p>
            SmartPDF is provided free of charge. You may use it for personal or commercial work.
            You are responsible for having the right to modify any document you open with it.
          </p>
        </section>

        <section>
          <h2>Your documents remain yours</h2>
          <p>
            We claim no rights over anything you open, edit or produce. Because most tools never
            transmit your file, we could not claim such rights even if we wanted to.
          </p>
        </section>

        <section>
          <h2>No warranty</h2>
          <p>
            SmartPDF is provided as is. PDF is a large and irregular format, and while the tools
            are tested against a corpus of real documents, we cannot guarantee correct output for
            every file in existence. <strong>Keep your original.</strong> Do not use SmartPDF as
            the only copy of anything important.
          </p>
        </section>

        <section>
          <h2>Password protection</h2>
          <p>
            The protect tool uses AES-256 as specified in ISO 32000-2. That is genuine encryption,
            but a document is only as safe as the password you choose and where you store it.
            We cannot recover a lost password — there is no back door and no copy on our side.
          </p>
        </section>

        <section>
          <h2>Third-party services</h2>
          <p>
            The four AI-backed tools send page images to Google Gemini and are subject to Google&apos;s
            terms in addition to these. See the <Link href="/privacy">privacy policy</Link>.
          </p>
        </section>
      </div>
    </>
  );
}

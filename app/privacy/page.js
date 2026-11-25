import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import Header from "../components/Header";

export const metadata = {
  title: "Privacy Policy | SmartPDF",
  description: "What SmartPDF does and does not do with your documents.",
};

export default function PrivacyPage() {
  return (
    <>
      <Header />
      <div className="tool-page legal-page">
        <Link href="/" className="back-link"><ArrowLeft size={14} /> Back to all tools</Link>
        <div className="tool-page-header">
          <h1><ShieldCheck size={28} strokeWidth={2} /> Privacy Policy</h1>
          <p>The short version: almost nothing leaves your device, and we tell you when it does.</p>
        </div>

        <section>
          <h2>Tools that run entirely in your browser</h2>
          <p>
            Merge, split, compress, rotate, organise, edit, sign, protect, unlock, watermark,
            page numbers, images to PDF and PDF to images all run as JavaScript inside your
            browser tab. Your file is read into memory on your own machine, processed there,
            and written back out as a download. It is never uploaded, never stored on a server,
            and never seen by us. Closing the tab discards it.
          </p>
          <p>
            This includes passwords. When you protect or unlock a document, the password is used
            to derive an encryption key locally and is never transmitted.
          </p>
        </section>

        <section>
          <h2>Tools that do send data</h2>
          <p>
            Four tools cannot work this way, because they rely on a hosted AI model:
            <strong> OCR, PDF to Word, PDF to Excel and PDF to PowerPoint</strong>. These render
            your pages to images and send them to Google Gemini for analysis. Each of those tools
            shows a notice saying so before you choose a file.
          </p>
          <p>
            We do not retain those pages. Google&apos;s handling of them is governed by their own
            terms. If a document is confidential, use a different tool or don&apos;t use those four.
          </p>
        </section>

        <section>
          <h2>What we collect</h2>
          <p>
            No accounts, no tracking cookies, no analytics on document contents. We do not build
            a profile of you and there is nothing to sell.
          </p>
        </section>

        <section>
          <h2>Contact</h2>
          <p>
            Questions about any of this: <Link href="/contact">get in touch</Link>.
          </p>
        </section>
      </div>
    </>
  );
}

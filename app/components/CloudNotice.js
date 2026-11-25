"use client";
import { Cloud } from "lucide-react";

/**
 * Shown on tools that send document content to a third party.
 *
 * The home page promises that files never leave the device. That is true of
 * every tool that runs on pdf-lib or pdf.js, and NOT true of the ones backed by
 * a hosted model. Saying so plainly, before the user picks a file, is the only
 * honest way to offer both in one product.
 */
export default function CloudNotice({ provider = "Google Gemini" }) {
  return (
    <div className="cloud-notice" role="note">
      <Cloud size={16} />
      <div>
        <strong>This tool sends your page content to {provider}.</strong>
        <span>
          Unlike the rest of SmartPDF, this one cannot run in your browser. Pages are
          uploaded for analysis and are not stored by us. Avoid it for confidential
          documents.
        </span>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { Check, Sparkles, ArrowLeft, Zap, Crown } from "lucide-react";
import Header from "../components/Header";

const plans = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Perfect for occasional use",
    Icon: Zap,
    features: [
      "Merge PDFs (unlimited)",
      "Split PDFs (unlimited)",
      "Compress PDFs (unlimited)",
      "Images to PDF",
      "PDF to Images",
      "Rotate Pages",
      "No signup required",
      "100% browser-based",
    ],
    cta: "Start Free",
    href: "/tools/merge",
    highlighted: false,
  },
  {
    name: "Pro",
    price: "$9.99",
    period: "/month",
    description: "For power users & professionals",
    Icon: Crown,
    features: [
      "Everything in Free",
      "AI Summarize PDF",
      "Chat with your PDF",
      "Extract data to CSV/Excel",
      "Batch processing",
      "No file size limits",
      "Priority processing",
      "API access",
    ],
    cta: "Upgrade to Pro",
    href: "#",
    highlighted: true,
    stripePriceId: "price_pro_monthly", // Replace with real Stripe price ID
  },
  {
    name: "Credit Pack",
    price: "$4.99",
    period: "one-time",
    description: "50 AI credits — no subscription",
    Icon: Sparkles,
    features: [
      "50 AI processing credits",
      "Use for any AI feature",
      "Credits never expire",
      "No subscription needed",
      "Perfect for one-time use",
    ],
    cta: "Buy Credits",
    href: "#",
    highlighted: false,
    stripePriceId: "price_credits_50", // Replace with real Stripe price ID
  },
];

export default function PricingPage() {
  const handleCheckout = async (stripePriceId) => {
    if (!stripePriceId) return;

    // In production, this would call your API route to create a Stripe Checkout session
    // For now, show a coming soon message
    alert(
      "Stripe checkout coming soon! Set up your Stripe account and add your price IDs to enable payments."
    );

    // Production implementation:
    // const res = await fetch('/api/checkout', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ priceId: stripePriceId }),
    // });
    // const { url } = await res.json();
    // window.location.href = url;
  };

  return (
    <>
      <Header />
      <div className="tool-page" style={{ maxWidth: 1100 }}>
        <Link href="/" className="back-link">
          <ArrowLeft size={14} /> Back to home
        </Link>

        <div className="tool-page-header" style={{ marginBottom: 48 }}>
          <h1>Simple, Transparent Pricing</h1>
          <p>Free tools forever. Pay only for AI-powered features.</p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 20,
          }}
        >
          {plans.map((plan) => (
            <div
              key={plan.name}
              style={{
                padding: 32,
                background: plan.highlighted
                  ? "linear-gradient(135deg, rgba(108,92,231,0.15), rgba(162,155,254,0.08))"
                  : "var(--bg-card)",
                border: `1px solid ${plan.highlighted ? "rgba(108,92,231,0.4)" : "var(--border)"}`,
                borderRadius: "var(--radius-lg)",
                position: "relative",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {plan.highlighted && (
                <div
                  style={{
                    position: "absolute",
                    top: -12,
                    left: "50%",
                    transform: "translateX(-50%)",
                    background: "var(--accent-gradient)",
                    color: "white",
                    padding: "4px 16px",
                    borderRadius: 100,
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    letterSpacing: "0.5px",
                    textTransform: "uppercase",
                  }}
                >
                  Most Popular
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <plan.Icon
                  size={22}
                  color={plan.highlighted ? "var(--accent-light)" : "var(--text-secondary)"}
                />
                <h3 style={{ fontSize: "1.1rem", fontWeight: 700 }}>{plan.name}</h3>
              </div>

              <div style={{ marginBottom: 8 }}>
                <span style={{ fontSize: "2.5rem", fontWeight: 900, letterSpacing: -2 }}>
                  {plan.price}
                </span>
                <span style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginLeft: 4 }}>
                  {plan.period}
                </span>
              </div>

              <p
                style={{
                  color: "var(--text-secondary)",
                  fontSize: "0.88rem",
                  marginBottom: 24,
                }}
              >
                {plan.description}
              </p>

              <ul
                style={{
                  listStyle: "none",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  marginBottom: 28,
                  flex: 1,
                }}
              >
                {plan.features.map((feat) => (
                  <li
                    key={feat}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      fontSize: "0.88rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    <Check
                      size={16}
                      color={plan.highlighted ? "var(--accent-light)" : "var(--success)"}
                    />
                    {feat}
                  </li>
                ))}
              </ul>

              {plan.stripePriceId ? (
                <button
                  className={plan.highlighted ? "btn-primary" : "btn-secondary"}
                  style={{ width: "100%", justifyContent: "center", padding: "14px 24px" }}
                  onClick={() => handleCheckout(plan.stripePriceId)}
                >
                  {plan.cta}
                </button>
              ) : (
                <Link
                  href={plan.href}
                  className="btn-secondary"
                  style={{
                    width: "100%",
                    justifyContent: "center",
                    padding: "14px 24px",
                    textAlign: "center",
                  }}
                >
                  {plan.cta}
                </Link>
              )}
            </div>
          ))}
        </div>

        <div
          style={{
            textAlign: "center",
            marginTop: 48,
            padding: 32,
            background: "var(--bg-card)",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--border)",
          }}
        >
          <h3 style={{ marginBottom: 8, fontSize: "1.1rem" }}>
            Need more? Contact us for Enterprise pricing.
          </h3>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
            Custom API limits, SSO, dedicated support, and SLA guarantees.
          </p>
        </div>
      </div>
    </>
  );
}

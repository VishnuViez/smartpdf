// Stripe Checkout API Route
// To activate:
// 1. npm install stripe
// 2. Set STRIPE_SECRET_KEY in your .env.local
// 3. Create products/prices in Stripe Dashboard
// 4. Replace price IDs in /app/pricing/page.js

import { NextResponse } from "next/server";

export async function POST(request) {
  try {
    const { priceId } = await request.json();

    if (!priceId) {
      return NextResponse.json({ error: "Price ID required" }, { status: 400 });
    }

    // Uncomment when Stripe is configured:
    //
    // const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    //
    // const session = await stripe.checkout.sessions.create({
    //   mode: priceId.includes('credits') ? 'payment' : 'subscription',
    //   payment_method_types: ['card'],
    //   line_items: [{ price: priceId, quantity: 1 }],
    //   success_url: `${request.headers.get('origin')}/success?session_id={CHECKOUT_SESSION_ID}`,
    //   cancel_url: `${request.headers.get('origin')}/pricing`,
    // });
    //
    // return NextResponse.json({ url: session.url });

    return NextResponse.json(
      { error: "Stripe not configured yet. Add STRIPE_SECRET_KEY to .env.local" },
      { status: 503 }
    );
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

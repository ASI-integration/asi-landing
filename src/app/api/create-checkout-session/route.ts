import type { NextRequest } from 'next/server';

function hostnameFromHeaders(request: NextRequest): string {
  const raw =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ??
    request.headers.get('host') ??
    '';
  if (!raw) return '';
  try {
    return new URL(`http://${raw}`).hostname;
  } catch {
    return raw;
  }
}

export async function POST(request: NextRequest) {
  if (hostnameFromHeaders(request).endsWith('.ru')) {
    return Response.json({ error: 'Checkout is not available on this host' }, { status: 403 });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    return Response.json({ error: 'Stripe is not configured' }, { status: 503 });
  }

  const priceId = process.env.NEXT_PUBLIC_STRIPE_PRICE_ID?.trim();
  if (!priceId) {
    return Response.json({ error: 'Stripe is not configured' }, { status: 503 });
  }

  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(secretKey);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: `${process.env.NEXT_PUBLIC_URL}/success`,
    cancel_url: `${process.env.NEXT_PUBLIC_URL}/`,
  });

  return Response.json({ url: session.url });
}

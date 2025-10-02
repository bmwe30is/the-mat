// 📡 WEBHOOK ENDPOINT
// app/api/stripe/webhook/[studioId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { StripeWebhookService } from '@/lib/stripe/webhook-service';

export async function POST(
	request: NextRequest,
	{ params }: { params: { studioId: string } }
) {
	try {
		const studioId = params.studioId;
		const signature = request.headers.get('stripe-signature');
		const body = await request.text();

		if (!signature) {
			console.error('❌ No Stripe signature provided');
			return NextResponse.json(
				{ error: 'No signature provided' },
				{ status: 400 }
			);
		}

		// Parse the event
		let event;
		try {
			event = JSON.parse(body);
		} catch (parseError) {
			console.error('❌ Invalid JSON in webhook:', parseError);
			return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
		}

		// Process webhook
		const result = await StripeWebhookService.processWebhook(
			studioId,
			event,
			signature
		);

		console.log('✅ Stripe webhook processed successfully:', event.id);

		return NextResponse.json({
			success: true,
			eventId: event.id,
		});
	} catch (error) {
		console.error('💥 Stripe webhook error:', error);

		return NextResponse.json(
			{
				error: 'Webhook processing failed',
				message: error instanceof Error ? error.message : 'Unknown error',
			},
			{ status: 500 }
		);
	}
}

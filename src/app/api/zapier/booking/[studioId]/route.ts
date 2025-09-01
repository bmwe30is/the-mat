// app/api/zapier/booking/[studioId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { ZapierWebhookService } from '@/lib/zapier/webhook-handler';
import type { ZapierBookingWebhook } from '@/types';

export async function POST(
	request: NextRequest,
	{ params }: { params: { studioId: string } }
) {
	try {
		const studioId = params.studioId;
		const body = await request.text();
		const signature = request.headers.get('x-zapier-signature') || '';

		// Validate webhook signature
		if (!ZapierWebhookService.validateWebhookSignature(body, signature)) {
			return NextResponse.json(
				{
					error: {
						code: 'INVALID_SIGNATURE',
						message: 'Invalid webhook signature',
					},
				},
				{ status: 401 }
			);
		}

		// Parse webhook data
		const webhookData: ZapierBookingWebhook = JSON.parse(body);

		// Process the booking webhook
		const result = await ZapierWebhookService.processBookingWebhook(
			studioId,
			webhookData
		);

		if (result.success) {
			return NextResponse.json({
				success: true,
				data: { bookingId: result.bookingId },
			});
		} else {
			return NextResponse.json(
				{
					error: {
						code: 'PROCESSING_FAILED',
						message: result.error || 'Failed to process booking',
					},
				},
				{ status: 400 }
			);
		}
	} catch (error) {
		console.error('Zapier webhook error:', error);
		return NextResponse.json(
			{
				error: {
					code: 'WEBHOOK_ERROR',
					message: 'Internal server error',
				},
			},
			{ status: 500 }
		);
	}
}

// GET endpoint to provide webhook URL for studio setup
export async function GET(
	request: NextRequest,
	{ params }: { params: { studioId: string } }
) {
	try {
		const webhookUrl = ZapierWebhookService.generateWebhookUrl(params.studioId);

		return NextResponse.json({
			success: true,
			data: {
				webhookUrl,
				instructions: 'Configure this URL in your Zapier webhook action',
			},
		});
	} catch (error) {
		return NextResponse.json(
			{
				error: {
					code: 'URL_GENERATION_FAILED',
					message: 'Failed to generate webhook URL',
				},
			},
			{ status: 500 }
		);
	}
}

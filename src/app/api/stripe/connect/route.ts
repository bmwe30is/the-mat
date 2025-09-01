// app/api/stripe/connect/route.ts - OAuth initiation endpoint
import { NextRequest, NextResponse } from 'next/server';
import { StripeConnectService } from '@/lib/stripe/connect';

export async function POST(request: NextRequest) {
	try {
		const { studioId } = await request.json();

		if (!studioId) {
			return NextResponse.json(
				{
					error: {
						code: 'MISSING_STUDIO_ID',
						message: 'Studio ID is required',
					},
				},
				{ status: 400 }
			);
		}

		const connectUrl = StripeConnectService.generateConnectUrl(studioId);

		return NextResponse.json({
			success: true,
			data: { connectUrl },
		});
	} catch (error) {
		console.error('Stripe Connect URL generation failed:', error);
		return NextResponse.json(
			{
				error: {
					code: 'CONNECT_URL_FAILED',
					message: 'Failed to generate Stripe Connect URL',
				},
			},
			{ status: 500 }
		);
	}
}

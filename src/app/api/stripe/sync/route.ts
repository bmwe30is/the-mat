// app/api/stripe/sync/route.ts - Manual sync endpoint
import { NextRequest, NextResponse } from 'next/server';
import { StripeConnectService } from '@/lib/stripe/connect';

export async function POST(request: NextRequest) {
	try {
		const { studioId, accountId } = await request.json();

		if (!studioId || !accountId) {
			return NextResponse.json(
				{
					error: {
						code: 'MISSING_PARAMS',
						message: 'Studio ID and Account ID required',
					},
				},
				{ status: 400 }
			);
		}

		const result = await StripeConnectService.syncPaymentData(
			studioId,
			accountId
		);

		return NextResponse.json({
			success: true,
			data: result,
		});
	} catch (error) {
		console.error('Payment sync error:', error);
		return NextResponse.json(
			{
				error: {
					code: 'SYNC_FAILED',
					message: 'Failed to sync payment data',
				},
			},
			{ status: 500 }
		);
	}
}

// app/api/stripe/connect/route.ts - Stripe Connect Integration
import { NextRequest, NextResponse } from 'next/server';
import { StripeConnectService } from '@/lib/stripe/connect';

export async function POST(request: NextRequest) {
	try {
		const body = await request.json();
		const { studioId } = body;

		const connectUrl = await StripeConnectService.generateConnectUrl(studioId);

		return NextResponse.json({
			success: true,
			url: connectUrl,
		});
	} catch (error) {
		console.error(
			'An error occurred when calling the Stripe API to create an account:',
			error
		);
		return NextResponse.json(
			{ success: false, error: 'Failed to create account link' },
			{ status: 500 }
		);
	}
}

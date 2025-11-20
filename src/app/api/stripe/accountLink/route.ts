// app/api/stripe/connect/route.ts - Stripe Connect Integration
import { NextRequest, NextResponse } from 'next/server';
import { StripeConnectService } from '@/lib/stripe/connect';

export async function POST(request: NextRequest) {
	try {
		const origin = request.headers.get('origin') || '';
		const body = await request.json();
		const { account } = body;
		const accountLink = await StripeConnectService.createStripeAccountLink(
			account,
			origin
		);

		return NextResponse.json(accountLink);
	} catch (error) {
		console.error(
			'An error occurred when calling the Stripe API to create an account link:',
			error
		);
		return NextResponse.json(
			{ success: false, error: 'Failed to create account link' },
			{ status: 500 }
		);
	}
}

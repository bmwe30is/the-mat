// app/api/stripe/callback/route.ts - OAuth callback handler
import { NextRequest, NextResponse } from 'next/server';
import { StripeConnectService } from '@/lib/stripe/connect';

export async function GET(request: NextRequest) {
	try {
		const searchParams = request.nextUrl.searchParams;
		const code = searchParams.get('code');
		const state = searchParams.get('state'); // studioId
		const error = searchParams.get('error');

		if (error) {
			// Redirect to error page
			return NextResponse.redirect(
				new URL(`/dashboard/${state}/integrations?error=${error}`, request.url)
			);
		}

		if (!code || !state) {
			return NextResponse.redirect(
				new URL(
					`/dashboard/${state}/integrations?error=missing_params`,
					request.url
				)
			);
		}

		// Exchange code for token and store account info
		const result = await StripeConnectService.exchangeCodeForToken(code, state);

		if (result.success && result.accountId) {
			// Trigger initial payment sync
			await StripeConnectService.syncPaymentData(state);

			// Redirect to success page
			return NextResponse.redirect(
				new URL(`/dashboard/${state}/integrations?connected=true`, request.url)
			);
		}

		throw new Error('Token exchange failed');
	} catch (error) {
		console.error('Stripe callback error:', error);
		return NextResponse.redirect(
			new URL('/dashboard?error=connection_failed', request.url)
		);
	}
}

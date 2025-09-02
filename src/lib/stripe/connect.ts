// lib/stripe/connect.ts
import { stripe } from './client';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
	process.env.NEXT_PUBLIC_SUPABASE_URL!,
	process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export class StripeConnectService {
	/**
	 * Generate Stripe Connect OAuth URL for studio onboarding
	 */
	static generateConnectUrl(studioId: string): string {
		const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
		const redirectUri = `${baseUrl}/api/stripe/callback`;

		const params = new URLSearchParams({
			response_type: 'code',
			client_id: process.env.STRIPE_CONNECT_CLIENT_ID!,
			scope: 'read_only',
			redirect_uri: redirectUri,
			state: studioId, // Pass studio ID for callback handling
		});

		return `https://connect.stripe.com/oauth/authorize?${params.toString()}`;
	}

	/**
	 * Exchange authorization code for access token
	 */
	static async exchangeCodeForToken(code: string, studioId: string) {
		try {
			const response = await stripe.oauth.token({
				grant_type: 'authorization_code',
				code,
			});

			// Store the connected account information
			await supabase
				.from('studios')
				.update({
					stripe_account_id: response.stripe_user_id,
					stripe_access_token: response.access_token, // Encrypt in production
					stripe_connected_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
				})
				.eq('id', studioId);

			return {
				success: true,
				accountId: response.stripe_user_id,
			};
		} catch (error) {
			console.error('Stripe Connect token exchange failed:', error);
			throw new Error('Failed to connect Stripe account');
		}
	}

	/**
	 * Sync payment data for a connected studio
	 */
	static async syncPaymentData(studioId: string) {
		try {
			// Get studio's access token (decrypt in production)
			const { data: studio } = await supabase
				.from('studios')
				.select('stripe_access_token, created_at')
				.eq('id', studioId)
				.single();

			if (!studio?.stripe_access_token) {
				throw new Error('No Stripe access token found');
			}

			// Fetch payments from the last 30 days (adjust as needed)
			const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;

			const charges = await stripe.charges.list({
				limit: 100,
				created: { gte: thirtyDaysAgo },
				expand: ['data.balance_transaction'],
			});

			// Process and store payment data
			const payments = charges.data.map((charge) => ({
				studio_id: studioId,
				stripe_payment_id: charge.id,
				amount: charge.amount,
				fee:
					typeof charge.balance_transaction === 'string'
						? charge.balance_transaction.toString()
						: charge.balance_transaction?.fee || 0,
				net_amount:
					typeof charge.balance_transaction === 'string'
						? charge.balance_transaction.toString()
						: charge.balance_transaction?.fee || 0,
				currency: charge.currency,
				customer_email: charge.billing_details?.email || charge.receipt_email,
				description: charge.description || '',
				metadata: charge.metadata,
				status: charge.status,
				created_at: new Date(charge.created * 1000).toISOString(),
				processed_at: charge.balance_transaction
					? new Date(
							typeof charge.balance_transaction === 'string'
								? charge.balance_transaction.toString()
								: charge.balance_transaction?.created * 1000
						).toISOString()
					: null,
			}));

			// Upsert payments to database
			const { error } = await supabase
				.from('stripe_payments')
				.upsert(payments, {
					onConflict: 'stripe_payment_id,studio_id',
					ignoreDuplicates: false,
				});

			if (error) {
				console.error('Error storing payment data:', error);
				throw error;
			}

			return {
				success: true,
				paymentsProcessed: payments.length,
			};
		} catch (error) {
			console.error('Payment sync failed:', error);
			throw error;
		}
	}

	/**
	 * Get account information for connected studio
	 */
	static async getAccountInfo(accountId: string) {
		try {
			const account = await stripe.accounts.retrieve(accountId);

			return {
				id: account.id,
				business_name: account.business_profile?.name || account.company?.name,
				email: account.email,
				country: account.country,
				currency: account.default_currency,
				charges_enabled: account.charges_enabled,
				payouts_enabled: account.payouts_enabled,
			};
		} catch (error) {
			console.error('Failed to get account info:', error);
			throw error;
		}
	}
}

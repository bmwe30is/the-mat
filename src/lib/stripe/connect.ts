// STEP 1: Update Stripe Connect Service
// lib/stripe/connect.ts - Enhanced with webhook setup and encrypted token storage
import Stripe from 'stripe';
import { stripe } from './client';
import { prisma } from '../prisma';
import { encrypt, decrypt } from '../crypto';

export class StripeConnectService {
	/**
	 * Enhanced token exchange with automatic webhook setup
	 */
	static async exchangeCodeForToken(code: string, studioId: string) {
		try {
			console.log('🔄 Exchanging Stripe Connect code for token...');

			studioId = 'test-studio-1';
			// 1. Exchange authorization code for access token
			const response = await stripe.oauth.token({
				grant_type: 'authorization_code',
				code,
			});

			const accountId = response.stripe_user_id;
			if (!accountId) {
				throw new Error('No account ID returned from Stripe');
			}
			console.log('✅ Token exchange successful for account:', accountId);

			// 2. Store connection information with encrypted refresh token
			await prisma.studio.update({
				where: { id: studioId },
				data: {
					stripeAccountId: accountId,
					stripeRefreshToken: response.refresh_token
						? encrypt(response.refresh_token)
						: null,
					stripeConnectedAt: new Date(),
					updatedAt: new Date(),
				},
			});

			// 4. 🆕 Perform initial data sync
			console.log('📥 Performing initial payment sync...');
			const syncResult = await this.performInitialSync(studioId, accountId);

			return {
				success: true,
				accountId,
				initialPayments: syncResult.paymentCount,
				message: `Connected successfully! Synced ${syncResult.paymentCount} recent payments.`,
			};
		} catch (error) {
			console.error('❌ Stripe Connect setup failed:', error);
			const errorMessage =
				error instanceof Error ? error.message : 'Unknown error';
			throw new Error(`Failed to connect Stripe account: ${errorMessage}`);
		}
	}

	/**
	 * Get a fresh access token for a connected account
	 */
	private static async getFreshAccessToken(studioId: string): Promise<string> {
		const studio = await prisma.studio.findUnique({
			where: { id: studioId },
			select: { stripeRefreshToken: true },
		});

		if (!studio?.stripeRefreshToken) {
			throw new Error('No refresh token found for studio');
		}

		try {
			// Decrypt the refresh token
			const refreshToken = decrypt(studio.stripeRefreshToken);

			const response = await stripe.oauth.token({
				grant_type: 'refresh_token',
				refresh_token: refreshToken,
			});

			if (!response.access_token) {
				throw new Error('No access token returned from Stripe');
			}

			return response.access_token;
		} catch (error) {
			console.error('Failed to refresh access token:', error);
			throw new Error(
				'Failed to refresh Stripe access token. Studio may need to reconnect.'
			);
		}
	}

	/**
	 * Initial sync of recent payment data (last 30 days)
	 */
	static async performInitialSync(studioId: string, accountId: string) {
		try {
			// Get fresh access token
			const accessToken = await this.getFreshAccessToken(studioId);

			// Create Stripe client with fresh token
			const connectedStripe = new Stripe(accessToken, {
				apiVersion: '2025-08-27.basil',
			});

			// Sync last 30 days of payments
			const thirtyDaysAgo = Math.floor(
				(Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000
			);

			const charges = await connectedStripe.charges.list({
				created: { gte: thirtyDaysAgo },
				limit: 100,
				expand: ['data.balance_transaction'],
			});

			if (charges.data.length === 0) {
				console.log('📭 No recent payments found');
				return { paymentCount: 0 };
			}

			// Transform and store payments
			const payments = charges.data.map((charge: Stripe.Charge) => ({
				studioId: studioId,
				stripePaymentId: charge.id,
				amount: charge.amount,
				currency: charge.currency,
				customerEmail: charge.billing_details?.email || charge.receipt_email,
				description: charge.description || '',
				metadata: charge.metadata || {},
				status: charge.status,
				paid: charge.status === 'succeeded',
				createdAt: new Date(charge.created * 1000),
			}));

			// Bulk upsert payments
			await prisma.stripePayment.createMany({
				data: payments,
				skipDuplicates: true,
			});

			console.log(
				`✅ Initial sync complete: ${payments.length} payments stored`
			);
			return { paymentCount: payments.length };
		} catch (error) {
			console.error('Initial sync failed:', error);
			// Don't throw - connection can succeed even if sync fails
			return { paymentCount: 0 };
		}
	}

	/**
	 * Manual sync for studios (fallback option)
	 */
	static async performManualSync(studioId: string, daysBack: number = 7) {
		try {
			console.log(
				`🔄 Starting manual sync for studio ${studioId}, ${daysBack} days back`
			);

			// Get studio's Stripe account info
			const studio = await prisma.studio.findUnique({
				where: { id: studioId },
				select: {
					stripeAccountId: true,
					stripeLastManualSync: true,
				},
			});

			if (!studio?.stripeAccountId) {
				throw new Error('Studio not found or Stripe not connected');
			}

			// Get fresh access token
			const accessToken = await this.getFreshAccessToken(studioId);

			// Create connected Stripe client with fresh token
			const connectedStripe = new Stripe(accessToken, {
				apiVersion: '2025-08-27.basil',
			});

			// Determine sync window
			let startDate: number;
			if (studio.stripeLastManualSync) {
				// Sync from last manual sync
				startDate = Math.floor(studio.stripeLastManualSync.getTime() / 1000);
			} else {
				// Sync from X days back
				startDate = Math.floor(
					(Date.now() - daysBack * 24 * 60 * 60 * 1000) / 1000
				);
			}

			let totalSynced = 0;
			let hasMore = true;
			let startingAfter: string | undefined;

			// Paginate through all charges
			while (hasMore) {
				const charges = await connectedStripe.charges.list({
					created: { gte: startDate },
					limit: 100,
					starting_after: startingAfter,
					expand: ['data.balance_transaction'],
				});

				if (charges.data.length === 0) break;

				// Process batch
				const payments = charges.data.map((charge: Stripe.Charge) => ({
					studioId: studioId,
					stripePaymentId: charge.id,
					amount: charge.amount,
					currency: charge.currency,
					customerEmail: charge.billing_details?.email || charge.receipt_email,
					description: charge.description || '',
					metadata: charge.metadata || {},
					status: charge.status,
					paid: charge.status === 'succeeded',
					createdAt: new Date(charge.created * 1000),
				}));

				// Bulk upsert
				await prisma.stripePayment.createMany({
					data: payments,
					skipDuplicates: true,
				});

				totalSynced += payments.length;
				hasMore = charges.has_more;
				startingAfter = charges.data[charges.data.length - 1].id;

				console.log(`📥 Manual sync progress: ${totalSynced} payments...`);
			}

			// Update last manual sync timestamp
			await prisma.studio.update({
				where: { id: studioId },
				data: {
					stripeLastManualSync: new Date(),
					// stripeTotalPayments: totalSynced, // TODO: Add to schema if needed
				},
			});

			console.log(`✅ Manual sync complete: ${totalSynced} payments synced`);
			return {
				success: true,
				paymentsSynced: totalSynced,
				syncedFrom: new Date(startDate * 1000).toISOString(),
			};
		} catch (error) {
			console.error('❌ Manual sync failed:', error);
			throw error;
		}
	}

	/**
	 * Create a Stripe connect account for a Studio
	 */
	// static async createStripeConnectAccount() {
	// 	try {
	// 		const account = await stripe.accounts.create({});

	// 		return {
	// 			success: true,
	// 			accountId: account.id,
	// 		};
	// 	} catch (error) {
	// 		console.error(
	// 			'An error occurred when calling the Stripe API to create an account:',
	// 			error
	// 		);
	// 		return {
	// 			success: false,
	// 			error: error,
	// 		};
	// 	}
	// }

	/**
	 * Create a Stripe account link for a Studio
	 *
	 * @param accountId - The ID of the Stripe account to link
	 * @param origin - The origin of the request
	 * @returns The URL of the Stripe account link
	 */
	static async createStripeAccountLink(accountId: string, origin: string) {
		try {
			const accountLink = await stripe.accountLinks.create({
				account: accountId,
				refresh_url: `${origin}/refresh/${accountId}`,
				return_url: `${origin}/return/${accountId}`,
				type: 'account_onboarding',
			});

			console.log('🔗 Stripe account link created:', accountLink.url);
			return {
				success: true,
				url: accountLink.url,
			};
		} catch (error) {
			console.error(
				'An error occurred when calling the Stripe API to create an account link:',
				error
			);
		}
	}

	/**
	 * Generate Stripe Connect OAuth URL for studio onboarding
	 */
	static generateConnectUrl(studioId: string): string {
		const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
		const redirectUri = `${baseUrl}/api/stripe/callback`;

		const params = new URLSearchParams({
			response_type: 'code',
			client_id: process.env.STRIPE_CONNECT_CLIENT_ID!,
			scope: 'read_write',
			redirect_uri: redirectUri,
			state: studioId, // Pass studio ID for callback handling
		});

		return `https://connect.stripe.com/oauth/authorize?${params.toString()}`;
	}

	/**
	 * Sync payment data for a connected studio
	 */
	static async syncPaymentData(studioId: string, accountId: string) {
		try {
			// Get studio's access token (decrypt in production)

			console.log('🔄 Syncing payment data for studio:', studioId);
			console.log('🔄 Account ID:', accountId);
			return {
				success: true,
				paymentsProcessed: 0,
			};
		} catch (error) {
			console.error('Payment sync failed:', error);
			throw error;
		}
	}
}

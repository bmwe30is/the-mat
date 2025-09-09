// STEP 1: Update Stripe Connect Service
// lib/stripe/connect.ts - Enhanced with webhook setup
import { stripe } from './client';
import { createClient } from '@supabase/supabase-js';
import { StripeWebhookService } from './webhook-service';

const supabase = createClient(
	process.env.NEXT_PUBLIC_SUPABASE_URL!,
	process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export class StripeConnectService {
	/**
	 * Enhanced token exchange with automatic webhook setup
	 */
	static async exchangeCodeForToken(code: string, studioId: string) {
		try {
			console.log('🔄 Exchanging Stripe Connect code for token...');

			// 1. Exchange authorization code for access token
			const response = await stripe.oauth.token({
				grant_type: 'authorization_code',
				code,
			});

			const accountId = response.stripe_user_id;
			console.log('✅ Token exchange successful for account:', accountId);

			// 2. Store connection information
			await supabase
				.from('studios')
				.update({
					stripe_account_id: accountId,
					stripe_access_token: response.access_token, // Encrypt in production
					stripe_connected_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
				})
				.eq('id', studioId);

			// 3. 🆕 Setup webhook automatically
			console.log('🔗 Setting up Stripe webhook...');
			const webhookResult = await StripeWebhookService.setupStudioWebhook(
				studioId,
				accountId
			);

			// 4. 🆕 Perform initial data sync
			console.log('📥 Performing initial payment sync...');
			const syncResult = await this.performInitialSync(studioId, accountId);

			return {
				success: true,
				accountId,
				webhookConfigured: webhookResult.success,
				webhookId: webhookResult.webhookId,
				initialPayments: syncResult.paymentCount,
				message: `Connected successfully! Synced ${syncResult.paymentCount} recent payments.`,
			};
		} catch (error) {
			console.error('❌ Stripe Connect setup failed:', error);
			throw new Error(`Failed to connect Stripe account: ${error.message}`);
		}
	}

	/**
	 * Initial sync of recent payment data (last 30 days)
	 */
	private static async performInitialSync(studioId: string, accountId: string) {
		try {
			// Create Stripe client for connected account
			const connectedStripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
				apiVersion: '2023-10-16',
				stripeAccount: accountId,
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
			const payments = charges.data.map((charge) => ({
				studio_id: studioId,
				stripe_payment_id: charge.id,
				amount: charge.amount,
				fee: charge.balance_transaction?.fee || 0,
				net_amount: charge.balance_transaction?.net || charge.amount,
				currency: charge.currency,
				customer_email: charge.billing_details?.email || charge.receipt_email,
				description: charge.description || '',
				metadata: charge.metadata || {},
				status: charge.status,
				created_at: new Date(charge.created * 1000).toISOString(),
				processed_at: charge.balance_transaction
					? new Date(charge.balance_transaction.created * 1000).toISOString()
					: null,
				sync_type: 'initial_sync',
			}));

			// Bulk insert payments
			const { error } = await supabase
				.from('stripe_payments')
				.upsert(payments, {
					onConflict: 'stripe_payment_id,studio_id',
					ignoreDuplicates: false,
				});

			if (error) {
				console.error('Failed to store initial payments:', error);
				throw error;
			}

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
			const { data: studio, error } = await supabase
				.from('studios')
				.select('stripe_account_id, stripe_last_manual_sync')
				.eq('id', studioId)
				.single();

			if (error || !studio?.stripe_account_id) {
				throw new Error('Studio not found or Stripe not connected');
			}

			// Create connected Stripe client
			const connectedStripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
				apiVersion: '2023-10-16',
				stripeAccount: studio.stripe_account_id,
			});

			// Determine sync window
			let startDate: number;
			if (studio.stripe_last_manual_sync) {
				// Sync from last manual sync
				startDate = Math.floor(
					new Date(studio.stripe_last_manual_sync).getTime() / 1000
				);
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
				const payments = charges.data.map((charge) => ({
					studio_id: studioId,
					stripe_payment_id: charge.id,
					amount: charge.amount,
					fee: charge.balance_transaction?.fee || 0,
					net_amount: charge.balance_transaction?.net || charge.amount,
					currency: charge.currency,
					customer_email: charge.billing_details?.email || charge.receipt_email,
					description: charge.description || '',
					metadata: charge.metadata || {},
					status: charge.status,
					created_at: new Date(charge.created * 1000).toISOString(),
					processed_at: charge.balance_transaction
						? new Date(charge.balance_transaction.created * 1000).toISOString()
						: null,
					sync_type: 'manual_sync',
				}));

				// Bulk upsert
				await supabase.from('stripe_payments').upsert(payments, {
					onConflict: 'stripe_payment_id,studio_id',
					ignoreDuplicates: false,
				});

				totalSynced += payments.length;
				hasMore = charges.has_more;
				startingAfter = charges.data[charges.data.length - 1].id;

				console.log(`📥 Manual sync progress: ${totalSynced} payments...`);
			}

			// Update last manual sync timestamp
			await supabase
				.from('studios')
				.update({
					stripe_last_manual_sync: new Date().toISOString(),
					stripe_total_payments: totalSynced,
				})
				.eq('id', studioId);

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
}

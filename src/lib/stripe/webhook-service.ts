// 🚀 STRIPE WEBHOOK IMPLEMENTATION FOR MVP
// Much simpler than periodic sync - payments come to you automatically!

// lib/stripe/webhook-service.ts
import { stripe } from './client';
import { prisma } from '@/lib/prisma';
import { StripeWebhookEvent, StripeCharge } from '@/types';
import type { Booking, StripePayment } from '@prisma/client';

export class StripeWebhookService {
	// 🔧 SETUP: Create webhook when studio connects Stripe
	static async setupStudioWebhook(studioId: string, accountId: string) {
		try {
			console.log('🔗 Setting up Stripe webhook for studio:', studioId);

			// Create webhook endpoint for the connected account
			const webhook = await stripe.webhookEndpoints.create(
				{
					url: `${process.env.NEXT_PUBLIC_APP_URL}/api/stripe/webhook/${studioId}`,
					enabled_events: [
						'charge.succeeded', // Successful payments
						'charge.refunded', // Refunds
						'charge.dispute.created', // Chargebacks/disputes
					],
					connect: true, // This webhook is for connected accounts
					metadata: {
						studio_id: studioId,
					},
				},
				{
					stripeAccount: accountId, // Create webhook on connected account
				}
			);

			// Store webhook info in studio record
			await prisma.studio.update({
				where: { id: studioId },
				data: {
					stripeWebhookId: webhook.id,
					stripeWebhookSecret: webhook.secret,
					stripeWebhookUrl: webhook.url,
					updatedAt: new Date(),
				},
			});

			console.log('✅ Stripe webhook created:', webhook.id);
			return { success: true, webhookId: webhook.id };
		} catch (error) {
			console.error('❌ Failed to create Stripe webhook:', error);
			throw error;
		}
	}

	// 📥 PROCESS: Handle incoming webhook from Stripe
	static async processWebhook(
		studioId: string,
		event: StripeWebhookEvent,
		signature: string
	) {
		const webhookId = event.id;

		try {
			// 1. Log webhook for retry processing
			// await this.logWebhook(studioId, event, 'processing');

			// 2. Validate webhook signature
			if (!(await this.validateStripeSignature(studioId, event, signature))) {
				throw new Error('Invalid webhook signature');
			}

			console.log(
				'📥 Processing Stripe webhook:',
				event.type,
				'for studio:',
				studioId
			);

			// 3. Process based on event type with proper type safety
			switch (event.type) {
				case 'charge.succeeded':
					const charge = event.data.object;
					await this.handleChargeSucceeded(studioId, charge);
					break;

				case 'charge.refunded':
					const refundedCharge = event.data.object;
					await this.handleRefund(studioId, refundedCharge);
					break;

				default:
					console.log('🔄 Unhandled webhook event type:', event.type);
			}

			// 4. Mark webhook as processed successfully
			await this.updateWebhookStatus(webhookId, 'success');

			return { success: true, processed: true };
		} catch (error) {
			console.error('❌ Webhook processing failed:', error);

			// 5. Mark webhook as failed and log error
			await this.updateWebhookStatus(
				webhookId,
				'failed',
				error instanceof Error ? error.message : 'Unknown error'
			);

			throw error;
		}
	}

	// 💰 HANDLE: Successful charge
	private static async handleChargeSucceeded(
		studioId: string,
		charge: StripeCharge
	) {
		try {
			const paymentData = {
				studioId: studioId,
				stripePaymentId: charge.id,
				amount: charge.amount,
				currency: charge.currency,
				customerEmail: charge.billing_details?.email || charge.receipt_email,
				description: charge.description || '',
				metadata: charge.metadata || {},
				status: charge.status,
				paid: charge.paid,
			};

			const createdPayment = await prisma.stripePayment.upsert({
				where: {
					stripePaymentId: charge.id,
				},
				update: paymentData,
				create: paymentData,
			});

			console.log('✅ Payment stored from webhook:', charge.id);
			await this.attemptBookingMatch(studioId, createdPayment);
		} catch (error) {
			console.error('Failed to handle charge.succeeded:', error);
			throw error;
		}
	}

	// �� AUTO-MATCH: Try to match new payment with existing unmatched bookings
	private static async attemptBookingMatch(
		studioId: string,
		paymentData: StripePayment
	) {
		try {
			// Find recent unmatched bookings that might match this payment
			const searchStart = new Date(Date.now() - 48 * 60 * 60 * 1000); // Last 48 hours
			const searchEnd = new Date(Date.now() + 24 * 60 * 60 * 1000); // Next 24 hours

			const unmatchedBookings = await prisma.booking.findMany({
				where: {
					// Note: matchedPaymentId field needs to be added to schema
					// matchedPaymentId: null, // Only unmatched bookings
					classStartTime: {
						gte: searchStart,
						lte: searchEnd,
					},
				},
			});

			if (!unmatchedBookings || unmatchedBookings.length === 0) {
				console.log(
					'🔍 No unmatched bookings found for payment:',
					paymentData.stripePaymentId
				);
				return;
			}

			// For each booking, try to match with the payment
			for (const booking of unmatchedBookings) {
				const matchResult = await this.evaluateMatch(booking, paymentData);

				if (matchResult.confidence === 'high') {
					await this.createMatchedTransaction(studioId, booking, paymentData);
					console.log(
						'✅ Auto-matched payment to booking:',
						paymentData.stripePaymentId,
						'→',
						booking.id
					);
					break; // Only match to one booking
				}
			}
		} catch (error) {
			console.error('Auto-matching failed:', error);
			// Don't throw - payment storage should succeed even if matching fails
		}
	}

	// 💸 HANDLE: Refunds
	private static async handleRefund(studioId: string, charge: StripeCharge) {
		try {
			// Update original payment record
			await prisma.stripePayment.updateMany({
				where: {
					stripePaymentId: charge.id,
					studioId: studioId,
				},
				data: {
					status: 'refunded',
				},
			});

			// Create refund record for tracking
			// Note: Need to create StripeRefund model in schema
			console.log('✅ Refund processed:', charge.id);
		} catch (error) {
			console.error('Failed to handle refund:', error);
			throw error;
		}
	}

	// 🛡️ VALIDATE: Webhook signature
	private static async validateStripeSignature(
		studioId: string,
		payload: StripeWebhookEvent,
		signature: string
	): Promise<boolean> {
		try {
			// Get webhook secret for this studio
			await prisma.studio.findUnique({
				where: { id: studioId },
				select: {
					stripeWebhookSecret: true,
				},
			});

			// For MVP, we'll use a fallback approach
			const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

			if (!webhookSecret) {
				console.warn('⚠️ No webhook secret found for studio:', studioId);
				return process.env.NODE_ENV === 'development'; // Allow in dev
			}

			// Validate using Stripe's built-in validation
			const event = stripe.webhooks.constructEvent(
				JSON.stringify(payload),
				signature,
				webhookSecret
			);

			return !!event;
		} catch (error) {
			console.error('❌ Webhook signature validation failed:', error);
			return false;
		}
	}

	// 📝 LOG: Webhook for retry processing
	// private static async logWebhook(
	// 	studioId: string,
	// 	event: StripeWebhookEvent,
	// 	status: 'pending' | 'processing' | 'success' | 'failed'
	// ) {
	// 	try {
	// 		// Note: Need to create WebhookLog model in schema
	// 		console.log(
	// 			`🔗 Logging webhook ${event.id} for studio ${studioId} with status ${status}`
	// 		);
	// 		// await prisma.webhookLog.create({
	// 		//   data: {
	// 		//     studioId,
	// 		//     eventType: event.type,
	// 		//     eventId: event.id,
	// 		//     status,
	// 		//     webhookData: event,
	// 		//     retryCount: 0,
	// 		//   },
	// 		// });
	// 	} catch (error) {
	// 		console.error('Failed to log webhook:', error);
	// 	}
	// }

	// 🔄 UPDATE: Webhook status
	private static async updateWebhookStatus(
		webhookId: string,
		status: 'success' | 'failed',
		errorMessage?: string
	) {
		try {
			// Note: Need to implement webhook status update
			console.log(`🔄 Updating webhook ${webhookId} status to ${status}`);
			// await prisma.webhookLog.update({
			//   where: { eventId: webhookId },
			//   data: {
			//     status,
			//     errorMessage,
			//     processedAt: new Date(),
			//   },
			// });
		} catch (error) {
			console.error('Failed to update webhook status:', errorMessage);
		}
	}

	// 🎯 MATCH: Evaluate if booking matches payment
	private static async evaluateMatch(
		booking: Booking,
		paymentData: StripePayment
	) {
		let score = 0;
		const reasons: string[] = [];

		// Email match (highest priority)
		if (
			paymentData.customerEmail?.toLowerCase() ===
			booking.customerEmail.toLowerCase()
		) {
			score += 100;
			reasons.push('Email match');
		}

		// Amount match (if booking has amount) - with proper Decimal handling
		if (booking.paidAmount) {
			try {
				const bookingAmount = booking.paidAmount.toNumber();
				const paymentAmount = paymentData.amount / 100; // Convert cents to dollars
				const amountDiff = Math.abs(paymentAmount - bookingAmount);

				// Allow 50 cent difference (0.50)
				if (amountDiff < 0.5) {
					score += 50;
					reasons.push('Amount match');
				}
			} catch (error) {
				console.warn('Failed to convert Decimal to number:', error);
				// Continue without amount matching
			}
		}

		// Description contains class name
		if (
			paymentData.description
				?.toLowerCase()
				.includes(booking.className.toLowerCase())
		) {
			score += 30;
			reasons.push('Class name in description');
		}

		// Time proximity (closer = higher score)
		const bookingTime = new Date(booking.classStartTime).getTime();
		const paymentTime = new Date(paymentData.createdAt).getTime();
		const timeDiffHours =
			Math.abs(bookingTime - paymentTime) / (1000 * 60 * 60);

		if (timeDiffHours < 1) score += 25;
		else if (timeDiffHours < 6) score += 15;
		else if (timeDiffHours < 24) score += 5;

		reasons.push(`${timeDiffHours.toFixed(1)}h time diff`);

		const confidence =
			score >= 150
				? 'high'
				: score >= 100
					? 'medium'
					: score >= 50
						? 'low'
						: 'unmatched';

		return {
			confidence,
			score,
			reasons: reasons.join(', '),
		};
	}

	// 🔗 CREATE: Matched transaction
	private static async createMatchedTransaction(
		studioId: string,
		booking: Booking,
		paymentData: StripePayment
	) {
		await prisma.matchedTransaction.create({
			data: {
				studioId: studioId,
				stripePaymentId: paymentData.stripePaymentId,
				bookingId: booking.id,
				matchConfidence: 'high', // From evaluateMatch result
				matchReason: 'Auto-matched from webhook',
				amount: paymentData.amount,
				netProfit: paymentData.amount,
				customerEmail: booking.customerEmail,
				className: booking.className,
				instructorName: booking.instructorName,
				transactionDate: booking.classStartTime,
			},
		});

		// Mark payment as matched
		await prisma.stripePayment.update({
			where: {
				studioId: studioId,
				stripePaymentId: paymentData.stripePaymentId,
			},
			data: {
				bookingMatchId: booking.id,
			},
		});
	}
}

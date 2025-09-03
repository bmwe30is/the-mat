// lib/zapier/webhook-handler.ts
import { createClient } from '@supabase/supabase-js';
import type { ZapierBookingWebhook, Booking } from '@/types';

const supabase = createClient(
	process.env.NEXT_PUBLIC_SUPABASE_URL!,
	process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export class ZapierWebhookService {
	/**
	 * Process incoming booking webhook from Zapier/Arketa
	 */
	static async processBookingWebhook(
		studioId: string,
		webhookData: ZapierBookingWebhook
	): Promise<{ success: boolean; bookingId?: string; error?: string }> {
		try {
			// Validate required fields
			if (!webhookData.booking_id || !webhookData.customer_email) {
				throw new Error('Missing required booking data');
			}

			// Transform webhook data to internal booking format
			const booking: Omit<Booking, 'id'> = {
				studio_id: studioId,
				external_booking_id: webhookData.booking_id,
				customer_email: webhookData.customer_email.toLowerCase().trim(),
				customer_name: `${webhookData.customer_first_name || ''} ${
					webhookData.customer_last_name || ''
				}`.trim(),
				class_name: webhookData.class_name,
				instructor_name: webhookData.instructor_name || undefined,
				class_start_time: webhookData.class_start_time,
				class_end_time: webhookData.class_end_time,
				booking_status: this.normalizeBookingStatus(webhookData.booking_status),
				paidAmount: webhookData.amount_paid || undefined,
				booking_created_at: webhookData.booking_created_at,
				class_attended_at: undefined, // Will be updated later
			};

			// Upsert booking to database
			const { data, error } = await supabase
				.from('bookings')
				.upsert(booking, {
					onConflict: 'external_booking_id,studio_id',
					ignoreDuplicates: false,
				})
				.select('id')
				.single();

			if (error) {
				console.error('Database error storing booking:', error);
				throw error;
			}

			// Trigger payment matching for this booking
			await this.triggerPaymentMatching(studioId, data.id);

			return {
				success: true,
				bookingId: data.id,
			};
		} catch (error) {
			console.error('Booking webhook processing failed:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			};
		}
	}

	/**
	 * Normalize booking status from various formats
	 */
	private static normalizeBookingStatus(
		status: string
	): 'confirmed' | 'cancelled' | 'no_show' | 'attended' {
		const normalizedStatus = status.toLowerCase().trim();

		switch (normalizedStatus) {
			case 'confirmed':
			case 'booked':
			case 'active':
				return 'confirmed';
			case 'cancelled':
			case 'canceled':
			case 'cancelled_by_customer':
				return 'cancelled';
			case 'no_show':
			case 'no-show':
			case 'missed':
				return 'no_show';
			case 'attended':
			case 'completed':
			case 'checked_in':
				return 'attended';
			default:
				return 'confirmed'; // Default fallback
		}
	}

	/**
	 * Trigger payment matching algorithm for a new booking
	 */
	private static async triggerPaymentMatching(
		studioId: string,
		bookingId: string
	) {
		try {
			// Import matching service (defined below)
			const { PaymentMatchingService } = await import(
				'@/lib/matching/payment-matcher'
			);
			await PaymentMatchingService.matchBookingWithPayments(
				studioId,
				bookingId
			);
		} catch (error) {
			console.error('Payment matching trigger failed:', error);
			// Don't throw - booking should still be stored even if matching fails
		}
	}

	/**
	 * Generate webhook URL for studio setup
	 */
	static generateWebhookUrl(studioId: string): string {
		const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
		return `${baseUrl}/api/zapier/booking/${studioId}`;
	}

	/**
	 * Validate webhook signature (implement based on your security requirements)
	 */
	static validateWebhookSignature(payload: string, signature: string): boolean {
		// Implement webhook signature validation
		// For Zapier, you might use a shared secret or API key

		console.log('zapier webhook payload', payload);
		console.log('zapier webhook signature', signature);
		if (!process.env.ZAPIER_WEBHOOK_SECRET) {
			console.warn('ZAPIER_WEBHOOK_SECRET not configured');
			return true; // Allow for development
		}

		// Add your signature validation logic here
		return true;
	}
}

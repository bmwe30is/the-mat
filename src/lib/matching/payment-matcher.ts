// lib/matching/payment-matcher.ts
import { createClient } from '@supabase/supabase-js';
import type { StripePayment, Booking, MatchedTransaction } from '@/types';

const supabase = createClient(
	process.env.NEXT_PUBLIC_SUPABASE_URL!,
	process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export class PaymentMatchingService {
	/**
	 * Match a booking with potential Stripe payments
	 */
	static async matchBookingWithPayments(studioId: string, bookingId: string) {
		try {
			// Get booking details
			const { data: booking, error: bookingError } = await supabase
				.from('bookings')
				.select('*')
				.eq('id', bookingId)
				.eq('studio_id', studioId)
				.single();

			if (bookingError || !booking) {
				throw new Error('Booking not found');
			}

			// Find potential matching payments
			const potentialMatches = await this.findPotentialPaymentMatches(booking);

			// Score and select best match
			const bestMatch = this.selectBestMatch(booking, potentialMatches);

			if (bestMatch) {
				await this.createMatchedTransaction(booking, bestMatch);
			}
		} catch (error) {
			console.error('Payment matching failed:', error);
			throw error;
		}
	}

	/**
	 * Find potential payment matches for a booking
	 */
	private static async findPotentialPaymentMatches(
		booking: Booking
	): Promise<StripePayment[]> {
		const bookingTime = new Date(booking.class_start_time);
		const searchWindowStart = new Date(
			bookingTime.getTime() - 24 * 60 * 60 * 1000
		); // 24 hours before
		const searchWindowEnd = new Date(
			bookingTime.getTime() + 2 * 60 * 60 * 1000
		); // 2 hours after

		const { data: payments, error } = await supabase
			.from('stripe_payments')
			.select('*')
			.eq('studio_id', booking.studio_id)
			.gte('created_at', searchWindowStart.toISOString())
			.lte('created_at', searchWindowEnd.toISOString())
			.is('booking_match_id', null); // Only unmatched payments

		if (error) {
			console.error('Error finding potential matches:', error);
			return [];
		}

		return payments || [];
	}

	/**
	 * Score and select the best payment match for a booking
	 */
	private static selectBestMatch(
		booking: Booking,
		payments: StripePayment[]
	): StripePayment | null {
		if (payments.length === 0) return null;

		interface ScoredPayment extends StripePayment {
			matchScore: number;
			matchReason: string;
		}

		const scoredPayments: ScoredPayment[] = payments.map((payment) => {
			let score = 0;
			const reasons: string[] = [];

			// Email match (highest priority)
			if (
				payment.customer_email?.toLowerCase() ===
				booking.customer_email.toLowerCase()
			) {
				score += 100;
				reasons.push('Email match');
			}

			// Amount match (if booking has amount)
			if (
				booking.amount_paid &&
				Math.abs(payment.amount - booking.amount_paid * 100) < 50
			) {
				score += 50;
				reasons.push('Amount match');
			}

			// Description contains class name
			if (
				payment.description
					.toLowerCase()
					.includes(booking.class_name.toLowerCase())
			) {
				score += 30;
				reasons.push('Class name in description');
			}

			// Time proximity (closer = higher score)
			const bookingTime = new Date(booking.class_start_time).getTime();
			const paymentTime = new Date(payment.created_at).getTime();
			const timeDiffHours =
				Math.abs(bookingTime - paymentTime) / (1000 * 60 * 60);

			if (timeDiffHours < 1) score += 25;
			else if (timeDiffHours < 6) score += 15;
			else if (timeDiffHours < 24) score += 5;

			reasons.push(`${timeDiffHours.toFixed(1)}h time diff`);

			return {
				...payment,
				matchScore: score,
				matchReason: reasons.join(', '),
			};
		});

		// Sort by score and return best match
		scoredPayments.sort((a, b) => b.matchScore - a.matchScore);

		const bestMatch = scoredPayments[0];

		// Minimum score threshold for a valid match
		return bestMatch.matchScore >= 50 ? bestMatch : null;
	}

	/**
	 * Create matched transaction record
	 */
	private static async createMatchedTransaction(
		booking: Booking,
		payment: StripePayment & { matchScore: number; matchReason: string }
	) {
		const confidence = this.getMatchConfidence(payment.matchScore);

		const matchedTransaction: Omit<MatchedTransaction, 'id' | 'created_at'> = {
			studio_id: booking.studio_id,
			stripe_payment_id: payment.stripe_payment_id,
			booking_id: booking.id,
			match_confidence: confidence,
			match_reason: payment.matchReason,
			amount: payment.amount,
			net_profit: payment.net_amount,
			customer_email: booking.customer_email,
			class_name: booking.class_name,
			instructor_name: booking.instructor_name,
			transaction_date: booking.class_start_time,
		};

		// Insert matched transaction
		const { error: matchError } = await supabase
			.from('matched_transactions')
			.insert(matchedTransaction);

		if (matchError) {
			console.error('Error creating matched transaction:', matchError);
			throw matchError;
		}

		// Mark payment as matched
		await supabase
			.from('stripe_payments')
			.update({ booking_match_id: booking.id })
			.eq('id', payment.id);
	}

	/**
	 * Convert match score to confidence level
	 */
	private static getMatchConfidence(
		score: number
	): 'high' | 'medium' | 'low' | 'unmatched' {
		if (score >= 150) return 'high';
		if (score >= 100) return 'medium';
		if (score >= 50) return 'low';
		return 'unmatched';
	}
}

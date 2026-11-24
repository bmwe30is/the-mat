// lib/matching/payment-matcher.ts
import { prisma } from '@/lib/prisma';
import type { StripePayment, ScoredPayment } from '@/types';
import { Decimal } from '@prisma/client/runtime/library';

type PrismaBooking = {
	id: string;
	customerEmail: string;
	className: string;
	instructorName: string | null;
	classStartTime: Date;
	paidAmount: Decimal | null; // Change from number to Decimal
	// Add other fields as needed
};

export class PaymentMatchingService {
	/**
	 * Match a booking with potential Stripe payments
	 */
	static async matchBookingWithPayments(studioId: string, bookingId: string) {
		try {
			// Get booking details
			const booking = (await prisma.booking.findFirst({
				where: {
					id: bookingId,
				},
			})) as PrismaBooking;

			if (!booking) {
				throw new Error('Booking not found');
			}

			// Find potential matching payments
			const potentialMatches = await this.findPotentialPaymentMatches(
				booking,
				studioId
			);

			// Score and select best match
			const bestMatch = this.selectBestMatch(booking, potentialMatches);

			if (bestMatch) {
				await this.createMatchedTransaction(booking, bestMatch, studioId);
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
		booking: PrismaBooking,
		studioId: string
	): Promise<StripePayment[]> {
		const bookingTime = new Date(booking.classStartTime);
		const searchWindowStart = new Date(
			bookingTime.getTime() - 24 * 60 * 60 * 1000
		); // 24 hours before
		const searchWindowEnd = new Date(
			bookingTime.getTime() + 2 * 60 * 60 * 1000
		); // 2 hours after

		const payments = await prisma.stripePayment.findMany({
			where: {
				studioId: studioId,
				createdAt: {
					gte: searchWindowStart,
					lte: searchWindowEnd,
				},
				bookingMatchId: null, // Only unmatched payments
			},
		});

		return payments as unknown as StripePayment[];
	}

	/**
	 * Score and select the best payment match for a booking
	 */
	private static selectBestMatch(
		booking: PrismaBooking,
		payments: StripePayment[]
	): ScoredPayment | null {
		if (payments.length === 0) return null;

		const scoredPayments: ScoredPayment[] = payments.map((payment) => {
			let score = 0;
			const reasons: string[] = [];

			// Email match (highest priority)
			if (
				payment.customerEmail?.toLowerCase() ===
				booking.customerEmail.toLowerCase()
			) {
				score += 100;
				reasons.push('Email match');
			}

			// Amount match (if booking has amount)
			if (
				booking.paidAmount &&
				Math.abs(payment.amount - booking.paidAmount.toNumber() * 100) < 50
			) {
				score += 50;
				reasons.push('Amount match');
			}

			// Description contains class name
			if (
				payment.description
					?.toLowerCase()
					.includes(booking.className.toLowerCase())
			) {
				score += 30;
				reasons.push('Class name in description');
			}

			// Time proximity (closer = higher score)
			const bookingTime = new Date(booking.classStartTime).getTime();
			const paymentTime = new Date(payment.createdAt).getTime();
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
		booking: PrismaBooking,
		payment: StripePayment & { matchScore: number; matchReason: string },
		studioId: string
	) {
		const confidence = this.getMatchConfidence(payment.matchScore);

		// Create matched transaction
		await prisma.matchedTransaction.create({
			data: {
				studioId: studioId,
				stripePaymentId: payment.stripePaymentId,
				bookingId: booking.id,
				matchConfidence: confidence,
				matchReason: payment.matchReason,
				amount: payment.amount,
				netProfit: payment.netAmount,
				customerEmail: booking.customerEmail,
				className: booking.className,
				instructorName: booking.instructorName,
				transactionDate: booking.classStartTime,
			},
		});

		// Mark payment as matched
		await prisma.stripePayment.update({
			where: { id: payment.id },
			data: { bookingMatchId: booking.id },
		});
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

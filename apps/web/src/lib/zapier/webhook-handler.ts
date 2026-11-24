// lib/zapier/webhook-handler.ts
import { prisma } from '@/lib/prisma';
import type { ArketaZapierBookingWebhook, PrismaBookingStatus } from '@/types';

export class ZapierWebhookService {
	/**
	 * Process incoming booking webhook from Zapier/Arketa
	 */
	static async processBookingWebhook(
		studioId: string,
		webhookData: ArketaZapierBookingWebhook
	): Promise<{ success: boolean; bookingId?: string; error?: string }> {
		try {
			// Validate required fields
			if (!webhookData.bookingId || !webhookData.customerEmail) {
				throw new Error('Missing required booking data');
			}

			// Find or create the user
			const user = await prisma.user.upsert({
				where: { email: webhookData.customerEmail.toLowerCase().trim() },
				update: {
					firstName: webhookData.customerFirstName || '',
					lastName: webhookData.customerLastName || '',
					phone: webhookData.customerPhone || undefined,
					arketaCustomerId: webhookData.customerArketaId || undefined,
				},
				create: {
					email: webhookData.customerEmail.toLowerCase().trim(),
					firstName: webhookData.customerFirstName || '',
					lastName: webhookData.customerLastName || '',
					phone: webhookData.customerPhone || undefined,
					arketaCustomerId: webhookData.customerArketaId || undefined,
				},
			});

			// For now, we'll create a placeholder class record
			// In a real implementation, you'd want to properly manage classes
			let studio = await prisma.studio.findFirst({
				where: {
					OR: [{ id: studioId }, { slug: `studio-${studioId}` }],
				},
				include: { locations: true },
			});

			let brand;

			if (!studio || !studio.locations.length) {
				// Create studio first
				await prisma.studio.upsert({
					where: { id: studioId },
					update: {},
					create: {
						id: studioId,
						name: `studio-${studioId}`,
						slug: `studio-${studioId}`,
						email: 'default-studio@example.com',
					},
				});

				// Create default brand AFTER studio exists
				brand = await prisma.brand.create({
					data: {
						studioId: studioId,
						name: 'Default Brand',
						slug: 'default-brand',
					},
				});

				// Create default location
				await prisma.location.create({
					data: {
						studioId: studioId,
						brandId: brand.id,
						name: 'Default Location',
						slug: 'default-location',
						address: '123 Main St',
						city: 'Default City',
						state: 'CA',
						zipCode: '90210',
					},
				});

				// Re-fetch studio with locations
				studio = await prisma.studio.findUnique({
					where: { id: studioId },
					include: { locations: true },
				});
			} else {
				// Only check for brand if studio already exists
				brand = await prisma.brand.findFirst({
					where: { studioId: studioId },
				});

				if (!brand) {
					brand = await prisma.brand.create({
						data: {
							studioId: studioId,
							name: 'Default Brand',
							slug: 'default-brand',
						},
					});
				}
			}

			let classType = await prisma.classType.findFirst({
				where: {
					brandId: brand.id,
					name: webhookData.className,
				},
			});

			if (!classType) {
				classType = await prisma.classType.create({
					data: {
						brandId: brand.id,
						name: webhookData.className,
						slug: webhookData.className.toLowerCase().replace(/\s+/g, '-'),
						duration: 60, // Default duration
					},
				});
			}

			// Create or find the class
			let classRecord = await prisma.class.findFirst({
				where: {
					arketaClassId: webhookData.classId,
				},
			});

			if (!classRecord) {
				// Convert paymentAmount string to number (Prisma handles Decimal conversion)
				const paymentAmount = parseFloat(webhookData.paymentAmount) || 0;

				classRecord = await prisma.class.create({
					data: {
						locationId: studio!.locations[0].id,
						classTypeId: classType.id,
						instructorId: webhookData.classInstructorId,
						instructorName: webhookData.classInstructorName,
						arketaClassId: webhookData.classId,
						startTime: this.normalizeArketaTimeStamp(
							webhookData.classStartTime
						),
						endTime: this.normalizeArketaTimeStamp(webhookData.classEndTime),
						capacity: 20, // Default capacity
						status: 'SCHEDULED', // Required field
						memberPrice: paymentAmount,
						dropInPrice: paymentAmount,
					},
				});
			}

			// Create the booking
			const booking = await prisma.booking.upsert({
				where: {
					arketaBookingId: webhookData.bookingId,
				},
				update: {
					status: this.normalizeBookingStatus(webhookData.bookingStatus),
					paidAmount: webhookData.paymentAmount
						? parseFloat(webhookData.paymentAmount)
						: null,
					classAttendedAt:
						webhookData.bookingStatus === 'attended' ? new Date() : undefined,
				},
				create: {
					userId: user.id,
					classId: classRecord.id,
					arketaBookingId: webhookData.bookingId,
					customerEmail: webhookData.customerEmail.toLowerCase().trim(),
					customerName: `${webhookData.customerFirstName || ''} ${
						webhookData.customerLastName || ''
					}`.trim(),
					className: webhookData.className,
					instructorName: webhookData.classInstructorName || undefined,
					classStartTime: this.normalizeArketaTimeStamp(
						webhookData.classStartTime
					),
					classEndTime: this.normalizeArketaTimeStamp(webhookData.classEndTime),
					status: this.normalizeBookingStatus(webhookData.bookingStatus),
					paidAmount: webhookData.paymentAmount
						? parseFloat(webhookData.paymentAmount)
						: null,
					bookedAt: this.normalizeArketaTimeStamp(webhookData.bookingCreatedAt),
				},
			});

			// Trigger payment matching for this booking
			await this.triggerPaymentMatching(studioId, booking.id);

			return {
				success: true,
				bookingId: booking.id,
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
	private static normalizeBookingStatus(status: string): PrismaBookingStatus {
		const normalizedStatus = status?.toLowerCase().trim() || '';

		switch (normalizedStatus) {
			case 'confirmed':
			case 'booked':
			case 'active':
				return 'CONFIRMED';
			case 'cancelled':
			case 'canceled':
			case 'cancelled_by_customer':
				return 'CANCELLED';
			case 'no_show':
			case 'no-show':
			case 'missed':
				return 'NO_SHOW';
			case 'attended':
			case 'completed':
			case 'checked_in':
				return 'ATTENDED';
			default:
				return 'CONFIRMED'; // Default fallback
		}
	}

	/**
	 * Normalize Arketa timestamp to Date object
	 */
	private static normalizeArketaTimeStamp(timestamp: string): Date {
		return new Date(parseInt(timestamp));
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

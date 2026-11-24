// lib/analytics/metrics-calculator.ts
import { prisma } from '@/lib/prisma';
import type {
	StudioMetrics,
	InstructorMetrics,
	MatchedTransaction,
	BookingData,
	StoredMetrics,
} from '@/types';

/**
 * Normalize date string to YYYY-MM-DD format
 * Extracts only the date part from ISO strings or other date formats
 */
function normalizeDate(dateInput: string | Date): string {
	const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

/**
 * Convert normalized date string (YYYY-MM-DD) to DateTime at start of day
 */
function dateStringToDateTime(dateString: string): Date {
	const date = new Date(dateString + 'T00:00:00.000Z');
	return date;
}

export class MetricsCalculator {
	/**
	 * Calculate comprehensive studio metrics for a date range
	 */
	static async calculateStudioMetrics(
		studioId: string,
		startDate: string,
		endDate: string
	): Promise<StudioMetrics> {
		try {
			// Normalize dates to YYYY-MM-DD format
			const normalizedStartDate = normalizeDate(startDate);
			const normalizedEndDate = normalizeDate(endDate);

			// Convert to DateTime for queries (start of day for start, end of day for end)
			const startDateTime = dateStringToDateTime(normalizedStartDate);
			const endDateTime = new Date(normalizedEndDate + 'T23:59:59.999Z');

			// Get all matched transactions in date range
			const transactions = await prisma.matchedTransaction.findMany({
				where: {
					studioId,
					transactionDate: {
						gte: startDateTime,
						lte: endDateTime,
					},
				},
			});

			// Get booking data for utilization calculations
			// Bookings are linked to studio through Class -> Location -> Studio
			const bookings = await prisma.booking.findMany({
				where: {
					class: {
						location: {
							studioId,
						},
					},
					classStartTime: {
						gte: startDateTime,
						lte: endDateTime,
					},
				},
				include: {
					class: {
						select: {
							capacity: true,
						},
					},
				},
			});

			// Map Prisma results to expected types
			const mappedTransactions: MatchedTransaction[] = transactions.map(
				(t) => ({
					id: t.id,
					studioId: t.studioId,
					stripePaymentId: t.stripePaymentId,
					bookingId: t.bookingId || undefined,
					matchConfidence: t.matchConfidence as
						| 'high'
						| 'medium'
						| 'low'
						| 'unmatched',
					matchReason: t.matchReason,
					amount: t.amount,
					netProfit: t.netProfit,
					customerEmail: t.customerEmail,
					className: t.className || undefined,
					instructorName: t.instructorName || undefined,
					transactionDate: t.transactionDate,
					createdAt: t.createdAt,
				})
			);

			const mappedBookings: BookingData[] = bookings.map((b) => ({
				class_name: b.className,
				class_start_time: b.classStartTime.toISOString(),
				booking_status: b.status.toLowerCase(),
				amount_paid: b.paidAmount ? Number(b.paidAmount) : undefined,
				customer_email: b.customerEmail,
				instructor_name: b.instructorName || undefined,
				capacity: b.class?.capacity || 20,
			}));

			const metrics = this.computeBasicMetrics(
				mappedTransactions,
				mappedBookings
			);

			// Store calculated metrics for caching
			await this.storeCalculatedMetrics(
				studioId,
				normalizedStartDate,
				normalizedEndDate,
				metrics
			);

			return {
				studio_id: studioId,
				startDate: normalizedStartDate,
				endDate: normalizedEndDate,
				...metrics,
			};
		} catch (error) {
			console.error('Metrics calculation failed:', error);
			throw error;
		}
	}

	/**
	 * Calculate instructor-specific performance metrics
	 */
	static async calculateInstructorMetrics(
		studioId: string,
		instructorName: string,
		startDate: string,
		endDate: string
	): Promise<InstructorMetrics> {
		try {
			const startDateTime = new Date(startDate);
			const endDateTime = new Date(endDate);

			// Get matched transactions for this instructor
			const transactions = await prisma.matchedTransaction.findMany({
				where: {
					studioId,
					instructorName,
					transactionDate: {
						gte: startDateTime,
						lte: endDateTime,
					},
				},
			});

			// Get bookings for this instructor
			const bookings = await prisma.booking.findMany({
				where: {
					class: {
						location: {
							studioId,
						},
					},
					instructorName,
					classStartTime: {
						gte: startDateTime,
						lte: endDateTime,
					},
				},
				include: {
					class: {
						select: {
							capacity: true,
						},
					},
				},
			});

			// Map Prisma results to expected types
			const mappedTransactions: MatchedTransaction[] = transactions.map(
				(t) => ({
					id: t.id,
					studioId: t.studioId,
					stripePaymentId: t.stripePaymentId,
					bookingId: t.bookingId || undefined,
					matchConfidence: t.matchConfidence as
						| 'high'
						| 'medium'
						| 'low'
						| 'unmatched',
					matchReason: t.matchReason,
					amount: t.amount,
					netProfit: t.netProfit,
					customerEmail: t.customerEmail,
					className: t.className || undefined,
					instructorName: t.instructorName || undefined,
					transactionDate: t.transactionDate,
					createdAt: t.createdAt,
				})
			);

			const mappedBookings: BookingData[] = bookings.map((b) => ({
				class_name: b.className,
				class_start_time: b.classStartTime.toISOString(),
				booking_status: b.status.toLowerCase(),
				amount_paid: b.paidAmount ? Number(b.paidAmount) : undefined,
				customer_email: b.customerEmail,
				instructor_name: b.instructorName || undefined,
				capacity: b.class?.capacity || 20,
			}));

			const metrics = this.computeInstructorSpecificMetrics(
				mappedTransactions,
				mappedBookings
			);

			return {
				studio_id: studioId,
				instructor_name: instructorName,
				date_range: { start: startDate, end: endDate },
				...metrics,
			};
		} catch (error) {
			console.error('Instructor metrics calculation failed:', error);
			throw error;
		}
	}

	/**
	 * Compute basic financial and operational metrics
	 */
	private static computeBasicMetrics(
		transactions: MatchedTransaction[],
		bookings: BookingData[]
	) {
		const totalRevenue = transactions.reduce(
			(sum, t) => sum + t.amount / 100,
			0
		);
		const totalProfit = transactions.reduce(
			(sum, t) => sum + t.netProfit / 100,
			0
		);
		const totalBookings = bookings.length;
		const totalAttendees = bookings.filter(
			(b) => b.booking_status === 'attended'
		).length;
		const processingFees = totalRevenue - totalProfit;

		// Calculate utilization rate (needs capacity data - mock for now)
		const totalCapacity = bookings.reduce(
			(sum, b) => sum + (b.capacity || 20),
			0
		);
		const utilizationRate =
			totalCapacity > 0 ? (totalAttendees / totalCapacity) * 100 : 0;

		return {
			total_revenue: Math.round(totalRevenue * 100) / 100,
			total_profit: Math.round(totalProfit * 100) / 100,
			total_bookings: totalBookings,
			total_attendees: totalAttendees,
			avg_transaction_size:
				transactions.length > 0
					? Math.round((totalRevenue / transactions.length) * 100) / 100
					: 0,
			processing_fees: Math.round(processingFees * 100) / 100,
			utilization_rate: Math.round(utilizationRate * 100) / 100,
			profit_per_customer:
				totalAttendees > 0
					? Math.round((totalProfit / totalAttendees) * 100) / 100
					: 0,
		};
	}

	/**
	 * Compute instructor-specific metrics
	 */
	private static computeInstructorSpecificMetrics(
		transactions: MatchedTransaction[],
		bookings: BookingData[]
	) {
		// Group bookings by class to count unique classes
		const uniqueClasses = new Set(
			bookings.map((b) => `${b.class_name}-${b.class_start_time}`)
		);

		const totalRevenue = transactions.reduce(
			(sum, t) => sum + t.amount / 100,
			0
		);
		const totalProfit = transactions.reduce(
			(sum, t) => sum + t.netProfit / 100,
			0
		);
		const totalAttendees = bookings.filter(
			(b) => b.booking_status === 'attended'
		).length;
		const totalCapacity = bookings.reduce(
			(sum, b) => sum + (b.capacity || 20),
			0
		);
		const processingFees = totalRevenue - totalProfit;

		return {
			total_classes: uniqueClasses.size,
			total_revenue: Math.round(totalRevenue * 100) / 100,
			total_profit: Math.round(totalProfit * 100) / 100,
			avg_utilization:
				totalCapacity > 0
					? Math.round((totalAttendees / totalCapacity) * 10000) / 100
					: 0,
			avg_transaction_size:
				transactions.length > 0
					? Math.round((totalRevenue / transactions.length) * 100) / 100
					: 0,
			total_processing_fees: Math.round(processingFees * 100) / 100,
		};
	}

	/**
	 * Store calculated metrics in database
	 */
	private static async storeCalculatedMetrics(
		studioId: string,
		startDate: string,
		endDate: string,
		metrics: StoredMetrics
	) {
		try {
			// Convert normalized date strings to DateTime (start of day)
			const startDateTime = dateStringToDateTime(startDate);
			const endDateTime = dateStringToDateTime(endDate);

			// Check if metrics already exist for this studio and date range
			const existing = await prisma.studioMetrics.findFirst({
				where: {
					studioId,
					startDate: startDateTime,
					endDate: endDateTime,
				},
			});

			const metricsData = {
				totalRevenue: metrics.total_revenue,
				totalProfit: metrics.total_profit,
				totalBookings: metrics.total_bookings,
				totalAttendees: metrics.total_attendees,
				avgTransactionSize: metrics.avg_transaction_size,
				processingFees: metrics.processing_fees,
				utilizationRate: metrics.utilization_rate,
				profitPerCustomer: metrics.profit_per_customer,
				calculatedAt: new Date(),
			};

			if (existing) {
				// Update existing metrics
				await prisma.studioMetrics.update({
					where: { id: existing.id },
					data: metricsData,
				});
			} else {
				// Create new metrics
				await prisma.studioMetrics.create({
					data: {
						id: crypto.randomUUID(),
						studioId,
						startDate: startDateTime,
						endDate: endDateTime,
						...metricsData,
					},
				});
			}
		} catch (error) {
			console.error('Failed to store calculated metrics:', error);
			// Don't throw - metrics calculation should still succeed
		}
	}

	/**
	 * Get cached metrics or calculate if not available
	 */
	static async getCachedOrCalculateMetrics(
		studioId: string,
		startDate: string,
		endDate: string
	): Promise<StudioMetrics | null> {
		try {
			// Normalize dates to YYYY-MM-DD format
			const normalizedStartDate = normalizeDate(startDate);
			const normalizedEndDate = normalizeDate(endDate);

			// Convert to DateTime for queries
			const startDateTime = dateStringToDateTime(normalizedStartDate);
			const endDateTime = dateStringToDateTime(normalizedEndDate);

			const cacheThreshold = new Date(Date.now() - 6 * 60 * 60 * 1000); // 6 hours cache

			// Try to get cached metrics first
			const cachedMetrics = await prisma.studioMetrics.findFirst({
				where: {
					studioId,
					startDate: startDateTime,
					endDate: endDateTime,
					calculatedAt: {
						gte: cacheThreshold,
					},
				},
			});

			if (cachedMetrics) {
				// Map Prisma result (camelCase) to StudioMetrics format (snake_case)
				return {
					studio_id: cachedMetrics.studioId,
					startDate: cachedMetrics.startDate.toISOString().split('T')[0],
					endDate: cachedMetrics.endDate.toISOString().split('T')[0],
					total_revenue: Number(cachedMetrics.totalRevenue),
					total_profit: Number(cachedMetrics.totalProfit),
					total_bookings: cachedMetrics.totalBookings,
					total_attendees: cachedMetrics.totalAttendees,
					avg_transaction_size: Number(cachedMetrics.avgTransactionSize),
					processing_fees: Number(cachedMetrics.processingFees),
					utilization_rate: Number(cachedMetrics.utilizationRate),
					profit_per_customer: Number(cachedMetrics.profitPerCustomer),
				};
			}

			// Calculate fresh metrics
			return await this.calculateStudioMetrics(
				studioId,
				normalizedStartDate,
				normalizedEndDate
			);
		} catch (error) {
			console.error('Error getting metrics:', error);
			return null;
		}
	}
}

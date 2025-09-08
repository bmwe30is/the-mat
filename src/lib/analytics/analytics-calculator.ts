// lib/analytics/metrics-calculator.ts
import { createClient } from '@supabase/supabase-js';
import type {
	StudioMetrics,
	InstructorMetrics,
	MatchedTransaction,
	BookingData,
	StoredMetrics,
} from '@/types';

const supabase = createClient(
	process.env.NEXT_PUBLIC_SUPABASE_URL!,
	process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
			// Get all matched transactions in date range
			const { data: transactions, error } = await supabase
				.from('matched_transactions')
				.select('*')
				.eq('studio_id', studioId)
				.gte('transaction_date', startDate)
				.lte('transaction_date', endDate);

			if (error) throw error;

			// Get booking data for utilization calculations
			const { data: bookings } = await supabase
				.from('bookings')
				.select('*')
				.eq('studio_id', studioId)
				.gte('class_start_time', startDate)
				.lte('class_start_time', endDate);

			const metrics = this.computeBasicMetrics(
				transactions || [],
				bookings || []
			);

			// Store calculated metrics for caching
			await this.storeCalculatedMetrics(studioId, startDate, metrics);

			return {
				studio_id: studioId,
				date: startDate,
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
			const { data: transactions, error } = await supabase
				.from('matched_transactions')
				.select('*')
				.eq('studio_id', studioId)
				.eq('instructor_name', instructorName)
				.gte('transaction_date', startDate)
				.lte('transaction_date', endDate);

			if (error) throw error;

			const { data: bookings } = await supabase
				.from('bookings')
				.select('*')
				.eq('studio_id', studioId)
				.eq('instructor_name', instructorName)
				.gte('class_start_time', startDate)
				.lte('class_start_time', endDate);

			const metrics = this.computeInstructorSpecificMetrics(
				transactions || [],
				bookings || []
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
		date: string,
		metrics: StoredMetrics
	) {
		try {
			await supabase.from('studio_metrics').upsert(
				{
					studio_id: studioId,
					date,
					...metrics,
					calculated_at: new Date().toISOString(),
				},
				{
					onConflict: 'studio_id,date',
				}
			);
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
		date: string
	): Promise<StudioMetrics | null> {
		try {
			// Try to get cached metrics first
			const { data: cachedMetrics } = await supabase
				.from('studio_metrics')
				.select('*')
				.eq('studio_id', studioId)
				.eq('date', date)
				.gte(
					'calculated_at',
					new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
				) // 6 hours cache
				.single();

			if (cachedMetrics) {
				return cachedMetrics;
			}

			// Calculate fresh metrics
			const endDate = new Date(date);
			endDate.setHours(23, 59, 59, 999);

			return await this.calculateStudioMetrics(
				studioId,
				date,
				endDate.toISOString()
			);
		} catch (error) {
			console.error('Error getting metrics:', error);
			return null;
		}
	}
}

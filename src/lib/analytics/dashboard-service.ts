// lib/analytics/dashboard-service.ts
import type {
	ApiResponse,
	StudioMetrics,
	DashboardOverviewData,
} from '@/types';
import { MetricsCalculator } from './analytics-calculator';
import { supabase } from '@/lib/supabase';

export class DashboardService {
	/**
	 * Get comprehensive dashboard overview
	 */
	static async getDashboardOverview(
		studioId: string,
		dateRange: { start: string; end: string }
	): Promise<ApiResponse<DashboardOverviewData>> {
		try {
			// Get current period metrics
			const currentMetrics = await MetricsCalculator.calculateStudioMetrics(
				studioId,
				dateRange.start,
				dateRange.end
			);

			// Get previous period for comparison
			const daysDiff = Math.ceil(
				(new Date(dateRange.end).getTime() -
					new Date(dateRange.start).getTime()) /
					(1000 * 60 * 60 * 24)
			);

			const prevStart = new Date(
				new Date(dateRange.start).getTime() - daysDiff * 24 * 60 * 60 * 1000
			);
			const prevEnd = new Date(dateRange.start);

			const previousMetrics = await MetricsCalculator.calculateStudioMetrics(
				studioId,
				prevStart.toISOString(),
				prevEnd.toISOString()
			);

			// Calculate percentage changes
			const changes = this.calculatePercentageChanges(
				currentMetrics,
				previousMetrics
			);

			// Get top performing classes
			const topClasses = await this.getTopPerformingClasses(
				studioId,
				dateRange
			);

			// Get instructor performance
			const instructorPerformance = await this.getInstructorPerformance(
				studioId,
				dateRange
			);

			// Transform instructor performance to match expected format
			const transformedInstructorPerformance = instructorPerformance.map(
				(metrics) => ({
					name: metrics.instructor_name,
					classes: metrics.total_classes,
					revenue: metrics.total_revenue,
					rating: 0, // Default rating since it's not calculated yet
				})
			);

			return {
				success: true,
				data: {
					metrics: currentMetrics,
					topClasses,
					instructorPerformance: transformedInstructorPerformance,
					growthMetrics: {
						revenueGrowth: changes.revenue,
						customerGrowth: changes.bookings,
						utilizationGrowth: changes.utilization,
					},
				},
			};
		} catch (error) {
			console.error('Dashboard overview error:', error);
			return {
				success: false,
				error: {
					code: 'DASHBOARD_ERROR',
					message: 'Failed to load dashboard data',
				},
			};
		}
	}

	/**
	 * Get top performing classes by revenue or utilization
	 */
	private static async getTopPerformingClasses(
		studioId: string,
		dateRange: { start: string; end: string }
	) {
		const { data: classPerformance } = await supabase.rpc(
			'get_class_performance',
			{
				p_studio_id: studioId,
				p_start_date: dateRange.start,
				p_end_date: dateRange.end,
			}
		);

		return classPerformance || [];
	}

	/**
	 * Get instructor performance summary
	 */
	private static async getInstructorPerformance(
		studioId: string,
		dateRange: { start: string; end: string }
	) {
		// Get unique instructors
		const { data: instructors } = await supabase
			.from('bookings')
			.select('instructor_name')
			.eq('studio_id', studioId)
			.not('instructor_name', 'is', null)
			.gte('class_start_time', dateRange.start)
			.lte('class_start_time', dateRange.end);

		if (!instructors) return [];

		const uniqueInstructors = [
			...new Set(instructors.map((i) => i.instructor_name)),
		];

		// Calculate metrics for each instructor
		const performance = await Promise.all(
			uniqueInstructors.map(async (instructorName) => {
				return await MetricsCalculator.calculateInstructorMetrics(
					studioId,
					instructorName,
					dateRange.start,
					dateRange.end
				);
			})
		);

		return performance.sort((a, b) => b.total_revenue - a.total_revenue);
	}

	/**
	 * Calculate percentage changes between current and previous periods
	 */
	private static calculatePercentageChanges(
		current: StudioMetrics,
		previous: StudioMetrics
	) {
		const calculateChange = (curr: number, prev: number): string => {
			if (prev === 0) return curr > 0 ? '+∞%' : '0%';
			const change = ((curr - prev) / prev) * 100;
			return `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`;
		};

		return {
			revenue: calculateChange(current.total_revenue, previous.total_revenue),
			profit: calculateChange(current.total_profit, previous.total_profit),
			bookings: calculateChange(
				current.total_bookings,
				previous.total_bookings
			),
			utilization: calculateChange(
				current.utilization_rate,
				previous.utilization_rate
			),
			avgTransaction: calculateChange(
				current.avg_transaction_size,
				previous.avg_transaction_size
			),
		};
	}
}

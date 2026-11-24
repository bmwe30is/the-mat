// components/dashboard/StudioDashboard.tsx - Updated dashboard component
'use client';

import React, { useState } from 'react';
import { useStudioData } from '@/lib/hooks/use-studio-data';
import { DashboardSkeleton } from '@/components/ui/loading-skeletons';
import {
	TrendingUp,
	Users,
	DollarSign,
	Calendar,
	RefreshCw,
} from 'lucide-react';

interface StudioDashboardProps {
	studioId: string;
	initialDateRange?: { start: string; end: string };
}

type DateRange = {
	start: string; // YYYY-MM-DD
	end: string; // YYYY-MM-DD
};

/**
 * Calculate date range for a given period
 */
function calculateDateRange(period: string): DateRange {
	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const formatDate = (date: Date): string => {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	};

	switch (period) {
		case 'Today': {
			return {
				start: formatDate(today),
				end: formatDate(today),
			};
		}
		case '7 Days': {
			const startDate = new Date(today);
			startDate.setDate(startDate.getDate() - 6); // Last 7 days including today
			return {
				start: formatDate(startDate),
				end: formatDate(today),
			};
		}
		case '30 Days': {
			const startDate = new Date(today);
			startDate.setDate(startDate.getDate() - 29); // Last 30 days including today
			return {
				start: formatDate(startDate),
				end: formatDate(today),
			};
		}
		case 'Custom Range':
		default: {
			// Default to last 7 days
			const startDate = new Date(today);
			startDate.setDate(startDate.getDate() - 6);
			return {
				start: formatDate(startDate),
				end: formatDate(today),
			};
		}
	}
}

const StudioDashboard: React.FC<StudioDashboardProps> = ({
	studioId,
	initialDateRange,
}) => {
	// Default to last 7 days if no initial date range provided
	const defaultDateRange = calculateDateRange('7 Days');
	const [selectedPeriod, setSelectedPeriod] = useState<string>('7 Days');
	const [dateRange, setDateRange] = useState<DateRange>(
		initialDateRange || defaultDateRange
	);

	const { metrics, isLoading, error, refetch } = useStudioData({
		studioId,
		dateRange,
	});

	const handlePeriodChange = (period: string) => {
		setSelectedPeriod(period);
		if (period === 'Custom Range') {
			// Placeholder for now - do nothing
			return;
		}
		const newDateRange = calculateDateRange(period);
		setDateRange(newDateRange);
		// Update URL without full page refresh
		const url = new URL(window.location.href);
		url.searchParams.set('start_date', newDateRange.start);
		url.searchParams.set('end_date', newDateRange.end);
		window.history.pushState({}, '', url.toString());
	};

	const handleRefresh = async () => {
		await refetch();
	};

	if (isLoading) {
		return <DashboardSkeleton />;
	}

	if (error) {
		return (
			<div className="min-h-screen bg-gray-50 flex items-center justify-center">
				<div className="text-center">
					<div className="text-red-600 mb-4">Error loading dashboard data</div>
					<button
						onClick={handleRefresh}
						className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
					>
						Try Again
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-gray-50">
			{/* Header */}
			<div className="bg-white border-b border-gray-200">
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
					<div className="flex justify-between items-center py-4">
						<h1 className="text-2xl font-bold text-blue-600">StudioMetrics</h1>
						<div className="flex items-center space-x-4">
							<button
								onClick={handleRefresh}
								className="p-2 text-gray-600 hover:text-gray-800 rounded-md hover:bg-gray-100"
								title="Refresh data"
							>
								<RefreshCw className="h-4 w-4" />
							</button>
							<div className="w-8 h-8 bg-gray-300 rounded-full"></div>
						</div>
					</div>
				</div>
			</div>

			{/* Main Content */}
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
				{/* Dashboard Header */}
				<div className="mb-8">
					<h2 className="text-3xl font-bold text-gray-900 mb-4">
						Dashboard Overview
					</h2>
					<div className="flex items-center space-x-4">
						<span className="text-gray-700 font-medium">Time Period:</span>
						{['Today', '7 Days', '30 Days', 'Custom Range'].map((period) => (
							<button
								key={period}
								onClick={() => handlePeriodChange(period)}
								disabled={period === 'Custom Range'}
								className={`px-4 py-2 rounded-md border font-medium transition-colors ${
									selectedPeriod === period
										? 'bg-blue-600 text-white border-blue-600'
										: period === 'Custom Range'
											? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
											: 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
								}`}
								title={
									period === 'Custom Range'
										? 'Custom date range selection coming soon'
										: undefined
								}
							>
								{period}
							</button>
						))}
					</div>
				</div>

				{/* Metrics Grid */}
				{metrics && (
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
						<MetricCard
							title="Total Revenue"
							value={`${metrics.total_revenue.toFixed(2)}`}
							change="+12% vs last period"
							trend="up"
							icon={DollarSign}
						/>
						<MetricCard
							title="Total Profit"
							value={`${metrics.total_profit.toFixed(2)}`}
							change="+8% vs last period"
							trend="up"
							icon={TrendingUp}
						/>
						<MetricCard
							title="Total Bookings"
							value={metrics.total_bookings.toString()}
							change="+5% vs last period"
							trend="up"
							icon={Calendar}
						/>
						<MetricCard
							title="Avg Transaction"
							value={`${metrics.avg_transaction_size.toFixed(2)}`}
							change="+3% vs last period"
							trend="up"
							icon={Users}
						/>
					</div>
				)}

				{/* Additional dashboard content would go here */}
				<div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
					<h3 className="text-xl font-semibold text-gray-900 mb-4">
						Integration Status
					</h3>
					<div className="text-gray-600">
						Your Stripe and Zapier integrations are working.
						<a
							href={`/dashboard/${studioId}/integrations`}
							className="text-blue-600 hover:text-blue-800 ml-2"
						>
							Manage integrations →
						</a>
					</div>
				</div>
			</div>
		</div>
	);
};

interface MetricCardProps {
	title: string;
	value: string;
	change: string;
	trend: 'up' | 'down' | 'neutral';
	icon: React.ComponentType<{ className?: string }>;
}

const MetricCard: React.FC<MetricCardProps> = ({
	title,
	value,
	change,
	trend,
	icon: Icon,
}) => (
	<div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
		<div className="flex items-center justify-between mb-2">
			<p className="text-sm font-medium text-gray-600 uppercase tracking-wide">
				{title}
			</p>
			<Icon className="h-5 w-5 text-gray-400" />
		</div>
		<p className="text-3xl font-bold text-gray-900 mb-1">{value}</p>
		<p
			className={`text-sm ${
				trend === 'up'
					? 'text-green-600'
					: trend === 'down'
						? 'text-red-600'
						: 'text-gray-600'
			}`}
		>
			{change}
		</p>
	</div>
);

export default StudioDashboard;

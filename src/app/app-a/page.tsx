'use client';

import React, { useState } from 'react';
import {
	BarChart3,
	TrendingUp,
	Users,
	DollarSign,
	Calendar,
	Clock,
	Star,
	Download,
} from 'lucide-react';

const StudioDashboard = () => {
	const [selectedPeriod, setSelectedPeriod] = useState('Today');

	// Mock data - replace with real API calls
	const metrics = {
		utilization: { value: '73%', change: '+5%', trend: 'up' },
		profitPerStudent: { value: '$18.50', change: '+$2.30', trend: 'up' },
		classesToday: { value: '8', change: '3 still upcoming', trend: 'neutral' },
		revenueToday: { value: '$1,247', change: '+12%', trend: 'up' },
	};

	const todaysClasses = [
		{
			name: 'Morning Vinyasa',
			time: '9:00 AM',
			instructor: 'Jennifer',
			capacity: 20,
			booked: 17,
			utilization: 85,
		},
		{
			name: 'Lunch Flow',
			time: '12:30 PM',
			instructor: 'Sarah',
			capacity: 15,
			booked: 9,
			utilization: 60,
		},
		{
			name: 'Power Hour',
			time: '6:00 PM',
			instructor: 'Mike',
			capacity: 25,
			booked: 24,
			utilization: 96,
		},
		{
			name: 'Evening Restore',
			time: '8:00 PM',
			instructor: 'Jennifer',
			capacity: 15,
			booked: 12,
			utilization: 80,
		},
	];

	const instructorPerformance = [
		{
			name: 'Jennifer Wilson',
			classes: 12,
			utilization: 87,
			revenue: 2340,
			profitPerClass: 65,
		},
		{
			name: 'Mike Chen',
			classes: 10,
			utilization: 92,
			revenue: 2890,
			profitPerClass: 78,
		},
		{
			name: 'Sarah Martinez',
			classes: 8,
			utilization: 73,
			revenue: 1560,
			profitPerClass: 52,
		},
	];

	const heatmapData = [
		[15, 45, 85, 60, 92, 40, 10],
		[20, 50, 88, 55, 90, 35, 8],
		[18, 48, 90, 65, 88, 42, 12],
		[22, 52, 85, 58, 95, 38, 15],
		[25, 60, 92, 70, 98, 45, 18],
		[30, 75, 95, 80, 85, 50, 20],
		[12, 35, 70, 45, 75, 30, 5],
	];

	const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
	const hours = ['6AM', '9AM', '12PM', '3PM', '6PM', '9PM', '12AM'];

	const getHeatmapColor = (value) => {
		if (value >= 80) return 'bg-red-200 text-red-800';
		if (value >= 50) return 'bg-orange-200 text-orange-800';
		return 'bg-yellow-200 text-yellow-800';
	};

	const MetricCard = ({ title, value, change, trend, icon: Icon }) => (
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

	return (
		<div className="min-h-screen bg-gray-50">
			{/* Header */}
			<div className="bg-white border-b border-gray-200">
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
					<div className="flex justify-between items-center py-4">
						<div className="flex items-center">
							<h1 className="text-2xl font-bold text-blue-600">
								StudioMetrics
							</h1>
						</div>
						<div className="flex items-center space-x-4">
							<span className="text-gray-700 font-medium">
								Sarah's Yoga Studio
							</span>
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
								onClick={() => setSelectedPeriod(period)}
								className={`px-4 py-2 rounded-md border font-medium transition-colors ${
									selectedPeriod === period
										? 'bg-blue-600 text-white border-blue-600'
										: 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
								}`}
							>
								{period}
							</button>
						))}
					</div>
				</div>

				{/* Metrics Grid */}
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
					<MetricCard
						title="Today's Utilization"
						value={metrics.utilization.value}
						change={`${metrics.utilization.change} vs yesterday`}
						trend={metrics.utilization.trend}
						icon={BarChart3}
					/>
					<MetricCard
						title="Avg Profit Per Student"
						value={metrics.profitPerStudent.value}
						change={`${metrics.profitPerStudent.change} vs last week`}
						trend={metrics.profitPerStudent.trend}
						icon={DollarSign}
					/>
					<MetricCard
						title="Total Classes Today"
						value={metrics.classesToday.value}
						change={metrics.classesToday.change}
						trend={metrics.classesToday.trend}
						icon={Calendar}
					/>
					<MetricCard
						title="Revenue Today"
						value={metrics.revenueToday.value}
						change={`${metrics.revenueToday.change} vs avg`}
						trend={metrics.revenueToday.trend}
						icon={TrendingUp}
					/>
				</div>

				{/* Charts Section */}
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
					{/* Booking Patterns Heatmap */}
					<div className="lg:col-span-2 bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
						<h3 className="text-xl font-semibold text-gray-900 mb-4">
							Booking Patterns - This Week
						</h3>
						<p className="text-gray-600 mb-4">
							Heat map showing hour-by-hour booking intensity
						</p>

						{/* Hour labels */}
						<div className="flex justify-between text-xs text-gray-500 mb-2 ml-12">
							{hours.map((hour) => (
								<span key={hour}>{hour}</span>
							))}
						</div>

						{/* Heatmap grid */}
						<div className="space-y-1">
							{heatmapData.map((row, dayIndex) => (
								<div key={dayIndex} className="flex items-center space-x-1">
									<div className="w-10 text-xs text-gray-500 text-right">
										{days[dayIndex]}
									</div>
									<div className="flex space-x-1">
										{row.map((value, hourIndex) => (
											<div
												key={hourIndex}
												className={`w-8 h-8 rounded text-xs font-medium flex items-center justify-center ${getHeatmapColor(
													value
												)}`}
											>
												{value}%
											</div>
										))}
									</div>
								</div>
							))}
						</div>
					</div>

					{/* Today's Classes */}
					<div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
						<h3 className="text-xl font-semibold text-gray-900 mb-4">
							Today's Classes
						</h3>
						<div className="space-y-4 max-h-96 overflow-y-auto">
							{todaysClasses.map((classItem, index) => (
								<div
									key={index}
									className="border-b border-gray-100 pb-4 last:border-b-0"
								>
									<div className="flex justify-between items-start mb-2">
										<div>
											<h4 className="font-semibold text-gray-900">
												{classItem.name}
											</h4>
											<p className="text-sm text-gray-600">
												{classItem.time} • {classItem.instructor} •{' '}
												{classItem.capacity} spots
											</p>
										</div>
									</div>
									<div className="space-y-1">
										<div className="w-full bg-gray-200 rounded-full h-2">
											<div
												className="bg-blue-600 h-2 rounded-full transition-all duration-300"
												style={{ width: `${classItem.utilization}%` }}
											></div>
										</div>
										<div className="text-xs text-center text-gray-600">
											{classItem.booked}/{classItem.capacity} (
											{classItem.utilization}%)
										</div>
									</div>
								</div>
							))}
						</div>
					</div>
				</div>

				{/* Instructor Performance Table */}
				<div className="bg-white rounded-lg border border-gray-200 shadow-sm">
					<div className="p-6 border-b border-gray-200">
						<div className="flex justify-between items-center">
							<h3 className="text-xl font-semibold text-gray-900">
								Instructor Performance - This Week
							</h3>
							<button className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors">
								<Download className="h-4 w-4" />
								<span>Export Report</span>
							</button>
						</div>
					</div>
					<div className="overflow-x-auto">
						<table className="w-full">
							<thead className="bg-gray-50">
								<tr>
									<th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
										Instructor
									</th>
									<th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
										Classes Taught
									</th>
									<th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
										Avg Utilization
									</th>
									<th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
										Revenue Generated
									</th>
									<th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
										Profit Per Class
									</th>
								</tr>
							</thead>
							<tbody className="bg-white divide-y divide-gray-200">
								{instructorPerformance.map((instructor, index) => (
									<tr key={index} className="hover:bg-gray-50">
										<td className="px-6 py-4 whitespace-nowrap">
											<div className="flex items-center">
												<div className="w-8 h-8 bg-gray-300 rounded-full mr-3"></div>
												<div className="text-sm font-medium text-gray-900">
													{instructor.name}
												</div>
											</div>
										</td>
										<td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
											{instructor.classes}
										</td>
										<td className="px-6 py-4 whitespace-nowrap">
											<div className="flex items-center">
												<span className="text-sm text-gray-900 mr-2">
													{instructor.utilization}%
												</span>
												<div className="w-16 bg-gray-200 rounded-full h-2">
													<div
														className="bg-green-600 h-2 rounded-full"
														style={{ width: `${instructor.utilization}%` }}
													></div>
												</div>
											</div>
										</td>
										<td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
											${instructor.revenue.toLocaleString()}
										</td>
										<td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
											${instructor.profitPerClass}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</div>
	);
};

export default StudioDashboard;

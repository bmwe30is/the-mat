'use client';
import React, { useState } from 'react';
import {
	Calendar,
	Users,
	TrendingUp,
	DollarSign,
	MapPin,
	Clock,
	Star,
	Settings,
	Plus,
	Filter,
	Search,
	BarChart3,
	UserCheck,
	CreditCard,
} from 'lucide-react';

const StudioDashboard = () => {
	const [activeTab, setActiveTab] = useState('overview');
	const [selectedLocation, setSelectedLocation] = useState('all');

	// Mock data - this would come from our API
	const mockData = {
		locations: [
			{ id: 'all', name: 'All Locations' },
			{ id: '1', name: 'Downtown Studio' },
			{ id: '2', name: 'Westside Studio' },
			{ id: '3', name: 'North Studio' },
		],
		metrics: {
			totalRevenue: 28750,
			totalCustomers: 342,
			classUtilization: 78,
			avgClassRating: 4.7,
			monthlyGrowth: 12.3,
		},
		upcomingClasses: [
			{
				id: 1,
				name: 'Morning Yoga Flow',
				instructor: 'Sarah Chen',
				time: '7:00 AM',
				capacity: 20,
				booked: 18,
				location: 'Downtown',
			},
			{
				id: 2,
				name: 'HIIT Bootcamp',
				instructor: 'Mike Johnson',
				time: '8:30 AM',
				capacity: 15,
				booked: 12,
				location: 'Westside',
			},
			{
				id: 3,
				name: 'Pilates Core',
				instructor: 'Emma Davis',
				time: '10:00 AM',
				capacity: 12,
				booked: 8,
				location: 'Downtown',
			},
			{
				id: 4,
				name: 'Spin Class',
				instructor: 'Alex Rodriguez',
				time: '6:00 PM',
				capacity: 25,
				booked: 23,
				location: 'North',
			},
		],
		recentBookings: [
			{
				id: 1,
				customer: 'Jennifer Smith',
				class: 'Morning Yoga Flow',
				time: '2 mins ago',
				amount: 25,
			},
			{
				id: 2,
				customer: 'David Park',
				class: 'HIIT Bootcamp',
				time: '5 mins ago',
				amount: 30,
			},
			{
				id: 3,
				customer: 'Lisa Wong',
				class: 'Pilates Core',
				time: '8 mins ago',
				amount: 28,
			},
		],
		instructors: [
			{
				id: 1,
				name: 'Sarah Chen',
				classes: 24,
				rating: 4.8,
				revenue: 3200,
				specialties: ['Yoga', 'Meditation'],
			},
			{
				id: 2,
				name: 'Mike Johnson',
				classes: 18,
				rating: 4.6,
				revenue: 2850,
				specialties: ['HIIT', 'Strength'],
			},
			{
				id: 3,
				name: 'Emma Davis',
				classes: 22,
				rating: 4.9,
				revenue: 3100,
				specialties: ['Pilates', 'Barre'],
			},
		],
	};

	const tabs = [
		{ id: 'overview', name: 'Overview', icon: BarChart3 },
		{ id: 'classes', name: 'Classes', icon: Calendar },
		{ id: 'customers', name: 'Customers', icon: Users },
		{ id: 'instructors', name: 'Instructors', icon: UserCheck },
		{ id: 'payments', name: 'Payments', icon: CreditCard },
		{ id: 'analytics', name: 'Analytics', icon: TrendingUp },
		{ id: 'settings', name: 'Settings', icon: Settings },
	];

	const MetricCard = ({ icon: Icon, title, value, change, prefix = '' }) => (
		<div className="bg-white rounded-lg shadow-sm border p-6">
			<div className="flex items-center justify-between">
				<div>
					<p className="text-sm font-medium text-gray-600">{title}</p>
					<p className="text-2xl font-bold text-gray-900 mt-2">
						{prefix}
						{value}
					</p>
				</div>
				<div className="h-12 w-12 bg-blue-100 rounded-lg flex items-center justify-center">
					<Icon className="h-6 w-6 text-blue-600" />
				</div>
			</div>
			{change && (
				<div className="mt-4 flex items-center">
					<TrendingUp className="h-4 w-4 text-green-500 mr-1" />
					<span className="text-sm font-medium text-green-500">+{change}%</span>
					<span className="text-sm text-gray-500 ml-1">from last month</span>
				</div>
			)}
		</div>
	);

	const renderOverview = () => (
		<div className="space-y-6">
			{/* Metrics Grid */}
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
				<MetricCard
					icon={DollarSign}
					title="Monthly Revenue"
					value={mockData.metrics.totalRevenue.toLocaleString()}
					prefix="$"
					change={mockData.metrics.monthlyGrowth}
				/>
				<MetricCard
					icon={Users}
					title="Active Customers"
					value={mockData.metrics.totalCustomers}
					change={8.2}
				/>
				<MetricCard
					icon={Calendar}
					title="Class Utilization"
					value={mockData.metrics.classUtilization}
					prefix=""
					change={5.1}
				/>
				<MetricCard
					icon={Star}
					title="Avg Class Rating"
					value={mockData.metrics.avgClassRating}
					change={2.3}
				/>
			</div>

			{/* Today's Classes & Recent Activity */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				<div className="bg-white rounded-lg shadow-sm border">
					<div className="px-6 py-4 border-b border-gray-200">
						<h3 className="text-lg font-semibold text-gray-900">
							Today's Classes
						</h3>
					</div>
					<div className="p-6">
						<div className="space-y-4">
							{mockData.upcomingClasses.map((cls) => (
								<div
									key={cls.id}
									className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
								>
									<div>
										<h4 className="font-medium text-gray-900">{cls.name}</h4>
										<p className="text-sm text-gray-600">
											{cls.instructor} • {cls.location}
										</p>
										<p className="text-sm text-gray-500">{cls.time}</p>
									</div>
									<div className="text-right">
										<div className="text-sm font-medium text-gray-900">
											{cls.booked}/{cls.capacity}
										</div>
										<div className="text-xs text-gray-500">booked</div>
										<div
											className={`w-16 h-2 rounded-full mt-1 ${
												cls.booked / cls.capacity > 0.8
													? 'bg-green-200'
													: cls.booked / cls.capacity > 0.5
													? 'bg-yellow-200'
													: 'bg-red-200'
											}`}
										>
											<div
												className={`h-2 rounded-full ${
													cls.booked / cls.capacity > 0.8
														? 'bg-green-500'
														: cls.booked / cls.capacity > 0.5
														? 'bg-yellow-500'
														: 'bg-red-500'
												}`}
												style={{
													width: `${(cls.booked / cls.capacity) * 100}%`,
												}}
											/>
										</div>
									</div>
								</div>
							))}
						</div>
					</div>
				</div>

				<div className="bg-white rounded-lg shadow-sm border">
					<div className="px-6 py-4 border-b border-gray-200">
						<h3 className="text-lg font-semibold text-gray-900">
							Recent Bookings
						</h3>
					</div>
					<div className="p-6">
						<div className="space-y-4">
							{mockData.recentBookings.map((booking) => (
								<div
									key={booking.id}
									className="flex items-center justify-between"
								>
									<div>
										<h4 className="font-medium text-gray-900">
											{booking.customer}
										</h4>
										<p className="text-sm text-gray-600">{booking.class}</p>
										<p className="text-xs text-gray-500">{booking.time}</p>
									</div>
									<div className="text-right">
										<div className="text-sm font-medium text-green-600">
											${booking.amount}
										</div>
									</div>
								</div>
							))}
						</div>
					</div>
				</div>
			</div>
		</div>
	);

	const renderInstructors = () => (
		<div className="space-y-6">
			<div className="flex justify-between items-center">
				<h2 className="text-2xl font-bold text-gray-900">
					Instructor Management
				</h2>
				<button className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700">
					<Plus className="h-4 w-4" />
					Add Instructor
				</button>
			</div>

			<div className="bg-white rounded-lg shadow-sm border">
				<div className="p-6">
					<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
						{mockData.instructors.map((instructor) => (
							<div key={instructor.id} className="border rounded-lg p-6">
								<div className="flex items-center gap-4 mb-4">
									<div className="h-12 w-12 bg-gray-200 rounded-full flex items-center justify-center">
										<span className="text-lg font-semibold text-gray-600">
											{instructor.name
												.split(' ')
												.map((n) => n[0])
												.join('')}
										</span>
									</div>
									<div>
										<h3 className="font-semibold text-gray-900">
											{instructor.name}
										</h3>
										<div className="flex items-center gap-1">
											<Star className="h-4 w-4 text-yellow-400 fill-current" />
											<span className="text-sm text-gray-600">
												{instructor.rating}
											</span>
										</div>
									</div>
								</div>

								<div className="space-y-3">
									<div className="flex justify-between">
										<span className="text-sm text-gray-600">
											Classes This Month
										</span>
										<span className="text-sm font-medium">
											{instructor.classes}
										</span>
									</div>
									<div className="flex justify-between">
										<span className="text-sm text-gray-600">
											Revenue Generated
										</span>
										<span className="text-sm font-medium">
											${instructor.revenue}
										</span>
									</div>
									<div>
										<span className="text-sm text-gray-600">Specialties</span>
										<div className="flex flex-wrap gap-1 mt-1">
											{instructor.specialties.map((specialty) => (
												<span
													key={specialty}
													className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded"
												>
													{specialty}
												</span>
											))}
										</div>
									</div>
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);

	const renderPlaceholder = (tabName) => (
		<div className="bg-white rounded-lg shadow-sm border p-8 text-center">
			<h2 className="text-2xl font-bold text-gray-900 mb-4">
				{tabName} Management
			</h2>
			<p className="text-gray-600 mb-6">
				This section will contain the {tabName.toLowerCase()} management
				interface.
			</p>
			<button className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700">
				Get Started
			</button>
		</div>
	);

	return (
		<div className="min-h-screen bg-gray-50">
			{/* Header */}
			<div className="bg-white shadow-sm border-b">
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
					<div className="flex justify-between items-center h-16">
						<div className="flex items-center gap-4">
							<h1 className="text-xl font-bold text-gray-900">FitStudio Pro</h1>
							<div className="flex items-center gap-2">
								<MapPin className="h-4 w-4 text-gray-400" />
								<select
									className="text-sm border-0 bg-transparent focus:ring-0 text-gray-600"
									value={selectedLocation}
									onChange={(e) => setSelectedLocation(e.target.value)}
								>
									{mockData.locations.map((location) => (
										<option key={location.id} value={location.id}>
											{location.name}
										</option>
									))}
								</select>
							</div>
						</div>

						<div className="flex items-center gap-4">
							<div className="relative">
								<Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
								<input
									type="text"
									placeholder="Search..."
									className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
								/>
							</div>
							<button className="h-8 w-8 bg-gray-200 rounded-full"></button>
						</div>
					</div>
				</div>
			</div>

			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
				<div className="flex gap-8">
					{/* Sidebar Navigation */}
					<div className="w-64 flex-shrink-0">
						<nav className="space-y-2">
							{tabs.map((tab) => {
								const Icon = tab.icon;
								return (
									<button
										key={tab.id}
										onClick={() => setActiveTab(tab.id)}
										className={`w-full flex items-center gap-3 px-4 py-3 text-left rounded-lg transition-colors ${
											activeTab === tab.id
												? 'bg-blue-100 text-blue-700 font-medium'
												: 'text-gray-600 hover:bg-gray-100'
										}`}
									>
										<Icon className="h-5 w-5" />
										{tab.name}
									</button>
								);
							})}
						</nav>
					</div>

					{/* Main Content */}
					<div className="flex-1">
						{activeTab === 'overview' && renderOverview()}
						{activeTab === 'instructors' && renderInstructors()}
						{activeTab === 'classes' && renderPlaceholder('Classes')}
						{activeTab === 'customers' && renderPlaceholder('Customers')}
						{activeTab === 'payments' && renderPlaceholder('Payments')}
						{activeTab === 'analytics' && renderPlaceholder('Analytics')}
						{activeTab === 'settings' && renderPlaceholder('Settings')}
					</div>
				</div>
			</div>
		</div>
	);
};

export default StudioDashboard;

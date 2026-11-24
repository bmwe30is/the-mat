// components/ui/loading-skeletons.tsx - Loading components
import React from 'react';

export const DashboardSkeleton = () => (
	<div className="min-h-screen bg-gray-50">
		<div className="bg-white border-b border-gray-200">
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
				<div className="flex justify-between items-center py-4">
					<div className="h-8 w-48 bg-gray-200 rounded animate-pulse"></div>
					<div className="h-8 w-32 bg-gray-200 rounded animate-pulse"></div>
				</div>
			</div>
		</div>

		<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
			<div className="mb-8">
				<div className="h-10 w-64 bg-gray-200 rounded animate-pulse mb-4"></div>
				<div className="flex space-x-4">
					{[1, 2, 3, 4].map((i) => (
						<div
							key={i}
							className="h-10 w-24 bg-gray-200 rounded animate-pulse"
						></div>
					))}
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
				{[1, 2, 3, 4].map((i) => (
					<div
						key={i}
						className="bg-white p-6 rounded-lg border border-gray-200"
					>
						<div className="h-4 w-20 bg-gray-200 rounded animate-pulse mb-2"></div>
						<div className="h-8 w-16 bg-gray-200 rounded animate-pulse mb-1"></div>
						<div className="h-3 w-24 bg-gray-200 rounded animate-pulse"></div>
					</div>
				))}
			</div>
		</div>
	</div>
);

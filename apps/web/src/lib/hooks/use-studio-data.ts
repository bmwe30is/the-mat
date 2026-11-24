// lib/hooks/use-studio-data.ts - Custom hook for dashboard data
import { useState, useEffect } from 'react';
import type { StudioMetrics } from '@/types';

interface DateRange {
	start: string; // YYYY-MM-DD
	end: string; // YYYY-MM-DD
}

interface UseStudioDataProps {
	studioId: string;
	dateRange?: DateRange;
}

interface StudioData {
	metrics: StudioMetrics | null;
	isLoading: boolean;
	error: string | null;
	refetch: () => Promise<void>;
}

/**
 * Calculate default date range (last 7 days)
 */
function getDefaultDateRange(): DateRange {
	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const formatDate = (date: Date): string => {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	};

	const startDate = new Date(today);
	startDate.setDate(startDate.getDate() - 6); // Last 7 days including today

	return {
		start: formatDate(startDate),
		end: formatDate(today),
	};
}

export function useStudioData({
	studioId,
	dateRange,
}: UseStudioDataProps): StudioData {
	const [data, setData] = useState<{
		metrics: StudioMetrics | null;
		isLoading: boolean;
		error: string | null;
	}>({
		metrics: null,
		isLoading: true,
		error: null,
	});

	const fetchData = async () => {
		try {
			setData((prev) => ({ ...prev, isLoading: true, error: null }));

			// Default to last 7 days if no dateRange provided
			const range = dateRange || getDefaultDateRange();

			const params = new URLSearchParams();
			params.set('start_date', range.start);
			params.set('end_date', range.end);

			const response = await fetch(`/api/studio/${studioId}/metrics?${params}`);
			const result = await response.json();

			if (result.success) {
				setData({
					metrics: result.data.metrics,
					isLoading: false,
					error: null,
				});
			} else {
				throw new Error(result.error?.message || 'Failed to fetch data');
			}
		} catch (error) {
			setData({
				metrics: null,
				isLoading: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			});
		}
	};

	useEffect(() => {
		if (studioId) {
			fetchData();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [studioId, dateRange?.start, dateRange?.end]);

	return {
		...data,
		refetch: fetchData,
	};
}

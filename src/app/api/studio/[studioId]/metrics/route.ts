// app/api/studio/[studioId]/metrics/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { DashboardService } from '@/lib/analytics/dashboard-service';

/**
 * Calculate default date range (last 7 days)
 */
function getDefaultDateRange(): { start: string; end: string } {
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

export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ studioId: string }> }
) {
	try {
		const { studioId } = await params;
		const { searchParams } = new URL(request.url);

		// Default to last 7 days if dates not provided
		const defaultRange = getDefaultDateRange();
		const startDate = searchParams.get('start_date') || defaultRange.start;
		const endDate = searchParams.get('end_date') || defaultRange.end;

		const result = await DashboardService.getDashboardOverview(studioId, {
			start: startDate,
			end: endDate,
		});

		return NextResponse.json(result);
	} catch (error) {
		console.error('Metrics API error:', error);
		return NextResponse.json(
			{
				success: false,
				error: {
					code: 'METRICS_ERROR',
					message: 'Failed to fetch metrics',
				},
			},
			{ status: 500 }
		);
	}
}

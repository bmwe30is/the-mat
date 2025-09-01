// app/api/studio/[studioId]/metrics/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { DashboardService } from '@/lib/analytics/dashboard-service';

export async function GET(
	request: NextRequest,
	{ params }: { params: { studioId: string } }
) {
	try {
		const { searchParams } = new URL(request.url);
		const startDate =
			searchParams.get('start_date') || new Date().toISOString().split('T')[0];
		const endDate =
			searchParams.get('end_date') || new Date().toISOString().split('T')[0];

		const result = await DashboardService.getDashboardOverview(
			params.studioId,
			{ start: startDate, end: endDate }
		);

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

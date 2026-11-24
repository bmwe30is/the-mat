// ============================================================================
// DASHBOARD API ROUTES
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// pages/api/dashboard/metrics.ts
export async function GET(request: NextRequest) {
	try {
		const { searchParams } = new URL(request.url);
		const studioId = searchParams.get('studioId');
		const locationId = searchParams.get('locationId');

		if (!studioId) {
			return NextResponse.json(
				{ error: 'studioId is required' },
				{ status: 400 }
			);
		}

		// Build location filter
		const locationFilter =
			locationId && locationId !== 'all'
				? { locationId }
				: { location: { studioId } };

		// Get current month metrics
		const now = new Date();
		const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
		const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

		// Total revenue this month
		const totalRevenue = await prisma.payment.aggregate({
			where: {
				booking: {
					class: locationFilter,
				},
				status: 'COMPLETED',
				processedAt: {
					gte: startOfMonth,
					lte: endOfMonth,
				},
			},
			_sum: {
				netAmount: true,
			},
		});

		// Active customers
		const totalCustomers = await prisma.studioUser.count({
			where: {
				studioId,
				isActive: true,
				role: 'CUSTOMER',
			},
		});

		// Class utilization (this month)
		const classUtilization = await prisma.class.findMany({
			where: {
				...locationFilter,
				startTime: {
					gte: startOfMonth,
					lte: endOfMonth,
				},
				status: 'COMPLETED',
			},
			select: {
				capacity: true,
				_count: {
					select: {
						bookings: {
							where: {
								status: 'ATTENDED',
							},
						},
					},
				},
			},
		});

		const utilizationRate =
			classUtilization.length > 0
				? (classUtilization.reduce((acc, cls) => {
						const attendanceRate = cls._count.bookings / cls.capacity;
						return acc + attendanceRate;
					}, 0) /
						classUtilization.length) *
					100
				: 0;

		// Average class rating (mock for now - would need rating system)
		const avgClassRating = 4.7;

		// Previous month for growth calculation
		const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
		const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

		const lastMonthRevenue = await prisma.payment.aggregate({
			where: {
				booking: {
					class: locationFilter,
				},
				status: 'COMPLETED',
				processedAt: {
					gte: startOfLastMonth,
					lte: endOfLastMonth,
				},
			},
			_sum: {
				netAmount: true,
			},
		});

		const revenueGrowth = lastMonthRevenue._sum.netAmount
			? (((Number(totalRevenue._sum.netAmount) || 0) -
					(Number(lastMonthRevenue._sum.netAmount) || 0)) /
					(Number(lastMonthRevenue._sum.netAmount) || 1)) *
				100
			: 0;

		return NextResponse.json({
			totalRevenue: Number(totalRevenue._sum.netAmount) || 0,
			totalCustomers,
			classUtilization: Math.round(utilizationRate * 100) / 100,
			avgClassRating,
			monthlyGrowth: Math.round(revenueGrowth * 100) / 100,
		});
	} catch (error) {
		return NextResponse.json(
			{
				error: error instanceof Error ? error.message : 'Unknown error',
			},
			{ status: 500 }
		);
	}
}

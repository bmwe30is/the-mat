// pages/api/dashboard/bookings/recent.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
	try {
		const { searchParams } = new URL(request.url);
		const studioId = searchParams.get('studioId');
		const limit = parseInt(searchParams.get('limit') || '10');

		if (!studioId) {
			return NextResponse.json(
				{ error: 'studioId is required' },
				{ status: 400 }
			);
		}

		const recentBookings = await prisma.booking.findMany({
			where: {
				class: {
					location: {
						studioId,
					},
				},
			},
			include: {
				user: true,
				class: {
					include: {
						classType: true,
					},
				},
				payments: true,
			},
			orderBy: {
				bookedAt: 'desc',
			},
			take: limit,
		});

		const formattedBookings = recentBookings.map((booking) => ({
			id: booking.id,
			customer: `${booking.user.firstName} ${booking.user.lastName}`,
			class: booking.class.classType.name,
			time: formatRelativeTime(booking.bookedAt),
			amount: booking.payments.reduce(
				(sum, payment) =>
					sum +
					(payment.status === 'COMPLETED' ? Number(payment.netAmount) : 0),
				0
			),
		}));

		return NextResponse.json({
			bookings: formattedBookings,
		});
	} catch (error) {
		return NextResponse.json(
			{
				error: error.message,
			},
			{ status: 500 }
		);
	}
}

// Helper function for relative time
function formatRelativeTime(date: Date): string {
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / (1000 * 60));

	if (diffMins < 1) return 'Just now';
	if (diffMins < 60) return `${diffMins} mins ago`;

	const diffHours = Math.floor(diffMins / 60);
	if (diffHours < 24) return `${diffHours} hours ago`;

	const diffDays = Math.floor(diffHours / 24);
	return `${diffDays} days ago`;
}

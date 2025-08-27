// pages/api/dashboard/classes/today.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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

		const locationFilter =
			locationId && locationId !== 'all'
				? { locationId }
				: { location: { studioId } };

		// Get today's classes
		const today = new Date();
		const startOfDay = new Date(today.setHours(0, 0, 0, 0));
		const endOfDay = new Date(today.setHours(23, 59, 59, 999));

		const todaysClasses = await prisma.class.findMany({
			where: {
				...locationFilter,
				startTime: {
					gte: startOfDay,
					lte: endOfDay,
				},
			},
			include: {
				classType: true,
				instructor: {
					include: {
						user: true,
					},
				},
				location: true,
				_count: {
					select: {
						bookings: {
							where: {
								status: {
									in: ['CONFIRMED', 'ATTENDED'],
								},
							},
						},
					},
				},
			},
			orderBy: {
				startTime: 'asc',
			},
		});

		const formattedClasses = todaysClasses.map((cls) => ({
			id: cls.id,
			name: cls.classType.name,
			instructor: cls.instructor?.user
				? `${cls.instructor.user.firstName} ${cls.instructor.user.lastName}`
				: 'TBD',
			time: cls.startTime.toLocaleTimeString('en-US', {
				hour: 'numeric',
				minute: '2-digit',
				hour12: true,
			}),
			capacity: cls.capacity,
			booked: cls._count.bookings,
			location: cls.location.name,
		}));

		return NextResponse.json({
			classes: formattedClasses,
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

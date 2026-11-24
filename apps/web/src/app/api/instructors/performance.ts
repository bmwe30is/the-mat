// pages/api/instructors/performance.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
	try {
		const { searchParams } = new URL(request.url);
		const studioId = searchParams.get('studioId');

		if (!studioId) {
			return NextResponse.json(
				{ error: 'studioId is required' },
				{ status: 400 }
			);
		}

		// Get current month
		const now = new Date();
		const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
		const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

		const instructorPerformance = await prisma.instructorProfile.findMany({
			where: {
				user: {
					studioUsers: {
						some: {
							studioId,
							role: {
								in: ['INSTRUCTOR', 'ADMIN', 'MANAGER'],
							},
						},
					},
				},
			},
			include: {
				user: true,
				classes: {
					where: {
						startTime: {
							gte: startOfMonth,
							lte: endOfMonth,
						},
						status: 'COMPLETED',
					},
					include: {
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
				},
				compensations: {
					where: {
						createdAt: {
							gte: startOfMonth,
							lte: endOfMonth,
						},
					},
				},
			},
		});

		const formattedInstructors = instructorPerformance.map((instructor) => {
			const totalRevenue = instructor.compensations.reduce(
				(sum, comp) => sum + Number(comp.totalAmount),
				0
			);

			const totalAttendance = instructor.classes.reduce(
				(sum, cls) => sum + cls._count.bookings,
				0
			);

			const totalClasses = instructor.classes.length;
			const avgAttendance =
				totalClasses > 0 ? totalAttendance / totalClasses : 0;

			// Mock rating for now - would need actual rating system
			const rating = 4.5 + Math.random() * 0.5;

			return {
				id: instructor.id,
				name: `${instructor.user.firstName} ${instructor.user.lastName}`,
				classes: totalClasses,
				rating: Math.round(rating * 10) / 10,
				revenue: totalRevenue,
				specialties: instructor.specialties,
				avgAttendance,
			};
		});

		return NextResponse.json({
			instructors: formattedInstructors,
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

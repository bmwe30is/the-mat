// ============================================================================
// STUDIO ROUTING & DASHBOARD API ROUTES
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// app/api/studios/route.ts - Get studios for user switching
export async function GET(request: NextRequest) {
	try {
		const { searchParams } = new URL(request.url);
		const userEmail = searchParams.get('userEmail');

		if (!userEmail) {
			return NextResponse.json(
				{ error: 'userEmail is required' },
				{ status: 400 }
			);
		}

		// Find user and their studio access
		const user = await prisma.user.findUnique({
			where: { email: userEmail },
			include: {
				studioUsers: {
					include: {
						studio: {
							select: {
								id: true,
								name: true,
								slug: true,
								logo: true,
							},
						},
					},
				},
			},
		});

		if (!user) {
			return NextResponse.json({ studios: [] });
		}

		const studios = user.studioUsers.map((su) => ({
			...su.studio,
			role: su.role,
		}));

		return NextResponse.json({ studios });
	} catch (error) {
		return NextResponse.json(
			{
				error:
					error instanceof Error ? error.message : 'Unknown error occurred',
			},
			{ status: 500 }
		);
	}
}

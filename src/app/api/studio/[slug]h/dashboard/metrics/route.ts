// app/api/studio/[slug]/dashboard/metrics/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
	request: NextRequest,
	{ params }: { params: { slug: string } }
) {
	try {
		const { searchParams } = new URL(request.url);
		const locationId = searchParams.get('locationId');
		const slug = (await params).slug;

		// Find studio by slug
		const studio = await prisma.studio.findUnique({
			where: { slug },
		});

		if (!studio) {
			return NextResponse.json({ error: 'Studio not found' }, { status: 404 });
		}

		// Build location filter
		const locationFilter =
			locationId && locationId !== 'all'
				? { locationId }
				: { location: { studioId: studio.id } };

		// Rest of the metrics logic stays the same...
		// (Previous dashboard metrics code but filtered by studio)

		return NextResponse.json({
			studioName: studio.name,
			// ... metrics
		});
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

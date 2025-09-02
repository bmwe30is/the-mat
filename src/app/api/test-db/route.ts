import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';

export async function GET() {
	try {
		// Test the connection
		const result = await prisma.$queryRaw`SELECT 1 as test`;

		return NextResponse.json({
			success: true,
			message: 'Database connected successfully',
			result,
		});
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error occurred';

		return NextResponse.json(
			{
				success: false,
				error: errorMessage,
			},
			{ status: 500 }
		);
	}
}

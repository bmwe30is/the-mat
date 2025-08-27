// ============================================================================
// MIDDLEWARE & UTILITIES
// ============================================================================

// middleware/apiAuth.ts
import { NextRequest } from 'next/server';
import { prisma } from '../lib/prisma';

export async function validateStudioApiKey(request: NextRequest) {
	const apiKey = request.headers.get('X-API-Key');

	if (!apiKey) {
		return { error: 'Missing API key', status: 401 };
	}

	try {
		// Find studio by API key
		const studio = await prisma.studio.findUnique({
			where: { apiKey },
			select: {
				id: true,
				name: true,
				slug: true,
				arketaApiKey: true,
				arketaStudioId: true,
			},
		});

		if (!studio) {
			return { error: 'Invalid API key', status: 401 };
		}

		return { valid: true, studio };
	} catch (error) {
		return { error: 'Database error during authentication', status: 500 };
	}
}

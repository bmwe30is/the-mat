// app/api/studio/[studioId]/integrations/route.ts - Integration status API
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateStudioApiKey } from '@/middleware/apiAuth';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function GET(
	request: NextRequest,
	params: Promise<{ studioId: string }>
) {
	try {
		const { studioId } = await params;

		// Validate studio API key
		// const authResult = await validateStudioApiKey(request);
		// if ('error' in authResult) {
		// 	return NextResponse.json(
		// 		{
		// 			success: false,
		// 			error: {
		// 				code: 'AUTH_ERROR',
		// 				message: authResult.error,
		// 			},
		// 		},
		// 		{ status: 200 }
		// 	);
		// }

		// Get authenticated user from session
		const cookieStore = await cookies();
		const supabase = createServerClient(
			process.env.NEXT_PUBLIC_SUPABASE_URL!,
			process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
			{
				cookies: {
					getAll() {
						return cookieStore.getAll();
					},
					setAll(cookiesToSet) {
						try {
							cookiesToSet.forEach(({ name, value, options }) =>
								cookieStore.set(name, value, options)
							);
						} catch {
							// The `setAll` method was called from a Server Component.
							// This can be ignored if you have middleware refreshing
							// user sessions.
						}
					},
				},
			}
		);

		// Get current user from Supabase session
		const {
			data: { user: supabaseUser },
			error: authError,
		} = await supabase.auth.getUser();

		if (authError || !supabaseUser || !supabaseUser.email) {
			return NextResponse.json(
				{
					success: false,
					error: {
						code: 'UNAUTHORIZED',
						message: 'Unauthorized. Please sign in.',
					},
				},
				{ status: 401 }
			);
		}

		// Find user in Prisma database by email
		const user = await prisma.user.findUnique({
			where: { email: supabaseUser.email.toLowerCase().trim() },
			include: {
				studioUsers: {
					where: { studioId },
					include: {
						studio: {
							select: {
								id: true,
								name: true,
								timezone: true,
								stripeAccountId: true,
								stripeConnectedAt: true,
							},
						},
					},
				},
			},
		});

		if (!user) {
			return NextResponse.json(
				{
					success: false,
					error: {
						code: 'USER_NOT_FOUND',
						message: 'User not found in database. Please complete signup.',
					},
				},
				{ status: 404 }
			);
		}

		if (user.studioUsers.length === 0) {
			return NextResponse.json(
				{
					success: false,
					error: {
						code: 'STUDIO_ACCESS_DENIED',
						message: 'User does not have access to this studio',
					},
				},
				{ status: 403 }
			);
		}

		const studio = user.studioUsers[0].studio;

		// Get latest payment sync info
		const latestPayment = await prisma.stripePayment.findFirst({
			where: { studioId },
			orderBy: { createdAt: 'desc' },
			select: { createdAt: true },
		});

		// Helper function to normalize timestamps to studio timezone
		const normalizeTimestamp = (timestamp: Date | null) => {
			if (!timestamp) return null;
			// For now, return ISO string - in production you'd use a timezone library
			return timestamp.toISOString();
		};

		const status = {
			stripe: {
				connected: !!studio.stripeAccountId,
				accountId: studio.stripeAccountId,
				connectedAt: normalizeTimestamp(studio.stripeConnectedAt),
				lastSync: normalizeTimestamp(latestPayment?.createdAt || null),
				businessName: studio.stripeAccountId ? studio.name : null,
			},
		};

		return NextResponse.json({
			success: true,
			data: status,
		});
	} catch (error) {
		console.error('Integration status error:', error);
		return NextResponse.json(
			{
				success: false,
				error: {
					code: 'INTEGRATION_STATUS_ERROR',
					message: 'Failed to fetch integration status',
				},
			},
			{ status: 200 }
		);
	}
}

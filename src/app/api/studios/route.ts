// ============================================================================
// STUDIO ROUTING & DASHBOARD API ROUTES
// ============================================================================

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// app/api/studios/route.ts - Get studios for user switching
export async function GET() {
	try {
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
				{ error: 'Unauthorized. Please sign in.' },
				{ status: 401 }
			);
		}

		// Find user in Prisma database by email
		const user = await prisma.user.findUnique({
			where: { email: supabaseUser.email.toLowerCase().trim() },
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
			return NextResponse.json(
				{ error: 'User not found in database. Please complete signup.' },
				{ status: 404 }
			);
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

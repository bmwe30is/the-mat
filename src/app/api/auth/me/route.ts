import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';

export async function GET() {
	try {
		// Create Supabase client with session from cookies
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
			select: {
				id: true,
				email: true,
				firstName: true,
				lastName: true,
			},
		});

		if (!user) {
			return NextResponse.json(
				{ error: 'User not found in database. Please complete signup.' },
				{ status: 404 }
			);
		}

		return NextResponse.json({ user });
	} catch (error) {
		console.error('Get user error:', error);
		return NextResponse.json({ error: 'Failed to get user' }, { status: 500 });
	}
}

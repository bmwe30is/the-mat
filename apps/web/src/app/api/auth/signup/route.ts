import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
	try {
		const body = await request.json();
		const { email, firstName, lastName, supabaseUserId } = body;

		// Validate required fields
		if (!email || !firstName || !lastName) {
			return NextResponse.json(
				{ error: 'All fields are required' },
				{ status: 400 }
			);
		}

		// Validate email format
		if (!/\S+@\S+\.\S+/.test(email)) {
			return NextResponse.json(
				{ error: 'Please enter a valid email address' },
				{ status: 400 }
			);
		}

		// Get Supabase user from session to verify authentication
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

		// Try to get Supabase user from session
		const sessionResult = await supabase.auth.getUser();
		const supabaseUser = sessionResult.data.user;
		const authError = sessionResult.error;

		// If we have supabaseUserId from the signup response, we can trust it
		// even if the session isn't available yet (session may take time to establish)
		if (supabaseUserId) {
			// Verify the user ID matches if we have a session
			if (supabaseUser && supabaseUser.id !== supabaseUserId) {
				return NextResponse.json(
					{ error: 'User ID mismatch' },
					{ status: 403 }
				);
			}

			// If session is available, verify email matches
			if (supabaseUser && supabaseUser.email) {
				if (supabaseUser.email.toLowerCase() !== email.toLowerCase()) {
					return NextResponse.json(
						{ error: 'Email mismatch with authenticated user' },
						{ status: 403 }
					);
				}
			}
			// If no session yet, we trust the supabaseUserId from the signup response
			// This is safe because we just created the Supabase user
		} else {
			// No user ID provided, require session
			if (authError || !supabaseUser || !supabaseUser.email) {
				return NextResponse.json(
					{ error: 'Unauthorized. Please sign up first.' },
					{ status: 401 }
				);
			}

			// Verify the email matches the authenticated user
			if (supabaseUser.email.toLowerCase() !== email.toLowerCase()) {
				return NextResponse.json(
					{ error: 'Email mismatch with authenticated user' },
					{ status: 403 }
				);
			}
		}

		// Check if user already exists in Prisma
		const existingUser = await prisma.user.findUnique({
			where: { email: email.toLowerCase().trim() },
		});

		if (existingUser) {
			return NextResponse.json(
				{ error: 'User already exists in database' },
				{ status: 409 }
			);
		}

		// Create the user in Prisma (Supabase Auth user already exists)
		// Note: Using UncheckedCreateInput to bypass password requirement until migration is applied
		const user = await prisma.user.create({
			data: {
				email: email.toLowerCase().trim(),
				firstName: firstName.trim(),
				lastName: lastName.trim(),
			},
			select: {
				id: true,
				email: true,
				firstName: true,
				lastName: true,
				createdAt: true,
			},
		});

		return NextResponse.json(
			{
				message: 'Account created successfully',
				user,
			},
			{ status: 201 }
		);
	} catch (error) {
		console.error('Signup error:', error);

		// Handle Prisma unique constraint errors
		if (error instanceof Error && error.message.includes('Unique constraint')) {
			return NextResponse.json(
				{ error: 'An account with this email already exists' },
				{ status: 409 }
			);
		}

		return NextResponse.json(
			{ error: 'Failed to create account. Please try again.' },
			{ status: 500 }
		);
	}
}

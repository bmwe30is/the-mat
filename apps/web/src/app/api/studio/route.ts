import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateUniqueSlug, generateSlug } from '@/utils/slug';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
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
		});

		if (!user) {
			return NextResponse.json(
				{ error: 'User not found in database. Please complete signup.' },
				{ status: 404 }
			);
		}

		const body = await request.json();
		const {
			name,
			email,
			phone,
			timezone,
			// Future fields (not currently used but may be needed later)
			// address,
			// city,
			// state,
			// zipCode,
		} = body;

		// Validate required fields
		if (!name || !email) {
			return NextResponse.json(
				{
					error: 'Studio name and email are required',
					field: !name ? 'name' : 'email',
				},
				{ status: 400 }
			);
		}

		// Validate studio name (cannot be empty or only special characters)
		const baseSlug = generateSlug(name);
		if (!baseSlug) {
			return NextResponse.json(
				{
					error: 'Studio name must contain at least one letter or number',
					field: 'name',
				},
				{ status: 400 }
			);
		}

		// Generate unique slug with collision check
		const slug = await generateUniqueSlug(name, async (testSlug: string) => {
			const existing = await prisma.studio.findUnique({
				where: { slug: testSlug },
			});
			return !!existing;
		});

		// Create the studio
		const studio = await prisma.studio.create({
			data: {
				name,
				slug,
				email,
				phone: phone || null,
				timezone: timezone || 'America/Los_Angeles',
				currency: 'USD',
				// Note: We'll need to add address fields to the schema if needed
				// For now, we'll store them in description or create separate fields
			},
		});

		// Create studio-user relationship
		await prisma.studioUser.create({
			data: {
				studioId: studio.id,
				userId: user.id,
				role: 'OWNER',
			},
		});

		return NextResponse.json(
			{
				message: 'Studio created successfully',
				studio: {
					id: studio.id,
					name: studio.name,
					slug: studio.slug,
					email: studio.email,
				},
			},
			{ status: 201 }
		);
	} catch (error) {
		console.error('Studio creation error:', error);

		// Handle Prisma unique constraint errors
		if (error instanceof Error) {
			// Check for slug uniqueness violation
			if (
				error.message.includes('Unique constraint') &&
				error.message.includes('slug')
			) {
				return NextResponse.json(
					{
						error:
							'A studio with this name already exists. Please choose a different name.',
						field: 'name',
					},
					{ status: 409 }
				);
			}

			// Check for email uniqueness violation
			if (
				error.message.includes('Unique constraint') &&
				error.message.includes('email')
			) {
				return NextResponse.json(
					{
						error: 'A studio with this email already exists.',
						field: 'email',
					},
					{ status: 409 }
				);
			}

			// Handle slug generation errors
			if (error.message.includes('Invalid studio name')) {
				return NextResponse.json(
					{
						error: error.message,
						field: 'name',
					},
					{ status: 400 }
				);
			}
		}

		return NextResponse.json(
			{
				error: 'Failed to create studio. Please try again.',
				field: null,
			},
			{ status: 500 }
		);
	}
}

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
	try {
		// Example: Get users from Prisma
		const users = await prisma.user.findMany({
			select: {
				id: true,
				email: true,
				firstName: true,
				lastName: true,
				createdAt: true,
			},
		});

		return NextResponse.json({ users });
	} catch (error) {
		console.error('Error fetching users:', error);
		return NextResponse.json(
			{ error: 'Failed to fetch users' },
			{ status: 500 }
		);
	}
}

export async function POST(request: NextRequest) {
	try {
		const body = await request.json();
		const { email, firstName, lastName } = body;

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

		// Check if user already exists
		const existingUser = await prisma.user.findUnique({
			where: { email: email.toLowerCase().trim() },
		});

		if (existingUser) {
			return NextResponse.json(
				{ error: 'An account with this email already exists' },
				{ status: 409 }
			);
		}

		// Create the user (password is handled by Supabase Auth)
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

		return NextResponse.json({ user }, { status: 201 });
	} catch (error) {
		console.error('Error creating user:', error);

		// Handle Prisma unique constraint errors
		if (error instanceof Error && error.message.includes('Unique constraint')) {
			return NextResponse.json(
				{ error: 'An account with this email already exists' },
				{ status: 409 }
			);
		}

		return NextResponse.json(
			{ error: 'Failed to create user' },
			{ status: 500 }
		);
	}
}

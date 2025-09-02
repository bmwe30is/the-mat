import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { supabase } from '@/lib/supabase';

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
		const { email } = body;

		if (!email) {
			return NextResponse.json({ error: 'Email is required' }, { status: 400 });
		}

		// Example: Create user with Prisma
		// const user = await prisma.user.create({
		// 	data: {
		// 		email,
		// 		name,
		// 	},
		// });

		// Example: You could also use Supabase here for additional functionality
		const { data, error } = await supabase.auth.admin.createUser({
			email,
			password: 'temporary-password',
			email_confirm: true,
		});
		console.error('Error creating user:', error);
		return NextResponse.json(data, { status: 201 });
	} catch (error) {
		console.error('Error creating user:', error);
		return NextResponse.json(
			{ error: 'Failed to create user' + error },
			{ status: 500 }
		);
	}
}

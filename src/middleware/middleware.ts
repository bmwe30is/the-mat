// middleware.ts - Authentication middleware
import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(req: NextRequest) {
	let response = NextResponse.next({
		request: {
			headers: req.headers,
		},
	});

	const supabase = createServerClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL!,
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
		{
			cookies: {
				getAll() {
					return req.cookies.getAll();
				},
				setAll(cookiesToSet) {
					cookiesToSet.forEach(({ name, value }) => {
						req.cookies.set(name, value);
					});
					response = NextResponse.next({
						request: {
							headers: req.headers,
						},
					});
					cookiesToSet.forEach(({ name, value, options }) => {
						response.cookies.set(name, value, options);
					});
				},
			},
		}
	);

	// Refresh session if expired
	const {
		data: { session },
	} = await supabase.auth.getSession();

	// Protect dashboard routes
	if (req.nextUrl.pathname.startsWith('/dashboard') && !session) {
		return NextResponse.redirect(new URL('/auth/signup', req.url));
	}

	// Protect onboarding routes (require authentication)
	if (req.nextUrl.pathname.startsWith('/onboarding') && !session) {
		return NextResponse.redirect(new URL('/auth/signup', req.url));
	}

	// Redirect authenticated users away from auth pages
	if (req.nextUrl.pathname.startsWith('/auth') && session) {
		return NextResponse.redirect(new URL('/dashboard', req.url));
	}

	return response;
}

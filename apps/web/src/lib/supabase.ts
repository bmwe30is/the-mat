import { createClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Create a Supabase client for browser/client-side usage.
 * This properly handles cookies for authentication in Next.js.
 * Use this in client components ('use client').
 */
export function createClientSupabase() {
	return createBrowserClient(supabaseUrl, supabaseAnonKey);
}

// Legacy export for backward compatibility (deprecated - use createClientSupabase instead)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server-side client with service role key
export const createServerSupabaseClient = () => {
	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
	const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

	return createClient(supabaseUrl, supabaseServiceKey, {
		auth: {
			autoRefreshToken: false,
			persistSession: false,
		},
	});
};

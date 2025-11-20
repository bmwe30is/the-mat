// 4. HOW TO USE THE STUDIO ID THROUGHOUT YOUR APP
// lib/hooks/use-current-studio.ts
import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { createClientSupabase } from '@/lib/supabase';

const supabase = createClientSupabase();

export function useCurrentStudio() {
	const params = useParams();
	const router = useRouter();
	const [studio, setStudio] = useState(null);
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		const fetchStudio = async () => {
			try {
				const studioId = params.studioId as string;

				if (!studioId) {
					router.push('/onboarding/studio');
					return;
				}

				// Fetch studio details using the Studio ID from URL
				const { data: studioData, error } = await supabase
					.from('studios')
					.select('*')
					.eq('id', studioId)
					.single();

				if (error || !studioData) {
					console.error('Studio not found:', error);
					router.push('/onboarding/studio');
					return;
				}

				setStudio(studioData);
			} catch (error) {
				console.error('Error fetching studio:', error);
			} finally {
				setIsLoading(false);
			}
		};

		fetchStudio();
	}, [params.studioId]);

	return { studio, isLoading };
}

// app/dashboard/[studioId]/page.tsx - Main dashboard
import { Suspense } from 'react';
import StudioDashboard from '@/components/dashboard/StudioDashboard';
import { DashboardSkeleton } from '@/components/ui/loading-skeletons';

interface DashboardPageProps {
	params: Promise<{ studioId: string }>;
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function DashboardPage({
	params,
	searchParams,
}: DashboardPageProps) {
	const { studioId } = await params;
	const { dateRange } = await searchParams;
	return (
		<Suspense fallback={<DashboardSkeleton />}>
			<StudioDashboard
				studioId={studioId}
				initialDateRange={
					dateRange as unknown as { start: string; end: string }
				}
			/>
		</Suspense>
	);
}

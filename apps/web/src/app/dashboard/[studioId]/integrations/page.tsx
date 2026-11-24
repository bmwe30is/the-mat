// app/dashboard/[studioId]/integrations/page.tsx - Integration setup
import IntegrationSetup from '@/components/integrations/IntegrationSetup';

interface IntegrationsPageProps {
	params: Promise<{ studioId: string }>;
	searchParams: { connected?: string; error?: string };
}

export default async function IntegrationsPage({
	params,
}: IntegrationsPageProps) {
	const { studioId } = await params;

	return <IntegrationSetup studioId={studioId} />;
}

// STEP 3: Manual Sync API Endpoint
// app/api/studio/[studioId]/sync-stripe/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { StripeConnectService } from '@/lib/stripe/connect';
import { prisma } from '@/lib/prisma';

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ studioId: string }> }
) {
	try {
		const { studioId } = await params;
		const { daysBack } = await request.json();

		// Validate studio access (basic auth check)
		const authHeader = request.headers.get('authorization');
		if (!authHeader) {
			return NextResponse.json(
				{ error: 'Authorization required' },
				{ status: 401 }
			);
		}

		// Validate studio exists and user has access
		const studio = await prisma.studio.findUnique({
			where: { id: studioId },
			select: { id: true, name: true, stripeAccountId: true },
		});

		if (!studio) {
			return NextResponse.json({ error: 'Studio not found' }, { status: 404 });
		}

		if (!studio.stripeAccountId) {
			return NextResponse.json(
				{ error: 'Stripe not connected for this studio' },
				{ status: 400 }
			);
		}

		// Perform manual sync
		const result = await StripeConnectService.performManualSync(
			studioId,
			daysBack || 7
		);

		return NextResponse.json({
			success: true,
			data: {
				studioName: studio.name,
				paymentsSynced: result.paymentsSynced,
				syncedFrom: result.syncedFrom,
				timestamp: new Date().toISOString(),
			},
		});
	} catch (error) {
		console.error('Manual sync API error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Manual sync failed',
			},
			{ status: 500 }
		);
	}
}

// GET endpoint to check sync status
export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ studioId: string }> }
) {
	try {
		const { studioId } = await params;

		// Get studio sync status
		const studio = await prisma.studio.findUnique({
			where: { id: studioId },
			select: {
				stripeConnectedAt: true,
				stripeLastManualSync: true,
				stripeWebhookId: true,
			},
		});

		// Get payment count from database
		const paymentCount = await prisma.stripePayment.count({
			where: { studioId: studioId },
		});

		// Get latest payment date
		const latestPayment = await prisma.stripePayment.findFirst({
			where: { studioId: studioId },
			select: { createdAt: true },
			orderBy: { createdAt: 'desc' },
		});

		return NextResponse.json({
			success: true,
			data: {
				stripeConnected: !!studio?.stripeConnectedAt,
				webhookConfigured: !!studio?.stripeWebhookId,
				totalPayments: paymentCount || 0,
				lastManualSync: studio?.stripeLastManualSync,
				latestPaymentDate: latestPayment?.createdAt,
				syncStatus: {
					webhookActive: !!studio?.stripeWebhookId,
					manualSyncAvailable: !!studio?.stripeConnectedAt,
				},
			},
		});
	} catch (error) {
		console.error('Sync status API error:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to get sync status' },
			{ status: 500 }
		);
	}
}

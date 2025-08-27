// ============================================================================
// IMPORT API ROUTES - Updated for Multi-Tenant
// ============================================================================

// app/api/import/customers/route.ts
import { NextRequest, NextResponse } from 'next/server';

import { validateStudioApiKey } from '@/middleware/apiAuth';
import { upsertUser } from '@/utils/upsertHelpers';
import { logger } from '@/utils/importLogger';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
	// Validate studio API key
	const authResult = await validateStudioApiKey(request);
	if ('error' in authResult) {
		return NextResponse.json(
			{ error: authResult.error },
			{ status: authResult.status }
		);
	}

	const { studio } = authResult;

	try {
		const body = await request.json();
		const { customers } = body;

		if (!customers || !Array.isArray(customers)) {
			return NextResponse.json(
				{ error: 'customers array is required' },
				{ status: 400 }
			);
		}

		logger.clear();
		const results = {
			processed: 0,
			created: 0,
			updated: 0,
			errors: 0,
		};

		for (const customerData of customers) {
			try {
				results.processed++;

				// Transform Arketa data to our format
				const userData = {
					arketaCustomerId: customerData.id,
					email: customerData.email,
					firstName: customerData.first_name,
					lastName: customerData.last_name,
					phone: customerData.phone,
					dateOfBirth: customerData.date_of_birth,
				};

				// Upsert user
				const userResult = await upsertUser(userData, studio.id, 'arketa');

				// Update studio user relationship with Arketa-specific data
				await prisma.studioUser.upsert({
					where: {
						studioId_userId: {
							studioId: studio.id,
							userId: userResult.record.id,
						},
					},
					update: {
						totalSpent: customerData.total_spent || 0,
						totalVisits: customerData.total_visits || 0,
						membershipType: customerData.membership_type,
						memberSince: customerData.member_since
							? new Date(customerData.member_since)
							: null,
						updatedAt: new Date(),
					},
					create: {
						studioId: studio.id,
						userId: userResult.record.id,
						role: 'CUSTOMER',
						totalSpent: customerData.total_spent || 0,
						totalVisits: customerData.total_visits || 0,
						membershipType: customerData.membership_type,
						memberSince: customerData.member_since
							? new Date(customerData.member_since)
							: null,
						acquisitionSource: 'arketa',
					},
				});

				if (userResult.isNew) {
					results.created++;
				} else {
					results.updated++;
				}

				await logger.log({
					studioId: studio.id,
					source: 'arketa',
					operation: userResult.isNew ? 'create' : 'update',
					recordType: 'customer',
					recordId: userResult.record.id,
					externalId: customerData.id,
					status: 'SUCCESS',
					importData: customerData,
					changes: userResult.changes,
				});
			} catch (error) {
				results.errors++;
				await logger.log({
					studioId: studio.id,
					source: 'arketa',
					operation: 'create',
					recordType: 'customer',
					externalId: customerData.id,
					status: 'ERROR',
					errorMessage: `Failed to process customer: ${error.message}`,
					importData: customerData,
				});
			}
		}

		return NextResponse.json({
			success: true,
			studio: studio.name,
			results,
			logs: logger.getLogs(),
			errors: logger.getErrors(),
		});
	} catch (error) {
		await logger.log({
			studioId: studio.id,
			source: 'arketa',
			operation: 'batch_import',
			recordType: 'customer',
			status: 'ERROR',
			errorMessage: `Batch import failed: ${error.message}`,
		});

		return NextResponse.json(
			{
				success: false,
				error: error.message,
				logs: logger.getLogs(),
			},
			{ status: 500 }
		);
	}
}

// Single customer import
export async function PUT(request: NextRequest) {
	const authResult = await validateStudioApiKey(request);
	if ('error' in authResult) {
		return NextResponse.json(
			{ error: authResult.error },
			{ status: authResult.status }
		);
	}

	const { studio } = authResult;

	try {
		const body = await request.json();
		const { customer } = body;

		if (!customer) {
			return NextResponse.json(
				{ error: 'customer is required' },
				{ status: 400 }
			);
		}

		const userData = {
			arketaCustomerId: customer.id,
			email: customer.email,
			firstName: customer.first_name,
			lastName: customer.last_name,
			phone: customer.phone,
			dateOfBirth: customer.date_of_birth,
		};

		const userResult = await upsertUser(userData, studio.id, 'arketa');

		await prisma.studioUser.upsert({
			where: {
				studioId_userId: {
					studioId: studio.id,
					userId: userResult.record.id,
				},
			},
			update: {
				totalSpent: customer.total_spent || 0,
				totalVisits: customer.total_visits || 0,
				membershipType: customer.membership_type,
				updatedAt: new Date(),
			},
			create: {
				studioId: studio.id,
				userId: userResult.record.id,
				role: 'CUSTOMER',
				totalSpent: customer.total_spent || 0,
				totalVisits: customer.total_visits || 0,
				membershipType: customer.membership_type,
				acquisitionSource: 'arketa',
			},
		});

		await logger.log({
			studioId: studio.id,
			source: 'arketa',
			operation: userResult.isNew ? 'create' : 'update',
			recordType: 'customer',
			recordId: userResult.record.id,
			externalId: customer.id,
			status: 'SUCCESS',
			importData: customer,
		});

		return NextResponse.json({
			success: true,
			studio: studio.name,
			customer: userResult.record,
			isNew: userResult.isNew,
		});
	} catch (error) {
		return NextResponse.json(
			{
				success: false,
				error: error.message,
			},
			{ status: 500 }
		);
	}
}

// ============================================================================
// IMPORT API ROUTES
// ============================================================================

// pages/api/import/customers.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { upsertUser } from '@/utils/upsertHelpers';
import { validateStudioApiKey } from '@/middleware/apiAuth';
import { logger } from '@/utils/importLogger';

export async function POST(request: NextRequest) {
	// Validate API key
	const authResult = await validateStudioApiKey(request);
	if ('error' in authResult) {
		return NextResponse.json(
			{ error: authResult.error },
			{ status: authResult.status }
		);
	}
	const body = await request.json();
	const { customers, studioId } = body;
	try {
		if (!customers || !Array.isArray(customers)) {
			return NextResponse.json(
				{ error: 'customers array is required' },
				{ status: 400 }
			);
		}

		if (!studioId) {
			return NextResponse.json(
				{ error: 'studioId is required' },
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
					email: customerData.email,
					firstName: customerData.first_name,
					lastName: customerData.last_name,
					phone: customerData.phone,
					dateOfBirth: customerData.date_of_birth
						? new Date(customerData.date_of_birth)
						: undefined,
					arketaCustomerId: customerData.id,
				};

				// Upsert user
				const userResult = await upsertUser(userData);

				// Create or update studio user relationship
				await prisma.studioUser.upsert({
					where: {
						studioId_userId: {
							studioId,
							userId: userResult.record.id,
						},
					},
					update: {
						totalSpent: customerData.total_spent || 0,
						totalVisits: customerData.total_visits || 0,
						memberSince: customerData.member_since
							? new Date(customerData.member_since)
							: null,
						acquisitionSource: 'arketa',
						updatedAt: new Date(),
					},
					create: {
						studioId,
						userId: userResult.record.id,
						role: 'CUSTOMER',
						totalSpent: customerData.total_spent || 0,
						totalVisits: customerData.total_visits || 0,
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

				// Convert customerData to ImportData format
				const importData = {
					id: customerData.id,
					email: customerData.email,
					first_name: customerData.first_name,
					last_name: customerData.last_name,
					phone: customerData.phone,
					date_of_birth: customerData.date_of_birth,
					total_spent: customerData.total_spent,
					total_visits: customerData.total_visits,
					member_since: customerData.member_since,
				};

				logger.log({
					studioId,
					source: 'arketa-import',
					operation: 'importCustomers',
					recordType: 'customer',
					externalId: customerData.id,
					status: 'SUCCESS',
					errorMessage: userResult.isNew
						? 'Customer created'
						: 'Customer updated',
					importData,
				});
			} catch (error) {
				results.errors++;
				const errorMessage =
					error instanceof Error ? error.message : 'Unknown error occurred';

				// Convert customerData to ImportData format for error logging
				const importData = {
					id: customerData.id,
					email: customerData.email,
					first_name: customerData.first_name,
					last_name: customerData.last_name,
					phone: customerData.phone,
					date_of_birth: customerData.date_of_birth,
					total_spent: customerData.total_spent,
					total_visits: customerData.total_visits,
					member_since: customerData.member_since,
				};

				logger.log({
					studioId,
					source: 'arketa-import',
					operation: 'importCustomers',
					recordType: 'customer',
					externalId: customerData.id,
					status: 'ERROR',
					errorMessage: `Failed to process customer: ${errorMessage}`,
					importData,
				});
			}
		}

		return NextResponse.json({
			success: true,
			results,
			logs: logger.getLogs(),
			errors: logger.getErrors(),
		});
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error occurred';
		logger.log({
			studioId: body?.studioId || 'unknown',
			source: 'arketa-import',
			operation: 'importCustomers',
			recordType: 'batch',
			status: 'ERROR',
			errorMessage: `Batch import failed: ${errorMessage}`,
		});

		return NextResponse.json(
			{
				success: false,
				error: errorMessage,
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

	try {
		const body = await request.json();
		const { customer, studioId } = body;

		if (!customer || !studioId) {
			return NextResponse.json(
				{ error: 'customer and studioId are required' },
				{ status: 400 }
			);
		}

		const userData = {
			email: customer.email,
			firstName: customer.first_name,
			lastName: customer.last_name,
			phone: customer.phone,
			dateOfBirth: customer.date_of_birth
				? new Date(customer.date_of_birth)
				: undefined,
			arketaCustomerId: customer.id,
		};

		const userResult = await upsertUser(userData);

		await prisma.studioUser.upsert({
			where: {
				studioId_userId: {
					studioId,
					userId: userResult.record.id,
				},
			},
			update: {
				totalSpent: customer.total_spent || 0,
				totalVisits: customer.total_visits || 0,
				updatedAt: new Date(),
			},
			create: {
				studioId,
				userId: userResult.record.id,
				role: 'CUSTOMER',
				totalSpent: customer.total_spent || 0,
				totalVisits: customer.total_visits || 0,
				acquisitionSource: 'arketa',
			},
		});

		return NextResponse.json({
			success: true,
			customer: userResult.record,
			isNew: userResult.isNew,
		});
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error occurred';
		return NextResponse.json(
			{
				success: false,
				error: errorMessage,
			},
			{ status: 500 }
		);
	}
}

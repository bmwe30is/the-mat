// ============================================================================
// IMPORT API ROUTES
// ============================================================================

// pages/api/import/customers.ts
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import {
	validateApiKey,
	logger,
	upsertUser,
} from '../../../utils/importHelpers';

const prisma = new PrismaClient();

interface ArketaCustomer {
	id: string;
	email: string;
	first_name: string;
	last_name: string;
	phone?: string;
	date_of_birth?: string;
	created_at: string;
	member_since?: string;
	total_spent?: number;
	total_visits?: number;
}

export async function POST(request: NextRequest) {
	// Validate API key
	const authResult = await validateApiKey(request);
	if ('error' in authResult) {
		return NextResponse.json(
			{ error: authResult.error },
			{ status: authResult.status }
		);
	}

	try {
		const body = await request.json();
		const { customers, studioId } = body;

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
						: null,
				};

				// Upsert user
				const userResult = await upsertUser(userData, 'arketa');

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

				logger.log({
					operation: 'importCustomers',
					recordType: 'customer',
					externalId: customerData.id,
					status: 'success',
					message: userResult.isNew ? 'Customer created' : 'Customer updated',
				});
			} catch (error) {
				results.errors++;
				logger.log({
					operation: 'importCustomers',
					recordType: 'customer',
					externalId: customerData.id,
					status: 'error',
					message: `Failed to process customer: ${error.message}`,
					data: customerData,
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
		logger.log({
			operation: 'importCustomers',
			recordType: 'batch',
			status: 'error',
			message: `Batch import failed: ${error.message}`,
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
	const authResult = await validateApiKey(request);
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
				: null,
		};

		const userResult = await upsertUser(userData, 'arketa');

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
		return NextResponse.json(
			{
				success: false,
				error: error.message,
			},
			{ status: 500 }
		);
	}
}

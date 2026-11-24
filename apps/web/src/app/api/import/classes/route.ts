// ============================================================================
// app/api/import/classes/route.ts
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { validateStudioApiKey } from '@/middleware/apiAuth';
import { logger } from '@/utils/importLogger';
import { prisma } from '@/lib/prisma';
import { ClassStatus } from '@prisma/client';

interface ArketaClass {
	id: string;
	name: string;
	description?: string;
	instructor_id?: string;
	instructor_name?: string;
	instructor_email?: string;
	start_time: string;
	end_time: string;
	capacity: number;
	price: number;
	location_id?: string;
	location_name: string;
	class_type: string;
	status: string;
}

export async function POST(request: NextRequest) {
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
		const { classes }: { classes: ArketaClass[] } = body;

		if (!classes || !Array.isArray(classes)) {
			return NextResponse.json(
				{ error: 'classes array is required' },
				{ status: 400 }
			);
		}

		logger.clear();
		const results = {
			processed: 0,
			created: 0,
			updated: 0,
			errors: 0,
			warnings: 0,
		};

		for (const classData of classes) {
			try {
				results.processed++;

				// Find or create location
				let location = null;
				if (classData.location_id) {
					location = await prisma.location.findFirst({
						where: {
							studioId: studio.id,
							arketaLocationId: classData.location_id,
						},
					});
				}

				if (!location) {
					location = await prisma.location.findFirst({
						where: {
							studioId: studio.id,
							name: classData.location_name,
						},
					});
				}

				if (!location) {
					// Create location if it doesn't exist
					location = await prisma.location.create({
						data: {
							studioId: studio.id,
							name: classData.location_name,
							slug: classData.location_name.toLowerCase().replace(/\s+/g, '-'),
							arketaLocationId: classData.location_id,
							address: 'TBD', // Arketa might provide this in other endpoints
							city: 'TBD',
							state: 'TBD',
							zipCode: 'TBD',
						},
					});

					await logger.log({
						studioId: studio.id,
						source: 'arketa',
						operation: 'create',
						recordType: 'location',
						recordId: location.id,
						externalId: classData.location_id,
						status: 'WARNING',
						errorMessage: `Auto-created location: ${classData.location_name}`,
						importData: { name: classData.location_name },
					});
					results.warnings++;
				}

				// Find or create class type
				let classType = await prisma.classType.findFirst({
					where: {
						name: classData.class_type,
						brand: {
							studioId: studio.id,
						},
					},
				});

				if (!classType) {
					// Find or create default brand
					let defaultBrand = await prisma.brand.findFirst({
						where: { studioId: studio.id },
					});

					if (!defaultBrand) {
						defaultBrand = await prisma.brand.create({
							data: {
								studioId: studio.id,
								name: 'Main',
								slug: 'main',
							},
						});
					}

					classType = await prisma.classType.create({
						data: {
							brandId: defaultBrand.id,
							name: classData.class_type,
							slug: classData.class_type.toLowerCase().replace(/\s+/g, '-'),
							duration: Math.round(
								(new Date(classData.end_time).getTime() -
									new Date(classData.start_time).getTime()) /
									(1000 * 60)
							),
							defaultCapacity: classData.capacity,
						},
					});
				}

				// Find instructor if provided
				let instructor = null;
				if (classData.instructor_id) {
					const user = await prisma.user.findFirst({
						where: { arketaCustomerId: classData.instructor_id },
					});

					if (user) {
						instructor = await prisma.instructorProfile.findUnique({
							where: { userId: user.id },
						});
					}
				} else if (classData.instructor_email) {
					const user = await prisma.user.findUnique({
						where: { email: classData.instructor_email },
					});

					if (user) {
						instructor = await prisma.instructorProfile.findUnique({
							where: { userId: user.id },
						});
					}
				}

				// Check for existing class
				const existingClass = await prisma.class.findFirst({
					where: {
						arketaClassId: classData.id,
					},
				});

				// Helper function to safely convert status
				const getClassStatus = (status: string): ClassStatus => {
					const upperStatus = status?.toUpperCase();
					if (upperStatus === 'CANCELLED') return 'CANCELLED';
					if (upperStatus === 'COMPLETED') return 'COMPLETED';
					return 'SCHEDULED'; // Default to SCHEDULED
				};

				if (existingClass) {
					// Update existing class
					await prisma.class.update({
						where: { id: existingClass.id },
						data: {
							locationId: location.id,
							classTypeId: classType.id,
							instructorId: instructor?.id,
							startTime: new Date(classData.start_time),
							endTime: new Date(classData.end_time),
							capacity: classData.capacity,
							memberPrice: classData.price,
							dropInPrice: classData.price,
							status: getClassStatus(classData.status),
							updatedAt: new Date(),
						},
					});
					results.updated++;
				} else {
					// Create new class
					await prisma.class.create({
						data: {
							locationId: location.id,
							classTypeId: classType.id,
							instructorId: instructor?.id,
							arketaClassId: classData.id,
							startTime: new Date(classData.start_time),
							endTime: new Date(classData.end_time),
							capacity: classData.capacity,
							memberPrice: classData.price,
							dropInPrice: classData.price,
							status: getClassStatus(classData.status),
						},
					});
					results.created++;
				}

				// Convert ArketaClass to ImportData format
				const importData = {
					id: classData.id,
					name: classData.name,
					description: classData.description,
					instructor_id: classData.instructor_id,
					instructor_name: classData.instructor_name,
					instructor_email: classData.instructor_email,
					start_time: classData.start_time,
					end_time: classData.end_time,
					capacity: classData.capacity,
					price: classData.price,
					location_id: classData.location_id,
					location_name: classData.location_name,
					class_type: classData.class_type,
					status: classData.status,
				};

				await logger.log({
					studioId: studio.id,
					source: 'arketa',
					operation: existingClass ? 'update' : 'create',
					recordType: 'class',
					recordId: existingClass?.id,
					externalId: classData.id,
					status: 'SUCCESS',
					importData,
				});
			} catch (error) {
				results.errors++;
				const errorMessage =
					error instanceof Error ? error.message : 'Unknown error occurred';

				// Convert ArketaClass to ImportData format for error logging
				const importData = {
					id: classData.id,
					name: classData.name,
					description: classData.description,
					instructor_id: classData.instructor_id,
					instructor_name: classData.instructor_name,
					instructor_email: classData.instructor_email,
					start_time: classData.start_time,
					end_time: classData.end_time,
					capacity: classData.capacity,
					price: classData.price,
					location_id: classData.location_id,
					location_name: classData.location_name,
					class_type: classData.class_type,
					status: classData.status,
				};

				await logger.log({
					studioId: studio.id,
					source: 'arketa',
					operation: 'create',
					recordType: 'class',
					externalId: classData.id,
					status: 'ERROR',
					errorMessage: `Failed to process class: ${errorMessage}`,
					importData,
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
		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error occurred';
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

// ============================================================================
// pages/api/import/classes.ts
// ============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateStudioApiKey } from '@/middleware/apiAuth';
import { logger } from '@/utils/importLogger';
import { ClassStatus } from '@prisma/client';

// Type guard function for ClassStatus
function isValidClassStatus(status: string): status is ClassStatus {
	return ['SCHEDULED', 'CANCELLED', 'COMPLETED'].includes(status.toUpperCase());
}

// Helper function to safely convert status to ClassStatus
function getClassStatus(status: string): ClassStatus {
	const upperStatus = status?.toUpperCase();
	if (isValidClassStatus(upperStatus)) {
		return upperStatus as ClassStatus;
	}
	return 'SCHEDULED'; // Default fallback
}

export async function POST(request: NextRequest) {
	const authResult = await validateStudioApiKey(request);
	if ('error' in authResult) {
		return NextResponse.json(
			{ error: authResult.error },
			{ status: authResult.status }
		);
	}

	try {
		const body = await request.json();
		const { classes, studioId } = body;

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
		};

		for (const classData of classes) {
			try {
				results.processed++;

				// Find or create location
				const location = await prisma.location.findFirst({
					where: {
						studioId,
						name: classData.location_name,
					},
				});

				if (!location) {
					logger.log({
						studioId,
						source: 'arketa-import',
						operation: 'importClasses',
						recordType: 'class',
						externalId: classData.id,
						status: 'ERROR',
						errorMessage: `Location not found: ${classData.location_name}`,
					});
					results.errors++;
					continue;
				}

				// Find or create class type
				let classType = await prisma.classType.findFirst({
					where: {
						name: classData.class_type,
						brand: {
							studioId,
						},
					},
				});

				if (!classType) {
					// Create a default brand if none exists
					let defaultBrand = await prisma.brand.findFirst({
						where: { studioId },
					});

					if (!defaultBrand) {
						defaultBrand = await prisma.brand.create({
							data: {
								studioId,
								name: 'Default',
								slug: 'default',
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
						},
					});
				}

				// Find instructor if provided
				let instructor = null;
				if (classData.instructor_email) {
					const user = await prisma.user.findUnique({
						where: { email: classData.instructor_email },
					});

					if (user) {
						instructor = await prisma.instructorProfile.findUnique({
							where: { userId: user.id },
						});
					}
				}

				// Create or update class
				const existingClass = await prisma.class.findFirst({
					where: {
						locationId: location.id,
						classTypeId: classType.id,
						startTime: new Date(classData.start_time),
					},
				});

				if (existingClass) {
					await prisma.class.update({
						where: { id: existingClass.id },
						data: {
							endTime: new Date(classData.end_time),
							capacity: classData.capacity,
							memberPrice: classData.price,
							dropInPrice: classData.price,
							status: getClassStatus(classData.status),
							instructorId: instructor?.id,
							updatedAt: new Date(),
						},
					});
					results.updated++;
				} else {
					await prisma.class.create({
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
						},
					});
					results.created++;
				}

				logger.log({
					studioId,
					source: 'arketa-import',
					operation: 'importClasses',
					recordType: 'class',
					externalId: classData.id,
					status: 'SUCCESS',
					errorMessage: existingClass ? 'Class updated' : 'Class created',
				});
			} catch (error) {
				results.errors++;
				const errorMessage =
					error instanceof Error ? error.message : 'Unknown error occurred';
				logger.log({
					studioId,
					source: 'arketa-import',
					operation: 'importClasses',
					recordType: 'class',
					externalId: classData.id,
					status: 'ERROR',
					errorMessage: `Failed to process class: ${errorMessage}`,
					importData: classData,
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

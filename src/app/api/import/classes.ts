// ============================================================================
// pages/api/import/classes.ts
// ============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateStudioApiKey } from '@/middleware/apiAuth';
import { logger } from '@/utils/importLogger';

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
						operation: 'importClasses',
						recordType: 'class',
						externalId: classData.id,
						status: 'error',
						message: `Location not found: ${classData.location_name}`,
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
					const updatedClass = await prisma.class.update({
						where: { id: existingClass.id },
						data: {
							endTime: new Date(classData.end_time),
							capacity: classData.capacity,
							memberPrice: classData.price,
							dropInPrice: classData.price,
							status: classData.status.toUpperCase() as any,
							instructorId: instructor?.id,
							updatedAt: new Date(),
						},
					});
					results.updated++;
				} else {
					const newClass = await prisma.class.create({
						data: {
							locationId: location.id,
							classTypeId: classType.id,
							instructorId: instructor?.id,
							startTime: new Date(classData.start_time),
							endTime: new Date(classData.end_time),
							capacity: classData.capacity,
							memberPrice: classData.price,
							dropInPrice: classData.price,
							status: (classData.status?.toUpperCase() || 'SCHEDULED') as any,
						},
					});
					results.created++;
				}

				logger.log({
					operation: 'importClasses',
					recordType: 'class',
					externalId: classData.id,
					status: 'success',
					message: existingClass ? 'Class updated' : 'Class created',
				});
			} catch (error) {
				results.errors++;
				logger.log({
					operation: 'importClasses',
					recordType: 'class',
					externalId: classData.id,
					status: 'error',
					message: `Failed to process class: ${error.message}`,
					data: classData,
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

// utils/upsertHelpers.ts - Updated for Arketa integration
export interface UpsertResult<T> {
	record: T;
	isNew: boolean;
	changes?: string[];
}

export async function upsertUser(
	userData: any,
	studioId: string,
	source: string = 'arketa'
): Promise<UpsertResult<any>> {
	const {
		arketaCustomerId,
		email,
		firstName,
		lastName,
		phone,
		dateOfBirth,
		...rest
	} = userData;

	try {
		// First try to find by Arketa customer ID
		let existingUser = null;
		if (arketaCustomerId) {
			existingUser = await prisma.user.findFirst({
				where: { arketaCustomerId },
			});
		}

		// Fallback to email if no Arketa ID match
		if (!existingUser && email) {
			existingUser = await prisma.user.findUnique({
				where: { email },
			});
		}

		const changes: string[] = [];

		if (existingUser) {
			// Track changes for audit
			if (existingUser.firstName !== firstName) changes.push('firstName');
			if (existingUser.lastName !== lastName) changes.push('lastName');
			if (existingUser.phone !== phone) changes.push('phone');

			// Update existing user
			const updatedUser = await prisma.user.update({
				where: { id: existingUser.id },
				data: {
					firstName: firstName || existingUser.firstName,
					lastName: lastName || existingUser.lastName,
					phone: phone || existingUser.phone,
					dateOfBirth: dateOfBirth
						? new Date(dateOfBirth)
						: existingUser.dateOfBirth,
					arketaCustomerId: arketaCustomerId || existingUser.arketaCustomerId,
					updatedAt: new Date(),
				},
			});

			// Ensure studio relationship exists
			await prisma.studioUser.upsert({
				where: {
					studioId_userId: {
						studioId,
						userId: existingUser.id,
					},
				},
				update: {
					acquisitionSource: source,
					updatedAt: new Date(),
				},
				create: {
					studioId,
					userId: existingUser.id,
					role: 'CUSTOMER',
					acquisitionSource: source,
				},
			});

			return {
				record: updatedUser,
				isNew: false,
				changes,
			};
		} else {
			// Create new user
			const newUser = await prisma.user.create({
				data: {
					email,
					firstName,
					lastName,
					phone,
					dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
					arketaCustomerId,
					...rest,
				},
			});

			// Create studio relationship
			await prisma.studioUser.create({
				data: {
					studioId,
					userId: newUser.id,
					role: 'CUSTOMER',
					acquisitionSource: source,
				},
			});

			return {
				record: newUser,
				isNew: true,
			};
		}
	} catch (error) {
		await logger.log({
			studioId,
			source,
			operation: 'upsert',
			recordType: 'user',
			externalId: arketaCustomerId,
			status: 'ERROR',
			errorMessage: `Failed to upsert user: ${error.message}`,
			importData: userData,
		});
		throw error;
	}
}

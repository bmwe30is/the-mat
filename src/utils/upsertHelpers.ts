// utils/upsertHelpers.ts - Updated for Arketa integration
import { prisma } from '@/lib/prisma';
import { UserData, UserRecord } from '@/types';
import { User } from '@prisma/client';

export interface UpsertResult<T> {
	record: T;
	isNew: boolean;
	changes?: string[];
}

// Helper function to transform Prisma user record to UserRecord interface
// Converts null values to undefined to match TypeScript conventions
function transformPrismaUserToUserRecord(prismaUser: User): UserRecord {
	return {
		id: prismaUser.id,
		email: prismaUser.email,
		firstName: prismaUser.firstName,
		lastName: prismaUser.lastName,
		phone: prismaUser.phone ?? undefined,
		dateOfBirth: prismaUser.dateOfBirth ?? undefined,
		arketaCustomerId: prismaUser.arketaCustomerId ?? undefined,
		createdAt: prismaUser.createdAt,
		updatedAt: prismaUser.updatedAt,
	};
}

export async function upsertUser(
	userData: UserData
	// studioId: string,
	// source: string = 'arketa'
): Promise<UpsertResult<UserRecord>> {
	const {
		arketaCustomerId,
		email,
		firstName,
		lastName,
		phone,
		dateOfBirth,
		// ...rest
	} = userData;

	try {
		// First try to find by Arketa customer ID
		let existingUser = null;
		if (arketaCustomerId) {
			existingUser = await prisma.user.findFirst({
				where: { arketaCustomerId },
			});
		}

		// If not found by Arketa ID, try by email
		if (!existingUser) {
			existingUser = await prisma.user.findUnique({
				where: { email },
			});
		}

		const changes: string[] = [];
		let isNew = false;

		if (existingUser) {
			// Update existing user
			const updateData: Partial<UserRecord> = {};

			if (firstName !== existingUser.firstName) {
				updateData.firstName = firstName;
				changes.push(`firstName: ${existingUser.firstName} → ${firstName}`);
			}

			if (lastName !== existingUser.lastName) {
				updateData.lastName = lastName;
				changes.push(`lastName: ${existingUser.lastName} → ${lastName}`);
			}

			if (phone && phone !== existingUser.phone) {
				updateData.phone = phone;
				changes.push(`phone: ${existingUser.phone} → ${phone}`);
			}

			if (dateOfBirth) {
				const dobDate =
					typeof dateOfBirth === 'string' ? new Date(dateOfBirth) : dateOfBirth;
				if (dobDate.getTime() !== existingUser.dateOfBirth?.getTime()) {
					updateData.dateOfBirth = dobDate;
					changes.push(`dateOfBirth: ${existingUser.dateOfBirth} → ${dobDate}`);
				}
			}

			if (
				arketaCustomerId &&
				arketaCustomerId !== existingUser.arketaCustomerId
			) {
				updateData.arketaCustomerId = arketaCustomerId;
				changes.push(
					`arketaCustomerId: ${existingUser.arketaCustomerId} → ${arketaCustomerId}`
				);
			}

			// Only update if there are changes
			if (Object.keys(updateData).length > 0) {
				updateData.updatedAt = new Date();
				const updatedUser = await prisma.user.update({
					where: { id: existingUser.id },
					data: updateData,
				});
				return {
					record: transformPrismaUserToUserRecord(updatedUser),
					isNew: false,
					changes,
				};
			}

			return {
				record: transformPrismaUserToUserRecord(existingUser),
				isNew: false,
				changes: [],
			};
		} else {
			// Create new user
			const newUser = await prisma.user.create({
				data: {
					email,
					firstName,
					lastName,
					phone,
					dateOfBirth: dateOfBirth
						? typeof dateOfBirth === 'string'
							? new Date(dateOfBirth)
							: dateOfBirth
						: undefined,
					arketaCustomerId,
				},
			});
			isNew = true;
			changes.push('User created');
			return {
				record: transformPrismaUserToUserRecord(newUser),
				isNew,
				changes,
			};
		}
	} catch (error) {
		console.error('Error upserting user:', error);
		throw new Error(
			`Failed to upsert user: ${error instanceof Error ? error.message : 'Unknown error'}`
		);
	}
}

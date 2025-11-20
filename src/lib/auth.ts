import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
	return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify a password against its hash
 */
export async function verifyPassword(
	password: string,
	hash: string
): Promise<boolean> {
	return bcrypt.compare(password, hash);
}

/**
 * Generate a JWT token (placeholder for future implementation)
 */
export function generateToken(userId: string): string {
	// TODO: Implement JWT token generation
	// For now, return a placeholder
	return `token_${userId}_${Date.now()}`;
}

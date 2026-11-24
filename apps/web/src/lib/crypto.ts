import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits

/**
 * Get encryption key from environment or generate one
 */
function getEncryptionKey(): Buffer {
	const keyString = process.env.STRIPE_REFRESH_TOKEN_ENCRYPTION_KEY;

	if (!keyString) {
		throw new Error(
			'STRIPE_REFRESH_TOKEN_ENCRYPTION_KEY environment variable is required'
		);
	}

	// If key is hex string, convert to buffer
	if (keyString.length === 64) {
		return Buffer.from(keyString, 'hex');
	}

	// Otherwise, derive key from string using PBKDF2
	return crypto.pbkdf2Sync(keyString, 'salt', 100000, KEY_LENGTH, 'sha256');
}

/**
 * Encrypt sensitive data
 */
export function encrypt(text: string): string {
	try {
		const key = getEncryptionKey();
		const iv = crypto.randomBytes(IV_LENGTH);

		// Use createCipherGCM instead of createCipher

		const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

		// Set AAD before encryption
		cipher.setAAD(Buffer.from('stripe-refresh-token'));

		let encrypted = cipher.update(text, 'utf8', 'hex');
		encrypted += cipher.final('hex');

		const tag = cipher.getAuthTag();

		// Combine IV + tag + encrypted data
		return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;
	} catch (error) {
		console.error('Encryption failed:', error);
		throw new Error('Failed to encrypt data');
	}
}

/**
 * Decrypt sensitive data
 */
export function decrypt(encryptedText: string): string {
	try {
		const key = getEncryptionKey();
		const parts = encryptedText.split(':');

		if (parts.length !== 3) {
			throw new Error('Invalid encrypted data format');
		}

		const iv = Buffer.from(parts[0], 'hex');
		const tag = Buffer.from(parts[1], 'hex');
		const encrypted = parts[2];

		const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

		// Set AAD before decryption
		decipher.setAAD(Buffer.from('stripe-refresh-token'));
		decipher.setAuthTag(tag);

		let decrypted = decipher.update(encrypted, 'hex', 'utf8');
		decrypted += decipher.final('utf8');

		return decrypted;
	} catch (error) {
		console.error('Decryption failed:', error);
		throw new Error('Failed to decrypt data');
	}
}

/**
 * Generate a new encryption key (for initial setup)
 */
export function generateEncryptionKey(): string {
	return crypto.randomBytes(KEY_LENGTH).toString('hex');
}

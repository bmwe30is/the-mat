// test-crypto.ts - Test script for encryption functions
const crypto = require('crypto');

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
function encrypt(text: string): string {
	try {
		const key = getEncryptionKey();
		const iv = crypto.randomBytes(IV_LENGTH);

		// Use createCipheriv instead of createCipherGCM
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
function decrypt(encryptedText: string): string {
	try {
		const key = getEncryptionKey();
		const parts = encryptedText.split(':');

		if (parts.length !== 3) {
			throw new Error('Invalid encrypted data format');
		}

		const iv = Buffer.from(parts[0], 'hex');
		const tag = Buffer.from(parts[1], 'hex');
		const encrypted = parts[2];

		// Use createDecipheriv instead of createDecipherGCM
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

// Test the encryption functions
console.log('🔐 Testing Encryption Functions...\n');

// Generate a test encryption key if not set
if (!process.env.STRIPE_REFRESH_TOKEN_ENCRYPTION_KEY) {
	const testKey = crypto.randomBytes(32).toString('hex');
	console.log('Generated test encryption key:', testKey);
	process.env.STRIPE_REFRESH_TOKEN_ENCRYPTION_KEY = testKey;
}

try {
	// Test with a sample Stripe refresh token
	const testToken = 'rt_test_1234567890abcdef';
	console.log('Original token:', testToken);

	// Encrypt
	const encrypted = encrypt(testToken);
	console.log('Encrypted:', encrypted);

	// Decrypt
	const decrypted = decrypt(encrypted);
	console.log('Decrypted:', decrypted);

	// Verify
	const isMatch = testToken === decrypted;
	console.log('✅ Match:', isMatch);

	if (isMatch) {
		console.log('\n🎉 Encryption/Decryption test PASSED!');
	} else {
		console.log('\n❌ Encryption/Decryption test FAILED!');
	}

	// Test with different token
	console.log('\n--- Testing with different token ---');
	const testToken2 = 'rt_live_abcdef1234567890';
	const encrypted2 = encrypt(testToken2);
	const decrypted2 = decrypt(encrypted2);
	console.log('Original:', testToken2);
	console.log('Encrypted:', encrypted2);
	console.log('Decrypted:', decrypted2);
	console.log('✅ Match:', testToken2 === decrypted2);
} catch (error) {
	console.error(
		'❌ Test failed:',
		error instanceof Error ? error.message : 'Unknown error'
	);
	process.exit(1);
}

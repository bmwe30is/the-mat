/**
 * Generate a URL-friendly slug from a string
 */
export function generateSlug(name: string): string {
	if (!name || typeof name !== 'string') {
		return '';
	}

	return name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/**
 * Generate a unique slug by checking against existing slugs and appending a number if needed
 */
export async function generateUniqueSlug(
	baseName: string,
	checkExists: (slug: string) => Promise<boolean>
): Promise<string> {
	const baseSlug = generateSlug(baseName);

	if (!baseSlug) {
		throw new Error('Invalid studio name: cannot generate a valid slug');
	}

	let slug = baseSlug;
	let counter = 1;

	// Check if slug exists, if so append a number
	while (await checkExists(slug)) {
		slug = `${baseSlug}-${counter}`;
		counter++;

		// Safety check to prevent infinite loops
		if (counter > 1000) {
			throw new Error('Unable to generate a unique slug');
		}
	}

	return slug;
}

// scripts/setup-test-studio.ts
// Run with: npx tsx scripts/setup-test-studio.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function setupTestStudio() {
	try {
		console.log('🏗️  Setting up test studio...');

		// Create test studio
		const studio = await prisma.studio.upsert({
			where: { slug: 'test-fitness' },
			update: {},
			create: {
				id: 'studio_test_123',
				name: 'Test Fitness Studio',
				slug: 'test-fitness',
				email: 'test@studio.com',
				phone: '+1-555-STUDIO',
				description: 'A test fitness studio for API testing',
				timezone: 'America/Los_Angeles',
				apiKey: 'test_api_key_12345',
			},
		});
		console.log('✅ Studio created:', studio.name);

		// Create default brand
		const brand = await prisma.brand.upsert({
			where: {
				studioId_slug: {
					studioId: studio.id,
					slug: 'main',
				},
			},
			update: {},
			create: {
				id: 'brand_test_123',
				studioId: studio.id,
				name: 'Main',
				slug: 'main',
				description: 'Main brand for test studio',
			},
		});
		console.log('✅ Brand created:', brand.name);

		// Create test locations
		const locations = await Promise.all([
			prisma.location.upsert({
				where: {
					studioId_slug: {
						studioId: studio.id,
						slug: 'downtown',
					},
				},
				update: {},
				create: {
					id: 'location_test_123',
					studioId: studio.id,
					brandId: brand.id,
					name: 'Downtown Studio',
					slug: 'downtown',
					address: '123 Main Street',
					city: 'Los Angeles',
					state: 'CA',
					zipCode: '90210',
					phone: '+1-555-DOWNTOWN',
					latitude: 34.0522,
					longitude: -118.2437,
				},
			}),
			prisma.location.upsert({
				where: {
					studioId_slug: {
						studioId: studio.id,
						slug: 'westside',
					},
				},
				update: {},
				create: {
					id: 'location_test_456',
					studioId: studio.id,
					brandId: brand.id,
					name: 'Westside Studio',
					slug: 'westside',
					address: '456 Ocean Blvd',
					city: 'Santa Monica',
					state: 'CA',
					zipCode: '90401',
					phone: '+1-555-WESTSIDE',
					latitude: 34.0195,
					longitude: -118.4912,
				},
			}),
		]);
		console.log(
			'✅ Locations created:',
			locations.map((l) => l.name).join(', ')
		);

		// Create class types
		const classTypes = await Promise.all([
			prisma.classType.upsert({
				where: {
					brandId_slug: {
						brandId: brand.id,
						slug: 'yoga',
					},
				},
				update: {},
				create: {
					brandId: brand.id,
					name: 'Yoga',
					slug: 'yoga',
					description: 'Vinyasa and flow yoga classes',
					duration: 60,
					difficulty: 'All Levels',
					category: 'Yoga',
					defaultCapacity: 20,
					color: '#8B5CF6',
				},
			}),
			prisma.classType.upsert({
				where: {
					brandId_slug: {
						brandId: brand.id,
						slug: 'hiit',
					},
				},
				update: {},
				create: {
					brandId: brand.id,
					name: 'HIIT',
					slug: 'hiit',
					description: 'High-intensity interval training',
					duration: 45,
					difficulty: 'Intermediate',
					category: 'Cardio',
					defaultCapacity: 15,
					color: '#EF4444',
				},
			}),
			prisma.classType.upsert({
				where: {
					brandId_slug: {
						brandId: brand.id,
						slug: 'pilates',
					},
				},
				update: {},
				create: {
					brandId: brand.id,
					name: 'Pilates',
					slug: 'pilates',
					description: 'Core-focused pilates classes',
					duration: 50,
					difficulty: 'Beginner',
					category: 'Strength',
					defaultCapacity: 12,
					color: '#10B981',
				},
			}),
		]);
		console.log(
			'✅ Class types created:',
			classTypes.map((ct) => ct.name).join(', ')
		);

		// Create test instructor
		const instructorUser = await prisma.user.upsert({
			where: { email: 'sarah@teststudio.com' },
			update: {},
			create: {
				email: 'sarah@teststudio.com',
				firstName: 'Sarah',
				lastName: 'Chen',
				phone: '+1-555-INSTRUCTOR',
			},
		});

		const instructorProfile = await prisma.instructorProfile.upsert({
			where: { userId: instructorUser.id },
			update: {},
			create: {
				userId: instructorUser.id,
				bio: 'Certified yoga instructor with 5+ years experience',
				specialties: ['Vinyasa', 'Yin Yoga', 'Meditation'],
				experience: 5,
				defaultRate: 75.0,
				rateType: 'PER_CLASS',
			},
		});

		// Create studio user relationship for instructor
		await prisma.studioUser.upsert({
			where: {
				studioId_userId: {
					studioId: studio.id,
					userId: instructorUser.id,
				},
			},
			update: {},
			create: {
				studioId: studio.id,
				userId: instructorUser.id,
				role: 'INSTRUCTOR',
				acquisitionSource: 'direct',
			},
		});
		console.log(
			'✅ Test instructor created:',
			`${instructorUser.firstName} ${instructorUser.lastName}`
		);

		// Create some sample classes
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		tomorrow.setHours(9, 0, 0, 0);

		const sampleClasses = [];
		for (let i = 0; i < 3; i++) {
			const classStart = new Date(tomorrow);
			classStart.setHours(9 + i * 2, 0, 0, 0);
			const classEnd = new Date(classStart);
			classEnd.setHours(classStart.getHours() + 1, 0, 0, 0);

			const classType = classTypes[i % classTypes.length];
			const location = locations[i % locations.length];

			sampleClasses.push(
				prisma.class.create({
					data: {
						locationId: location.id,
						classTypeId: classType.id,
						instructorId: instructorProfile.id,
						startTime: classStart,
						endTime: classEnd,
						capacity: classType.defaultCapacity,
						memberPrice: 25.0,
						dropInPrice: 30.0,
						status: 'SCHEDULED',
					},
				})
			);
		}

		await Promise.all(sampleClasses);
		console.log('✅ Sample classes created for tomorrow');

		// Create some pricing rules
		await prisma.pricingRule.upsert({
			where: {
				id: 'pricing_test_123',
			},
			update: {},
			create: {
				id: 'pricing_test_123',
				studioId: studio.id,
				name: 'Peak Hours Pricing',
				dayOfWeek: [1, 2, 3, 4, 5], // Monday-Friday
				timeStart: '17:00',
				timeEnd: '20:00',
				memberPrice: 28.0,
				dropInPrice: 35.0,
				priority: 10,
			},
		});
		console.log('✅ Pricing rules created');

		console.log('\n🎉 Test studio setup complete!');
		console.log('\n📋 Test Details:');
		console.log(`Studio Name: ${studio.name}`);
		console.log(`Studio Slug: ${studio.slug}`);
		console.log(`API Key: ${studio.apiKey}`);
		console.log(`Locations: ${locations.length}`);
		console.log(`Class Types: ${classTypes.length}`);
		console.log(`Sample Classes: 3`);

		console.log('\n🧪 Ready for testing! Use these values:');
		console.log(`- API Key: test_api_key_12345`);
		console.log(`- Studio Slug: test-fitness`);
		console.log(`- Test User Email: sarah@teststudio.com`);
	} catch (error) {
		console.error('❌ Error setting up test studio:', error);
	} finally {
		await prisma.$disconnect();
	}
}

setupTestStudio();

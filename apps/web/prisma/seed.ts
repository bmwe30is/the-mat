// import { PrismaClient } from '@prisma/client';

// const prisma = new PrismaClient();

// async function main() {
// 	console.log('🌱 Seeding database...');

// 	// Create sample users
// 	const user1 = await prisma.user.upsert({
// 		where: { email: 'alice@example.com' },
// 		update: {},
// 		create: {
// 			email: 'alice@example.com',
// 			name: 'Alice Johnson',
// 		},
// 	});

// 	const user2 = await prisma.user.upsert({
// 		where: { email: 'bob@example.com' },
// 		update: {},
// 		create: {
// 			email: 'bob@example.com',
// 			name: 'Bob Smith',
// 		},
// 	});

// 	// Create sample posts
// 	await prisma.post.upsert({
// 		where: { id: 'post-1' },
// 		update: {},
// 		create: {
// 			id: 'post-1',
// 			title: 'Welcome to The Mat!',
// 			content: 'This is our first blog post. Welcome to our community!',
// 			published: true,
// 			authorId: user1.id,
// 		},
// 	});

// 	await prisma.post.upsert({
// 		where: { id: 'post-2' },
// 		update: {},
// 		create: {
// 			id: 'post-2',
// 			title: 'Getting Started with Next.js',
// 			content: 'Learn how to build amazing web applications with Next.js.',
// 			published: true,
// 			authorId: user2.id,
// 		},
// 	});

// 	console.log('✅ Database seeded successfully!');
// }

// main()
// 	.catch((e) => {
// 		console.error('❌ Error seeding database:', e);
// 		process.exit(1);
// 	})
// 	.finally(async () => {
// 		await prisma.$disconnect();
// 	});

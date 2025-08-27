import Link from 'next/link';

export default function Home() {
	return (
		<main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
			<div className="container mx-auto px-4 py-16">
				<div className="text-center">
					<h1 className="text-5xl font-bold text-gray-900 mb-6">
						Welcome to <span className="text-indigo-600">The Mat</span>
					</h1>
					<p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
						A full-stack application built with Next.js, Prisma ORM, and
						Supabase. This project demonstrates modern web development practices
						with TypeScript and TailwindCSS.
					</p>

					<div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
						<Link
							href="/api/users"
							className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
						>
							View API Endpoint
						</Link>
						<a
							href="https://github.com/your-username/the-mat"
							target="_blank"
							rel="noopener noreferrer"
							className="bg-gray-800 hover:bg-gray-900 text-white px-6 py-3 rounded-lg font-medium transition-colors"
						>
							View Source Code
						</a>
					</div>

					<div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
						<div className="bg-white p-6 rounded-lg shadow-md">
							<div className="text-3xl mb-4">⚡</div>
							<h3 className="text-lg font-semibold mb-2">Next.js 14</h3>
							<p className="text-gray-600">
								Built with the latest Next.js features including App Router and
								Server Components.
							</p>
						</div>

						<div className="bg-white p-6 rounded-lg shadow-md">
							<div className="text-3xl mb-4">🗄️</div>
							<h3 className="text-lg font-semibold mb-2">Prisma ORM</h3>
							<p className="text-gray-600">
								Type-safe database access with PostgreSQL and automatic
								migrations.
							</p>
						</div>

						<div className="bg-white p-6 rounded-lg shadow-md">
							<div className="text-3xl mb-4">🔐</div>
							<h3 className="text-lg font-semibold mb-2">Supabase</h3>
							<p className="text-gray-600">
								Authentication, real-time features, and managed PostgreSQL
								database.
							</p>
						</div>
					</div>

					<div className="mt-12 p-6 bg-white rounded-lg shadow-md max-w-2xl mx-auto">
						<h2 className="text-2xl font-semibold mb-4">Getting Started</h2>
						<div className="text-left space-y-2 text-sm">
							<p>
								1. Update your{' '}
								<code className="bg-gray-100 px-2 py-1 rounded">.env</code> file
								with Supabase credentials
							</p>
							<p>
								2. Run{' '}
								<code className="bg-gray-100 px-2 py-1 rounded">
									npm run db:migrate
								</code>{' '}
								to set up the database
							</p>
							<p>
								3. Run{' '}
								<code className="bg-gray-100 px-2 py-1 rounded">
									npm run db:seed
								</code>{' '}
								to add sample data
							</p>
							<p>
								4. Start development with{' '}
								<code className="bg-gray-100 px-2 py-1 rounded">
									npm run dev
								</code>
							</p>
						</div>
					</div>
				</div>
			</div>
		</main>
	);
}

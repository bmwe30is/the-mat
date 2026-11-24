// 2. STUDIO ONBOARDING - WHERE THE STUDIO ID IS CREATED
// app/onboarding/studio/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

type User = {
	id: string;
	email: string;
	firstName: string;
	lastName: string;
};

export default function StudioOnboardingPage() {
	const [user, setUser] = useState<User | null>(null);
	const [formData, setFormData] = useState({
		studioName: '',
		email: '',
		phone: '',
		timezone: 'America/Los_Angeles',
		address: '',
		city: '',
		state: '',
		zipCode: '',
	});
	const [isLoading, setIsLoading] = useState(false);
	const router = useRouter();

	useEffect(() => {
		const getUser = async () => {
			try {
				// Get user from session cookie (secure approach)
				const response = await fetch('/api/auth/me');
				const data = await response.json();

				if (response.ok) {
					setUser(data.user);
				} else {
					// Redirect to signup if user not found or unauthorized
					if (response.status === 401 || response.status === 404) {
						router.push('/auth/signup');
					}
				}
			} catch (error) {
				console.error('Error getting user:', error);
				router.push('/auth/signup');
			}
		};
		getUser();
	}, [router]);

	const handleCreateStudio = async (e: React.FormEvent) => {
		e.preventDefault();
		setIsLoading(true);

		try {
			if (!user) {
				alert('User not found. Please sign up first.');
				router.push('/auth/signup');
				return;
			}

			// 🎯 THIS IS WHERE THE STUDIO ID IS CREATED!
			const studioData = {
				name: formData.studioName,
				email: formData.email,
				phone: formData.phone,
				timezone: formData.timezone,
				address: formData.address,
				city: formData.city,
				state: formData.state,
				zipCode: formData.zipCode,
			};

			// Create studio using our Prisma API
			const response = await fetch('/api/studio', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(studioData),
			});

			const data = await response.json();

			if (!response.ok) {
				throw new Error(data.error || 'Failed to create studio');
			}

			// 🚀 Redirect to integrations with the new Studio ID
			router.push(`/dashboard/${data.studio.id}/integrations`);
		} catch (error) {
			console.error('Studio creation error:', error);
			alert(
				error instanceof Error
					? error.message
					: 'Failed to create studio. Please try again.'
			);
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="min-h-screen bg-gray-50 py-12 px-4">
			<div className="max-w-md mx-auto">
				<h1 className="text-3xl font-bold text-center text-gray-900 mb-8">
					Create Your Studio
				</h1>

				<form onSubmit={handleCreateStudio} className="space-y-6">
					<div>
						<label className="block text-sm font-medium text-gray-700">
							Studio Name *
						</label>
						<input
							type="text"
							required
							value={formData.studioName}
							onChange={(e) =>
								setFormData((prev) => ({ ...prev, studioName: e.target.value }))
							}
							className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
							placeholder="Your Studio Name"
						/>
					</div>

					<div>
						<label className="block text-sm font-medium text-gray-700">
							Studio Email *
						</label>
						<input
							type="email"
							required
							value={formData.email}
							onChange={(e) =>
								setFormData((prev) => ({ ...prev, email: e.target.value }))
							}
							className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
							placeholder="studio@example.com"
						/>
					</div>

					<div>
						<label className="block text-sm font-medium text-gray-700">
							Phone Number
						</label>
						<input
							type="tel"
							value={formData.phone}
							onChange={(e) =>
								setFormData((prev) => ({ ...prev, phone: e.target.value }))
							}
							className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
							placeholder="+1 (555) 123-4567"
						/>
					</div>

					<div>
						<label className="block text-sm font-medium text-gray-700">
							Address
						</label>
						<input
							type="text"
							value={formData.address}
							onChange={(e) =>
								setFormData((prev) => ({ ...prev, address: e.target.value }))
							}
							className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
							placeholder="123 Main Street"
						/>
					</div>

					<div className="grid grid-cols-3 gap-4">
						<div className="col-span-2">
							<label className="block text-sm font-medium text-gray-700">
								City
							</label>
							<input
								type="text"
								value={formData.city}
								onChange={(e) =>
									setFormData((prev) => ({ ...prev, city: e.target.value }))
								}
								className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
							/>
						</div>
						<div>
							<label className="block text-sm font-medium text-gray-700">
								State
							</label>
							<input
								type="text"
								value={formData.state}
								onChange={(e) =>
									setFormData((prev) => ({ ...prev, state: e.target.value }))
								}
								className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
								placeholder="CA"
							/>
						</div>
					</div>

					<div>
						<label className="block text-sm font-medium text-gray-700">
							ZIP Code
						</label>
						<input
							type="text"
							value={formData.zipCode}
							onChange={(e) =>
								setFormData((prev) => ({ ...prev, zipCode: e.target.value }))
							}
							className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
							placeholder="90210"
						/>
					</div>

					<div>
						<label className="block text-sm font-medium text-gray-700">
							Timezone *
						</label>
						<select
							value={formData.timezone}
							onChange={(e) =>
								setFormData((prev) => ({ ...prev, timezone: e.target.value }))
							}
							className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
						>
							<option value="America/Los_Angeles">Pacific Time (PT)</option>
							<option value="America/Denver">Mountain Time (MT)</option>
							<option value="America/Chicago">Central Time (CT)</option>
							<option value="America/New_York">Eastern Time (ET)</option>
						</select>
					</div>

					<button
						type="submit"
						disabled={isLoading}
						className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
					>
						{isLoading ? 'Creating Studio...' : 'Create Studio & Continue'}
					</button>
				</form>
			</div>
		</div>
	);
}

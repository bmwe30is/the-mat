// app/onboarding/page.tsx - Studio onboarding flow
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { generateSlug } from '@/utils/slug';

interface FormErrors {
	studioName?: string;
	email?: string;
	general?: string;
}

export default function OnboardingPage() {
	const [formData, setFormData] = useState({
		studioName: '',
		email: '',
		timezone: 'America/Los_Angeles',
	});
	const [isLoading, setIsLoading] = useState(false);
	const [errors, setErrors] = useState<FormErrors>({});
	const router = useRouter();

	const validateForm = (): boolean => {
		const newErrors: FormErrors = {};

		// Validate studio name
		if (!formData.studioName.trim()) {
			newErrors.studioName = 'Studio name is required';
		} else {
			const slug = generateSlug(formData.studioName);
			if (!slug) {
				newErrors.studioName =
					'Studio name must contain at least one letter or number';
			}
		}

		// Validate email
		if (!formData.email.trim()) {
			newErrors.email = 'Email address is required';
		} else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
			newErrors.email = 'Please enter a valid email address';
		}

		setErrors(newErrors);
		return Object.keys(newErrors).length === 0;
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setErrors({});

		// Client-side validation
		if (!validateForm()) {
			return;
		}

		setIsLoading(true);

		try {
			// Get current user from auth API (uses session from cookies)
			const userResponse = await fetch('/api/auth/me');

			if (!userResponse.ok) {
				const errorData = await userResponse.json();
				setErrors({
					general:
						errorData.error ||
						'You must be signed in to create a studio. Please sign in and try again.',
				});
				setIsLoading(false);
				return;
			}

			const { user } = await userResponse.json();

			if (!user || !user.email) {
				setErrors({
					general:
						'Unable to get user information. Please sign in and try again.',
				});
				setIsLoading(false);
				return;
			}

			// Call API route to create studio
			const response = await fetch('/api/studio', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					name: formData.studioName,
					email: formData.email,
					timezone: formData.timezone,
				}),
			});

			const data = await response.json();

			if (!response.ok) {
				// Handle API errors with field-specific messages
				if (data.field) {
					setErrors({
						[data.field]: data.error || 'An error occurred',
					});
				} else {
					setErrors({
						general: data.error || 'Failed to create studio. Please try again.',
					});
				}
				return;
			}

			// Redirect to integrations setup
			router.push(`/dashboard/${data.studio.id}/integrations`);
		} catch (error) {
			console.error('Onboarding error:', error);
			setErrors({
				general: 'An unexpected error occurred. Please try again.',
			});
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
			<div className="max-w-md w-full space-y-8">
				<div>
					<h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
						Set up your studio
					</h2>
					<p className="mt-2 text-center text-sm text-gray-600">
						Let&apos;s get your analytics platform configured
					</p>
				</div>

				<form className="mt-8 space-y-6" onSubmit={handleSubmit}>
					{errors.general && (
						<div className="rounded-md bg-red-50 p-4">
							<div className="flex">
								<div className="ml-3">
									<p className="text-sm font-medium text-red-800">
										{errors.general}
									</p>
								</div>
							</div>
						</div>
					)}

					<div className="space-y-4">
						<div>
							<label
								htmlFor="studioName"
								className="block text-sm font-medium text-gray-700"
							>
								Studio Name
							</label>
							<input
								id="studioName"
								name="studioName"
								type="text"
								required
								value={formData.studioName}
								onChange={(e) => {
									setFormData((prev) => ({
										...prev,
										studioName: e.target.value,
									}));
									// Clear error when user starts typing
									if (errors.studioName) {
										setErrors((prev) => ({ ...prev, studioName: undefined }));
									}
								}}
								className={`mt-1 block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
									errors.studioName
										? 'border-red-300 focus:border-red-500 focus:ring-red-500'
										: 'border-gray-300'
								}`}
								placeholder="Your Studio Name"
							/>
							{errors.studioName && (
								<p className="mt-1 text-sm text-red-600">{errors.studioName}</p>
							)}
						</div>

						<div>
							<label
								htmlFor="email"
								className="block text-sm font-medium text-gray-700"
							>
								Email Address
							</label>
							<input
								id="email"
								name="email"
								type="email"
								required
								value={formData.email}
								onChange={(e) => {
									setFormData((prev) => ({ ...prev, email: e.target.value }));
									// Clear error when user starts typing
									if (errors.email) {
										setErrors((prev) => ({ ...prev, email: undefined }));
									}
								}}
								className={`mt-1 block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
									errors.email
										? 'border-red-300 focus:border-red-500 focus:ring-red-500'
										: 'border-gray-300'
								}`}
								placeholder="studio@example.com"
							/>
							{errors.email && (
								<p className="mt-1 text-sm text-red-600">{errors.email}</p>
							)}
						</div>

						<div>
							<label
								htmlFor="timezone"
								className="block text-sm font-medium text-gray-700"
							>
								Timezone
							</label>
							<select
								id="timezone"
								name="timezone"
								value={formData.timezone}
								onChange={(e) =>
									setFormData((prev) => ({ ...prev, timezone: e.target.value }))
								}
								className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
							>
								<option value="America/Los_Angeles">Pacific Time</option>
								<option value="America/Denver">Mountain Time</option>
								<option value="America/Chicago">Central Time</option>
								<option value="America/New_York">Eastern Time</option>
							</select>
						</div>
					</div>

					<button
						type="submit"
						disabled={isLoading}
						className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
					>
						{isLoading ? 'Creating Studio...' : 'Continue to Setup'}
					</button>
				</form>
			</div>
		</div>
	);
}

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClientSupabase } from '@/lib/supabase';
import { Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react';

const supabase = createClientSupabase();

export default function SignUpPage() {
	const router = useRouter();
	const [formData, setFormData] = useState({
		email: '',
		password: '',
		confirmPassword: '',
		firstName: '',
		lastName: '',
	});
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [isLoading, setIsLoading] = useState(false);
	const [showPassword, setShowPassword] = useState(false);
	const [showConfirmPassword, setShowConfirmPassword] = useState(false);

	// Form validation
	const validateForm = () => {
		const newErrors: Record<string, string> = {};

		// Email validation
		if (!formData.email) {
			newErrors.email = 'Email is required';
		} else if (!/\S+@\S+\.\S+/.test(formData.email)) {
			newErrors.email = 'Email is invalid';
		}

		// Password validation
		if (!formData.password) {
			newErrors.password = 'Password is required';
		} else if (formData.password.length < 8) {
			newErrors.password = 'Password must be at least 8 characters';
		} else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(formData.password)) {
			newErrors.password =
				'Password must contain uppercase, lowercase, and number';
		}

		// Confirm password validation
		if (!formData.confirmPassword) {
			newErrors.confirmPassword = 'Please confirm your password';
		} else if (formData.password !== formData.confirmPassword) {
			newErrors.confirmPassword = 'Passwords do not match';
		}

		// Name validation
		if (!formData.firstName.trim()) {
			newErrors.firstName = 'First name is required';
		}
		if (!formData.lastName.trim()) {
			newErrors.lastName = 'Last name is required';
		}

		setErrors(newErrors);
		return Object.keys(newErrors).length === 0;
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		// Validate form
		if (!validateForm()) {
			return;
		}

		setIsLoading(true);
		setErrors({});

		let supabaseUserId: string | null = null;

		try {
			// Step 1: Create user account in Supabase Auth
			const { data: authData, error: authError } = await supabase.auth.signUp({
				email: formData.email,
				password: formData.password,
				options: {
					data: {
						first_name: formData.firstName,
						last_name: formData.lastName,
					},
				},
			});

			if (authError) {
				// Handle Supabase auth errors
				if (authError.message.includes('already registered')) {
					setErrors({ email: 'An account with this email already exists' });
				} else if (authError.message.includes('Password')) {
					setErrors({ password: authError.message });
				} else if (authError.message.includes('email')) {
					setErrors({ email: authError.message });
				} else {
					setErrors({
						general: authError.message || 'Failed to create account.',
					});
				}
				return;
			}

			if (!authData.user) {
				setErrors({ general: 'Failed to create account. Please try again.' });
				return;
			}

			supabaseUserId = authData.user.id;

			// Session is automatically handled by @supabase/ssr cookie management
			// No delay needed - cookies are set immediately

			// Step 2: Create user in Prisma database
			const response = await fetch('/api/auth/signup', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					email: formData.email,
					firstName: formData.firstName,
					lastName: formData.lastName,
					supabaseUserId: supabaseUserId,
				}),
			});

			const data = await response.json();

			if (!response.ok) {
				// Rollback: Delete Supabase user if Prisma creation fails
				if (supabaseUserId) {
					try {
						// Use admin API to delete user (requires service role key)
						// For now, we'll log the error - in production, you'd want to use
						// a server-side endpoint to handle this cleanup
						console.error(
							'Prisma user creation failed, Supabase user should be cleaned up:',
							supabaseUserId
						);
					} catch (rollbackError) {
						console.error('Failed to rollback Supabase user:', rollbackError);
					}
				}

				// Handle specific error cases
				if (response.status === 409) {
					setErrors({ email: 'An account with this email already exists' });
				} else if (response.status === 400) {
					// Handle validation errors
					if (data.error.includes('email')) {
						setErrors({ email: data.error });
					} else {
						setErrors({ general: data.error });
					}
				} else if (response.status === 401) {
					setErrors({ general: 'Authentication failed. Please try again.' });
				} else {
					setErrors({
						general:
							data.error || 'Failed to create account. Please try again.',
					});
				}
				return;
			}

			// Success! Redirect to studio onboarding
			// Session cookie is automatically set by Supabase Auth
			router.push('/onboarding/studio');
		} catch (error) {
			console.error('Sign up error:', error);

			// Rollback: Delete Supabase user if there was an unexpected error
			if (supabaseUserId) {
				try {
					console.error(
						'Unexpected error, Supabase user should be cleaned up:',
						supabaseUserId
					);
				} catch (rollbackError) {
					console.error('Failed to rollback Supabase user:', rollbackError);
				}
			}

			setErrors({
				general: 'Failed to create account. Please try again.',
			});
		} finally {
			setIsLoading(false);
		}
	};

	const handleInputChange = (field: string, value: string) => {
		setFormData((prev) => ({ ...prev, [field]: value }));
		// Clear error for this field when user starts typing
		if (errors[field]) {
			setErrors((prev) => ({ ...prev, [field]: '' }));
		}
	};

	return (
		<div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
			<div className="sm:mx-auto sm:w-full sm:max-w-md">
				<div className="flex justify-center">
					<div className="text-4xl font-bold text-blue-600 dark:text-blue-400">
						The Mat
					</div>
				</div>
				<h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900 dark:text-white">
					Create your account
				</h2>
				<p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-300">
					Start managing your studio with data-driven insights
				</p>
			</div>

			<div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
				<div className="bg-white dark:bg-slate-800 py-8 px-4 shadow sm:rounded-lg sm:px-10">
					<form className="space-y-6" onSubmit={handleSubmit}>
						{/* General Error Message */}
						{errors.general && (
							<div className="rounded-md bg-red-50 dark:bg-red-900/20 p-4">
								<div className="flex">
									<AlertCircle className="h-5 w-5 text-red-400" />
									<div className="ml-3">
										<h3 className="text-sm font-medium text-red-800 dark:text-red-200">
											{errors.general}
										</h3>
									</div>
								</div>
							</div>
						)}

						{/* First Name */}
						<div>
							<label
								htmlFor="firstName"
								className="block text-sm font-medium text-gray-700 dark:text-gray-300"
							>
								First name *
							</label>
							<div className="mt-1">
								<input
									id="firstName"
									name="firstName"
									type="text"
									autoComplete="given-name"
									required
									value={formData.firstName}
									onChange={(e) =>
										handleInputChange('firstName', e.target.value)
									}
									className={`appearance-none block w-full px-3 py-2 border ${
										errors.firstName
											? 'border-red-300 dark:border-red-500'
											: 'border-gray-300 dark:border-gray-600'
									} rounded-md shadow-sm placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white`}
									placeholder="John"
								/>
								{errors.firstName && (
									<p className="mt-2 text-sm text-red-600 dark:text-red-400">
										{errors.firstName}
									</p>
								)}
							</div>
						</div>

						{/* Last Name */}
						<div>
							<label
								htmlFor="lastName"
								className="block text-sm font-medium text-gray-700 dark:text-gray-300"
							>
								Last name *
							</label>
							<div className="mt-1">
								<input
									id="lastName"
									name="lastName"
									type="text"
									autoComplete="family-name"
									required
									value={formData.lastName}
									onChange={(e) =>
										handleInputChange('lastName', e.target.value)
									}
									className={`appearance-none block w-full px-3 py-2 border ${
										errors.lastName
											? 'border-red-300 dark:border-red-500'
											: 'border-gray-300 dark:border-gray-600'
									} rounded-md shadow-sm placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white`}
									placeholder="Doe"
								/>
								{errors.lastName && (
									<p className="mt-2 text-sm text-red-600 dark:text-red-400">
										{errors.lastName}
									</p>
								)}
							</div>
						</div>

						{/* Email */}
						<div>
							<label
								htmlFor="email"
								className="block text-sm font-medium text-gray-700 dark:text-gray-300"
							>
								Email address *
							</label>
							<div className="mt-1">
								<input
									id="email"
									name="email"
									type="email"
									autoComplete="email"
									required
									value={formData.email}
									onChange={(e) => handleInputChange('email', e.target.value)}
									className={`appearance-none block w-full px-3 py-2 border ${
										errors.email
											? 'border-red-300 dark:border-red-500'
											: 'border-gray-300 dark:border-gray-600'
									} rounded-md shadow-sm placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white`}
									placeholder="you@example.com"
								/>
								{errors.email && (
									<p className="mt-2 text-sm text-red-600 dark:text-red-400">
										{errors.email}
									</p>
								)}
							</div>
						</div>

						{/* Password */}
						<div>
							<label
								htmlFor="password"
								className="block text-sm font-medium text-gray-700 dark:text-gray-300"
							>
								Password *
							</label>
							<div className="mt-1 relative">
								<input
									id="password"
									name="password"
									type={showPassword ? 'text' : 'password'}
									autoComplete="new-password"
									required
									value={formData.password}
									onChange={(e) =>
										handleInputChange('password', e.target.value)
									}
									className={`appearance-none block w-full px-3 py-2 border ${
										errors.password
											? 'border-red-300 dark:border-red-500'
											: 'border-gray-300 dark:border-gray-600'
									} rounded-md shadow-sm placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm pr-10 bg-white dark:bg-slate-700 text-gray-900 dark:text-white`}
									placeholder="••••••••"
								/>
								<button
									type="button"
									className="absolute inset-y-0 right-0 pr-3 flex items-center"
									onClick={() => setShowPassword(!showPassword)}
								>
									{showPassword ? (
										<EyeOff className="h-4 w-4 text-gray-400 dark:text-gray-500" />
									) : (
										<Eye className="h-4 w-4 text-gray-400 dark:text-gray-500" />
									)}
								</button>
							</div>
							{errors.password && (
								<p className="mt-2 text-sm text-red-600 dark:text-red-400">
									{errors.password}
								</p>
							)}
							{!errors.password && formData.password && (
								<p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
									Must be 8+ characters with uppercase, lowercase, and number
								</p>
							)}
						</div>

						{/* Confirm Password */}
						<div>
							<label
								htmlFor="confirmPassword"
								className="block text-sm font-medium text-gray-700 dark:text-gray-300"
							>
								Confirm password *
							</label>
							<div className="mt-1 relative">
								<input
									id="confirmPassword"
									name="confirmPassword"
									type={showConfirmPassword ? 'text' : 'password'}
									autoComplete="new-password"
									required
									value={formData.confirmPassword}
									onChange={(e) =>
										handleInputChange('confirmPassword', e.target.value)
									}
									className={`appearance-none block w-full px-3 py-2 border ${
										errors.confirmPassword
											? 'border-red-300 dark:border-red-500'
											: 'border-gray-300 dark:border-gray-600'
									} rounded-md shadow-sm placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm pr-10 bg-white dark:bg-slate-700 text-gray-900 dark:text-white`}
									placeholder="••••••••"
								/>
								<button
									type="button"
									className="absolute inset-y-0 right-0 pr-3 flex items-center"
									onClick={() => setShowConfirmPassword(!showConfirmPassword)}
								>
									{showConfirmPassword ? (
										<EyeOff className="h-4 w-4 text-gray-400 dark:text-gray-500" />
									) : (
										<Eye className="h-4 w-4 text-gray-400 dark:text-gray-500" />
									)}
								</button>
							</div>
							{errors.confirmPassword && (
								<p className="mt-2 text-sm text-red-600 dark:text-red-400">
									{errors.confirmPassword}
								</p>
							)}
						</div>

						{/* Terms and Conditions */}
						<div className="flex items-start">
							<div className="text-sm">
								<p className="text-gray-500 dark:text-gray-400">
									By creating an account, you agree to our{' '}
									<a
										href="/terms"
										className="font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
									>
										Terms of Service
									</a>{' '}
									and{' '}
									<a
										href="/privacy"
										className="font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
									>
										Privacy Policy
									</a>
								</p>
							</div>
						</div>

						{/* Submit Button */}
						<div>
							<button
								type="submit"
								disabled={isLoading}
								className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors dark:bg-blue-500 dark:hover:bg-blue-600"
							>
								{isLoading ? (
									<>
										<Loader2 className="animate-spin h-4 w-4 mr-2" />
										Creating account...
									</>
								) : (
									'Create account'
								)}
							</button>
						</div>
					</form>

					{/* Sign In Link */}
					<div className="mt-6">
						<div className="relative">
							<div className="absolute inset-0 flex items-center">
								<div className="w-full border-t border-gray-300 dark:border-gray-600" />
							</div>
							<div className="relative flex justify-center text-sm">
								<span className="px-2 bg-white dark:bg-slate-800 text-gray-500 dark:text-gray-400">
									Already have an account?
								</span>
							</div>
						</div>

						<div className="mt-6">
							<button
								type="button"
								onClick={() => router.push('/auth/login')}
								className="w-full flex justify-center py-2 px-4 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-700 hover:bg-gray-50 dark:hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
							>
								Sign in instead
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

import React, { useState, useEffect } from 'react';
import {
	CheckCircle,
	ExternalLink,
	Copy,
	Zap,
	CreditCard,
	Settings,
	RefreshCw,
} from 'lucide-react';
import { IntegrationSetupProps, IntegrationStatus } from '@/types';

const IntegrationSetup: React.FC<IntegrationSetupProps> = ({
	studioId,
	onIntegrationComplete,
}) => {
	const [status, setStatus] = useState<IntegrationStatus>({
		stripe: { connected: false },
		zapier: { configured: false },
	});
	const [isLoading, setIsLoading] = useState(true);
	const [isConnecting, setIsConnecting] = useState(false);
	const [isSyncing, setIsSyncing] = useState(false);
	const [copiedUrl, setCopiedUrl] = useState(false);

	useEffect(() => {
		fetchIntegrationStatus();
	});

	const fetchIntegrationStatus = async () => {
		try {
			const response = await fetch(`/api/studio/${studioId}/integrations`);
			const data = await response.json();

			if (data.success) {
				setStatus(data.data);
			}
		} catch (error) {
			console.error('Failed to fetch integration status:', error);
		} finally {
			setIsLoading(false);
		}
	};

	const handleStripeConnect = async () => {
		try {
			setIsConnecting(true);

			// Get Stripe Connect URL
			const response = await fetch('/api/stripe/connect', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ studioId }),
			});

			const data = await response.json();

			if (data.success) {
				// Redirect to Stripe Connect
				window.location.href = data.data.connectUrl;
			} else {
				throw new Error(
					data.error?.message || 'Failed to generate connect URL'
				);
			}
		} catch (error) {
			console.error('Stripe connection error:', error);
			alert('Failed to connect to Stripe. Please try again.');
		} finally {
			setIsConnecting(false);
		}
	};

	const handleSyncPayments = async () => {
		if (!status.stripe.accountId) return;

		try {
			setIsSyncing(true);

			const response = await fetch('/api/stripe/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					studioId,
					accountId: status.stripe.accountId,
				}),
			});

			const data = await response.json();

			if (data.success) {
				await fetchIntegrationStatus(); // Refresh status
				alert(`Successfully synced ${data.data.paymentsProcessed} payments`);
			} else {
				throw new Error(data.error?.message || 'Sync failed');
			}
		} catch (error) {
			console.error('Payment sync error:', error);
			alert('Failed to sync payments. Please try again.');
		} finally {
			setIsSyncing(false);
		}
	};

	const copyWebhookUrl = async () => {
		if (status.zapier.webhookUrl) {
			await navigator.clipboard.writeText(status.zapier.webhookUrl);
			setCopiedUrl(true);
			setTimeout(() => setCopiedUrl(false), 2000);
		}
	};

	const generateWebhookUrl = async () => {
		try {
			const response = await fetch(`/api/zapier/booking/${studioId}`);
			const data = await response.json();

			if (data.success) {
				setStatus((prev) => ({
					...prev,
					zapier: {
						...prev.zapier,
						webhookUrl: data.data.webhookUrl,
					},
				}));
			}
		} catch (error) {
			console.error('Failed to generate webhook URL:', error);
		}
	};

	useEffect(() => {
		if (!status.zapier.webhookUrl && !isLoading) {
			generateWebhookUrl();
		}
	});

	if (isLoading) {
		return (
			<div className="min-h-screen bg-gray-50 flex items-center justify-center">
				<div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-gray-50 py-8">
			<div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
				{/* Header */}
				<div className="mb-8">
					<h1 className="text-3xl font-bold text-gray-900">
						Integration Setup
					</h1>
					<p className="text-gray-600 mt-2">
						Connect your existing tools to start getting insights from your
						studio data.
					</p>
				</div>

				{/* Progress Overview */}
				<div className="bg-white rounded-lg shadow-sm border p-6 mb-8">
					<h2 className="text-xl font-semibold text-gray-900 mb-4">
						Setup Progress
					</h2>
					<div className="flex items-center space-x-6">
						<div className="flex items-center space-x-2">
							{status.stripe.connected ? (
								<CheckCircle className="h-5 w-5 text-green-600" />
							) : (
								<div className="h-5 w-5 rounded-full border-2 border-gray-300" />
							)}
							<span
								className={
									status.stripe.connected ? 'text-green-600' : 'text-gray-600'
								}
							>
								Stripe Connected
							</span>
						</div>
						<div className="flex items-center space-x-2">
							{status.zapier.configured ? (
								<CheckCircle className="h-5 w-5 text-green-600" />
							) : (
								<div className="h-5 w-5 rounded-full border-2 border-gray-300" />
							)}
							<span
								className={
									status.zapier.configured ? 'text-green-600' : 'text-gray-600'
								}
							>
								Zapier Configured
							</span>
						</div>
					</div>

					{status.stripe.connected && status.zapier.configured && (
						<div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-md">
							<div className="flex items-center">
								<CheckCircle className="h-5 w-5 text-green-600 mr-2" />
								<span className="text-green-800 font-medium">
									All integrations complete! Your dashboard is ready.
								</span>
							</div>
						</div>
					)}
				</div>

				{/* Integration Cards */}
				<div className="space-y-6">
					{/* Stripe Integration */}
					<div className="bg-white rounded-lg shadow-sm border">
						<div className="p-6">
							<div className="flex items-center justify-between mb-4">
								<div className="flex items-center space-x-3">
									<div className="p-2 bg-blue-100 rounded-lg">
										<CreditCard className="h-6 w-6 text-blue-600" />
									</div>
									<div>
										<h3 className="text-lg font-semibold text-gray-900">
											Stripe Integration
										</h3>
										<p className="text-gray-600">
											Connect your Stripe account for financial analytics
										</p>
									</div>
								</div>
								{status.stripe.connected && (
									<div className="flex items-center space-x-2 text-green-600">
										<CheckCircle className="h-5 w-5" />
										<span className="text-sm font-medium">Connected</span>
									</div>
								)}
							</div>

							{status.stripe.connected ? (
								<div className="space-y-4">
									<div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
										<div>
											<label className="block text-sm font-medium text-gray-700">
												Business Name
											</label>
											<p className="text-gray-900">
												{status.stripe.businessName || 'Not available'}
											</p>
										</div>
										<div>
											<label className="block text-sm font-medium text-gray-700">
												Last Sync
											</label>
											<p className="text-gray-900">
												{status.stripe.lastSync
													? new Date(
															status.stripe.lastSync
														).toLocaleDateString()
													: 'Never'}
											</p>
										</div>
									</div>

									<div className="flex space-x-4">
										<button
											onClick={handleSyncPayments}
											disabled={isSyncing}
											className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
										>
											{isSyncing ? (
												<RefreshCw className="h-4 w-4 animate-spin" />
											) : (
												<RefreshCw className="h-4 w-4" />
											)}
											<span>{isSyncing ? 'Syncing...' : 'Sync Payments'}</span>
										</button>

										<button className="text-blue-600 hover:text-blue-800 px-4 py-2 border border-blue-200 rounded-md transition-colors">
											View Settings
										</button>
									</div>
								</div>
							) : (
								<div className="space-y-4">
									<div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
										<h4 className="font-medium text-blue-900 mb-2">
											What you&apos;ll get:
										</h4>
										<ul className="text-blue-800 text-sm space-y-1">
											<li>
												• Real profit calculations with exact transaction fees
											</li>
											<li>• Revenue trends and payment analytics</li>
											<li>• Customer payment behavior insights</li>
											<li>• Automated financial reporting</li>
										</ul>
									</div>

									<button
										onClick={handleStripeConnect}
										disabled={isConnecting}
										className="flex items-center space-x-2 bg-blue-600 text-white px-6 py-3 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
									>
										{isConnecting ? (
											<div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
										) : (
											<ExternalLink className="h-4 w-4" />
										)}
										<span>
											{isConnecting
												? 'Connecting...'
												: 'Connect Stripe Account'}
										</span>
									</button>

									<p className="text-xs text-gray-600">
										You&apos;ll be redirected to Stripe to authorize read-only
										access to your payment data.
									</p>
								</div>
							)}
						</div>
					</div>

					{/* Zapier Integration */}
					<div className="bg-white rounded-lg shadow-sm border">
						<div className="p-6">
							<div className="flex items-center justify-between mb-4">
								<div className="flex items-center space-x-3">
									<div className="p-2 bg-orange-100 rounded-lg">
										<Zap className="h-6 w-6 text-orange-600" />
									</div>
									<div>
										<h3 className="text-lg font-semibold text-gray-900">
											Zapier Integration
										</h3>
										<p className="text-gray-600">
											Automatically sync booking data from Arketa
										</p>
									</div>
								</div>
								{status.zapier.configured && (
									<div className="flex items-center space-x-2 text-green-600">
										<CheckCircle className="h-5 w-5" />
										<span className="text-sm font-medium">Configured</span>
									</div>
								)}
							</div>

							<div className="space-y-4">
								<div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
									<h4 className="font-medium text-orange-900 mb-2">
										Setup Instructions:
									</h4>
									<ol className="text-orange-800 text-sm space-y-1 list-decimal list-inside">
										<li>Create a new Zap in your Zapier account</li>
										<li>Set Arketa as the trigger app (New Booking)</li>
										<li>Set Webhooks as the action app</li>
										<li>Use the webhook URL below as the destination</li>
										<li>Test your Zap to start receiving booking data</li>
									</ol>
								</div>

								{status.zapier.webhookUrl && (
									<div className="space-y-2">
										<label className="block text-sm font-medium text-gray-700">
											Webhook URL (copy this into Zapier)
										</label>
										<div className="flex items-center space-x-2">
											<input
												type="text"
												value={status.zapier.webhookUrl}
												readOnly
												className="flex-1 px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-sm font-mono"
											/>
											<button
												onClick={copyWebhookUrl}
												className="flex items-center space-x-2 px-3 py-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
											>
												{copiedUrl ? (
													<CheckCircle className="h-4 w-4 text-green-600" />
												) : (
													<Copy className="h-4 w-4 text-gray-600" />
												)}
												<span className="text-sm">
													{copiedUrl ? 'Copied!' : 'Copy'}
												</span>
											</button>
										</div>
									</div>
								)}

								{status.zapier.lastWebhook && (
									<div className="p-3 bg-green-50 border border-green-200 rounded-lg">
										<div className="flex items-center space-x-2">
											<CheckCircle className="h-4 w-4 text-green-600" />
											<span className="text-green-800 text-sm">
												Last webhook received:{' '}
												{new Date(status.zapier.lastWebhook).toLocaleString()}
											</span>
										</div>
									</div>
								)}

								<div className="flex space-x-4">
									<a
										href="https://zapier.com/apps/arketa/integrations"
										target="_blank"
										rel="noopener noreferrer"
										className="flex items-center space-x-2 bg-orange-600 text-white px-4 py-2 rounded-md hover:bg-orange-700 transition-colors"
									>
										<ExternalLink className="h-4 w-4" />
										<span>Open Zapier</span>
									</a>

									<a
										href="/docs/zapier-setup"
										className="text-orange-600 hover:text-orange-800 px-4 py-2 border border-orange-200 rounded-md transition-colors"
									>
										View Setup Guide
									</a>
								</div>
							</div>
						</div>
					</div>

					{/* Test Integration */}
					{status.stripe.connected && status.zapier.webhookUrl && (
						<div className="bg-white rounded-lg shadow-sm border">
							<div className="p-6">
								<div className="flex items-center space-x-3 mb-4">
									<div className="p-2 bg-green-100 rounded-lg">
										<Settings className="h-6 w-6 text-green-600" />
									</div>
									<div>
										<h3 className="text-lg font-semibold text-gray-900">
											Test Your Integration
										</h3>
										<p className="text-gray-600">
											Verify that data is flowing correctly
										</p>
									</div>
								</div>

								<div className="space-y-4">
									<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
										<div className="p-4 border rounded-lg">
											<h4 className="font-medium text-gray-900 mb-2">
												Stripe Data
											</h4>
											<p className="text-sm text-gray-600 mb-2">
												{status.stripe.lastSync
													? `Last synced: ${new Date(status.stripe.lastSync).toLocaleString()}`
													: 'No data synced yet'}
											</p>
											<button
												onClick={handleSyncPayments}
												disabled={isSyncing}
												className="text-blue-600 hover:text-blue-800 text-sm font-medium"
											>
												{isSyncing ? 'Syncing...' : 'Test Sync'}
											</button>
										</div>

										<div className="p-4 border rounded-lg">
											<h4 className="font-medium text-gray-900 mb-2">
												Zapier Webhooks
											</h4>
											<p className="text-sm text-gray-600 mb-2">
												{status.zapier.lastWebhook
													? `Last webhook: ${new Date(status.zapier.lastWebhook).toLocaleString()}`
													: 'No webhooks received yet'}
											</p>
											<button
												className="text-orange-600 hover:text-orange-800 text-sm font-medium"
												onClick={() =>
													window.open(
														'https://zapier.com/app/history',
														'_blank'
													)
												}
											>
												View Zap History
											</button>
										</div>
									</div>

									{status.stripe.connected && status.zapier.configured && (
										<div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
											<div className="flex items-center justify-between">
												<div>
													<h4 className="font-medium text-blue-900">
														Ready to Launch!
													</h4>
													<p className="text-blue-800 text-sm mt-1">
														Your integrations are complete. Start exploring your
														studio analytics.
													</p>
												</div>
												<button
													onClick={() => {
														onIntegrationComplete?.();
														window.location.href = `/dashboard/${studioId}`;
													}}
													className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors"
												>
													Go to Dashboard
												</button>
											</div>
										</div>
									)}
								</div>
							</div>
						</div>
					)}
				</div>

				{/* Support Section */}
				<div className="mt-8 bg-gray-100 rounded-lg p-6">
					<h3 className="text-lg font-semibold text-gray-900 mb-2">
						Need Help?
					</h3>
					<p className="text-gray-600 mb-4">
						Our team is here to help you get set up quickly. Don&apos;t hesitate
						to reach out if you run into any issues.
					</p>
					<div className="flex space-x-4">
						<a
							href="mailto:support@studiometrics.com"
							className="text-blue-600 hover:text-blue-800 font-medium"
						>
							Email Support
						</a>
						<a
							href="/docs"
							className="text-blue-600 hover:text-blue-800 font-medium"
						>
							View Documentation
						</a>
						<a
							href="/calendar/setup-call"
							className="text-blue-600 hover:text-blue-800 font-medium"
						>
							Schedule Setup Call
						</a>
					</div>
				</div>
			</div>
		</div>
	);
};

export default IntegrationSetup;

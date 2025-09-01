import React, { useState } from 'react';
import {
	CreditCard,
	CheckCircle,
	AlertCircle,
	ArrowRight,
	Shield,
	BarChart3,
	DollarSign,
	Users,
} from 'lucide-react';

const StripeConnectOnboarding = () => {
	const [currentStep, setCurrentStep] = useState(1);
	const [isConnecting, setIsConnecting] = useState(false);
	const [connectionStatus, setConnectionStatus] = useState('disconnected'); // disconnected, connecting, connected, error
	const [stripeAccountInfo, setStripeAccountInfo] = useState(null);

	// Simulate Stripe Connect OAuth flow
	const handleStripeConnect = async () => {
		setIsConnecting(true);
		setConnectionStatus('connecting');

		try {
			// In real implementation, this would redirect to Stripe OAuth
			// const redirectUrl = `${window.location.origin}/api/stripe/callback`;
			// const stripeUrl = `https://connect.stripe.com/oauth/authorize?response_type=code&client_id=${process.env.NEXT_PUBLIC_STRIPE_CLIENT_ID}&scope=read_only&redirect_uri=${encodeURIComponent(redirectUrl)}`;
			// window.location.href = stripeUrl;

			// Simulate OAuth success
			setTimeout(() => {
				setStripeAccountInfo({
					account_id: 'acct_studio_sarah_yoga',
					business_name: "Sarah's Yoga Studio",
					email: 'sarah@sarahsyoga.com',
					country: 'US',
					created: new Date().toISOString(),
					charges_enabled: true,
				});
				setConnectionStatus('connected');
				setIsConnecting(false);
				setCurrentStep(3);
			}, 3000);
		} catch (error) {
			setConnectionStatus('error');
			setIsConnecting(false);
		}
	};

	const steps = [
		{
			id: 1,
			title: 'Connect Your Stripe Account',
			description:
				'Securely connect your existing Stripe account to access financial analytics',
		},
		{
			id: 2,
			title: 'Authorize Data Access',
			description:
				'Grant read-only access to payment data for profit calculations',
		},
		{
			id: 3,
			title: 'Start Analyzing',
			description: 'View your studio analytics with real financial data',
		},
	];

	const benefits = [
		{
			icon: DollarSign,
			title: 'Accurate Profit Calculations',
			description:
				'See real profit per class, student, and instructor based on actual payment data',
		},
		{
			icon: BarChart3,
			title: 'Revenue Analytics',
			description:
				'Track daily, weekly, and monthly revenue trends with Stripe transaction data',
		},
		{
			icon: Users,
			title: 'Customer Insights',
			description: 'Analyze customer payment patterns and lifetime value',
		},
		{
			icon: Shield,
			title: 'Secure & Private',
			description:
				'Read-only access to your data. We never store credit card information',
		},
	];

	if (connectionStatus === 'connected') {
		return (
			<div className="max-w-4xl mx-auto p-8">
				<div className="bg-green-50 border border-green-200 rounded-lg p-8 text-center">
					<CheckCircle className="h-16 w-16 text-green-600 mx-auto mb-4" />
					<h2 className="text-2xl font-bold text-green-900 mb-2">
						Successfully Connected!
					</h2>
					<p className="text-green-700 mb-6">
						Your Stripe account is now connected. We're importing your payment
						history and will have insights ready shortly.
					</p>

					{stripeAccountInfo && (
						<div className="bg-white rounded-lg p-6 mb-6 text-left">
							<h3 className="font-semibold text-gray-900 mb-4">
								Connected Account Details:
							</h3>
							<div className="grid grid-cols-2 gap-4 text-sm">
								<div>
									<span className="text-gray-600">Business Name:</span>
									<div className="font-medium">
										{stripeAccountInfo.business_name}
									</div>
								</div>
								<div>
									<span className="text-gray-600">Account ID:</span>
									<div className="font-mono text-xs">
										{stripeAccountInfo.account_id}
									</div>
								</div>
								<div>
									<span className="text-gray-600">Email:</span>
									<div className="font-medium">{stripeAccountInfo.email}</div>
								</div>
								<div>
									<span className="text-gray-600">Status:</span>
									<div className="flex items-center text-green-600">
										<CheckCircle className="h-4 w-4 mr-1" />
										Active
									</div>
								</div>
							</div>
						</div>
					)}

					<div className="space-y-3">
						<button
							onClick={() => (window.location.href = '/dashboard')}
							className="w-full bg-blue-600 text-white px-6 py-3 rounded-md hover:bg-blue-700 transition-colors font-medium"
						>
							View Your Dashboard
						</button>
						<p className="text-sm text-gray-600">
							Next: Set up Zapier integration for booking data automation
						</p>
					</div>
				</div>
			</div>
		);
	}

	if (connectionStatus === 'error') {
		return (
			<div className="max-w-4xl mx-auto p-8">
				<div className="bg-red-50 border border-red-200 rounded-lg p-8 text-center">
					<AlertCircle className="h-16 w-16 text-red-600 mx-auto mb-4" />
					<h2 className="text-2xl font-bold text-red-900 mb-2">
						Connection Failed
					</h2>
					<p className="text-red-700 mb-6">
						There was an issue connecting your Stripe account. Please try again
						or contact support if the problem persists.
					</p>
					<button
						onClick={() => setConnectionStatus('disconnected')}
						className="bg-red-600 text-white px-6 py-3 rounded-md hover:bg-red-700 transition-colors font-medium"
					>
						Try Again
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="max-w-6xl mx-auto p-8">
			{/* Progress Steps */}
			<div className="mb-12">
				<div className="flex items-center justify-center space-x-8">
					{steps.map((step, index) => (
						<div key={step.id} className="flex items-center">
							<div
								className={`flex items-center justify-center w-10 h-10 rounded-full border-2 ${
									currentStep >= step.id
										? 'bg-blue-600 border-blue-600 text-white'
										: 'border-gray-300 text-gray-400'
								}`}
							>
								{currentStep > step.id ? (
									<CheckCircle className="h-5 w-5" />
								) : (
									<span>{step.id}</span>
								)}
							</div>
							{index < steps.length - 1 && (
								<ArrowRight className="h-5 w-5 text-gray-400 mx-4" />
							)}
						</div>
					))}
				</div>
				<div className="text-center mt-4">
					<h3 className="text-lg font-semibold text-gray-900">
						{steps[currentStep - 1].title}
					</h3>
					<p className="text-gray-600">{steps[currentStep - 1].description}</p>
				</div>
			</div>

			<div className="grid lg:grid-cols-2 gap-12">
				{/* Left Column - Benefits */}
				<div>
					<h2 className="text-3xl font-bold text-gray-900 mb-6">
						Connect Your Stripe Account
					</h2>
					<p className="text-lg text-gray-700 mb-8">
						Get accurate profit insights by connecting your existing Stripe
						account. We'll analyze your payment history to show you exactly
						where your money comes from.
					</p>

					<div className="space-y-6">
						{benefits.map((benefit, index) => (
							<div key={index} className="flex items-start space-x-4">
								<div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-lg">
									<benefit.icon className="h-6 w-6 text-blue-600" />
								</div>
								<div>
									<h3 className="font-semibold text-gray-900 mb-1">
										{benefit.title}
									</h3>
									<p className="text-gray-600">{benefit.description}</p>
								</div>
							</div>
						))}
					</div>

					<div className="mt-8 p-4 bg-gray-50 rounded-lg">
						<div className="flex items-start space-x-3">
							<Shield className="h-5 w-5 text-gray-600 mt-0.5" />
							<div className="text-sm text-gray-700">
								<p className="font-medium mb-1">Your data security:</p>
								<ul className="space-y-1 text-sm">
									<li>• Read-only access to payment data</li>
									<li>• No access to customer payment methods</li>
									<li>• You can disconnect at any time</li>
									<li>• We follow SOC 2 compliance standards</li>
								</ul>
							</div>
						</div>
					</div>
				</div>

				{/* Right Column - Connection Interface */}
				<div>
					<div className="bg-white rounded-lg border border-gray-200 shadow-lg p-8">
						<div className="text-center mb-8">
							<div className="w-16 h-16 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-4">
								<CreditCard className="h-8 w-8 text-blue-600" />
							</div>
							<h3 className="text-xl font-bold text-gray-900 mb-2">
								Ready to Connect?
							</h3>
							<p className="text-gray-600">
								This will redirect you to Stripe's secure authorization page
							</p>
						</div>

						<button
							onClick={handleStripeConnect}
							disabled={isConnecting}
							className="w-full bg-blue-600 text-white py-4 px-6 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-all duration-200 font-semibold text-lg flex items-center justify-center space-x-3"
						>
							{isConnecting ? (
								<>
									<div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
									<span>Connecting to Stripe...</span>
								</>
							) : (
								<>
									<CreditCard className="h-6 w-6" />
									<span>Connect with Stripe</span>
								</>
							)}
						</button>

						<div className="mt-6 text-center">
							<p className="text-sm text-gray-500">
								Powered by <span className="font-semibold">Stripe Connect</span>
							</p>
						</div>

						{/* What happens next preview */}
						<div className="mt-8 p-6 bg-gray-50 rounded-lg">
							<h4 className="font-semibold text-gray-900 mb-3">
								What happens after you connect:
							</h4>
							<div className="space-y-3 text-sm text-gray-700">
								<div className="flex items-center space-x-3">
									<div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center">
										<span className="text-xs font-semibold text-blue-600">
											1
										</span>
									</div>
									<span>We import your last 12 months of payment data</span>
								</div>
								<div className="flex items-center space-x-3">
									<div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center">
										<span className="text-xs font-semibold text-blue-600">
											2
										</span>
									</div>
									<span>Calculate profit margins and customer insights</span>
								</div>
								<div className="flex items-center space-x-3">
									<div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center">
										<span className="text-xs font-semibold text-blue-600">
											3
										</span>
									</div>
									<span>Generate your first analytics dashboard</span>
								</div>
							</div>
						</div>
					</div>

					{/* Sample Data Preview */}
					<div className="mt-8 bg-white rounded-lg border border-gray-200 p-6">
						<h4 className="font-semibold text-gray-900 mb-4">
							Preview: What You'll See
						</h4>
						<div className="grid grid-cols-2 gap-4 text-sm">
							<div className="p-3 bg-green-50 rounded">
								<div className="font-semibold text-green-800">
									Profit Per Class
								</div>
								<div className="text-2xl font-bold text-green-900">$67.50</div>
								<div className="text-green-700">After Stripe fees</div>
							</div>
							<div className="p-3 bg-blue-50 rounded">
								<div className="font-semibold text-blue-800">
									Top Customer LTV
								</div>
								<div className="text-2xl font-bold text-blue-900">$890</div>
								<div className="text-blue-700">Based on payment history</div>
							</div>
							<div className="p-3 bg-purple-50 rounded">
								<div className="font-semibold text-purple-800">
									Processing Costs
								</div>
								<div className="text-2xl font-bold text-purple-900">3.2%</div>
								<div className="text-purple-700">vs 15-41% ClassPass fees</div>
							</div>
							<div className="p-3 bg-orange-50 rounded">
								<div className="font-semibold text-orange-800">
									Peak Revenue Hour
								</div>
								<div className="text-2xl font-bold text-orange-900">
									6:00 PM
								</div>
								<div className="text-orange-700">Optimize class scheduling</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};

export default StripeConnectOnboarding;

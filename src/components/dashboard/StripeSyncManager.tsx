// STEP 4: Studio Dashboard Component with Manual Sync
// components/dashboard/StripeSyncManager.tsx
'use client';
import React, { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle, AlertCircle, Zap } from 'lucide-react';

interface StripeSyncManagerProps {
	studioId: string;
}

interface SyncStatus {
	stripeConnected: boolean;
	webhookConfigured: boolean;
	totalPayments: number;
	lastManualSync?: string;
	latestPaymentDate?: string;
	syncStatus: {
		webhookActive: boolean;
		manualSyncAvailable: boolean;
	};
}

const StripeSyncManager: React.FC<StripeSyncManagerProps> = ({ studioId }) => {
	const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isSyncing, setIsSyncing] = useState(false);
	const [syncDays, setSyncDays] = useState(7);

	useEffect(() => {
		fetchSyncStatus();
	}, [studioId]);

	const fetchSyncStatus = async () => {
		try {
			const response = await fetch(`/api/studio/${studioId}/sync-stripe`);
			const result = await response.json();

			if (result.success) {
				setSyncStatus(result.data);
			}
		} catch (error) {
			console.error('Failed to fetch sync status:', error);
		} finally {
			setIsLoading(false);
		}
	};

	const handleManualSync = async () => {
		setIsSyncing(true);
		try {
			const response = await fetch(`/api/studio/${studioId}/sync-stripe`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer temp-token', // Replace with real auth
				},
				body: JSON.stringify({ daysBack: syncDays }),
			});

			const result = await response.json();

			if (result.success) {
				alert(`✅ Success! Synced ${result.data.paymentsSynced} payments`);
				await fetchSyncStatus(); // Refresh status
			} else {
				throw new Error(result.error);
			}
		} catch (error) {
			console.error('Manual sync failed:', error);
			alert(
				`❌ Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		} finally {
			setIsSyncing(false);
		}
	};

	if (isLoading) {
		return (
			<div className="bg-white rounded-lg border p-6">
				<div className="animate-pulse">
					<div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
					<div className="h-8 bg-gray-200 rounded w-1/2"></div>
				</div>
			</div>
		);
	}

	if (!syncStatus?.stripeConnected) {
		return (
			<div className="bg-white rounded-lg border p-6">
				<div className="flex items-center space-x-2 text-orange-600">
					<AlertCircle className="h-5 w-5" />
					<span>Stripe not connected</span>
				</div>
			</div>
		);
	}

	return (
		<div className="bg-white rounded-lg border p-6">
			<div className="flex items-center justify-between mb-6">
				<h3 className="text-lg font-semibold text-gray-900">
					💳 Stripe Payment Sync
				</h3>
				<div className="flex items-center space-x-2">
					{syncStatus.syncStatus.webhookActive && (
						<div className="flex items-center space-x-1 text-green-600 text-sm">
							<Zap className="h-4 w-4" />
							<span>Live</span>
						</div>
					)}
				</div>
			</div>

			{/* Status Overview */}
			<div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
				<div className="text-center">
					<div className="text-2xl font-bold text-gray-900">
						{syncStatus.totalPayments.toLocaleString()}
					</div>
					<div className="text-sm text-gray-600">Total Payments</div>
				</div>

				<div className="text-center">
					<div className="text-sm text-gray-600">Webhook Status</div>
					<div
						className={`flex items-center justify-center space-x-1 ${
							syncStatus.webhookConfigured ? 'text-green-600' : 'text-red-600'
						}`}
					>
						{syncStatus.webhookConfigured ? (
							<CheckCircle className="h-4 w-4" />
						) : (
							<AlertCircle className="h-4 w-4" />
						)}
						<span className="text-sm">
							{syncStatus.webhookConfigured ? 'Active' : 'Not configured'}
						</span>
					</div>
				</div>

				<div className="text-center">
					<div className="text-sm text-gray-600">Latest Payment</div>
					<div className="text-sm font-medium text-gray-900">
						{syncStatus.latestPaymentDate
							? new Date(syncStatus.latestPaymentDate).toLocaleDateString()
							: 'None'}
					</div>
				</div>
			</div>

			{/* Manual Sync Section */}
			<div className="border-t pt-6">
				<div className="flex items-center justify-between mb-4">
					<div>
						<h4 className="font-medium text-gray-900">Manual Sync</h4>
						<p className="text-sm text-gray-600">
							Sync recent payments manually if needed
						</p>
					</div>

					<div className="flex items-center space-x-3">
						<select
							value={syncDays}
							onChange={(e) => setSyncDays(Number(e.target.value))}
							className="border border-gray-300 rounded px-3 py-1 text-sm"
							disabled={isSyncing}
						>
							<option value={1}>Last 1 day</option>
							<option value={7}>Last 7 days</option>
							<option value={30}>Last 30 days</option>
							<option value={90}>Last 90 days</option>
						</select>

						<button
							onClick={handleManualSync}
							disabled={isSyncing || !syncStatus.syncStatus.manualSyncAvailable}
							className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
						>
							{isSyncing ? (
								<RefreshCw className="h-4 w-4 animate-spin" />
							) : (
								<RefreshCw className="h-4 w-4" />
							)}
							<span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
						</button>
					</div>
				</div>

				{syncStatus.lastManualSync && (
					<div className="text-xs text-gray-500">
						Last manual sync:{' '}
						{new Date(syncStatus.lastManualSync).toLocaleString()}
					</div>
				)}
			</div>

			{/* Info Box */}
			<div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
				<div className="flex items-start space-x-2">
					<Zap className="h-4 w-4 text-blue-600 mt-0.5" />
					<div className="text-blue-800 text-sm">
						<strong>How it works:</strong> Payments are automatically synced via
						webhooks when customers pay. Use manual sync only if you notice
						missing payments or want to backfill historical data.
					</div>
				</div>
			</div>
		</div>
	);
};

export default StripeSyncManager;

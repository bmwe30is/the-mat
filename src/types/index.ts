// types/index.ts
export interface Studio {
	id: string;
	name: string;
	email: string;
	created_at: string;
	updated_at: string;
	stripe_account_id?: string;
	stripe_connected_at?: string;
	zapier_webhook_url?: string;
	settings: StudioSettings;
}

export interface StudioSettings {
	timezone: string;
	currency: string;
	default_instructor_rate: number;
	overhead_percentage: number;
}

// Stripe Payment Data
export interface StripePayment {
	id: string;
	studio_id: string;
	stripe_payment_id: string;
	amount: number;
	fee: number;
	net_amount: number;
	currency: string;
	customer_email?: string;
	description: string;
	metadata: Record<string, string>;
	status: 'succeeded' | 'pending' | 'failed';
	created_at: string;
	processed_at?: string;
}

// Booking data from Zapier/Arketa
export interface Booking {
	id: string;
	studio_id: string;
	external_booking_id: string; // Arketa booking ID
	customer_email: string;
	customer_name: string;
	class_name: string;
	instructor_name?: string;
	class_start_time: string;
	class_end_time: string;
	booking_status: 'confirmed' | 'cancelled' | 'no_show' | 'attended';
	amount_paid?: number;
	booking_created_at: string;
	class_attended_at?: string;
}

// Matched transaction combining Stripe + Booking data
export interface MatchedTransaction {
	id: string;
	studio_id: string;
	stripe_payment_id: string;
	booking_id?: string;
	match_confidence: 'high' | 'medium' | 'low' | 'unmatched';
	match_reason: string;
	amount: number;
	net_profit: number;
	customer_email: string;
	class_name?: string;
	instructor_name?: string;
	transaction_date: string;
	created_at: string;
}

// Analytics & Metrics
export interface StudioMetrics {
	studio_id: string;
	date: string;
	total_revenue: number;
	total_profit: number;
	total_bookings: number;
	total_attendees: number;
	avg_transaction_size: number;
	processing_fees: number;
	utilization_rate: number;
	profit_per_customer: number;
}

export interface InstructorMetrics {
	studio_id: string;
	instructor_name: string;
	date_range: {
		start: string;
		end: string;
	};
	total_classes: number;
	total_revenue: number;
	total_profit: number;
	avg_utilization: number;
	avg_transaction_size: number;
	total_processing_fees: number;
}

// API Response Types
export interface ApiResponse<T> {
	success: boolean;
	data?: T;
	error?: {
		code: string;
		message: string;
		details?: any;
	};
}

export interface PaginatedResponse<T> {
	data: T[];
	pagination: {
		page: number;
		limit: number;
		total: number;
		totalPages: number;
	};
}

// Webhook payload types
export interface ZapierBookingWebhook {
	booking_id: string;
	customer_email: string;
	customer_first_name: string;
	customer_last_name: string;
	class_name: string;
	instructor_name?: string;
	class_start_time: string; // ISO string
	class_end_time: string; // ISO string
	booking_status: string;
	amount_paid?: number;
	booking_created_at: string;
	class_location?: string;
}

export interface StripeWebhookEvent {
	id: string;
	type: string;
	data: {
		object: any;
	};
	created: number;
}

// Database utility types
export type DatabaseResult<T> = {
	data: T | null;
	error: Error | null;
};

export type StudioContextType = {
	studio: Studio | null;
	metrics: StudioMetrics | null;
	isLoading: boolean;
	refreshMetrics: () => Promise<void>;
};

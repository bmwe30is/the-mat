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
}

// Stripe Payment Data
export interface StripePayment {
	id: string;
	studioId: string;
	stripePaymentId: string;
	amount: number; // Amount in cents
	fee: number; // Fee in cents
	netAmount: number; // Net amount in cents
	currency: string;
	customerEmail?: string;
	description?: string;
	metadata?: Record<string, unknown>;
	status: 'succeeded' | 'pending' | 'failed';
	bookingMatchId?: string;
	createdAt: Date;
	processedAt?: Date;
}

// Prisma BookingStatus enum values
export type PrismaBookingStatus =
	| 'CONFIRMED'
	| 'CANCELLED'
	| 'NO_SHOW'
	| 'ATTENDED'
	| 'WAITLISTED';

// Webhook payload types
export interface ArketaZapierBookingWebhook {
	customerEmail: string;
	customerFirstName: string;
	customerLastName: string;
	customerPhone: string;
	customerArketaId: string;
	bookingId: string; // Arketa unique ID
	bookingCreatedAt: string; // Arketa date created
	bookingStatus: string;

	className: string;
	classInstructorName: string;
	classInstructorId: string;
	classPrice: string;
	classStartTime: string; // ISO string
	classEndTime: string; // ISO string
	classDuration: string;
	classLocationCityState: string;
	classLocationAddress: string;
	classLocationState: string;
	classLocationPostalCode: string;
	classLocationCountry: string;
	classLocationName: string;
	classLocationId: string;
	classCapacity: string;
	classId: string;

	classBlockedSeats: string;
	classLastBookedAt: string; // Arketa class last blocket slot

	paidBooking: string;
	paymentAmount: string;
}

// Prisma-compatible booking structure (matches database schema)
export interface PrismaBooking {
	id: string;
	userId?: string;
	classId?: string;
	arketaBookingId?: string;
	customerEmail: string;
	customerName: string;
	className: string;
	instructorName?: string;
	classStartTime: Date;
	classEndTime: Date;
	classAttendedAt?: Date;
	status: PrismaBookingStatus;
	bookedAt: Date;
	checkedInAt?: Date;
	paymentMethod?:
		| 'CREDIT_CARD'
		| 'BANK_TRANSFER'
		| 'CASH'
		| 'PACKAGE_CREDIT'
		| 'MEMBERSHIP'
		| 'CLASSPASS'
		| 'FREE';
	paidAmount?: number;
	refundAmount?: number;
	packagePurchaseId?: string;
	creditsUsed?: number;
	notes?: string;
	createdAt: Date;
	updatedAt: Date;
}

// Legacy Booking type for backward compatibility (deprecated)
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
	paidAmount?: number;
	booking_created_at: string;
	class_attended_at?: string;
}

// Matched transaction combining Stripe + Booking data
export interface MatchedTransaction {
	id: string;
	studioId: string;
	stripePaymentId: string;
	bookingId?: string;
	matchConfidence: 'high' | 'medium' | 'low' | 'unmatched';
	matchReason: string;
	amount: number; // Amount in cents
	netProfit: number; // Net profit in cents
	customerEmail: string;
	className?: string;
	instructorName?: string;
	transactionDate: Date;
	createdAt: Date;
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
		details?: Record<string, unknown>;
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

export interface StripeWebhookEvent {
	id: string;
	type: string;
	data: {
		object: Record<string, unknown>;
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

export interface DashboardOverviewData {
	metrics: StudioMetrics;
	topClasses: Array<{
		name: string;
		revenue: number;
		bookings: number;
		utilization: number;
	}>;
	instructorPerformance: Array<{
		name: string;
		classes: number;
		revenue: number;
		rating: number;
	}>;
	growthMetrics: {
		revenueGrowth: string;
		customerGrowth: string;
		utilizationGrowth: string;
	};
}

// Define specific interfaces for booking data
export interface BookingData {
	class_name: string;
	class_start_time: string;
	booking_status: string;
	amount_paid?: number;
	customer_email: string;
	instructor_name?: string;
	capacity?: number;
}

// Define interface for stored metrics
export interface StoredMetrics {
	total_revenue: number;
	total_profit: number;
	total_bookings: number;
	total_attendees: number;
	avg_transaction_size: number;
	processing_fees: number;
	utilization_rate: number;
	profit_per_customer: number;
}

export interface UserData {
	arketaCustomerId?: string;
	email: string;
	firstName: string;
	lastName: string;
	phone?: string;
	dateOfBirth?: string | Date;
	[key: string]: string | Date | undefined;
}

export interface UserRecord {
	id: string;
	email: string;
	firstName: string;
	lastName: string;
	phone?: string;
	dateOfBirth?: Date;
	arketaCustomerId?: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface ImportChanges {
	field: string;
	oldValue: string | number | boolean | Date | null;
	newValue: string | number | boolean | Date | null;
}

export interface ImportData {
	[key: string]: string | number | boolean | Date | null | undefined;
}

export interface ImportLogEntry {
	studioId: string;
	source: string;
	operation: string;
	recordType: string;
	recordId?: string;
	externalId?: string;
	status: 'SUCCESS' | 'ERROR' | 'WARNING' | 'SKIPPED';
	errorMessage?: string;
	importData?: ImportData;
	changes?: ImportChanges[];
}

export interface ScoredPayment extends StripePayment {
	matchScore: number;
	matchReason: string;
}

export interface IntegrationSetupProps {
	studioId: string;
	onIntegrationComplete?: () => void;
}

export interface IntegrationStatus {
	stripe: {
		connected: boolean;
		accountId?: string;
		businessName?: string;
		lastSync?: string;
	};
	zapier: {
		configured: boolean;
		webhookUrl?: string;
		lastWebhook?: string;
	};
}

// Loose shapes of the Square v2 objects we read (see Acuity types.ts for why loose).

export interface SquareMoney {
  amount: number; // smallest currency unit (cents) — already an integer
  currency: string;
}

export interface SquarePayment {
  id: string;
  created_at: string; // RFC 3339, UTC
  status?: string;
  amount_money?: SquareMoney;
  tip_money?: SquareMoney;
  total_money?: SquareMoney;
  refunded_money?: SquareMoney;
  processing_fee?: Array<{ amount_money?: SquareMoney; type?: string; effective_at?: string }>;
  source_type?: string;
  order_id?: string;
  customer_id?: string;
  note?: string;
  reference_id?: string;
  application_details?: { square_product?: string; application_id?: string };
  [k: string]: unknown;
}

export interface SquareLineItem {
  uid?: string;
  name?: string;
  quantity?: string;
  note?: string;
  catalog_object_id?: string;
  variation_name?: string;
  base_price_money?: SquareMoney;
  gross_sales_money?: SquareMoney;
  total_discount_money?: SquareMoney;
  metadata?: Record<string, string>;
  [k: string]: unknown;
}

export interface SquareOrder {
  id: string;
  created_at?: string;
  reference_id?: string;
  source?: { name?: string };
  metadata?: Record<string, string>;
  line_items?: SquareLineItem[];
  discounts?: Array<{ uid?: string; name?: string; type?: string; scope?: string; applied_money?: SquareMoney }>;
  total_money?: SquareMoney;
  total_discount_money?: SquareMoney;
  [k: string]: unknown;
}

export interface SquareRefund {
  id: string;
  payment_id?: string;
  created_at?: string;
  status?: string;
  amount_money?: SquareMoney;
  reason?: string;
  [k: string]: unknown;
}

export interface SquareLocation {
  id: string;
  name?: string;
  timezone?: string;
  [k: string]: unknown;
}

export interface SquareInvoice {
  id: string;
  order_id?: string;
  status?: string; // DRAFT | UNPAID | SCHEDULED | PARTIALLY_PAID | PAID | PARTIALLY_REFUNDED | REFUNDED | CANCELED | FAILED | PAYMENT_PENDING
  created_at?: string;
  updated_at?: string;
  primary_recipient?: { customer_id?: string; [k: string]: unknown };
  [k: string]: unknown;
}

export interface SquareCustomer {
  id: string;
  created_at?: string;
  updated_at?: string;
  [k: string]: unknown;
}

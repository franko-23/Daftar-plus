-- Subscription plans
CREATE TABLE IF NOT EXISTS subscription_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  regular_price_tzs INTEGER NOT NULL DEFAULT 0,
  discount_percent REAL NOT NULL DEFAULT 0,
  final_price_tzs INTEGER NOT NULL DEFAULT 0,
  duration_days INTEGER NOT NULL DEFAULT 30,
  promotion_name TEXT,
  promotion_start TEXT,
  promotion_end TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A subscription belongs to a business.
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  plan_id INTEGER NOT NULL,
  amount_paid_tzs INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  start_at TEXT,
  expires_at TEXT,
  order_id TEXT UNIQUE,
  transaction_id TEXT,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Immutable payment record. The amount here is the amount actually charged.
CREATE TABLE IF NOT EXISTS subscription_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  subscription_id INTEGER,
  phone TEXT NOT NULL,
  amount_tzs INTEGER NOT NULL,
  provider TEXT NOT NULL DEFAULT 'palmpesa',
  order_id TEXT UNIQUE,
  transaction_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sub_business ON subscriptions(business_id);
CREATE INDEX IF NOT EXISTS idx_sub_payment_business ON subscription_payments(business_id);
CREATE INDEX IF NOT EXISTS idx_sub_payment_status ON subscription_payments(status);

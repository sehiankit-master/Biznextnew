-- BIZNEXT DIGITAL COMPANY - PostgreSQL schema (safe to run multiple times)

CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  phone          TEXT,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin')),
  email_verified BOOLEAN NOT NULL DEFAULT false,
  is_blocked     BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otps (
  id         SERIAL PRIMARY KEY,
  email      TEXT NOT NULL,
  purpose    TEXT NOT NULL CHECK (purpose IN ('verify','reset')),
  code_hash  TEXT NOT NULL,
  attempts   INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otps_email ON otps(email, purpose);

CREATE TABLE IF NOT EXISTS categories (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id             SERIAL PRIMARY KEY,
  category_id    INT REFERENCES categories(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  features       TEXT NOT NULL DEFAULT '',        -- one feature per line
  price          NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  image_url      TEXT,
  preview_url    TEXT,
  file_name      TEXT,                            -- stored (private) file name
  file_original  TEXT,                            -- original name shown to customer
  resell_allowed BOOLEAN NOT NULL DEFAULT false,  -- only true if YOU have the owner's reselling rights
  resell_info    TEXT NOT NULL DEFAULT '',
  is_active      BOOLEAN NOT NULL DEFAULT true,
  sales_count    INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plans (
  id         SERIAL PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  price      NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  features   TEXT NOT NULL DEFAULT '',            -- one per line
  notes      TEXT NOT NULL DEFAULT '',            -- shown before checkout (validity, renewal, inclusions)
  badge      TEXT NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS orders (
  id                  SERIAL PRIMARY KEY,
  user_id             INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type           TEXT NOT NULL CHECK (item_type IN ('plan','product')),
  product_id          INT REFERENCES products(id) ON DELETE SET NULL,
  plan_id             INT REFERENCES plans(id) ON DELETE SET NULL,
  item_name           TEXT NOT NULL,
  amount              NUMERIC(10,2) NOT NULL,
  method              TEXT CHECK (method IN ('razorpay','manual')),
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','awaiting_verification','paid','failed','rejected','refunded')),
  razorpay_order_id   TEXT UNIQUE,
  razorpay_payment_id TEXT,
  utr                 TEXT,
  proof_file          TEXT,
  details             TEXT,                       -- customer's business / domain preference for plans
  admin_note          TEXT,
  invoice_no          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at             TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
-- one Razorpay payment can only ever be used for one order
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_rzp_payment ON orders(razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS downloads (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INT REFERENCES products(id) ON DELETE SET NULL,
  order_id   INT REFERENCES orders(id) ON DELETE SET NULL,
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- ---------- Seed data ----------
INSERT INTO settings(key, value) VALUES
  ('company_name', 'BIZNEXT DIGITAL COMPANY'),
  ('tagline', 'Your Digital Business. Your Future. Your Success.'),
  ('whatsapp_number', '919376998999'),
  ('support_email', ''),
  ('logo_url', ''),
  ('manual_enabled', 'true'),
  ('upi_id', ''),
  ('qr_url', ''),
  ('payment_instructions', 'Scan the QR code or pay to the UPI ID shown. After payment, enter the UTR / transaction ID and upload a screenshot. Your order is delivered after our team verifies the payment.'),
  ('invoice_note', 'This is a computer generated invoice. Prices are in INR.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO categories(name, sort_order) VALUES
  ('AI Software',1),('AI Tools',2),('E-books',3),('Digital Courses',4),('Website Templates',5),
  ('Business Tools',6),('Marketing Tools',7),('Social Media Products',8),('Ready-Made Business Packages',9)
ON CONFLICT (name) DO NOTHING;

INSERT INTO plans(code, name, price, features, notes, badge, sort_order) VALUES
('basic','Normal Digital Product Setup',1999,
 E'Normal Digital Products Setup\nDigital Product Store\nCustomer Dashboard\nBasic Business Setup Guidance\nWithout Domain\nWithout Hosting',
 E'Domain and hosting are NOT included in this plan. You can arrange your own domain and hosting.\nSetup is started after your payment is verified.','',1),
('ai','AI Software + Digital Product Setup',4999,
 E'AI Software Setup\nDigital Products Setup\nDigital Business Dashboard\nCustomer Login System\nBusiness Setup Support\nWithout Domain\nWithout Hosting',
 E'Domain and hosting are NOT included in this plan.\nSetup is started after your payment is verified.','Most Popular',2),
('complete','Complete Business Setup',9999,
 E'Complete Professional Website\nDomain Registration and Setup\nHosting Setup\nDigital Product Store\nCustomer Registration and Login\nPayment Gateway Integration\nAutomatic Product Delivery\nAdmin Dashboard\nCustomer Dashboard\nBusiness Setup Support',
 E'Domain validity: 1 year from the date of registration (EDIT THIS in Admin > Plans).\nHosting validity: 1 year from the date of setup (EDIT THIS in Admin > Plans).\nRenewal charges: Domain and hosting renewal is charged separately at the then-current rate; the amount is told to you before renewal (EDIT THIS in Admin > Plans).\nPayment gateway activation needs your own business / KYC documents approved by the gateway.','Complete Package',3)
ON CONFLICT (code) DO NOTHING;

-- Sample products are inactive. Edit them (add file + image) in Admin > Products and activate, or delete them.
INSERT INTO products(category_id, name, description, features, price, resell_allowed, resell_info, is_active)
SELECT c.id, v.name, v.descr, v.feat, v.price, false, 'Reselling is not enabled for this product.', false
FROM (VALUES
  ('AI Tools','Sample AI Tool Pack','Sample product - replace with your own product details.',E'Feature one\nFeature two',499::numeric),
  ('E-books','Sample E-book','Sample product - replace with your own product details.',E'PDF format\nInstant download',199::numeric),
  ('Website Templates','Sample Website Template','Sample product - replace with your own product details.',E'Responsive design\nEasy to edit',799::numeric)
) AS v(cat, name, descr, feat, price)
JOIN categories c ON c.name = v.cat
WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.name = v.name) AND NOT EXISTS (SELECT 1 FROM settings WHERE key='sample_seeded');
INSERT INTO settings(key,value) VALUES ('sample_seeded','1') ON CONFLICT (key) DO NOTHING;


-- ---------- v2: course delivery link + AI Course ----------
ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_link TEXT;  -- private https link (course portal / drive), shown only after purchase

-- AI Course is created HIDDEN. Add your course link/file in Admin > Products, then tick "Visible in store".
INSERT INTO products(category_id, name, description, features, price, resell_allowed, resell_info, is_active)
SELECT c.id, 'AI Business Course',
 'Learn to use AI tools for business: Canva, ChatGPT, WhatsApp automation and Meta Ads. Includes how to set up ads and start your own ads agency service.',
 E'Canva for business designs\nChatGPT for content, replies and daily work\nWhatsApp automation basics\nMeta Ads: setup, targeting and running campaigns\nHow to start your own ads agency service\nUsing AI software to create and manage ads',
 999, false, 'Personal learning use. Reselling this course is not allowed.', false
FROM categories c
WHERE c.name='Digital Courses' AND NOT EXISTS (SELECT 1 FROM products p WHERE p.name='AI Business Course') AND NOT EXISTS (SELECT 1 FROM settings WHERE key='aicourse_seeded');
INSERT INTO settings(key,value) VALUES ('aicourse_seeded','1') ON CONFLICT (key) DO NOTHING;


-- ---------- v3: home page tabs (topics) + content types ----------
CREATE TABLE IF NOT EXISTS topics (
  id         SERIAL PRIMARY KEY,
  title      TEXT NOT NULL UNIQUE,
  icon_url   TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE products ADD COLUMN IF NOT EXISTS topic_id     INT REFERENCES topics(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'product';  -- product | ebook | pdf | video | course | software
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_free      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS video_url    TEXT;

-- Default home tabs are created only once. Edit / delete / add tabs from Admin > Home Tabs & Content.
INSERT INTO topics(title, sort_order)
SELECT v.t, v.o FROM (VALUES
  ('Small Business Ideas',1),('E-Commerce Seller',2),('AI for Business',3),('Ads & Marketing',4),
  ('Digital Products Business',5),('Business Ideas Under 50K',6),('Zero Investment Business',7),
  ('Work From Home Businesses',8),('Business for Women',9),('Business Mindset',10),
  ('GST & Business Basics',11),('Canva & Design',12)
) AS v(t,o)
WHERE NOT EXISTS (SELECT 1 FROM topics) AND NOT EXISTS (SELECT 1 FROM settings WHERE key='topics_seeded');
INSERT INTO settings(key,value) VALUES ('topics_seeded','1') ON CONFLICT (key) DO NOTHING;

UPDATE products SET topic_id=(SELECT id FROM topics WHERE title='AI for Business'), content_type='course'
WHERE name='AI Business Course' AND content_type='product' AND topic_id IS NULL;


-- ---------- v4: tab passes (Rs 199 per tab) and All Tabs Access (Rs 999) ----------
ALTER TABLE topics ADD COLUMN IF NOT EXISTS price NUMERIC(10,2) NOT NULL DEFAULT 199;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS topic_id INT REFERENCES topics(id) ON DELETE SET NULL;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_item_type_check;
ALTER TABLE orders ADD CONSTRAINT orders_item_type_check CHECK (item_type IN ('plan','product','topic','all_access'));
INSERT INTO settings(key, value) VALUES ('all_access_price', '999') ON CONFLICT (key) DO NOTHING;

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { pool, query } = require('./db');

const PROD = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const RZP_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const RZP_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';
const VERIFY_REQUIRED = process.env.REQUIRE_EMAIL_VERIFY === 'true';
const MAX_MB = parseInt(process.env.MAX_UPLOAD_MB || '200', 10);

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('JWT_SECRET missing or too short (min 32 chars). Set it in .env');
  process.exit(1);
}

const ROOT = __dirname;
const UPLOADS = path.join(ROOT, 'uploads');
const STORE_PRODUCTS = path.join(ROOT, 'storage', 'products'); // private
const STORE_PROOFS = path.join(ROOT, 'storage', 'proofs'); // private
const LOG_DIR = path.join(ROOT, 'logs');
[UPLOADS, STORE_PRODUCTS, STORE_PROOFS, LOG_DIR].forEach((d) => fs.mkdirSync(d, { recursive: true }));

/* ------------------------------ helpers ------------------------------ */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const isEmail = (e) => typeof e === 'string' && /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(e) && e.length <= 254;
const cleanStr = (s, max = 500) => String(s ?? '').trim().slice(0, max);
const toPaise = (rupees) => Math.round(Number(rupees) * 100);
const bool = (v) => v === true || v === 'true' || v === 'on' || v === '1' || v === 1;

function logError(err, req) {
  const line = `[${new Date().toISOString()}] ${req ? req.method + ' ' + req.originalUrl : ''} ${err && err.stack ? err.stack : err}\n`;
  console.error(line);
  fs.appendFile(path.join(LOG_DIR, 'error.log'), line, () => {});
}

function safeUnlink(dir, name) {
  if (!name) return;
  const p = path.join(dir, path.basename(name));
  fs.unlink(p, () => {});
}

async function getSettings() {
  const { rows } = await query('SELECT key, value FROM settings');
  const s = {};
  rows.forEach((r) => (s[r.key] = r.value));
  return s;
}
async function setSetting(key, value) {
  await query(
    'INSERT INTO settings(key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',
    [key, String(value ?? '')]
  );
}

/* ------------------------------ email ------------------------------ */
let transporter = null;
if (process.env.SMTP_HOST) {
  try {
    transporter = require('nodemailer').createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  } catch (e) {
    logError(e);
  }
}
async function sendMail(to, subject, text) {
  if (!transporter) {
    console.log(`\n[EMAIL not configured - printed here]\nTo: ${to}\nSubject: ${subject}\n${text}\n`);
    return;
  }
  try {
    await transporter.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text });
  } catch (e) {
    logError(e);
  }
}

/* ------------------------------ app setup ------------------------------ */
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'script-src': ["'self'", 'https://cdn.jsdelivr.net', 'https://checkout.razorpay.com'],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
        'img-src': ["'self'", 'data:', 'https:'],
        'frame-src': ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com', 'https://www.youtube.com', 'https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'https://drive.google.com'],
        'connect-src': ["'self'", 'https://api.razorpay.com', 'https://lumberjack.razorpay.com'],
        'form-action': ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(cookieParser());

// Razorpay webhook needs the RAW body for signature verification -> must be before express.json()
app.post(
  '/api/webhooks/razorpay',
  express.raw({ type: '*/*', limit: '1mb' }),
  ah(async (req, res) => {
    const signature = req.get('x-razorpay-signature') || '';
    if (!RZP_WEBHOOK_SECRET || !Buffer.isBuffer(req.body)) return res.status(400).send('not configured');
    const expected = crypto.createHmac('sha256', RZP_WEBHOOK_SECRET).update(req.body).digest('hex');
    if (!safeEqual(expected, signature)) return res.status(400).send('invalid signature');

    const event = JSON.parse(req.body.toString('utf8'));
    const pay = event?.payload?.payment?.entity;
    const rzpOrderId = pay?.order_id || event?.payload?.order?.entity?.id;
    if (!rzpOrderId) return res.json({ ok: true });

    const { rows } = await query('SELECT * FROM orders WHERE razorpay_order_id=$1', [rzpOrderId]);
    const order = rows[0];
    if (!order) return res.json({ ok: true });

    if (event.event === 'payment.captured' || event.event === 'order.paid') {
      // amount must match what we created the order for
      if (pay && Number(pay.amount) === toPaise(order.amount) && pay.status === 'captured') {
        const done = await markPaid(order.id, pay.id);
        if (done && done.justPaid) notifyPaid(done.order);
      }
    } else if (event.event === 'payment.failed') {
      await query("UPDATE orders SET status='failed' WHERE id=$1 AND status='pending'", [order.id]);
    }
    res.json({ ok: true });
  })
);

app.use(express.json({ limit: '1mb' }));

// CSRF defence: cookies are SameSite=Lax and every state-changing API call must carry this custom header,
// which browsers will not add on cross-site form posts.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'biznext') return res.status(403).json({ error: 'Blocked (CSRF check)' });
  next();
});

app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 240, standardHeaders: true, legacyHeaders: false }));
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again after 15 minutes.' },
});
const checkoutLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, message: { error: 'Too many requests. Try later.' } });

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* ------------------------------ uploads ------------------------------ */
const IMAGE_FIELDS = ['image', 'qr', 'logo', 'proof', 'icon'];
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) =>
      cb(null, file.fieldname === 'file' ? STORE_PRODUCTS : file.fieldname === 'proof' ? STORE_PROOFS : UPLOADS),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
      cb(null, crypto.randomBytes(16).toString('hex') + ext);
    },
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 3 },
  fileFilter: (req, file, cb) => {
    if (IMAGE_FIELDS.includes(file.fieldname) && !/^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)) {
      return cb(new Error('Only PNG, JPG, WEBP or GIF images are allowed'));
    }
    cb(null, true);
  },
});

/* ------------------------------ auth ------------------------------ */
function issueToken(res, user) {
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 7 * 24 * 3600 * 1000, path: '/' });
}

const loadUser = ah(async (req, res, next) => {
  const token = req.cookies && req.cookies.token;
  if (token) {
    try {
      const { id } = jwt.verify(token, JWT_SECRET);
      const { rows } = await query(
        'SELECT id,name,email,phone,role,email_verified,is_blocked,created_at FROM users WHERE id=$1',
        [id]
      );
      if (rows[0] && !rows[0].is_blocked) req.user = rows[0];
    } catch (_) {
      /* invalid token -> treated as logged out */
    }
  }
  next();
});
app.use(loadUser);

const requireAuth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Please login first' }));
const requireAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Please login first' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access only' });
  next();
};

async function createOtp(email, purpose) {
  const code = String(crypto.randomInt(100000, 1000000));
  await query('DELETE FROM otps WHERE email=$1 AND purpose=$2', [email, purpose]);
  await query("INSERT INTO otps(email,purpose,code_hash,expires_at) VALUES ($1,$2,$3, now() + interval '10 minutes')", [
    email,
    purpose,
    sha256(code + email),
  ]);
  return code;
}
async function checkOtp(email, purpose, code) {
  const { rows } = await query('SELECT * FROM otps WHERE email=$1 AND purpose=$2 AND expires_at > now()', [email, purpose]);
  const o = rows[0];
  if (!o) return false;
  if (o.attempts >= 5) return false;
  await query('UPDATE otps SET attempts = attempts + 1 WHERE id=$1', [o.id]);
  if (!safeEqual(o.code_hash, sha256(String(code) + email))) return false;
  await query('DELETE FROM otps WHERE id=$1', [o.id]);
  return true;
}

/* ------------------------------ auth routes ------------------------------ */
app.post(
  '/api/auth/register',
  authLimiter,
  ah(async (req, res) => {
    const name = cleanStr(req.body.name, 80);
    const email = cleanStr(req.body.email, 254).toLowerCase();
    const phone = cleanStr(req.body.phone, 20);
    const password = String(req.body.password || '');
    if (name.length < 2) return res.status(400).json({ error: 'Please enter your name' });
    if (!isEmail(email)) return res.status(400).json({ error: 'Enter a valid email' });
    if (password.length < 8 || password.length > 100) return res.status(400).json({ error: 'Password must be 8 to 100 characters' });
    if (phone && !/^[0-9+\-\s]{8,20}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid phone number' });

    const exists = await query('SELECT id FROM users WHERE email=$1', [email]);
    if (exists.rows[0]) return res.status(409).json({ error: 'This email is already registered. Please login.' });

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await query(
      "INSERT INTO users(name,email,phone,password_hash,email_verified) VALUES ($1,$2,$3,$4,$5) RETURNING id,name,email",
      [name, email, phone || null, hash, !VERIFY_REQUIRED]
    );
    if (VERIFY_REQUIRED) {
      const code = await createOtp(email, 'verify');
      await sendMail(email, 'Verify your email - BIZNEXT DIGITAL COMPANY', `Your verification code is ${code}. It is valid for 10 minutes.`);
      return res.json({ ok: true, needVerify: true, email });
    }
    issueToken(res, rows[0]);
    res.json({ ok: true, needVerify: false });
  })
);

app.post(
  '/api/auth/verify-email',
  authLimiter,
  ah(async (req, res) => {
    const email = cleanStr(req.body.email, 254).toLowerCase();
    const ok = await checkOtp(email, 'verify', cleanStr(req.body.otp, 10));
    if (!ok) return res.status(400).json({ error: 'Invalid or expired code' });
    const { rows } = await query('UPDATE users SET email_verified=true WHERE email=$1 RETURNING id', [email]);
    if (rows[0]) issueToken(res, rows[0]);
    res.json({ ok: true });
  })
);

app.post(
  '/api/auth/resend-otp',
  authLimiter,
  ah(async (req, res) => {
    const email = cleanStr(req.body.email, 254).toLowerCase();
    const purpose = req.body.purpose === 'reset' ? 'reset' : 'verify';
    const { rows } = await query('SELECT id, email_verified FROM users WHERE email=$1', [email]);
    if (rows[0] && (purpose === 'reset' || !rows[0].email_verified)) {
      const code = await createOtp(email, purpose);
      await sendMail(email, 'Your code - BIZNEXT DIGITAL COMPANY', `Your code is ${code}. It is valid for 10 minutes.`);
    }
    res.json({ ok: true }); // same answer whether or not the email exists
  })
);

app.post(
  '/api/auth/login',
  authLimiter,
  ah(async (req, res) => {
    const email = cleanStr(req.body.email, 254).toLowerCase();
    const password = String(req.body.password || '');
    const { rows } = await query('SELECT * FROM users WHERE email=$1', [email]);
    const u = rows[0];
    const ok = u && (await bcrypt.compare(password, u.password_hash));
    if (!ok) return res.status(401).json({ error: 'Wrong email or password' });
    if (u.is_blocked) return res.status(403).json({ error: 'Your account is blocked. Contact support.' });
    if (!u.email_verified) {
      const code = await createOtp(email, 'verify');
      await sendMail(email, 'Verify your email - BIZNEXT DIGITAL COMPANY', `Your verification code is ${code}. It is valid for 10 minutes.`);
      return res.status(403).json({ error: 'Please verify your email first', needVerify: true, email });
    }
    issueToken(res, u);
    res.json({ ok: true, role: u.role });
  })
);

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token', { path: '/' });
  res.json({ ok: true });
});

app.post(
  '/api/auth/forgot',
  authLimiter,
  ah(async (req, res) => {
    const email = cleanStr(req.body.email, 254).toLowerCase();
    const { rows } = await query('SELECT id FROM users WHERE email=$1', [email]);
    if (rows[0]) {
      const code = await createOtp(email, 'reset');
      await sendMail(email, 'Reset your password - BIZNEXT DIGITAL COMPANY', `Your password reset code is ${code}. It is valid for 10 minutes. If you did not ask for this, ignore this email.`);
    }
    res.json({ ok: true });
  })
);

app.post(
  '/api/auth/reset',
  authLimiter,
  ah(async (req, res) => {
    const email = cleanStr(req.body.email, 254).toLowerCase();
    const password = String(req.body.password || '');
    if (password.length < 8 || password.length > 100) return res.status(400).json({ error: 'Password must be 8 to 100 characters' });
    const ok = await checkOtp(email, 'reset', cleanStr(req.body.otp, 10));
    if (!ok) return res.status(400).json({ error: 'Invalid or expired code' });
    await query('UPDATE users SET password_hash=$1, email_verified=true WHERE email=$2', [await bcrypt.hash(password, 12), email]);
    res.json({ ok: true });
  })
);

app.get('/api/me', (req, res) => res.json({ user: req.user || null }));

app.put(
  '/api/me',
  requireAuth,
  ah(async (req, res) => {
    const name = cleanStr(req.body.name, 80);
    const phone = cleanStr(req.body.phone, 20);
    if (name.length < 2) return res.status(400).json({ error: 'Please enter your name' });
    if (phone && !/^[0-9+\-\s]{8,20}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid phone number' });
    await query('UPDATE users SET name=$1, phone=$2 WHERE id=$3', [name, phone || null, req.user.id]);
    res.json({ ok: true });
  })
);

app.post(
  '/api/me/password',
  requireAuth,
  authLimiter,
  ah(async (req, res) => {
    const { rows } = await query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
    if (!(await bcrypt.compare(String(req.body.current || ''), rows[0].password_hash))) return res.status(400).json({ error: 'Current password is wrong' });
    const np = String(req.body.password || '');
    if (np.length < 8 || np.length > 100) return res.status(400).json({ error: 'New password must be 8 to 100 characters' });
    await query('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(np, 12), req.user.id]);
    res.json({ ok: true });
  })
);

/* ------------------------------ public data ------------------------------ */
const PUBLIC_SETTING_KEYS = ['company_name', 'tagline', 'whatsapp_number', 'support_email', 'logo_url'];

app.get(
  '/api/settings',
  ah(async (req, res) => {
    const s = await getSettings();
    const out = {};
    PUBLIC_SETTING_KEYS.forEach((k) => (out[k] = s[k] || ''));
    out.razorpay_enabled = !!(RZP_KEY_ID && RZP_KEY_SECRET);
    out.manual_enabled = s.manual_enabled === 'true';
    res.json(out);
  })
);

app.get(
  '/api/plans',
  ah(async (req, res) => {
    const { rows } = await query('SELECT id,code,name,price,features,notes,badge FROM plans WHERE is_active ORDER BY sort_order, id');
    res.json({ plans: rows });
  })
);

app.get(
  '/api/categories',
  ah(async (req, res) => {
    const { rows } = await query('SELECT id,name FROM categories ORDER BY sort_order, id');
    res.json({ categories: rows });
  })
);

const PRODUCT_COLS = `p.id,p.name,p.description,p.features,p.price,p.image_url,p.preview_url,p.resell_allowed,p.resell_info,
  p.category_id,c.name AS category, (p.file_name IS NOT NULL) AS has_file, (p.delivery_link IS NOT NULL) AS has_link,
  p.topic_id, p.content_type, p.is_free`;

app.get(
  '/api/products',
  ah(async (req, res) => {
    const params = [];
    let where = 'WHERE p.is_active';
    if (req.query.category) {
      params.push(parseInt(req.query.category, 10) || 0);
      where += ` AND p.category_id=$${params.length}`;
    }
    if (req.query.categoryName) {
      params.push(cleanStr(req.query.categoryName, 80));
      where += ` AND c.name=$${params.length}`;
    }
    if (req.query.q) {
      params.push('%' + cleanStr(req.query.q, 80).replace(/[%_]/g, '') + '%');
      where += ` AND (p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`;
    }
    const { rows } = await query(
      `SELECT ${PRODUCT_COLS} FROM products p LEFT JOIN categories c ON c.id=p.category_id ${where} ORDER BY p.created_at DESC`,
      params
    );
    res.json({ products: rows });
  })
);

app.get(
  '/api/products/:id',
  ah(async (req, res) => {
    const { rows } = await query(
      `SELECT ${PRODUCT_COLS} FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=$1 AND p.is_active`,
      [parseInt(req.params.id, 10) || 0]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Product not found' });
    res.json({ product: rows[0] });
  })
);

/* ------------------------------ payment core ------------------------------ */
async function rzp(pathname, method, body) {
  if (!RZP_KEY_ID || !RZP_KEY_SECRET) throw new Error('Razorpay keys are not configured');
  const r = await fetch('https://api.razorpay.com/v1' + pathname, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + Buffer.from(RZP_KEY_ID + ':' + RZP_KEY_SECRET).toString('base64'),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.description) || 'Razorpay request failed');
  return j;
}

// Marks an order paid exactly once (row lock + transaction). Safe to call from verify, webhook and admin approval.
async function markPaid(orderId, razorpayPaymentId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
    const o = rows[0];
    if (!o) {
      await client.query('ROLLBACK');
      return null;
    }
    if (o.status === 'paid') {
      await client.query('COMMIT');
      return { order: o, justPaid: false };
    }
    if (o.status === 'refunded') {
      await client.query('ROLLBACK');
      return null;
    }
    const invoice = 'BN-' + new Date().getFullYear() + '-' + String(o.id).padStart(6, '0');
    const upd = await client.query(
      "UPDATE orders SET status='paid', paid_at=now(), invoice_no=$2, razorpay_payment_id=COALESCE($3, razorpay_payment_id) WHERE id=$1 RETURNING *",
      [orderId, invoice, razorpayPaymentId || null]
    );
    if (o.product_id) await client.query('UPDATE products SET sales_count = sales_count + 1 WHERE id=$1', [o.product_id]);
    await client.query('COMMIT');
    return { order: upd.rows[0], justPaid: true };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function notifyPaid(order) {
  try {
    const { rows } = await query('SELECT name,email FROM users WHERE id=$1', [order.user_id]);
    if (!rows[0]) return;
    const s = await getSettings();
    const base = process.env.BASE_URL || '';
    await sendMail(
      rows[0].email,
      `Payment confirmed - Order #${order.id} - ${s.company_name || 'BIZNEXT DIGITAL COMPANY'}`,
      `Hi ${rows[0].name},\n\nWe have received and verified your payment of INR ${order.amount} for "${order.item_name}".\nInvoice: ${order.invoice_no}\n\nLogin to your dashboard to see your order${order.product_id ? ' and download your product' : ''}: ${base}/dashboard.html\n\nThank you,\n${s.company_name || 'BIZNEXT DIGITAL COMPANY'}`
    );
  } catch (e) {
    logError(e);
  }
}

/* ------------------------------ checkout ------------------------------ */
app.get(
  '/api/payment-options',
  requireAuth,
  ah(async (req, res) => {
    const s = await getSettings();
    res.json({
      razorpay: !!(RZP_KEY_ID && RZP_KEY_SECRET),
      manual: s.manual_enabled === 'true' && !!(s.upi_id || s.qr_url),
      upi_id: s.manual_enabled === 'true' ? s.upi_id : '',
      qr_url: s.manual_enabled === 'true' ? s.qr_url : '',
      instructions: s.payment_instructions || '',
    });
  })
);

app.post(
  '/api/checkout',
  requireAuth,
  checkoutLimiter,
  ah(async (req, res) => {
    const type = ['plan', 'topic', 'all_access'].includes(req.body.type) ? req.body.type : 'product';
    const id = parseInt(req.body.id, 10) || 0;
    const method = req.body.method === 'manual' ? 'manual' : 'razorpay';
    const details = cleanStr(req.body.details, 1000);
    const s = await getSettings();

    let item;
    if (type === 'topic') {
      const t = (await query('SELECT id,title,price FROM topics WHERE id=$1 AND is_active', [id])).rows[0];
      if (t) {
        const pa = await passAccess(req.user.id);
        if (pa.all || pa.topics.has(t.id)) return res.status(409).json({ error: 'This tab is already unlocked for you.' });
        item = { id: t.id, name: 'Tab Pass: ' + t.title, price: t.price };
      }
    } else if (type === 'all_access') {
      const pa = await passAccess(req.user.id);
      if (pa.all) return res.status(409).json({ error: 'You already have access to all tabs.' });
      item = { id: 0, name: 'All Tabs Access', price: Number(s.all_access_price || 999) };
    } else if (type === 'plan') {
      item = (await query('SELECT id,name,price FROM plans WHERE id=$1 AND is_active', [id])).rows[0];
    } else {
      item = (await query('SELECT id,name,price,file_name FROM products WHERE id=$1 AND is_active', [id])).rows[0];
      if (item) {
        const already = await query("SELECT 1 FROM orders WHERE user_id=$1 AND product_id=$2 AND status='paid' LIMIT 1", [req.user.id, id]);
        if (already.rows[0]) return res.status(409).json({ error: 'You already own this product. Find it in your dashboard.' });
      }
    }
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (Number(item.price) <= 0) return res.status(400).json({ error: 'Invalid price' });

    if (method === 'manual' && !(s.manual_enabled === 'true' && (s.upi_id || s.qr_url))) {
      return res.status(400).json({ error: 'Manual payment is not available right now' });
    }

    // Price always comes from the database - never from the browser.
    const ins = await query(
      `INSERT INTO orders(user_id,item_type,product_id,plan_id,item_name,amount,method,status,details,topic_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9) RETURNING *`,
      [req.user.id, type, type === 'product' ? id : null, type === 'plan' ? id : null, item.name, item.price, method, details || null, type === 'topic' ? id : null]
    );
    const order = ins.rows[0];

    if (method === 'manual') return res.json({ ok: true, orderId: order.id, method: 'manual' });

    const rz = await rzp('/orders', 'POST', {
      amount: toPaise(order.amount),
      currency: 'INR',
      receipt: 'bn_' + order.id,
      notes: { order_id: String(order.id), user_id: String(req.user.id) },
    });
    await query('UPDATE orders SET razorpay_order_id=$1 WHERE id=$2', [rz.id, order.id]);
    res.json({
      ok: true,
      method: 'razorpay',
      orderId: order.id,
      key: RZP_KEY_ID,
      rzpOrderId: rz.id,
      amount: rz.amount,
      currency: 'INR',
      itemName: order.item_name,
      user: { name: req.user.name, email: req.user.email, phone: req.user.phone || '' },
    });
  })
);

// Browser reports success -> we verify signature AND ask Razorpay for the real payment status before delivering.
app.post(
  '/api/payments/razorpay/verify',
  requireAuth,
  checkoutLimiter,
  ah(async (req, res) => {
    const orderId = parseInt(req.body.order_id, 10) || 0;
    const rzpOrderId = cleanStr(req.body.razorpay_order_id, 100);
    const rzpPaymentId = cleanStr(req.body.razorpay_payment_id, 100);
    const signature = cleanStr(req.body.razorpay_signature, 200);

    const { rows } = await query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [orderId, req.user.id]);
    const order = rows[0];
    if (!order || order.razorpay_order_id !== rzpOrderId) return res.status(400).json({ error: 'Invalid order' });
    if (order.status === 'paid') return res.json({ ok: true, status: 'paid' });

    const expected = crypto.createHmac('sha256', RZP_KEY_SECRET).update(rzpOrderId + '|' + rzpPaymentId).digest('hex');
    if (!safeEqual(expected, signature)) {
      await query("UPDATE orders SET status='failed' WHERE id=$1 AND status='pending'", [order.id]);
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    let pay = await rzp('/payments/' + encodeURIComponent(rzpPaymentId), 'GET');
    if (pay.order_id !== rzpOrderId || Number(pay.amount) !== toPaise(order.amount)) {
      return res.status(400).json({ error: 'Payment details do not match the order' });
    }
    if (pay.status === 'authorized') {
      pay = await rzp('/payments/' + encodeURIComponent(rzpPaymentId) + '/capture', 'POST', { amount: pay.amount, currency: 'INR' });
    }
    if (pay.status !== 'captured') {
      return res.status(202).json({ ok: false, status: pay.status, error: 'Payment is not completed yet. If money was deducted, it will be confirmed automatically.' });
    }
    const done = await markPaid(order.id, rzpPaymentId);
    if (done && done.justPaid) notifyPaid(done.order);
    res.json({ ok: true, status: 'paid' });
  })
);

app.post(
  '/api/orders/:id/proof',
  requireAuth,
  checkoutLimiter,
  upload.single('proof'),
  ah(async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    const utr = cleanStr(req.body.utr, 40);
    const { rows } = await query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [id, req.user.id]);
    const o = rows[0];
    if (!o || o.method !== 'manual' || !['pending', 'awaiting_verification', 'rejected'].includes(o.status)) {
      if (req.file) safeUnlink(STORE_PROOFS, req.file.filename);
      return res.status(400).json({ error: 'This order cannot accept payment proof' });
    }
    if (!/^[A-Za-z0-9\-]{6,40}$/.test(utr)) {
      if (req.file) safeUnlink(STORE_PROOFS, req.file.filename);
      return res.status(400).json({ error: 'Enter a valid UTR / transaction ID (6 to 40 letters or numbers)' });
    }
    if (!req.file && !o.proof_file) return res.status(400).json({ error: 'Please upload the payment screenshot' });
    if (req.file && o.proof_file) safeUnlink(STORE_PROOFS, o.proof_file);
    await query("UPDATE orders SET utr=$1, proof_file=COALESCE($2, proof_file), status='awaiting_verification', admin_note=NULL WHERE id=$3", [
      utr,
      req.file ? req.file.filename : null,
      id,
    ]);
    res.json({ ok: true });
  })
);

/* ------------------------------ customer data ------------------------------ */
app.get(
  '/api/orders',
  requireAuth,
  ah(async (req, res) => {
    const { rows } = await query(
      `SELECT id,item_type,product_id,plan_id,item_name,amount,method,status,utr,invoice_no,admin_note,created_at,paid_at,
              (proof_file IS NOT NULL) AS has_proof
       FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200`,
      [req.user.id]
    );
    res.json({ orders: rows });
  })
);

app.get(
  '/api/my/products',
  requireAuth,
  ah(async (req, res) => {
    const { rows } = await query(
      `SELECT DISTINCT ON (p.id) p.id,p.name,p.image_url,p.description,p.resell_allowed,p.resell_info,
              p.delivery_link, (p.file_name IS NOT NULL) AS has_file, p.file_original, o.id AS order_id, o.paid_at
       FROM orders o JOIN products p ON p.id=o.product_id
       WHERE o.user_id=$1 AND o.status='paid' ORDER BY p.id, o.paid_at DESC`,
      [req.user.id]
    );
    res.json({ products: rows });
  })
);

app.get(
  '/api/my/downloads',
  requireAuth,
  ah(async (req, res) => {
    const { rows } = await query(
      `SELECT d.id, d.created_at, p.name AS product FROM downloads d LEFT JOIN products p ON p.id=d.product_id
       WHERE d.user_id=$1 ORDER BY d.created_at DESC LIMIT 100`,
      [req.user.id]
    );
    res.json({ downloads: rows });
  })
);

app.get(
  '/api/my/stats',
  requireAuth,
  ah(async (req, res) => {
    const uid = req.user.id;
    const t = (
      await query(
        `SELECT COUNT(*) FILTER (WHERE status='paid')::int AS purchases,
                COALESCE(SUM(amount) FILTER (WHERE status='paid'),0)::float AS spent,
                COUNT(*) FILTER (WHERE status IN ('pending','awaiting_verification'))::int AS pending,
                COUNT(*) FILTER (WHERE status='paid' AND item_type='plan')::int AS plans
         FROM orders WHERE user_id=$1`,
        [uid]
      )
    ).rows[0];
    const dl = (await query('SELECT COUNT(*)::int AS c FROM downloads WHERE user_id=$1', [uid])).rows[0].c;
    const owned = (await query("SELECT COUNT(DISTINCT product_id)::int AS c FROM orders WHERE user_id=$1 AND status='paid' AND product_id IS NOT NULL", [uid])).rows[0].c;
    const monthly = (
      await query(
        `SELECT to_char(date_trunc('month', paid_at),'Mon YY') AS label, SUM(amount)::float AS total, COUNT(*)::int AS n
         FROM orders WHERE user_id=$1 AND status='paid' AND paid_at > now() - interval '6 months'
         GROUP BY date_trunc('month', paid_at) ORDER BY date_trunc('month', paid_at)`,
        [uid]
      )
    ).rows;
    res.json({ ...t, downloads: dl, owned, monthly });
  })
);

// Which tab passes the user owns (a verified paid order is required).
async function passAccess(userId) {
  const out = { all: false, topics: new Set() };
  if (!userId) return out;
  const { rows } = await query(
    "SELECT item_type, topic_id FROM orders WHERE user_id=$1 AND status='paid' AND item_type IN ('topic','all_access')",
    [userId]
  );
  rows.forEach((r) => {
    if (r.item_type === 'all_access') out.all = true;
    else if (r.topic_id) out.topics.add(r.topic_id);
  });
  return out;
}

// Access rule for content: free samples need only a login; everything else needs the tab pass, All Tabs Access, or a paid order for that exact item.
async function accessProduct(userId, pid) {
  const p = (
    await query(
      'SELECT id,name,topic_id,content_type,is_free,is_active,file_name,file_original,delivery_link,video_url FROM products WHERE id=$1',
      [pid]
    )
  ).rows[0];
  if (!p) return null;
  if (p.is_free && p.is_active) return { p, orderId: null };
  const o = (
    await query("SELECT id FROM orders WHERE user_id=$1 AND product_id=$2 AND status='paid' ORDER BY paid_at DESC LIMIT 1", [userId, pid])
  ).rows[0];
  if (o) return { p, orderId: o.id };
  if (p.topic_id && p.is_active) {
    const pa = await passAccess(userId);
    if (pa.all || pa.topics.has(p.topic_id)) return { p, orderId: null };
  }
  return null;
}

app.get(
  '/api/topics',
  ah(async (req, res) => {
    const { rows } = await query(
      `SELECT t.id, t.title, t.icon_url, t.price::float AS price, COUNT(p.id) FILTER (WHERE p.is_active)::int AS items
       FROM topics t LEFT JOIN products p ON p.topic_id=t.id
       WHERE t.is_active GROUP BY t.id ORDER BY t.sort_order, t.id`
    );
    const pa = await passAccess(req.user && req.user.id);
    rows.forEach((t) => (t.locked = !(pa.all || pa.topics.has(t.id))));
    const st = await getSettings();
    res.json({ topics: rows, all_access: pa.all, all_access_price: Number(st.all_access_price || 999) });
  })
);

app.get(
  '/api/topics/:id',
  ah(async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    const topic = (await query('SELECT id,title,icon_url,price::float AS price FROM topics WHERE id=$1 AND is_active', [id])).rows[0];
    if (!topic) return res.status(404).json({ error: 'Tab not found' });
    const { rows: items } = await query(
      `SELECT p.id,p.name,p.description,p.price,p.image_url,p.content_type,p.is_free
       FROM products p WHERE p.topic_id=$1 AND p.is_active ORDER BY p.created_at DESC`,
      [id]
    );
    const pa = await passAccess(req.user && req.user.id);
    const access = pa.all || pa.topics.has(id);
    let direct = new Set();
    if (req.user && items.length) {
      const o = await query("SELECT DISTINCT product_id FROM orders WHERE user_id=$1 AND status='paid' AND product_id = ANY($2::int[])", [
        req.user.id,
        items.map((i) => i.id),
      ]);
      direct = new Set(o.rows.map((r) => r.product_id));
    }
    items.forEach((i) => (i.owned = access || direct.has(i.id) || (i.is_free && !!req.user)));
    const st = await getSettings();
    res.json({ topic, items, access, all_access: pa.all, all_access_price: Number(st.all_access_price || 999) });
  })
);

app.get(
  '/api/my/access',
  requireAuth,
  ah(async (req, res) => {
    const pa = await passAccess(req.user.id);
    const { rows } = await query('SELECT id,title FROM topics WHERE is_active ORDER BY sort_order, id');
    res.json({ all: pa.all, topics: rows.filter((t) => pa.all || pa.topics.has(t.id)) });
  })
);

// What the customer may see after unlocking an item (links are never sent to people who have not unlocked it).
app.get(
  '/api/content/:id/open',
  requireAuth,
  ah(async (req, res) => {
    const a = await accessProduct(req.user.id, parseInt(req.params.id, 10) || 0);
    if (!a) return res.status(403).json({ error: 'Please buy this content to open it' });
    const p = a.p;
    res.json({
      name: p.name,
      type: p.content_type,
      video_url: p.video_url,
      delivery_link: p.delivery_link,
      has_file: !!p.file_name,
      ext: p.file_name ? path.extname(p.file_name).slice(1).toLowerCase() : '',
    });
  })
);

// In-browser viewing / streaming of the private file (PDF, video). Supports seeking in videos.
const INLINE_EXT = new Set(['.pdf', '.mp4', '.webm', '.mov', '.m4v', '.mp3', '.png', '.jpg', '.jpeg', '.webp', '.gif']);
app.get(
  '/api/view/:id',
  requireAuth,
  ah(async (req, res) => {
    const a = await accessProduct(req.user.id, parseInt(req.params.id, 10) || 0);
    if (!a) return res.status(403).send('Not allowed');
    if (!a.p.file_name) return res.status(404).send('No file');
    const full = path.join(STORE_PRODUCTS, path.basename(a.p.file_name));
    if (!fs.existsSync(full)) return res.status(404).send('File missing');
    const inline = INLINE_EXT.has(path.extname(full).toLowerCase());
    res.setHeader('Content-Disposition', (inline ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(a.p.file_original || 'file'));
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(full);
  })
);

app.get(
  '/api/download/:productId',
  requireAuth,
  ah(async (req, res) => {
    const pid = parseInt(req.params.productId, 10) || 0;
    const a = await accessProduct(req.user.id, pid);
    if (!a) return res.status(403).json({ error: 'You have not purchased this product' });
    const r = a.p;
    if (!r.file_name) return res.status(404).json({ error: 'File is not uploaded yet. Please contact support.' });
    const full = path.join(STORE_PRODUCTS, path.basename(r.file_name));
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'File not found. Please contact support.' });
    await query('INSERT INTO downloads(user_id,product_id,order_id,ip) VALUES ($1,$2,$3,$4)', [req.user.id, pid, a.orderId, req.ip]);
    res.download(full, r.file_original || r.name);
  })
);

app.get(
  '/api/orders/:id/invoice',
  requireAuth,
  ah(async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    const isAdmin = req.user.role === 'admin';
    const { rows } = await query(
      `SELECT o.*, u.name AS cname, u.email AS cemail, u.phone AS cphone FROM orders o JOIN users u ON u.id=o.user_id
       WHERE o.id=$1 ${isAdmin ? '' : 'AND o.user_id=$2'}`,
      isAdmin ? [id] : [id, req.user.id]
    );
    const o = rows[0];
    if (!o || o.status !== 'paid') return res.status(404).send('Invoice is available only for paid orders');
    const s = await getSettings();
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(o.invoice_no)}</title>
<style>body{font-family:Arial,sans-serif;max-width:720px;margin:30px auto;padding:0 16px;color:#111}
h1{color:#0a1630;margin:0}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:10px;border-bottom:1px solid #ddd;text-align:left}
.r{text-align:right}.tag{color:#555;font-size:13px}button{margin-top:20px;padding:10px 18px;background:#2f6bff;color:#fff;border:0;border-radius:6px;cursor:pointer}
@media print{button{display:none}}</style></head><body>
<h1>${esc(s.company_name || 'BIZNEXT DIGITAL COMPANY')}</h1><div class="tag">${esc(s.tagline || '')}</div><hr>
<h2>INVOICE ${esc(o.invoice_no)}</h2>
<p><b>Date:</b> ${new Date(o.paid_at).toLocaleDateString('en-IN')}<br><b>Order #:</b> ${o.id}<br><b>Payment method:</b> ${o.method === 'razorpay' ? 'Razorpay (online)' : 'Manual UPI / QR (verified)'}
${o.razorpay_payment_id ? '<br><b>Payment ID:</b> ' + esc(o.razorpay_payment_id) : ''}${o.utr ? '<br><b>UTR:</b> ' + esc(o.utr) : ''}</p>
<p><b>Billed to:</b><br>${esc(o.cname)}<br>${esc(o.cemail)}<br>${esc(o.cphone || '')}</p>
<table><tr><th>Item</th><th class="r">Amount (INR)</th></tr><tr><td>${esc(o.item_name)}</td><td class="r">${Number(o.amount).toFixed(2)}</td></tr>
<tr><th class="r">Total</th><th class="r">${Number(o.amount).toFixed(2)}</th></tr></table>
<p class="tag">${esc(s.invoice_note || '')}</p><button id="printBtn">Print / Save as PDF</button><script src="/js/print.js"></script></body></html>`);
  })
);

/* ------------------------------ admin ------------------------------ */
const admin = express.Router();
admin.use(requireAdmin);

admin.get(
  '/stats',
  ah(async (req, res) => {
    const a = (
      await query(
        `SELECT (SELECT COUNT(*)::int FROM users WHERE role='customer') AS customers,
                (SELECT COUNT(*)::int FROM orders) AS orders,
                (SELECT COUNT(*)::int FROM orders WHERE status='paid') AS paid_orders,
                (SELECT COALESCE(SUM(amount),0)::float FROM orders WHERE status='paid') AS revenue,
                (SELECT COUNT(*)::int FROM orders WHERE status='awaiting_verification') AS to_verify,
                (SELECT COUNT(*)::int FROM products WHERE is_active) AS products,
                (SELECT COUNT(*)::int FROM downloads) AS downloads`
      )
    ).rows[0];
    const recent = (
      await query(
        `SELECT o.id,o.item_name,o.amount,o.status,o.method,o.created_at,u.name AS customer
         FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 8`
      )
    ).rows;
    res.json({ ...a, recent });
  })
);

admin.get(
  '/analytics',
  ah(async (req, res) => {
    const cfg = {
      daily: { unit: 'day', span: '30 days', fmt: 'DD Mon' },
      weekly: { unit: 'week', span: '84 days', fmt: 'DD Mon' },
      monthly: { unit: 'month', span: '12 months', fmt: 'Mon YY' },
    }[req.query.range] || { unit: 'day', span: '30 days', fmt: 'DD Mon' };
    // cfg values come from the fixed map above (never from user input)
    const sales = (
      await query(
        `SELECT to_char(date_trunc('${cfg.unit}', paid_at), '${cfg.fmt}') AS label, SUM(amount)::float AS revenue, COUNT(*)::int AS orders
         FROM orders WHERE status='paid' AND paid_at > now() - interval '${cfg.span}'
         GROUP BY date_trunc('${cfg.unit}', paid_at) ORDER BY date_trunc('${cfg.unit}', paid_at)`
      )
    ).rows;
    const growth = (
      await query(
        `SELECT to_char(date_trunc('month', created_at),'Mon YY') AS label, COUNT(*)::int AS customers
         FROM users WHERE role='customer' AND created_at > now() - interval '12 months'
         GROUP BY date_trunc('month', created_at) ORDER BY date_trunc('month', created_at)`
      )
    ).rows;
    const performance = (
      await query(
        `SELECT item_name AS name, COUNT(*)::int AS sales, SUM(amount)::float AS revenue
         FROM orders WHERE status='paid' GROUP BY item_name ORDER BY revenue DESC LIMIT 10`
      )
    ).rows;
    const methods = (await query(`SELECT COALESCE(method,'-') AS method, COUNT(*)::int AS n FROM orders WHERE status='paid' GROUP BY method`)).rows;
    res.json({ sales, growth, performance, methods });
  })
);

/* products */
const productUpload = upload.fields([{ name: 'image', maxCount: 1 }, { name: 'file', maxCount: 1 }]);

function productFields(b) {
  const price = Number(b.price);
  if (!(price >= 0) || price > 10000000) throw Object.assign(new Error('Enter a valid price'), { status: 400 });
  const name = cleanStr(b.name, 150);
  if (!name) throw Object.assign(new Error('Product name is required'), { status: 400 });
  const videoUrl = cleanStr(b.video_url, 500);
  if (videoUrl && !/^https:\/\/\S+$/.test(videoUrl)) throw Object.assign(new Error('Video link must start with https://'), { status: 400 });
  if (bool(b.is_free) && !(parseInt(b.topic_id, 10) > 0)) throw Object.assign(new Error('Choose a Home tab for free content'), { status: 400 });
  if (!bool(b.is_free) && !(parseInt(b.topic_id, 10) > 0) && !(price > 0)) throw Object.assign(new Error('Price must be more than 0, or choose a Home tab (items in a tab open with the tab pass)'), { status: 400 });
  const link = cleanStr(b.delivery_link, 500);
  if (link && !/^https:\/\/\S+$/.test(link)) throw Object.assign(new Error('Course / delivery link must start with https://'), { status: 400 });
  return {
    delivery_link: link || null,
    topic_id: parseInt(b.topic_id, 10) || null,
    content_type: ['product', 'ebook', 'pdf', 'video', 'course', 'software'].includes(b.content_type) ? b.content_type : 'product',
    is_free: bool(b.is_free),
    video_url: videoUrl || null,
    name,
    category_id: parseInt(b.category_id, 10) || null,
    description: cleanStr(b.description, 5000),
    features: cleanStr(b.features, 3000),
    price,
    preview_url: cleanStr(b.preview_url, 500) || null,
    resell_allowed: bool(b.resell_allowed),
    resell_info: cleanStr(b.resell_info, 1000),
    is_active: b.is_active === undefined ? true : bool(b.is_active),
  };
}

admin.get(
  '/products',
  ah(async (req, res) => {
    const { rows } = await query(
      `SELECT p.*, c.name AS category FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.created_at DESC`
    );
    res.json({ products: rows });
  })
);

admin.post(
  '/products',
  productUpload,
  ah(async (req, res) => {
    const f = productFields(req.body);
    const img = req.files && req.files.image && req.files.image[0];
    const file = req.files && req.files.file && req.files.file[0];
    const { rows } = await query(
      `INSERT INTO products(category_id,name,description,features,price,image_url,preview_url,file_name,file_original,resell_allowed,resell_info,is_active,delivery_link,topic_id,content_type,is_free,video_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
      [
        f.category_id, f.name, f.description, f.features, f.price,
        img ? '/uploads/' + img.filename : cleanStr(req.body.image_url, 500) || null,
        f.preview_url, file ? file.filename : null, file ? cleanStr(file.originalname, 200) : null,
        f.resell_allowed, f.resell_info, f.is_active, f.delivery_link, f.topic_id, f.content_type, f.is_free, f.video_url,
      ]
    );
    res.json({ ok: true, id: rows[0].id });
  })
);

admin.put(
  '/products/:id',
  productUpload,
  ah(async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    const old = (await query('SELECT * FROM products WHERE id=$1', [id])).rows[0];
    if (!old) return res.status(404).json({ error: 'Not found' });
    const f = productFields(req.body);
    const img = req.files && req.files.image && req.files.image[0];
    const file = req.files && req.files.file && req.files.file[0];
    let imageUrl = old.image_url;
    if (img) {
      if (old.image_url && old.image_url.startsWith('/uploads/')) safeUnlink(UPLOADS, old.image_url.slice(9));
      imageUrl = '/uploads/' + img.filename;
    } else if (req.body.image_url !== undefined && req.body.image_url !== '') {
      imageUrl = cleanStr(req.body.image_url, 500);
    }
    if (file) safeUnlink(STORE_PRODUCTS, old.file_name);
    await query(
      `UPDATE products SET category_id=$1,name=$2,description=$3,features=$4,price=$5,image_url=$6,preview_url=$7,
         file_name=$8,file_original=$9,resell_allowed=$10,resell_info=$11,is_active=$12,delivery_link=$13,topic_id=$14,content_type=$15,is_free=$16,video_url=$17 WHERE id=$18`,
      [
        f.category_id, f.name, f.description, f.features, f.price, imageUrl, f.preview_url,
        file ? file.filename : old.file_name, file ? cleanStr(file.originalname, 200) : old.file_original,
        f.resell_allowed, f.resell_info, f.is_active, f.delivery_link, f.topic_id, f.content_type, f.is_free, f.video_url, id,
      ]
    );
    res.json({ ok: true });
  })
);

admin.delete(
  '/products/:id',
  ah(async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    const used = (await query('SELECT COUNT(*)::int AS c FROM orders WHERE product_id=$1', [id])).rows[0].c;
    if (used > 0) {
      // customers already bought it -> keep their access, just hide it from the store
      await query('UPDATE products SET is_active=false WHERE id=$1', [id]);
      return res.json({ ok: true, hidden: true, message: 'This product has orders, so it was hidden from the store instead of deleted.' });
    }
    const old = (await query('DELETE FROM products WHERE id=$1 RETURNING image_url,file_name', [id])).rows[0];
    if (old) {
      if (old.image_url && old.image_url.startsWith('/uploads/')) safeUnlink(UPLOADS, old.image_url.slice(9));
      safeUnlink(STORE_PRODUCTS, old.file_name);
    }
    res.json({ ok: true });
  })
);

/* plans */
admin.get(
  '/plans',
  ah(async (req, res) => {
    const { rows } = await query('SELECT * FROM plans ORDER BY sort_order, id');
    res.json({ plans: rows });
  })
);
admin.put(
  '/plans/:id',
  ah(async (req, res) => {
    const price = Number(req.body.price);
    if (!(price > 0)) return res.status(400).json({ error: 'Enter a valid price' });
    await query('UPDATE plans SET name=$1, price=$2, features=$3, notes=$4, badge=$5, is_active=$6 WHERE id=$7', [
      cleanStr(req.body.name, 150), price, cleanStr(req.body.features, 3000), cleanStr(req.body.notes, 3000),
      cleanStr(req.body.badge, 40), bool(req.body.is_active), parseInt(req.params.id, 10) || 0,
    ]);
    res.json({ ok: true });
  })
);

/* orders */
admin.get(
  '/orders',
  ah(async (req, res) => {
    const params = [];
    let where = '';
    if (req.query.status) {
      params.push(cleanStr(req.query.status, 30));
      where = 'WHERE o.status=$1';
    }
    const { rows } = await query(
      `SELECT o.id,o.item_type,o.item_name,o.amount,o.method,o.status,o.utr,o.details,o.admin_note,o.invoice_no,o.created_at,o.paid_at,
              o.razorpay_payment_id,(o.proof_file IS NOT NULL) AS has_proof,u.name AS customer,u.email,u.phone
       FROM orders o JOIN users u ON u.id=o.user_id ${where} ORDER BY o.created_at DESC LIMIT 300`,
      params
    );
    res.json({ orders: rows });
  })
);

admin.get(
  '/orders/:id/proof',
  ah(async (req, res) => {
    const { rows } = await query('SELECT proof_file FROM orders WHERE id=$1', [parseInt(req.params.id, 10) || 0]);
    if (!rows[0] || !rows[0].proof_file) return res.status(404).send('No proof');
    const full = path.join(STORE_PROOFS, path.basename(rows[0].proof_file));
    if (!fs.existsSync(full)) return res.status(404).send('File missing');
    res.sendFile(full);
  })
);

admin.post(
  '/orders/:id/approve',
  ah(async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    const o = (await query('SELECT * FROM orders WHERE id=$1', [id])).rows[0];
    if (!o) return res.status(404).json({ error: 'Not found' });
    if (o.method !== 'manual' || o.status !== 'awaiting_verification') {
      return res.status(400).json({ error: 'Only manual orders waiting for verification can be approved' });
    }
    const done = await markPaid(id, null);
    if (done && done.justPaid) notifyPaid(done.order);
    res.json({ ok: true });
  })
);

admin.post(
  '/orders/:id/reject',
  ah(async (req, res) => {
    const r = await query(
      "UPDATE orders SET status='rejected', admin_note=$1 WHERE id=$2 AND method='manual' AND status IN ('awaiting_verification','pending') RETURNING id",
      [cleanStr(req.body.note, 300) || 'Payment could not be verified', parseInt(req.params.id, 10) || 0]
    );
    if (!r.rows[0]) return res.status(400).json({ error: 'Cannot reject this order' });
    res.json({ ok: true });
  })
);

admin.post(
  '/orders/:id/refund',
  ah(async (req, res) => {
    // Marks as refunded (downloads stop). The actual money refund is done from Razorpay dashboard / your bank.
    const r = await query(
      "UPDATE orders SET status='refunded', admin_note=$1 WHERE id=$2 AND status='paid' RETURNING id,product_id",
      [cleanStr(req.body.note, 300) || 'Refunded', parseInt(req.params.id, 10) || 0]
    );
    if (!r.rows[0]) return res.status(400).json({ error: 'Only paid orders can be marked refunded' });
    if (r.rows[0].product_id) await query('UPDATE products SET sales_count = GREATEST(sales_count - 1, 0) WHERE id=$1', [r.rows[0].product_id]);
    res.json({ ok: true });
  })
);

/* customers */
admin.get(
  '/customers',
  ah(async (req, res) => {
    const { rows } = await query(
      `SELECT u.id,u.name,u.email,u.phone,u.email_verified,u.is_blocked,u.created_at,
              COUNT(o.id) FILTER (WHERE o.status='paid')::int AS orders,
              COALESCE(SUM(o.amount) FILTER (WHERE o.status='paid'),0)::float AS spent
       FROM users u LEFT JOIN orders o ON o.user_id=u.id WHERE u.role='customer'
       GROUP BY u.id ORDER BY u.created_at DESC LIMIT 500`
    );
    res.json({ customers: rows });
  })
);
admin.post(
  '/customers/:id/block',
  ah(async (req, res) => {
    await query("UPDATE users SET is_blocked=$1 WHERE id=$2 AND role='customer'", [bool(req.body.blocked), parseInt(req.params.id, 10) || 0]);
    res.json({ ok: true });
  })
);

/* settings: branding, WhatsApp, UPI + QR */
admin.get(
  '/settings',
  ah(async (req, res) => res.json({ settings: await getSettings() }))
);
admin.put(
  '/settings',
  ah(async (req, res) => {
    const b = req.body;
    if (b.whatsapp_number !== undefined) {
      const n = String(b.whatsapp_number).replace(/\D/g, '');
      if (n.length < 10 || n.length > 15) return res.status(400).json({ error: 'WhatsApp number must include country code, e.g. 919376998999' });
      await setSetting('whatsapp_number', n);
    }
    if (b.upi_id !== undefined) {
      const u = cleanStr(b.upi_id, 80);
      if (u && !/^[\w.\-]{2,}@[A-Za-z]{2,}$/.test(u)) return res.status(400).json({ error: 'Enter a valid UPI ID like name@bank' });
      await setSetting('upi_id', u);
    }
    if (b.all_access_price !== undefined) {
      const n = Number(b.all_access_price);
      if (!(n > 0) || n > 1000000) return res.status(400).json({ error: 'Enter a valid price' });
      await setSetting('all_access_price', String(n));
    }
    if (b.manual_enabled !== undefined) await setSetting('manual_enabled', bool(b.manual_enabled) ? 'true' : 'false');
    for (const k of ['company_name', 'tagline', 'support_email', 'payment_instructions', 'invoice_note']) {
      if (b[k] !== undefined) await setSetting(k, cleanStr(b[k], 1000));
    }
    res.json({ ok: true });
  })
);
admin.post(
  '/settings/qr',
  upload.single('qr'),
  ah(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Choose an image file' });
    const s = await getSettings();
    if (s.qr_url && s.qr_url.startsWith('/uploads/')) safeUnlink(UPLOADS, s.qr_url.slice(9));
    await setSetting('qr_url', '/uploads/' + req.file.filename);
    res.json({ ok: true, qr_url: '/uploads/' + req.file.filename });
  })
);
admin.delete(
  '/settings/qr',
  ah(async (req, res) => {
    const s = await getSettings();
    if (s.qr_url && s.qr_url.startsWith('/uploads/')) safeUnlink(UPLOADS, s.qr_url.slice(9));
    await setSetting('qr_url', '');
    res.json({ ok: true });
  })
);
admin.post(
  '/settings/logo',
  upload.single('logo'),
  ah(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Choose an image file' });
    const s = await getSettings();
    if (s.logo_url && s.logo_url.startsWith('/uploads/')) safeUnlink(UPLOADS, s.logo_url.slice(9));
    await setSetting('logo_url', '/uploads/' + req.file.filename);
    res.json({ ok: true });
  })
);
admin.delete(
  '/settings/logo',
  ah(async (req, res) => {
    const s = await getSettings();
    if (s.logo_url && s.logo_url.startsWith('/uploads/')) safeUnlink(UPLOADS, s.logo_url.slice(9));
    await setSetting('logo_url', '');
    res.json({ ok: true });
  })
);

/* home tabs (topics) */
admin.get(
  '/topics',
  ah(async (req, res) => {
    const { rows } = await query(
      `SELECT t.id,t.title,t.icon_url,t.sort_order,t.is_active,t.price::float AS price, COUNT(p.id)::int AS items
       FROM topics t LEFT JOIN products p ON p.topic_id=t.id GROUP BY t.id ORDER BY t.sort_order, t.id`
    );
    res.json({ topics: rows });
  })
);
admin.post(
  '/topics',
  upload.single('icon'),
  ah(async (req, res) => {
    const title = cleanStr(req.body.title, 80);
    const price = Number(req.body.price === undefined || req.body.price === '' ? 199 : req.body.price);
    if (!(price > 0) || price > 1000000) {
      if (req.file) safeUnlink(UPLOADS, req.file.filename);
      return res.status(400).json({ error: 'Enter a valid tab pass price' });
    }
    if (!title) {
      if (req.file) safeUnlink(UPLOADS, req.file.filename);
      return res.status(400).json({ error: 'Enter the tab name' });
    }
    const r = await query('INSERT INTO topics(title,icon_url,sort_order,is_active,price) VALUES ($1,$2,$3,$4,$5) RETURNING id', [
      title,
      req.file ? '/uploads/' + req.file.filename : null,
      parseInt(req.body.sort_order, 10) || 0,
      req.body.is_active === undefined ? true : bool(req.body.is_active),
      price,
    ]);
    res.json({ ok: true, id: r.rows[0].id });
  })
);
admin.put(
  '/topics/:id',
  upload.single('icon'),
  ah(async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    const old = (await query('SELECT * FROM topics WHERE id=$1', [id])).rows[0];
    if (!old) return res.status(404).json({ error: 'Not found' });
    const title = cleanStr(req.body.title, 80);
    const price = Number(req.body.price === undefined || req.body.price === '' ? 199 : req.body.price);
    if (!(price > 0) || price > 1000000) {
      if (req.file) safeUnlink(UPLOADS, req.file.filename);
      return res.status(400).json({ error: 'Enter a valid tab pass price' });
    }
    if (!title) return res.status(400).json({ error: 'Enter the tab name' });
    let icon = old.icon_url;
    if (req.file) {
      if (icon && icon.startsWith('/uploads/')) safeUnlink(UPLOADS, icon.slice(9));
      icon = '/uploads/' + req.file.filename;
    } else if (bool(req.body.remove_icon)) {
      if (icon && icon.startsWith('/uploads/')) safeUnlink(UPLOADS, icon.slice(9));
      icon = null;
    }
    await query('UPDATE topics SET title=$1, icon_url=$2, sort_order=$3, is_active=$4, price=$5 WHERE id=$6', [
      title, icon, parseInt(req.body.sort_order, 10) || 0, bool(req.body.is_active), price, id,
    ]);
    res.json({ ok: true });
  })
);
admin.delete(
  '/topics/:id',
  ah(async (req, res) => {
    // content inside the tab is kept (it just becomes "no tab"), so nothing customers bought is lost
    const old = (await query('DELETE FROM topics WHERE id=$1 RETURNING icon_url', [parseInt(req.params.id, 10) || 0])).rows[0];
    if (old && old.icon_url && old.icon_url.startsWith('/uploads/')) safeUnlink(UPLOADS, old.icon_url.slice(9));
    res.json({ ok: true });
  })
);

app.use('/api/admin', admin);

/* ------------------------------ static + errors ------------------------------ */
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
// Flat repo: only whitelisted website files are served (server.js, db.js, schema.sql are never exposed).
const PAGES = new Set(fs.readdirSync(ROOT).filter((f) => /^[\w-]+\.html$/.test(f)));
app.get('/style.css', (req, res) => res.sendFile('style.css', { root: ROOT }));
app.get('/js/:name', (req, res, next) => {
  const f = 'fe-' + path.basename(req.params.name);
  if (/^fe-[\w-]+\.js$/.test(f) && fs.existsSync(path.join(ROOT, f))) return res.sendFile(f, { root: ROOT });
  next();
});
app.use('/uploads', express.static(UPLOADS, { maxAge: PROD ? '1h' : 0 }));
app.get('/', (req, res) => res.sendFile('index.html', { root: ROOT }));
app.get('/:page', (req, res, next) => {
  const p = req.params.page.endsWith('.html') ? req.params.page : req.params.page + '.html';
  if (PAGES.has(p)) return res.sendFile(p, { root: ROOT });
  next();
});
app.use((req, res) => res.status(404).sendFile('404.html', { root: ROOT }));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `File too large (max ${MAX_MB} MB)` : err.message });
  if (err && err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  if (err && /Only PNG, JPG/.test(err.message)) return res.status(400).json({ error: err.message });
  if (err && err.code === '23505') return res.status(409).json({ error: 'Duplicate entry' });
  logError(err, req);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

process.on('unhandledRejection', (e) => logError(e));

async function bootstrap() {
  // creates / updates tables and default data (safe to run on every start)
  await pool.query(fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8'));
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const pass = process.env.ADMIN_PASSWORD || '';
  if (email && pass.length >= 10) {
    // creates the admin once; an existing password is never overwritten
    await pool.query(
      `INSERT INTO users(name,email,password_hash,role,email_verified) VALUES ($1,$2,$3,'admin',true)
       ON CONFLICT (email) DO UPDATE SET role='admin', email_verified=true`,
      [process.env.ADMIN_NAME || 'Super Admin', email, await bcrypt.hash(pass, 12)]
    );
    console.log('Admin account ready:', email);
  } else {
    console.log('ADMIN_EMAIL / ADMIN_PASSWORD (min 10 chars) not set - no admin created.');
  }
}

if (require.main === module) {
  bootstrap()
    .then(() => app.listen(PORT, () => console.log(`BIZNEXT DIGITAL COMPANY running on port ${PORT}`)))
    .catch((e) => { logError(e); console.error('Startup failed:', e.message); process.exit(1); });
}
module.exports = app;

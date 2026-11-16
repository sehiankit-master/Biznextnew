# BIZNEXT DIGITAL COMPANY

Your Digital Business. Your Future. Your Success.

Node.js + PostgreSQL website: plans, digital store, AI Course, customer dashboard, admin panel, Razorpay and manual QR/UPI payments.

## Go live on Render (no computer needed)
1. Upload ALL files of this folder to a new GitHub repository (all files sit in one flat folder).
2. Render.com -> New -> **Blueprint** -> connect the repo. Render reads `render.yaml` and creates the web service and the database.
3. When asked, fill: `ADMIN_EMAIL`, `ADMIN_PASSWORD` (min 10 characters), `BASE_URL` (your Render URL, add it after the first deploy if unknown).
   Razorpay keys can be left empty at first: the site then accepts manual QR/UPI payments only.
4. Open the Render URL. Login with the admin email/password. Tables and the 3 plans are created automatically on every start.
5. Admin -> QR & UPI: upload your QR and UPI ID. Admin -> Products: add products. Admin -> Products -> AI Business Course: add the course link and tick "Visible in store".

## Razorpay (test mode first)
Add `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` in Render -> Environment. In Razorpay Dashboard add a webhook: `https://YOUR-URL/api/webhooks/razorpay` (events: payment.captured, order.paid, payment.failed) with the same secret.

## Free plan notes
- The free web service sleeps when idle (first load is slow) and its disk is temporary: uploaded QR, logo and product files can disappear on redeploy. Use product links (Admin -> delivery link) and a paid plan with a persistent disk for real business.
- Free Render databases can expire after a while; use a paid database for a real business.

## Home tabs and content (new)
The main page shows tiles (tabs). Admin -> **Home Tabs & Content**:
- **+ Add Tab** (name, order, optional icon), Edit tab, Delete tab.
- **Manage content** on a tab -> **+ Add E-book / PDF / Video**: upload a PDF or video file, or paste a YouTube / Vimeo / Google Drive link. Edit or Delete any item later.
- Tick **Free** for content any logged-in customer can open; otherwise set a price and customers buy it first.

Deploy: push these files to GitHub; Render redeploys automatically and updates the database by itself.

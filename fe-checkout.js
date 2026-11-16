(async function () {
  await BN.ready;
  if (!(await BN.requireLogin())) return;
  const esc = BN.esc;
  const q = new URLSearchParams(location.search);
  const type = q.get('type') === 'plan' ? 'plan' : 'product';
  const id = parseInt(q.get('id'), 10) || 0;
  const root = document.getElementById('root');

  let item, opts;
  try {
    opts = await BN.api('/api/payment-options');
    if (type === 'plan') {
      const { plans } = await BN.api('/api/plans');
      item = plans.find((p) => p.id === id);
    } else {
      item = (await BN.api('/api/products/' + id)).product;
    }
    if (!item) throw new Error('Item not found');
  } catch (e) {
    root.innerHTML = `<div class="card empty">${esc(e.message || 'Could not load checkout')}<br><br><a class="btn btn-primary" href="/#pricing">Back to plans</a></div>`;
    return;
  }

  const notes = type === 'plan' ? BN.lines(item.notes) : [];
  const feats = BN.lines(item.features);
  const methods = [];
  if (opts.razorpay) methods.push(['razorpay', 'Pay online (UPI / Cards / Net Banking)', 'Secure payment by Razorpay. Product / order is confirmed automatically after server verification.']);
  if (opts.manual) methods.push(['manual', 'Pay by QR / UPI ID (manual verification)', 'Pay using the QR or UPI ID, then submit the UTR and screenshot. Delivery after our team verifies the payment.']);
  let method = methods.length ? methods[0][0] : null;

  root.innerHTML = `
  <div class="checkout">
    <div>
      <div class="panel" id="step1">
        <h3>1. Order details</h3>
        ${type === 'plan' ? `<label for="details">Your business name / preferred domain name (optional)</label>
          <textarea id="details" maxlength="1000" placeholder="e.g. Business name, preferred domain, any special requirement"></textarea>` : '<p style="color:var(--muted)">You will get access in your dashboard after payment is verified.</p>'}
        ${notes.length ? `<div class="notes"><b>Please read before you pay</b><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
        <h3 style="margin-top:18px">2. Payment method</h3>
        ${methods.length ? methods.map(([k, t, d], i) => `<label class="paybox ${i === 0 ? 'sel' : ''}" data-m="${k}"><input type="radio" name="m" ${i === 0 ? 'checked' : ''}><span><b>${t}</b><br><small style="color:var(--muted);font-weight:400">${d}</small></span></label>`).join('')
          : '<div class="msg show err">No payment method is active right now. Please contact support on WhatsApp.</div>'}
        <label class="check"><input type="checkbox" id="agree"> <span>I have read and accept the <a href="/terms.html" target="_blank">Terms</a>, <a href="/refund-policy.html" target="_blank">Refund Policy</a>${type === 'product' ? ' and <a href="/reselling-policy.html" target="_blank">Reselling Policy</a>' : ''}.</span></label>
        <div id="msg" class="msg"></div>
        <button class="btn btn-gold btn-block" id="payBtn" ${methods.length ? '' : 'disabled'}>Pay ${BN.inr(item.price)}</button>
      </div>
      <div class="panel hidden" id="manualBox"></div>
    </div>
    <div class="panel">
      <h3>Order summary</h3>
      <div style="font-weight:700">${esc(item.name)}</div>
      <div class="pprice" style="margin:6px 0 10px">${BN.inr(item.price)}</div>
      ${feats.length ? `<ul style="margin-left:18px;color:var(--muted);font-size:14px">${feats.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      ${type === 'product' ? `<div class="notes"><b>Reselling:</b> ${item.resell_allowed ? 'Allowed for this product. ' : 'Not available for this product. '}${esc(item.resell_info || '')}</div>` : ''}
      <p style="font-size:12.5px;color:var(--muted);margin-top:10px">Need help? <a data-wa="Hello, I need help with my order: ${esc(item.name)}" href="#">Chat on WhatsApp</a></p>
    </div>
  </div>`;
  BN.waButtons();

  document.querySelectorAll('.paybox').forEach((b) => (b.onclick = () => {
    document.querySelectorAll('.paybox').forEach((x) => { x.classList.remove('sel'); x.querySelector('input').checked = false; });
    b.classList.add('sel'); b.querySelector('input').checked = true; method = b.dataset.m;
  }));

  const msg = document.getElementById('msg');
  const btn = document.getElementById('payBtn');

  function loadRzp() {
    return new Promise((res, rej) => {
      if (window.Razorpay) return res();
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = res; s.onerror = () => rej(new Error('Could not load payment window. Check your internet.'));
      document.body.appendChild(s);
    });
  }

  btn.onclick = async () => {
    msg.className = 'msg';
    if (!document.getElementById('agree').checked) return BN.msg(msg, 'Please accept the terms to continue');
    btn.disabled = true;
    try {
      const details = document.getElementById('details') ? document.getElementById('details').value : '';
      const r = await BN.api('/api/checkout', { method: 'POST', body: { type, id, method, details } });
      if (r.method === 'manual') return showManual(r.orderId);
      await loadRzp();
      const rz = new window.Razorpay({
        key: r.key, amount: r.amount, currency: r.currency, name: BN.settings.company_name || 'BIZNEXT DIGITAL COMPANY',
        description: r.itemName, order_id: r.rzpOrderId,
        prefill: { name: r.user.name, email: r.user.email, contact: r.user.phone },
        theme: { color: '#2f6bff' },
        modal: { ondismiss: () => { btn.disabled = false; } },
        handler: async (resp) => {
          BN.msg(msg, 'Verifying your payment, please wait…', true);
          try {
            const v = await BN.api('/api/payments/razorpay/verify', { method: 'POST', body: { order_id: r.orderId, ...resp } });
            if (v.status === 'paid') {
              root.innerHTML = `<div class="card" style="max-width:560px;margin:40px auto;text-align:center"><div style="font-size:56px">✅</div><h2>Payment successful</h2>
                <p style="color:var(--muted);margin:8px 0 18px">Your order is confirmed${type === 'product' ? ' and your product is ready in your dashboard.' : '. Our team will contact you on WhatsApp / email to start your setup.'}</p>
                <a class="btn btn-primary" href="/dashboard.html">Go to Dashboard</a></div>`;
            } else BN.msg(msg, v.error || 'Payment is being confirmed. Check your dashboard in a few minutes.');
          } catch (err) { BN.msg(msg, err.message + ' If money was deducted, it will be confirmed automatically — check your dashboard or contact support.'); }
        },
      });
      rz.on('payment.failed', (f) => { BN.msg(msg, 'Payment failed: ' + ((f.error && f.error.description) || 'please try again')); btn.disabled = false; });
      rz.open();
    } catch (e) { BN.msg(msg, e.message); btn.disabled = false; }
  };

  function showManual(orderId) {
    document.getElementById('step1').classList.add('hidden');
    const box = document.getElementById('manualBox');
    box.classList.remove('hidden');
    box.innerHTML = `<h3>Pay ${BN.inr(item.price)} by QR / UPI</h3>
      ${opts.qr_url ? `<img class="qr" src="${esc(opts.qr_url)}" alt="Payment QR code">` : ''}
      ${opts.upi_id ? `<p style="text-align:center">UPI ID: <b id="upiId">${esc(opts.upi_id)}</b> <button class="btn btn-outline btn-sm" id="copyUpi" type="button">Copy</button></p>` : ''}
      <div class="notes" style="white-space:pre-line">${esc(opts.instructions)}</div>
      <form id="proofForm">
        <label for="utr">UTR / Transaction ID *</label><input id="utr" required minlength="6" maxlength="40" placeholder="12 digit UTR number">
        <label for="proof">Payment screenshot *</label><input id="proof" type="file" accept="image/*" required>
        <div id="pmsg" class="msg"></div>
        <button class="btn btn-gold btn-block" type="submit" style="margin-top:10px">Submit payment details</button>
      </form>`;
    const c = document.getElementById('copyUpi');
    if (c) c.onclick = () => { navigator.clipboard && navigator.clipboard.writeText(opts.upi_id); BN.toast('UPI ID copied'); };
    document.getElementById('proofForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData();
      fd.append('utr', document.getElementById('utr').value.trim());
      fd.append('proof', document.getElementById('proof').files[0]);
      try {
        await BN.api('/api/orders/' + orderId + '/proof', { method: 'POST', body: fd });
        box.innerHTML = `<div style="text-align:center"><div style="font-size:52px">🕒</div><h2>Payment submitted</h2>
          <p style="color:var(--muted);margin:8px 0 18px">Our team will verify your payment. You will get your order after verification. You can track it in your dashboard.</p>
          <a class="btn btn-primary" href="/dashboard.html">Go to Dashboard</a></div>`;
      } catch (err) { BN.msg('#pmsg', err.message); }
    };
  }
})();

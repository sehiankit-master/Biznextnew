/* Shared helpers: API, header, footer, WhatsApp button, toast */
(function () {
  const BN = (window.BN = {});
  BN.settings = {};
  BN.user = null;

  BN.esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  BN.inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  BN.date = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '-');
  BN.lines = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean);

  BN.api = async function (url, opts = {}) {
    const o = { credentials: 'same-origin', headers: { 'X-Requested-With': 'biznext' }, ...opts };
    o.headers = { 'X-Requested-With': 'biznext', ...(opts.headers || {}) };
    if (o.body && !(o.body instanceof FormData) && typeof o.body !== 'string') {
      o.headers['Content-Type'] = 'application/json';
      o.body = JSON.stringify(o.body);
    }
    const r = await fetch(url, o);
    let data = {};
    try { data = await r.json(); } catch (_) {}
    if (!r.ok && r.status !== 202) {
      const e = new Error(data.error || 'Request failed');
      e.status = r.status; e.data = data;
      throw e;
    }
    return data;
  };

  BN.toast = function (msg) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3500);
  };

  BN.msg = function (el, text, good) {
    if (typeof el === 'string') el = document.querySelector(el);
    if (!el) return;
    el.className = 'msg show ' + (good ? 'good' : 'err');
    el.textContent = text;
  };

  BN.statusTag = function (s) {
    const map = {
      paid: ['ok', 'Paid'], pending: ['gray', 'Payment pending'], awaiting_verification: ['warn', 'Verifying payment'],
      failed: ['no', 'Failed'], rejected: ['no', 'Rejected'], refunded: ['info', 'Refunded'],
    };
    const [c, l] = map[s] || ['gray', s];
    return `<span class="tag ${c}">${l}</span>`;
  };

  BN.requireLogin = async function (role) {
    await BN.loadUser();
    if (!BN.user) { location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search); return false; }
    if (role && BN.user.role !== role) { location.href = '/dashboard.html'; return false; }
    return true;
  };

  BN.loadUser = async function () {
    try { BN.user = (await BN.api('/api/me')).user; } catch (_) { BN.user = null; }
    return BN.user;
  };

  BN.logout = async function () {
    try { await BN.api('/api/auth/logout', { method: 'POST' }); } catch (_) {}
    location.href = '/';
  };

  const NAV = [
    ['/', 'Home'], ['/products.html', 'Digital Products'], ['/ai-course.html', 'AI Course'],
    ['/businesses.html', 'Business Models'], ['/#pricing', 'Pricing'], ['/contact.html', 'Contact'],
  ];

  function renderHeader() {
    const el = document.getElementById('site-header');
    if (!el) return;
    const s = BN.settings, u = BN.user;
    const name = s.company_name || 'BIZNEXT DIGITAL COMPANY';
    const here = location.pathname;
    const links = NAV.map(([h, t]) => `<a href="${h}" class="${h === here ? 'active' : ''}">${t}</a>`).join('');
    const logo = s.logo_url ? `<img src="${BN.esc(s.logo_url)}" alt="${BN.esc(name)}">` : `<span class="logo-mark">B</span>`;
    const right = u
      ? `<a class="btn btn-gold btn-sm" href="${u.role === 'admin' ? '/admin.html' : '/dashboard.html'}">${u.role === 'admin' ? 'Admin Panel' : 'My Dashboard'}</a>
         <button class="btn btn-ghost btn-sm" id="logoutBtn">Logout</button>`
      : `<a class="btn btn-ghost btn-sm" href="/login.html">Login</a><a class="btn btn-gold btn-sm" href="/register.html">Register</a>`;
    el.className = 'site-header';
    el.innerHTML = `<div class="container nav">
      <a class="brand" href="/">${logo}<span>${BN.esc(name.split(' ')[0])}<small>${BN.esc(name.split(' ').slice(1).join(' '))}</small></span></a>
      <nav class="nav-links" id="navLinks">${links}</nav>
      <div class="nav-cta">${right}<button class="burger" id="burger" aria-label="Menu">☰</button></div></div>`;
    document.getElementById('burger').onclick = () => document.getElementById('navLinks').classList.toggle('open');
    const lb = document.getElementById('logoutBtn');
    if (lb) lb.onclick = BN.logout;
  }

  function renderFooter() {
    const el = document.getElementById('site-footer');
    if (!el) return;
    const s = BN.settings;
    const name = s.company_name || 'BIZNEXT DIGITAL COMPANY';
    el.className = 'site-footer';
    el.innerHTML = `<div class="container"><div class="foot-grid">
      <div><h4>${BN.esc(name)}</h4><p style="font-size:14px">${BN.esc(s.tagline || '')}</p>
        <p style="font-size:14px;margin-top:8px">WhatsApp: <a style="display:inline" href="${waLink()}" target="_blank" rel="noopener">+${BN.esc(s.whatsapp_number || '')}</a></p></div>
      <div><h4>Company</h4><a href="/about.html">About Us</a><a href="/how-it-works.html">How It Works</a><a href="/faq.html">FAQ</a><a href="/contact.html">Contact Us</a></div>
      <div><h4>Shop</h4><a href="/products.html">Digital Products</a><a href="/ai-software.html">AI Software</a><a href="/ai-course.html">AI Course</a><a href="/businesses.html">Business Models</a><a href="/#pricing">Pricing Plans</a><a href="/login.html">Customer Login</a></div>
      <div><h4>Policies</h4><a href="/privacy-policy.html">Privacy Policy</a><a href="/terms.html">Terms &amp; Conditions</a><a href="/refund-policy.html">Refund Policy</a><a href="/reselling-policy.html">Reselling Policy</a></div>
    </div><div class="copy">© ${new Date().getFullYear()} ${BN.esc(name)}. All rights reserved. Earnings from any business depend on your own effort, market and product; no profit or income is guaranteed.</div></div>`;
  }

  function waLink(text) {
    const n = (BN.settings.whatsapp_number || '919376998999').replace(/\D/g, '');
    return 'https://wa.me/' + n + (text ? '?text=' + encodeURIComponent(text) : '');
  }
  BN.waLink = waLink;

  function renderWhatsApp() {
    if (document.querySelector('.wa-float')) return;
    const a = document.createElement('a');
    a.className = 'wa-float'; a.href = waLink('Hello BIZNEXT DIGITAL COMPANY, I need help.');
    a.target = '_blank'; a.rel = 'noopener'; a.setAttribute('aria-label', 'WhatsApp support');
    a.innerHTML = '<svg viewBox="0 0 32 32"><path d="M16 3C9 3 3.3 8.6 3.3 15.5c0 2.4.7 4.7 2 6.6L3 29l7.1-2.2a13 13 0 0 0 5.9 1.4c7 0 12.7-5.6 12.7-12.6S23 3 16 3zm0 23a10.6 10.6 0 0 1-5.4-1.5l-.4-.2-4.2 1.3 1.4-4.1-.3-.4A10.3 10.3 0 0 1 5.5 15.5C5.5 9.8 10.2 5.2 16 5.2s10.5 4.6 10.5 10.3S21.800 26 16 26zm5.800-7.700c-.3-.2-1.900-.9-2.200-1s-.5-.2-.7.200-.8 1-1 1.200-.4.200-.7.100a8.700 8.700 0 0 1-4.300-3.700c-.3-.6.300-.5.900-1.700.1-.2 0-.4 0-.5l-1-2.300c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.5.100-.8.400s-1 1-1 2.500 1.100 2.900 1.200 3.100 2.100 3.300 5.200 4.600c1.900.8 2.700.9 3.600.7.600-.1 1.900-.8 2.100-1.500.3-.7.300-1.400.2-1.500l-.5-.4z"/></svg>';
    document.body.appendChild(a);
  }

  BN.productCard = function (p) {
    const img = p.image_url ? `<img src="${BN.esc(p.image_url)}" alt="${BN.esc(p.name)}" loading="lazy">` : '🛍️';
    const resell = p.resell_allowed ? '<span class="tag ok">Reselling rights available</span>' : '<span class="tag gray">Personal use only</span>';
    const desc = BN.esc(p.description || '').slice(0, 110);
    return `<div class="card pcard reveal">
      <div class="pimg">${img}</div>
      <div class="pbody">
        <div class="pcat">${BN.esc(p.category || 'Digital Product')}</div>
        <h3>${BN.esc(p.name)}</h3>
        <p>${desc}${(p.description || '').length > 110 ? '…' : ''}</p>
        <div>${resell}</div>
        <div class="pprice">${p.is_free ? 'Free sample' : (p.topic_id && Number(p.price) <= 0) ? 'Tab pass' : BN.inr(p.price)}</div>
        <div class="pfoot">
          <a class="btn btn-outline btn-sm js-detail" data-id="${p.id}" href="/products.html?open=${p.id}">Details</a>
          ${(p.topic_id && (p.is_free || Number(p.price) <= 0)) ? `<a class="btn btn-gold btn-sm" href="/topic.html?id=${p.topic_id}">Open in tab</a>` : `<a class="btn btn-primary btn-sm" href="/checkout.html?type=product&id=${p.id}">Buy Now</a>`}
        </div>
      </div></div>`;
  };

  BN.reveal = function () {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 });
    document.querySelectorAll('.reveal:not(.in)').forEach((el) => io.observe(el));
  };

  BN.waButtons = function () {
    document.querySelectorAll('[data-wa]').forEach((a) => { a.href = waLink(a.getAttribute('data-wa') || ''); a.target = '_blank'; a.rel = 'noopener'; });
  };

  BN.ready = (async function () {
    await Promise.all([
      BN.api('/api/settings').then((s) => (BN.settings = s)).catch(() => {}),
      BN.loadUser(),
    ]);
    if (BN.settings.company_name) {
      document.title = document.title.replace('BIZNEXT DIGITAL COMPANY', BN.settings.company_name);
    }
    renderHeader(); renderFooter(); renderWhatsApp(); BN.waButtons(); BN.reveal();
  })();
})();

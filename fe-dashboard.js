(async function () {
  await BN.ready;
  if (!(await BN.requireLogin())) return;
  const esc = BN.esc;
  const main = document.getElementById('main');
  let tab = 'overview', chart = null, timer = null;

  document.getElementById('hello').textContent = 'Welcome, ' + BN.user.name;

  const tabs = {
    overview: renderOverview, products: renderProducts, orders: renderOrders, downloads: renderDownloads, profile: renderProfile,
  };

  document.querySelectorAll('.side button').forEach((b) => (b.onclick = () => go(b.dataset.tab)));
  function go(t) {
    tab = t;
    document.querySelectorAll('.side button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    clearInterval(timer);
    tabs[t]();
    if (t === 'overview' || t === 'orders') timer = setInterval(() => tab === t && tabs[t](true), 20000); // live refresh
  }

  async function renderOverview() {
    const [s, o] = await Promise.all([BN.api('/api/my/stats'), BN.api('/api/orders')]);
    const rows = o.orders.slice(0, 6).map((x) => `<tr><td>#${x.id}</td><td>${esc(x.item_name)}</td><td>${BN.inr(x.amount)}</td><td>${BN.statusTag(x.status)}</td><td>${BN.date(x.created_at)}</td></tr>`).join('');
    main.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h2>Overview</h2><span class="live">Live</span></div>
      <div class="stats">
        <div class="stat hl"><span>Total Purchases</span><b>${s.purchases}</b></div>
        <div class="stat hl"><span>Total Spent</span><b>${BN.inr(s.spent)}</b></div>
        <div class="stat"><span>Products Owned</span><b>${s.owned}</b></div>
        <div class="stat"><span>Business Plans</span><b>${s.plans}</b></div>
        <div class="stat"><span>Downloads</span><b>${s.downloads}</b></div>
        <div class="stat"><span>Pending Orders</span><b>${s.pending}</b></div>
      </div>
      <div class="panel"><h3>Purchase analytics (last 6 months)</h3><div class="chart-box"><canvas id="c1"></canvas></div></div>
      <div class="panel"><h3>Recent transactions</h3><div class="table-wrap">${rows ? `<table><tr><th>Order</th><th>Item</th><th>Amount</th><th>Status</th><th>Date</th></tr>${rows}</table>` : '<div class="empty">No orders yet. <a href="/#pricing">Choose a plan</a> or <a href="/products.html">browse products</a>.</div>'}</div></div>`;
    if (window.Chart) {
      if (chart) chart.destroy();
      chart = new Chart(document.getElementById('c1'), {
        type: 'bar',
        data: { labels: s.monthly.map((m) => m.label), datasets: [{ label: 'Amount (₹)', data: s.monthly.map((m) => m.total), backgroundColor: '#2f6bff', borderRadius: 8 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
      });
    }
  }

  async function renderProducts() {
    const { products } = await BN.api('/api/my/products');
    main.innerHTML = `<h2 style="margin-bottom:12px">Purchased Products</h2>` + (products.length
      ? `<div class="grid g2">${products.map((p) => `<div class="card">
          <h3>${esc(p.name)}</h3><p style="color:var(--muted);font-size:14px;margin:6px 0">Purchased ${BN.date(p.paid_at)}</p>
          <p style="margin-bottom:10px"><b>Reselling:</b> ${p.resell_allowed ? '<span class="tag ok">Allowed</span> ' + esc(p.resell_info) : '<span class="tag gray">Not available</span>'}</p>
          <div class="actions">${p.delivery_link ? `<a class="btn btn-gold btn-sm" href="${esc(p.delivery_link)}" target="_blank" rel="noopener noreferrer">▶ Open course / access</a>` : ''}
          ${p.has_file ? `<a class="btn btn-primary btn-sm" href="/api/download/${p.id}">⬇ Download</a>` : ''}
          ${!p.delivery_link && !p.has_file ? '<span class="tag warn">Content will be added soon — contact support</span>' : ''}</div>
        </div>`).join('')}</div>`
      : '<div class="panel empty">No purchased products yet. <a href="/products.html">Browse products</a></div>');
  }

  async function renderOrders() {
    const { orders } = await BN.api('/api/orders');
    main.innerHTML = `<h2 style="margin-bottom:12px">Order History</h2><div class="panel"><div class="table-wrap">${orders.length ? `<table>
      <tr><th>Order</th><th>Item</th><th>Amount</th><th>Method</th><th>Status</th><th>Date</th><th></th></tr>
      ${orders.map((x) => `<tr><td>#${x.id}</td><td>${esc(x.item_name)}</td><td>${BN.inr(x.amount)}</td><td>${x.method === 'manual' ? 'QR / UPI' : 'Online'}</td>
        <td>${BN.statusTag(x.status)}${x.admin_note ? `<div style="font-size:12px;color:var(--bad)">${esc(x.admin_note)}</div>` : ''}</td><td>${BN.date(x.created_at)}</td>
        <td class="actions">${x.status === 'paid' ? `<a class="btn btn-outline btn-sm" target="_blank" href="/api/orders/${x.id}/invoice">Invoice</a>` : ''}
          ${x.method === 'manual' && ['pending', 'rejected'].includes(x.status) ? `<button class="btn btn-gold btn-sm" data-proof="${x.id}">Submit payment proof</button>` : ''}</td></tr>`).join('')}
      </table>` : '<div class="empty">No orders yet.</div>'}</div></div>`;
    main.querySelectorAll('[data-proof]').forEach((b) => (b.onclick = () => proofModal(b.dataset.proof)));
  }

  function proofModal(orderId) {
    const bg = document.getElementById('modalBg');
    document.getElementById('modalBody').innerHTML = `<h3>Submit payment proof - Order #${orderId}</h3>
      <form id="pf"><label>UTR / Transaction ID</label><input id="utr" required minlength="6" maxlength="40">
      <label>Payment screenshot</label><input id="pr" type="file" accept="image/*" required><div id="pm" class="msg"></div>
      <div class="actions" style="margin-top:12px"><button class="btn btn-primary" type="submit">Submit</button><button class="btn btn-outline" type="button" id="cl">Cancel</button></div></form>`;
    bg.classList.add('show');
    document.getElementById('cl').onclick = () => bg.classList.remove('show');
    document.getElementById('pf').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(); fd.append('utr', document.getElementById('utr').value.trim()); fd.append('proof', document.getElementById('pr').files[0]);
      try { await BN.api('/api/orders/' + orderId + '/proof', { method: 'POST', body: fd }); bg.classList.remove('show'); BN.toast('Submitted for verification'); renderOrders(); }
      catch (err) { BN.msg('#pm', err.message); }
    };
  }

  async function renderDownloads() {
    const { downloads } = await BN.api('/api/my/downloads');
    main.innerHTML = `<h2 style="margin-bottom:12px">Download History</h2><div class="panel">${downloads.length ? `<div class="table-wrap"><table><tr><th>Product</th><th>Date</th></tr>${downloads.map((d) => `<tr><td>${esc(d.product || 'Removed product')}</td><td>${BN.date(d.created_at)}</td></tr>`).join('')}</table></div>` : '<div class="empty">No downloads yet.</div>'}</div>`;
  }

  function renderProfile() {
    const u = BN.user;
    main.innerHTML = `<h2 style="margin-bottom:12px">My Profile</h2>
      <div class="grid g2"><div class="panel"><h3>Profile details</h3>
        <form id="pf"><label>Name</label><input id="n" value="${esc(u.name)}" required minlength="2"><label>Email</label><input value="${esc(u.email)}" disabled>
        <label>Phone</label><input id="p" value="${esc(u.phone || '')}"><div id="m1" class="msg"></div><button class="btn btn-primary" style="margin-top:10px">Save</button></form></div>
      <div class="panel"><h3>Change password</h3><form id="pw"><label>Current password</label><input id="cur" type="password" required>
        <label>New password</label><input id="np" type="password" minlength="8" required><div id="m2" class="msg"></div><button class="btn btn-primary" style="margin-top:10px">Update password</button></form></div></div>`;
    document.getElementById('pf').onsubmit = async (e) => {
      e.preventDefault();
      try { await BN.api('/api/me', { method: 'PUT', body: { name: document.getElementById('n').value, phone: document.getElementById('p').value } }); BN.msg('#m1', 'Saved', true); }
      catch (err) { BN.msg('#m1', err.message); }
    };
    document.getElementById('pw').onsubmit = async (e) => {
      e.preventDefault();
      try { await BN.api('/api/me/password', { method: 'POST', body: { current: document.getElementById('cur').value, password: document.getElementById('np').value } }); BN.msg('#m2', 'Password updated', true); e.target.reset(); }
      catch (err) { BN.msg('#m2', err.message); }
    };
  }

  document.getElementById('modalBg').onclick = (e) => { if (e.target.id === 'modalBg') e.target.classList.remove('show'); };
  go('overview');
})();

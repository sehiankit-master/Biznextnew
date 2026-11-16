(async function () {
  await BN.ready;
  if (!(await BN.requireLogin('admin'))) return;
  const esc = BN.esc;
  const main = document.getElementById('main');
  const bg = document.getElementById('modalBg');
  const body = document.getElementById('modalBody');
  let tab = 'overview', timer = null, returnTopic = null;
  const charts = {};

  const tabs = { overview, analytics, topics, products, plans, orders, customers, payments, settings };
  document.querySelectorAll('.side button').forEach((b) => (b.onclick = () => go(b.dataset.tab)));
  bg.onclick = (e) => { if (e.target === bg) bg.classList.remove('show'); };
  const closeModal = () => bg.classList.remove('show');

  function go(t, arg) {
    tab = t;
    document.querySelectorAll('.side button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    clearInterval(timer);
    tabs[t](arg);
    if (t === 'overview') timer = setInterval(() => tab === 'overview' && overview(true), 15000);
  }

  function chart(id, cfg) {
    if (!window.Chart) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(document.getElementById(id), cfg);
  }
  const opt = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } };

  /* ---------- overview ---------- */
  async function overview() {
    const [s, a] = await Promise.all([BN.api('/api/admin/stats'), BN.api('/api/admin/analytics?range=daily')]);
    main.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:12px"><h2>Overview</h2><span class="live">Live</span></div>
      <div class="stats">
        <div class="stat hl"><span>Total Revenue</span><b>${BN.inr(s.revenue)}</b></div>
        <div class="stat hl"><span>Total Customers</span><b>${s.customers}</b></div>
        <div class="stat"><span>Total Orders</span><b>${s.orders}</b></div>
        <div class="stat"><span>Paid Orders</span><b>${s.paid_orders}</b></div>
        <div class="stat"><span>Payments to Verify</span><b style="color:${s.to_verify ? 'var(--warn)' : 'inherit'}">${s.to_verify}</b></div>
        <div class="stat"><span>Active Products</span><b>${s.products}</b></div>
        <div class="stat"><span>Downloads</span><b>${s.downloads}</b></div>
      </div>
      <div class="panel"><h3>Daily sales (last 30 days)</h3><div class="chart-box"><canvas id="c1"></canvas></div></div>
      <div class="panel"><h3>Recent orders</h3><div class="table-wrap">${s.recent.length ? `<table><tr><th>#</th><th>Customer</th><th>Item</th><th>Amount</th><th>Status</th><th>Date</th></tr>
        ${s.recent.map((o) => `<tr><td>${o.id}</td><td>${esc(o.customer)}</td><td>${esc(o.item_name)}</td><td>${BN.inr(o.amount)}</td><td>${BN.statusTag(o.status)}</td><td>${BN.date(o.created_at)}</td></tr>`).join('')}</table>` : '<div class="empty">No orders yet.</div>'}</div></div>`;
    chart('c1', { type: 'line', data: { labels: a.sales.map((x) => x.label), datasets: [{ data: a.sales.map((x) => x.revenue), borderColor: '#2f6bff', backgroundColor: 'rgba(47,107,255,.15)', fill: true, tension: .35 }] }, options: opt });
  }

  /* ---------- analytics ---------- */
  async function analytics(range) {
    range = range || 'daily';
    const a = await BN.api('/api/admin/analytics?range=' + range);
    main.innerHTML = `<h2 style="margin-bottom:12px">Analytics</h2>
      <div class="actions" style="margin-bottom:14px">${['daily', 'weekly', 'monthly'].map((r) => `<button class="btn btn-sm ${r === range ? 'btn-primary' : 'btn-outline'}" data-r="${r}">${r[0].toUpperCase() + r.slice(1)} sales</button>`).join('')}</div>
      <div class="panel"><h3>${range[0].toUpperCase() + range.slice(1)} revenue (₹)</h3><div class="chart-box"><canvas id="a1"></canvas></div></div>
      <div class="grid g2"><div class="panel"><h3>Customer growth</h3><div class="chart-box"><canvas id="a2"></canvas></div></div>
      <div class="panel"><h3>Product / plan performance (revenue)</h3><div class="chart-box"><canvas id="a3"></canvas></div></div></div>
      <div class="panel"><h3>Revenue report</h3><div class="table-wrap">${a.sales.length ? `<table><tr><th>Period</th><th>Orders</th><th>Revenue</th></tr>${a.sales.map((x) => `<tr><td>${x.label}</td><td>${x.orders}</td><td>${BN.inr(x.revenue)}</td></tr>`).join('')}</table>` : '<div class="empty">No sales in this period.</div>'}</div></div>`;
    main.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => analytics(b.dataset.r)));
    chart('a1', { type: 'bar', data: { labels: a.sales.map((x) => x.label), datasets: [{ data: a.sales.map((x) => x.revenue), backgroundColor: '#2f6bff', borderRadius: 6 }] }, options: opt });
    chart('a2', { type: 'line', data: { labels: a.growth.map((x) => x.label), datasets: [{ data: a.growth.map((x) => x.customers), borderColor: '#f5b942', tension: .3 }] }, options: opt });
    chart('a3', { type: 'bar', data: { labels: a.performance.map((x) => x.name), datasets: [{ data: a.performance.map((x) => x.revenue), backgroundColor: '#0f2147', borderRadius: 6 }] }, options: { ...opt, indexAxis: 'y', scales: { x: { beginAtZero: true } } } });
  }

  /* ---------- products ---------- */
  async function products() {
    returnTopic = null;
    const { products } = await BN.api('/api/admin/products');
    main.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h2>Products</h2><button class="btn btn-primary btn-sm" id="addP">+ Add Product</button></div>
      <div class="panel"><div class="table-wrap">${products.length ? `<table><tr><th>Product</th><th>Category</th><th>Price</th><th>Sales</th><th>File</th><th>Resell</th><th>Status</th><th></th></tr>
      ${products.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.category || '-')}</td><td>${BN.inr(p.price)}</td><td>${p.sales_count}</td>
        <td>${p.file_name ? '<span class="tag ok">Uploaded</span>' : '<span class="tag warn">Missing</span>'}</td>
        <td>${p.resell_allowed ? '<span class="tag ok">Yes</span>' : '<span class="tag gray">No</span>'}</td>
        <td>${p.is_active ? '<span class="tag ok">Active</span>' : '<span class="tag gray">Hidden</span>'}</td>
        <td class="actions"><button class="btn btn-outline btn-sm" data-e="${p.id}">Edit</button><button class="btn btn-danger btn-sm" data-d="${p.id}">Delete</button></td></tr>`).join('')}</table>` : '<div class="empty">No products yet.</div>'}</div></div>`;
    document.getElementById('addP').onclick = () => productForm();
    main.querySelectorAll('[data-e]').forEach((b) => (b.onclick = () => productForm(products.find((x) => x.id == b.dataset.e))));
    main.querySelectorAll('[data-d]').forEach((b) => (b.onclick = async () => {
      if (!confirm('Delete this product? (If it already has orders it will only be hidden.)')) return;
      try { const r = await BN.api('/api/admin/products/' + b.dataset.d, { method: 'DELETE' }); BN.toast(r.message || 'Deleted'); products_(); } catch (e) { BN.toast(e.message); }
    }));
  }
  const products_ = () => go('products');

  async function productForm(p) {
    const { categories } = await BN.api('/api/categories');
    const { topics: topicList } = await BN.api('/api/admin/topics');
    p = p || {};
    body.innerHTML = `<h3>${p.id ? 'Edit' : 'Add'} product</h3>
      <form id="pf">
        <label>Product name *</label><input name="name" required value="${esc(p.name || '')}">
        <div class="row2"><div><label>Category</label><select name="category_id">${categories.map((c) => `<option value="${c.id}" ${c.id === p.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div><label>Price (₹) * <small style="font-weight:400;color:var(--muted)">(use 0 for items inside a tab: they open with the tab pass)</small></label><input name="price" type="number" min="0" step="0.01" required value="${p.price ?? ''}"></div></div>
        <label>Description</label><textarea name="description">${esc(p.description || '')}</textarea>
        <label>Features (one per line)</label><textarea name="features">${esc(p.features || '')}</textarea>
        <label>Preview link (optional)</label><input name="preview_url" type="url" value="${esc(p.preview_url || '')}" placeholder="https://...">
        <div class="row2"><div><label>Home tab (tile on main page)</label><select name="topic_id"><option value="">- no tab -</option>${topicList.map((t) => `<option value="${t.id}" ${t.id === p.topic_id ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</select></div>
        <div><label>Content type</label><select name="content_type">${[['ebook', 'E-book'], ['pdf', 'PDF'], ['video', 'Video'], ['course', 'Course'], ['software', 'Software'], ['product', 'Other product']].map(([v, l]) => `<option value="${v}" ${v === (p.content_type || 'ebook') ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
        <label class="check"><input type="checkbox" name="is_free" ${p.is_free ? 'checked' : ''}> <span>Free sample (any logged-in customer can open it without a pass)</span></label>
        <label>Video link (YouTube / Vimeo / Google Drive, optional)</label><input name="video_url" type="url" value="${esc(p.video_url || '')}" placeholder="https://youtu.be/...">
        <label>Course / delivery link (optional, private https link; customers see it only after paying)</label><input name="delivery_link" type="url" value="${esc(p.delivery_link || '')}" placeholder="https://... (course portal, Drive folder, etc.)">
        <div class="row2"><div><label>Product image ${p.image_url ? '(leave empty to keep)' : ''}</label><input name="image" type="file" accept="image/*"></div>
        <div><label>Upload file (PDF / e-book / video) ${p.file_name ? '(leave empty to keep: ' + esc(p.file_original || '') + ')' : ''}</label><input name="file" type="file"></div></div>
        <label class="check"><input type="checkbox" name="resell_allowed" ${p.resell_allowed ? 'checked' : ''}> <span>Reselling rights authorised (tick ONLY if the product owner has allowed reselling)</span></label>
        <label>Reselling information shown to customers</label><textarea name="resell_info" placeholder="e.g. Reselling allowed with a minimum price of ₹..., no editing of owner's name">${esc(p.resell_info || '')}</textarea>
        <label class="check"><input type="checkbox" name="is_active" ${p.id ? (p.is_active ? 'checked' : '') : 'checked'}> <span>Visible in store (active)</span></label>
        <div id="pmsg" class="msg"></div>
        <div class="actions" style="margin-top:10px"><button class="btn btn-primary" type="submit">Save product</button><button type="button" class="btn btn-outline" id="cl">Cancel</button></div>
      </form>`;
    bg.classList.add('show');
    document.getElementById('cl').onclick = closeModal;
    document.getElementById('pf').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target; const fd = new FormData(f);
      ['resell_allowed', 'is_active', 'is_free'].forEach((k) => fd.set(k, f.elements[k].checked ? 'true' : 'false'));
      if (!f.elements.image.files.length) fd.delete('image');
      if (!f.elements.file.files.length) fd.delete('file');
      const btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Saving / uploading…';
      try {
        await BN.api(p.id ? '/api/admin/products/' + p.id : '/api/admin/products', { method: p.id ? 'PUT' : 'POST', body: fd });
        closeModal(); BN.toast('Saved'); returnTopic ? go('topics', returnTopic) : products_();
      } catch (err) { BN.msg('#pmsg', err.message); btn.disabled = false; btn.textContent = 'Save product'; }
    };
  }

  /* ---------- home tabs & content ---------- */
  const TYPE_LABEL = { product: 'Product', ebook: 'E-book', pdf: 'PDF', video: 'Video', course: 'Course', software: 'Software' };

  async function topics(openId) {
    if (openId) return topicContent(openId);
    returnTopic = null;
    const [{ topics: list }, { settings: st }] = await Promise.all([BN.api('/api/admin/topics'), BN.api('/api/admin/settings')]);
    const allPanel = `<div class="panel"><h3>All Tabs Access price</h3><p style="color:var(--muted);font-size:14px;margin-bottom:8px">One payment that unlocks every tab. Each tab has its own pass price below.</p>
      <form id="apf" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end"><div style="flex:1;min-width:140px"><label>Price (₹)</label><input name="all_access_price" type="number" min="1" step="1" value="${esc(st.all_access_price || '999')}"></div><button class="btn btn-primary btn-sm">Save</button></form><div id="apm" class="msg"></div></div>`;
    main.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:10px;flex-wrap:wrap"><h2>Home Tabs &amp; Content</h2><button class="btn btn-primary btn-sm" id="addT">+ Add Tab</button></div>
      <p style="color:var(--muted);font-size:14px;margin-bottom:14px">Each tab is a tile on the main page. Open a tab to add, edit or delete its e-books, PDFs and videos.</p>
      ${allPanel}<div class="panel"><div class="table-wrap">${list.length ? `<table><tr><th>Order</th><th>Tab</th><th>Items</th><th>Pass price</th><th>Status</th><th></th></tr>
      ${list.map((t) => `<tr><td>${t.sort_order}</td><td>${esc(t.title)}</td><td>${t.items}</td><td>${BN.inr(t.price)}</td><td>${t.is_active ? '<span class="tag ok">Visible</span>' : '<span class="tag gray">Hidden</span>'}</td>
        <td class="actions"><button class="btn btn-primary btn-sm" data-m="${t.id}">Manage content</button><button class="btn btn-outline btn-sm" data-e="${t.id}">Edit tab</button><button class="btn btn-danger btn-sm" data-d="${t.id}">Delete</button></td></tr>`).join('')}</table>` : '<div class="empty">No tabs yet. Add your first tab.</div>'}</div></div>`;
    document.getElementById('addT').onclick = () => topicForm();
    document.getElementById('apf').onsubmit = async (e) => {
      e.preventDefault();
      try { await BN.api('/api/admin/settings', { method: 'PUT', body: { all_access_price: e.target.all_access_price.value } }); BN.msg('#apm', 'Saved', true); }
      catch (err) { BN.msg('#apm', err.message); }
    };
    main.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => go('topics', b.dataset.m)));
    main.querySelectorAll('[data-e]').forEach((b) => (b.onclick = () => topicForm(list.find((x) => x.id == b.dataset.e))));
    main.querySelectorAll('[data-d]').forEach((b) => (b.onclick = async () => {
      if (!confirm('Delete this tab? Its content is kept but will no longer show on the main page.')) return;
      try { await BN.api('/api/admin/topics/' + b.dataset.d, { method: 'DELETE' }); BN.toast('Tab deleted'); topics(); } catch (e) { BN.toast(e.message); }
    }));
  }

  function topicForm(t) {
    t = t || {};
    body.innerHTML = `<h3>${t.id ? 'Edit' : 'Add'} tab</h3><form id="tf">
      <label>Tab name *</label><input name="title" required maxlength="80" value="${esc(t.title || '')}">
      <label>Tab pass price (₹) *</label><input name="price" type="number" min="1" step="1" required value="${t.price ?? 199}">
      <div class="row2"><div><label>Order (small number shows first)</label><input name="sort_order" type="number" value="${t.sort_order ?? 0}"></div>
      <div><label>Tab icon (optional image)</label><input name="icon" type="file" accept="image/*"></div></div>
      ${t.icon_url ? '<label class="check"><input type="checkbox" name="remove_icon"> <span>Remove current icon</span></label>' : ''}
      <label class="check"><input type="checkbox" name="is_active" ${t.id ? (t.is_active ? 'checked' : '') : 'checked'}> <span>Visible on main page</span></label>
      <div id="tm" class="msg"></div>
      <div class="actions" style="margin-top:10px"><button class="btn btn-primary" type="submit">Save tab</button><button type="button" class="btn btn-outline" id="cl">Cancel</button></div></form>`;
    bg.classList.add('show');
    document.getElementById('cl').onclick = closeModal;
    document.getElementById('tf').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, fd = new FormData(f);
      fd.set('is_active', f.elements.is_active.checked ? 'true' : 'false');
      if (f.elements.remove_icon) fd.set('remove_icon', f.elements.remove_icon.checked ? 'true' : 'false');
      if (!f.elements.icon.files.length) fd.delete('icon');
      try {
        await BN.api(t.id ? '/api/admin/topics/' + t.id : '/api/admin/topics', { method: t.id ? 'PUT' : 'POST', body: fd });
        closeModal(); BN.toast('Tab saved'); topics();
      } catch (err) { BN.msg('#tm', err.message); }
    };
  }

  async function topicContent(id) {
    returnTopic = id;
    const [tl, pl] = await Promise.all([BN.api('/api/admin/topics'), BN.api('/api/admin/products')]);
    const t = tl.topics.find((x) => x.id == id);
    if (!t) return topics();
    const items = pl.products.filter((p) => p.topic_id == id);
    main.innerHTML = `<div style="margin-bottom:10px"><button class="btn btn-outline btn-sm" id="back">&larr; All tabs</button></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:10px;flex-wrap:wrap"><h2>${esc(t.title)}</h2><button class="btn btn-primary btn-sm" id="addC">+ Add E-book / PDF / Video</button></div>
      <div class="panel"><div class="table-wrap">${items.length ? `<table><tr><th>Title</th><th>Type</th><th>Access</th><th>Content</th><th>Status</th><th></th></tr>
      ${items.map((p) => `<tr><td>${esc(p.name)}</td><td>${TYPE_LABEL[p.content_type] || 'Product'}</td><td>${p.is_free ? '<span class="tag ok">Free</span>' : BN.inr(p.price)}</td>
        <td>${[p.file_name ? 'File' : '', p.video_url ? 'Video link' : '', p.delivery_link ? 'Link' : ''].filter(Boolean).join(', ') || '<span class="tag warn">Missing</span>'}</td>
        <td>${p.is_active ? '<span class="tag ok">Visible</span>' : '<span class="tag gray">Hidden</span>'}</td>
        <td class="actions"><button class="btn btn-outline btn-sm" data-e="${p.id}">Edit</button><button class="btn btn-danger btn-sm" data-d="${p.id}">Delete</button></td></tr>`).join('')}</table>` : '<div class="empty">Nothing here yet. Tap "+ Add" to upload your first e-book, PDF or video.</div>'}</div></div>`;
    document.getElementById('back').onclick = () => go('topics');
    document.getElementById('addC').onclick = () => productForm({ topic_id: Number(id), content_type: 'ebook', price: 0 });
    main.querySelectorAll('[data-e]').forEach((b) => (b.onclick = () => productForm(items.find((x) => x.id == b.dataset.e))));
    main.querySelectorAll('[data-d]').forEach((b) => (b.onclick = async () => {
      if (!confirm('Delete this item? (If customers already bought it, it is only hidden so they keep access.)')) return;
      try { const r = await BN.api('/api/admin/products/' + b.dataset.d, { method: 'DELETE' }); BN.toast(r.message || 'Deleted'); topicContent(id); } catch (e) { BN.toast(e.message); }
    }));
  }

  /* ---------- plans ---------- */
  async function plans() {
    const { plans } = await BN.api('/api/admin/plans');
    main.innerHTML = `<h2 style="margin-bottom:6px">Pricing Plans</h2><p style="color:var(--muted);margin-bottom:14px;font-size:14px">The "Notes" box is shown to customers before checkout — put domain / hosting validity, renewal charges and inclusions here (one point per line).</p>` +
      plans.map((p) => `<div class="panel"><form data-id="${p.id}">
        <div class="row2"><div><label>Plan name</label><input name="name" value="${esc(p.name)}" required></div><div><label>Price (₹)</label><input name="price" type="number" min="1" step="0.01" value="${p.price}" required></div></div>
        <label>Features (one per line)</label><textarea name="features" style="min-height:130px">${esc(p.features)}</textarea>
        <label>Notes shown before checkout (validity, renewal, inclusions)</label><textarea name="notes" style="min-height:110px">${esc(p.notes)}</textarea>
        <div class="row2"><div><label>Badge (optional, e.g. Most Popular)</label><input name="badge" value="${esc(p.badge)}"></div>
        <div><label class="check" style="margin-top:34px"><input type="checkbox" name="is_active" ${p.is_active ? 'checked' : ''}> Active on website</label></div></div>
        <button class="btn btn-primary btn-sm" style="margin-top:8px">Save plan</button></form></div>`).join('');
    main.querySelectorAll('form[data-id]').forEach((f) => (f.onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f)); d.is_active = f.elements.is_active.checked;
      try { await BN.api('/api/admin/plans/' + f.dataset.id, { method: 'PUT', body: d }); BN.toast('Plan saved'); } catch (err) { BN.toast(err.message); }
    }));
  }

  /* ---------- orders ---------- */
  async function orders(status) {
    status = status || '';
    const { orders } = await BN.api('/api/admin/orders' + (status ? '?status=' + status : ''));
    main.innerHTML = `<h2 style="margin-bottom:12px">Orders &amp; Payment Verification</h2>
      <div class="actions" style="margin-bottom:12px">${[['', 'All'], ['awaiting_verification', 'To verify'], ['paid', 'Paid'], ['pending', 'Pending'], ['failed', 'Failed'], ['rejected', 'Rejected']].map(([v, l]) => `<button class="btn btn-sm ${v === status ? 'btn-primary' : 'btn-outline'}" data-s="${v}">${l}</button>`).join('')}</div>
      <div class="panel"><div class="table-wrap">${orders.length ? `<table><tr><th>#</th><th>Customer</th><th>Item</th><th>Amount</th><th>Payment</th><th>Status</th><th>Date</th><th>Actions</th></tr>
      ${orders.map((o) => `<tr><td>${o.id}</td><td>${esc(o.customer)}<br><small>${esc(o.email)}<br>${esc(o.phone || '')}</small></td>
        <td>${esc(o.item_name)}${o.details ? `<br><small style="color:var(--muted)">Req: ${esc(o.details)}</small>` : ''}</td><td>${BN.inr(o.amount)}</td>
        <td>${o.method === 'manual' ? 'QR / UPI' : 'Razorpay'}${o.utr ? `<br><small>UTR: ${esc(o.utr)}</small>` : ''}${o.razorpay_payment_id ? `<br><small>${esc(o.razorpay_payment_id)}</small>` : ''}</td>
        <td>${BN.statusTag(o.status)}${o.admin_note ? `<br><small>${esc(o.admin_note)}</small>` : ''}</td><td>${BN.date(o.created_at)}</td>
        <td class="actions">
          ${o.has_proof ? `<a class="btn btn-outline btn-sm" target="_blank" href="/api/admin/orders/${o.id}/proof">Proof</a>` : ''}
          ${o.method === 'manual' && o.status === 'awaiting_verification' ? `<button class="btn btn-primary btn-sm" data-ap="${o.id}">Approve</button><button class="btn btn-danger btn-sm" data-rj="${o.id}">Reject</button>` : ''}
          ${o.status === 'paid' ? `<a class="btn btn-outline btn-sm" target="_blank" href="/api/orders/${o.id}/invoice">Invoice</a><button class="btn btn-danger btn-sm" data-rf="${o.id}">Refund</button>` : ''}
        </td></tr>`).join('')}</table>` : '<div class="empty">No orders found.</div>'}</div></div>`;
    main.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => orders(b.dataset.s)));
    const act = (sel, path, ask, withNote) => main.querySelectorAll(sel).forEach((b) => (b.onclick = async () => {
      let note = '';
      if (withNote) { note = prompt(ask, ''); if (note === null) return; } else if (!confirm(ask)) return;
      try { await BN.api('/api/admin/orders/' + b.getAttribute(sel.slice(1, -1)) + path, { method: 'POST', body: { note } }); BN.toast('Done'); orders(status); } catch (e) { BN.toast(e.message); }
    }));
    act('[data-ap]', '/approve', 'Confirm: you have checked the money in your bank/UPI app. Approve and deliver?');
    act('[data-rj]', '/reject', 'Reason for rejecting (shown to customer):', true);
    act('[data-rf]', '/refund', 'Note for refund (you must send the money back separately):', true);
  }

  /* ---------- customers ---------- */
  async function customers() {
    const { customers } = await BN.api('/api/admin/customers');
    main.innerHTML = `<h2 style="margin-bottom:12px">Customers (${customers.length})</h2><div class="panel"><div class="table-wrap">${customers.length ? `<table>
      <tr><th>Name</th><th>Email</th><th>Phone</th><th>Paid orders</th><th>Spent</th><th>Joined</th><th></th></tr>
      ${customers.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.email)} ${c.email_verified ? '' : '<span class="tag warn">unverified</span>'}</td><td>${esc(c.phone || '-')}</td><td>${c.orders}</td><td>${BN.inr(c.spent)}</td><td>${BN.date(c.created_at)}</td>
        <td><button class="btn btn-sm ${c.is_blocked ? 'btn-primary' : 'btn-danger'}" data-b="${c.id}" data-v="${c.is_blocked ? 0 : 1}">${c.is_blocked ? 'Unblock' : 'Block'}</button></td></tr>`).join('')}</table>` : '<div class="empty">No customers yet.</div>'}</div></div>`;
    main.querySelectorAll('[data-b]').forEach((b) => (b.onclick = async () => {
      try { await BN.api('/api/admin/customers/' + b.dataset.b + '/block', { method: 'POST', body: { blocked: b.dataset.v === '1' } }); customers(); } catch (e) { BN.toast(e.message); }
    }));
  }

  /* ---------- payment settings (QR + UPI) ---------- */
  async function payments() {
    const { settings: s } = await BN.api('/api/admin/settings');
    main.innerHTML = `<h2 style="margin-bottom:12px">QR Code &amp; UPI Payment Settings</h2>
      <div class="grid g2">
      <div class="panel"><h3>Payment QR code</h3>
        ${s.qr_url ? `<img class="qr" src="${esc(s.qr_url)}" alt="QR">` : '<div class="empty">No QR uploaded.</div>'}
        <label>${s.qr_url ? 'Replace QR code' : 'Upload QR code'} (image)</label><input type="file" id="qrFile" accept="image/*">
        <div class="actions" style="margin-top:10px"><button class="btn btn-primary btn-sm" id="qrUp">${s.qr_url ? 'Replace' : 'Upload'}</button>
        ${s.qr_url ? '<button class="btn btn-danger btn-sm" id="qrDel">Delete QR</button>' : ''}</div></div>
      <div class="panel"><h3>UPI &amp; instructions</h3>
        <form id="upiForm"><label>UPI ID</label><input name="upi_id" value="${esc(s.upi_id)}" placeholder="name@bank">
        <label>Payment instructions (shown to customer)</label><textarea name="payment_instructions" style="min-height:130px">${esc(s.payment_instructions)}</textarea>
        <label class="check"><input type="checkbox" name="manual_enabled" ${s.manual_enabled === 'true' ? 'checked' : ''}> Enable manual QR / UPI payment</label>
        <div id="um" class="msg"></div><button class="btn btn-primary btn-sm">Save</button></form></div></div>
      <p style="font-size:13px;color:var(--muted)">Manual payments appear in <b>Orders → To verify</b>. Approve only after you see the money in your bank / UPI app.</p>`;
    document.getElementById('qrUp').onclick = async () => {
      const f = document.getElementById('qrFile').files[0]; if (!f) return BN.toast('Choose an image first');
      const fd = new FormData(); fd.append('qr', f);
      try { await BN.api('/api/admin/settings/qr', { method: 'POST', body: fd }); BN.toast('QR saved'); payments(); } catch (e) { BN.toast(e.message); }
    };
    const del = document.getElementById('qrDel');
    if (del) del.onclick = async () => { if (!confirm('Delete QR code?')) return; try { await BN.api('/api/admin/settings/qr', { method: 'DELETE' }); payments(); } catch (e) { BN.toast(e.message); } };
    document.getElementById('upiForm').onsubmit = async (e) => {
      e.preventDefault(); const f = e.target;
      try { await BN.api('/api/admin/settings', { method: 'PUT', body: { upi_id: f.upi_id.value.trim(), payment_instructions: f.payment_instructions.value, manual_enabled: f.manual_enabled.checked } }); BN.msg('#um', 'Saved', true); }
      catch (err) { BN.msg('#um', err.message); }
    };
  }

  /* ---------- site settings ---------- */
  async function settings() {
    const { settings: s } = await BN.api('/api/admin/settings');
    main.innerHTML = `<h2 style="margin-bottom:12px">Website, Branding &amp; Support</h2><div class="grid g2">
      <div class="panel"><h3>Company &amp; WhatsApp</h3><form id="sf">
        <label>Company name</label><input name="company_name" value="${esc(s.company_name)}">
        <label>Tagline</label><input name="tagline" value="${esc(s.tagline)}">
        <label>WhatsApp support number (with country code)</label><input name="whatsapp_number" value="${esc(s.whatsapp_number)}" placeholder="919376998999">
        <label>Support email (shown on contact page)</label><input name="support_email" type="email" value="${esc(s.support_email)}">
        <label>Invoice footer note</label><input name="invoice_note" value="${esc(s.invoice_note)}">
        <div id="sm" class="msg"></div><button class="btn btn-primary btn-sm" style="margin-top:8px">Save</button></form></div>
      <div class="panel"><h3>Logo</h3>${s.logo_url ? `<img src="${esc(s.logo_url)}" style="max-height:80px;background:#0a1630;padding:10px;border-radius:10px" alt="logo">` : '<div class="empty">No logo uploaded (default icon is shown).</div>'}
        <label>Upload new logo</label><input type="file" id="logoFile" accept="image/*">
        <div class="actions" style="margin-top:10px"><button class="btn btn-primary btn-sm" id="logoUp">Upload</button>${s.logo_url ? '<button class="btn btn-danger btn-sm" id="logoDel">Remove</button>' : ''}</div></div></div>`;
    document.getElementById('sf').onsubmit = async (e) => {
      e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
      try { await BN.api('/api/admin/settings', { method: 'PUT', body: d }); BN.msg('#sm', 'Saved. Refresh the site to see changes.', true); } catch (err) { BN.msg('#sm', err.message); }
    };
    document.getElementById('logoUp').onclick = async () => {
      const f = document.getElementById('logoFile').files[0]; if (!f) return BN.toast('Choose an image');
      const fd = new FormData(); fd.append('logo', f);
      try { await BN.api('/api/admin/settings/logo', { method: 'POST', body: fd }); settings(); } catch (e) { BN.toast(e.message); }
    };
    const ld = document.getElementById('logoDel');
    if (ld) ld.onclick = async () => { try { await BN.api('/api/admin/settings/logo', { method: 'DELETE' }); settings(); } catch (e) { BN.toast(e.message); } };
  }

  go('overview');
})();

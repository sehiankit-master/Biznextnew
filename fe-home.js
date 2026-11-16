(async function () {
  await BN.ready;
  const esc = BN.esc;

  // topic tiles (locked until a tab pass or All Tabs Access is bought)
  const LOCK = '<span class="lock" title="Locked"><svg viewBox="0 0 24 24"><path d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V11a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm-3 8V6a3 3 0 1 1 6 0v3H9z"/></svg></span>';
  const tiles = document.getElementById('topics');
  try {
    const d = await BN.api('/api/topics');
    document.getElementById('passBand').innerHTML = d.all_access
      ? '<div class="passband"><div><b>All tabs unlocked</b><p>You have full access. Tap any tab to start.</p></div></div>'
      : `<div class="passband"><div><b>Unlock everything for ${BN.inr(d.all_access_price)}</b><p>Or unlock a single tab with its own pass. A tab stays locked until you buy a pass.</p></div>
         <a class="btn btn-gold" href="/checkout.html?type=all_access&id=0">Get All Tabs - ${BN.inr(d.all_access_price)}</a></div>`;
    tiles.innerHTML = d.topics.length
      ? d.topics.map((t) => `<a class="tile${t.items ? '' : ' soon'}${t.locked ? '' : ' unlocked'}" href="/topic.html?id=${t.id}">${t.locked ? LOCK : ''}<b>${esc(t.title)}</b><small>${t.locked ? BN.inr(t.price) + ' to unlock' : t.items ? t.items + (t.items === 1 ? ' item' : ' items') : 'Soon'}</small>${
          t.icon_url ? `<img class="ti" src="${esc(t.icon_url)}" alt="" loading="lazy">` : `<span class="ti">${esc(t.title.trim().charAt(0).toUpperCase())}</span>`}</a>`).join('')
      : '<div class="empty" style="grid-column:1/-1;color:#aebce6">Topics will appear here soon.</div>';
  } catch (e) { tiles.innerHTML = ''; }

  // pricing cards
  const box = document.getElementById('plans');
  try {
    const { plans } = await BN.api('/api/plans');
    box.innerHTML = plans.map((p) => {
      const feats = BN.lines(p.features).map((f) => `<li class="${/^without/i.test(f) ? 'no' : ''}">${esc(f)}</li>`).join('');
      const feat = p.badge ? ' featured' : '';
      const first = BN.lines(p.notes)[0] || '';
      return `<div class="plan reveal${feat}">
        ${p.badge ? `<div class="badge">${esc(p.badge)}</div>` : ''}
        <h3>${esc(p.name)}</h3>
        <div class="price">${BN.inr(p.price)} <small>one-time</small></div>
        <ul>${feats}</ul>
        ${first ? `<div class="note">${esc(first)}</div>` : ''}
        <a class="btn ${p.badge ? 'btn-gold' : 'btn-primary'} btn-block" href="/checkout.html?type=plan&id=${p.id}">Buy This Plan</a>
        <a class="btn btn-outline btn-block" style="margin-top:8px" data-wa="Hello, I want details about: ${esc(p.name)}" href="#">Ask on WhatsApp</a>
      </div>`;
    }).join('');
    BN.waButtons(); BN.reveal();
  } catch (e) {
    box.innerHTML = '<div class="empty">Could not load plans. Please refresh.</div>';
  }

  // featured products
  const f = document.getElementById('featured');
  try {
    const { products } = await BN.api('/api/products');
    f.innerHTML = products.slice(0, 6).map(BN.productCard).join('') || '<div class="empty" style="grid-column:1/-1">Products are being added. Please check back soon or contact us on WhatsApp.</div>';
    BN.reveal();
  } catch (e) { f.innerHTML = ''; }
})();

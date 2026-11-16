(async function () {
  await BN.ready;
  const esc = BN.esc;

  // topic tiles
  const tiles = document.getElementById('topics');
  try {
    const { topics } = await BN.api('/api/topics');
    tiles.innerHTML = topics.length
      ? topics.map((t) => `<a class="tile${t.items ? '' : ' soon'}" href="/topic.html?id=${t.id}"><b>${esc(t.title)}</b><small>${t.items ? t.items + (t.items === 1 ? ' item' : ' items') : 'Soon'}</small>${
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

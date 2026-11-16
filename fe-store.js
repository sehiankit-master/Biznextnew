(async function () {
  await BN.ready;
  const esc = BN.esc;
  const grid = document.getElementById('grid');
  const lockedCategory = document.body.getAttribute('data-category'); // used by ai-software page
  const qEl = document.getElementById('q');
  const catEl = document.getElementById('cat');
  let all = [];

  async function load() {
    const params = new URLSearchParams();
    if (lockedCategory) params.set('categoryName', lockedCategory);
    else if (catEl && catEl.value) params.set('category', catEl.value);
    if (qEl && qEl.value.trim()) params.set('q', qEl.value.trim());
    grid.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    try {
      const { products } = await BN.api('/api/products?' + params.toString());
      all = products;
      grid.innerHTML = products.length
        ? products.map(BN.productCard).join('')
        : '<div class="empty" style="grid-column:1/-1">No products found yet. New products are added regularly — contact us on WhatsApp for requirements.</div>';
      BN.reveal();
    } catch (e) { grid.innerHTML = '<div class="empty" style="grid-column:1/-1">Could not load products.</div>'; }
  }

  if (catEl && !lockedCategory) {
    const { categories } = await BN.api('/api/categories');
    catEl.innerHTML = '<option value="">All categories</option>' + categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    catEl.onchange = load;
  }
  if (qEl) { let t; qEl.oninput = () => { clearTimeout(t); t = setTimeout(load, 300); }; }

  const modalBg = document.getElementById('modalBg');
  function openDetail(id) {
    const p = all.find((x) => x.id === id);
    if (!p) return;
    const feats = BN.lines(p.features).map((f) => `<li>${esc(f)}</li>`).join('');
    document.getElementById('modalBody').innerHTML = `
      ${p.image_url ? `<img src="${esc(p.image_url)}" alt="" style="border-radius:12px;margin-bottom:12px;max-height:260px;width:100%;object-fit:cover">` : ''}
      <div class="pcat">${esc(p.category || '')}</div>
      <h2 style="margin:4px 0 8px">${esc(p.name)}</h2>
      <p style="color:var(--muted);white-space:pre-line">${esc(p.description)}</p>
      ${feats ? `<h3 style="margin-top:14px;font-size:16px">Features</h3><ul style="margin:6px 0 0 20px">${feats}</ul>` : ''}
      <div class="notes"><b>Reselling rights:</b> ${p.resell_allowed ? 'Available for this product.' : 'Not available — personal / own business use only.'}
        ${esc(p.resell_info || '')}</div>
      <div class="pprice" style="margin:10px 0">${p.is_free ? 'Free' : BN.inr(p.price)}</div>
      <div class="actions">
        ${p.is_free && p.topic_id ? `<a class="btn btn-gold" href="/topic.html?id=${p.topic_id}">Open free</a>` : `<a class="btn btn-primary" href="/checkout.html?type=product&id=${p.id}">Buy Now</a>`}
        ${p.preview_url ? `<a class="btn btn-outline" href="${esc(p.preview_url)}" target="_blank" rel="noopener noreferrer">Preview</a>` : ''}
        <button class="btn btn-outline" id="closeModal">Close</button>
      </div>
      <p style="font-size:12.5px;color:var(--muted);margin-top:10px">Download becomes available in your dashboard after payment is verified.</p>`;
    modalBg.classList.add('show');
    document.getElementById('closeModal').onclick = () => modalBg.classList.remove('show');
  }
  modalBg.onclick = (e) => { if (e.target === modalBg) modalBg.classList.remove('show'); };
  grid.addEventListener('click', (e) => {
    const a = e.target.closest('.js-detail');
    if (a) { e.preventDefault(); openDetail(parseInt(a.dataset.id, 10)); }
  });

  await load();
  const open = parseInt(new URLSearchParams(location.search).get('open'), 10);
  if (open) openDetail(open);
})();

(async function () {
  await BN.ready;
  const esc = BN.esc;
  const id = parseInt(new URLSearchParams(location.search).get('id'), 10) || 0;
  const LABEL = { ebook: 'E-book', pdf: 'PDF', video: 'Video', course: 'Course', software: 'Software', product: 'Product' };
  const grid = document.getElementById('items');
  const chipsEl = document.getElementById('chips');
  const bg = document.getElementById('modalBg');
  const body = document.getElementById('modalBody');
  let data = null, filter = 'all';

  function closeModal() { bg.classList.remove('show'); body.innerHTML = ''; }
  bg.onclick = (e) => { if (e.target === bg) closeModal(); };

  function render() {
    const items = data.items.filter((i) => filter === 'all' || i.content_type === filter);
    const types = [...new Set(data.items.map((i) => i.content_type))];
    chipsEl.innerHTML = types.length > 1
      ? ['all', ...types].map((t) => `<button class="btn btn-sm ${t === filter ? 'btn-primary' : 'btn-outline'}" data-f="${t}" style="flex:0 0 auto">${t === 'all' ? 'All' : LABEL[t] || t}</button>`).join('')
      : '';
    chipsEl.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { filter = b.dataset.f; render(); }));
    grid.innerHTML = items.length ? items.map((i) => {
      const img = i.image_url ? `<img src="${esc(i.image_url)}" alt="" loading="lazy">` : `<span style="font-size:22px;font-weight:800">${LABEL[i.content_type] || 'Item'}</span>`;
      const desc = esc(i.description || '').slice(0, 120);
      return `<div class="card pcard"><div class="pimg">${img}</div><div class="pbody">
        <div class="pcat">${LABEL[i.content_type] || 'Product'}</div><h3>${esc(i.name)}</h3><p>${desc}</p>
        <div>${i.is_free ? '<span class="tag ok">Free</span>' : i.owned ? '<span class="tag ok">Purchased</span>' : ''}</div>
        <div class="pprice">${i.is_free ? 'Free' : BN.inr(i.price)}</div>
        <div class="pfoot">${i.owned || i.is_free
          ? `<button class="btn btn-gold btn-sm" data-open="${i.id}">Open</button>`
          : `<a class="btn btn-primary btn-sm" href="/checkout.html?type=product&id=${i.id}">Buy ${BN.inr(i.price)}</a>`}</div></div></div>`;
    }).join('') : '<div class="empty" style="grid-column:1/-1">Content for this tab is coming soon. Message us on WhatsApp for updates.</div>';
    grid.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => openItem(b.dataset.open)));
  }

  function embedUrl(u) {
    try {
      const x = new URL(u), h = x.hostname.replace(/^www\./, '');
      if (h === 'youtube.com' || h === 'm.youtube.com') {
        if (x.pathname === '/watch' && x.searchParams.get('v')) return 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(x.searchParams.get('v'));
        const m = x.pathname.match(/^\/(shorts|embed|live)\/([\w-]+)/);
        if (m) return 'https://www.youtube-nocookie.com/embed/' + m[2];
      }
      if (h === 'youtu.be') return 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(x.pathname.slice(1));
      if (h === 'vimeo.com') { const m = x.pathname.match(/^\/(\d+)/); if (m) return 'https://player.vimeo.com/video/' + m[1]; }
      if (h === 'drive.google.com') { const m = x.pathname.match(/\/file\/d\/([\w-]+)/); if (m) return 'https://drive.google.com/file/d/' + m[1] + '/preview'; }
    } catch (_) {}
    return null;
  }

  async function openItem(itemId) {
    try {
      const r = await BN.api('/api/content/' + itemId + '/open');
      let h = `<h3 style="margin-bottom:8px">${esc(r.name)}</h3>`;
      let any = false;
      if (r.video_url) {
        any = true;
        const e = embedUrl(r.video_url);
        h += e
          ? `<div style="aspect-ratio:16/9;margin:12px 0"><iframe src="${esc(e)}" style="width:100%;height:100%;border:0;border-radius:12px" allow="fullscreen; picture-in-picture" allowfullscreen></iframe></div>`
          : `<p style="margin:12px 0"><a class="btn btn-primary" href="${esc(r.video_url)}" target="_blank" rel="noopener noreferrer">Watch video</a></p>`;
      }
      if (r.has_file) {
        any = true;
        if (['mp4', 'webm', 'mov', 'm4v'].includes(r.ext)) h += `<video controls controlsList="nodownload" playsinline style="width:100%;border-radius:12px;margin:12px 0;background:#000" src="/api/view/${itemId}"></video>`;
        else if (r.ext === 'mp3') h += `<audio controls style="width:100%;margin:12px 0" src="/api/view/${itemId}"></audio>`;
        h += `<div class="actions" style="margin:12px 0">${r.ext === 'pdf' ? `<a class="btn btn-primary" href="/api/view/${itemId}" target="_blank" rel="noopener">Read PDF</a>` : ''}<a class="btn btn-outline" href="/api/download/${itemId}">Download</a></div>`;
      }
      if (r.delivery_link) {
        any = true;
        h += `<p style="margin:12px 0"><a class="btn btn-gold" href="${esc(r.delivery_link)}" target="_blank" rel="noopener noreferrer">Open content link</a></p>`;
      }
      if (!any) h += '<div class="notes">Content is not added yet. Please contact support on WhatsApp.</div>';
      h += '<button class="btn btn-outline" id="closeM" style="margin-top:6px">Close</button>';
      body.innerHTML = h;
      bg.classList.add('show');
      document.getElementById('closeM').onclick = closeModal;
    } catch (e) {
      if (e.status === 401) location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search);
      else BN.toast(e.message);
    }
  }

  try {
    data = await BN.api('/api/topics/' + id);
    document.title = data.topic.title + ' | BIZNEXT DIGITAL COMPANY';
    document.getElementById('tTitle').textContent = data.topic.title;
    document.getElementById('tSub').textContent = data.items.length + (data.items.length === 1 ? ' item' : ' items') + ' in this tab';
    render();
  } catch (e) {
    document.getElementById('tTitle').textContent = 'Tab not found';
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1">This tab is not available. <a href="/">Go to Home</a></div>';
  }
})();

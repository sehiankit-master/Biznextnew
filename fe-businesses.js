(async function () {
  await BN.ready;
  const sections = [
    ['ebook', 'E-books'],
    ['course', 'Digital Courses'],
    ['software', 'AI Software'],
  ];
  await Promise.all(sections.map(async ([id, cat]) => {
    const el = document.getElementById('list-' + id);
    try {
      const { products } = await BN.api('/api/products?categoryName=' + encodeURIComponent(cat));
      el.innerHTML = products.length
        ? products.slice(0, 3).map(BN.productCard).join('')
        : '<div class="empty" style="grid-column:1/-1">Products in this business are being added. Message us on WhatsApp for the latest list.</div>';
    } catch (_) { el.innerHTML = ''; }
  }));
  BN.reveal();
})();

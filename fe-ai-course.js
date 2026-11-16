(async function () {
  await BN.ready;
  const box = document.getElementById('buyBox');
  let p = null;
  try {
    const { products } = await BN.api('/api/products?categoryName=' + encodeURIComponent('Digital Courses'));
    p = products.find((x) => x.name === 'AI Business Course') || null;
  } catch (_) {}
  const price = p ? p.price : 999;
  document.querySelectorAll('.js-price').forEach((e) => (e.textContent = BN.inr(price)));
  box.innerHTML = p
    ? `<a class="btn btn-gold btn-block" href="/checkout.html?type=product&id=${p.id}">Enrol Now - ${BN.inr(price)}</a>
       <a class="btn btn-wa btn-block" style="margin-top:8px" data-wa="Hello, I want details about the AI Business Course" href="#">Ask on WhatsApp</a>`
    : `<div class="notes">Enrolment is opening soon. Message us on WhatsApp and we will tell you when it starts.</div>
       <a class="btn btn-wa btn-block" data-wa="Hello, I want to join the AI Business Course" href="#">Join waiting list on WhatsApp</a>`;
  BN.waButtons();
})();

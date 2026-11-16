(async () => {
  await BN.ready;
  document.getElementById('waNum').textContent = '+' + (BN.settings.whatsapp_number || '');
  if (BN.settings.support_email) {
    document.getElementById('mailLine').classList.remove('hidden');
    document.getElementById('mailTxt').textContent = BN.settings.support_email;
  }
  document.getElementById('cf').onsubmit = (e) => {
    e.preventDefault();
    window.open(BN.waLink('Hi, I am ' + document.getElementById('cn').value + '. ' + document.getElementById('cm').value), '_blank', 'noopener');
  };
})();

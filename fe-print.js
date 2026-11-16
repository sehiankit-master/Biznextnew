document.addEventListener('DOMContentLoaded', () => {
  const b = document.getElementById('printBtn');
  if (b) b.addEventListener('click', () => window.print());
});

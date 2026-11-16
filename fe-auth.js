(async function () {
  await BN.ready;
  const page = document.body.getAttribute('data-page');
  const next = new URLSearchParams(location.search).get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
  const msg = document.getElementById('msg');
  const form = document.getElementById('form');
  const val = (n) => (form.elements[n] ? form.elements[n].value.trim() : '');
  let pendingEmail = '';

  if (BN.user && (page === 'login' || page === 'register')) { location.href = safeNext || '/dashboard.html'; return; }

  function goAfterLogin(role) {
    location.href = safeNext || (role === 'admin' ? '/admin.html' : '/dashboard.html');
  }

  function showOtp(email, purpose) {
    pendingEmail = email;
    document.getElementById('mainFields').classList.add('hidden');
    document.getElementById('otpBox').classList.remove('hidden');
    form.dataset.mode = purpose;
    BN.msg(msg, 'We sent a 6-digit code to ' + email + '. Enter it below.', true);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; msg.className = 'msg';
    try {
      if (form.dataset.mode === 'verify') {
        await BN.api('/api/auth/verify-email', { method: 'POST', body: { email: pendingEmail, otp: val('otp') } });
        BN.msg(msg, 'Email verified!', true);
        setTimeout(() => goAfterLogin('customer'), 600);
      } else if (page === 'login') {
        try {
          const r = await BN.api('/api/auth/login', { method: 'POST', body: { email: val('email'), password: form.elements.password.value } });
          goAfterLogin(r.role);
        } catch (err) {
          if (err.data && err.data.needVerify) return showOtp(err.data.email, 'verify');
          throw err;
        }
      } else if (page === 'register') {
        if (form.elements.password.value !== form.elements.password2.value) throw new Error('Passwords do not match');
        if (!form.elements.agree.checked) throw new Error('Please accept the Terms & Conditions');
        const r = await BN.api('/api/auth/register', { method: 'POST', body: { name: val('name'), email: val('email'), phone: val('phone'), password: form.elements.password.value } });
        if (r.needVerify) return showOtp(r.email, 'verify');
        goAfterLogin('customer');
      } else if (page === 'forgot') {
        if (form.dataset.mode === 'reset') {
          if (form.elements.password.value.length < 8) throw new Error('Password must be at least 8 characters');
          await BN.api('/api/auth/reset', { method: 'POST', body: { email: pendingEmail, otp: val('otp'), password: form.elements.password.value } });
          BN.msg(msg, 'Password changed. Redirecting to login…', true);
          setTimeout(() => (location.href = '/login.html'), 1200);
        } else {
          await BN.api('/api/auth/forgot', { method: 'POST', body: { email: val('email') } });
          pendingEmail = val('email').toLowerCase();
          form.dataset.mode = 'reset';
          document.getElementById('mainFields').classList.add('hidden');
          document.getElementById('otpBox').classList.remove('hidden');
          BN.msg(msg, 'If this email is registered, a code has been sent. Enter it with your new password.', true);
        }
      }
    } catch (err) {
      BN.msg(msg, err.message);
    } finally { btn.disabled = false; }
  });

  const resend = document.getElementById('resend');
  if (resend) resend.onclick = async (e) => {
    e.preventDefault();
    try {
      await BN.api('/api/auth/resend-otp', { method: 'POST', body: { email: pendingEmail, purpose: form.dataset.mode === 'reset' ? 'reset' : 'verify' } });
      BN.msg(msg, 'A new code has been sent.', true);
    } catch (err) { BN.msg(msg, err.message); }
  };
})();

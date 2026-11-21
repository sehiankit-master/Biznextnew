// smmService.js
const API_URL = process.env.SMM_API_URL || 'https://iluvsmmpanel.com/api/v2';
const API_KEY = process.env.SMM_API_KEY;

async function callSmmApi(payload) {
  if (!API_KEY) {
    return { error: 'SMM_API_KEY Render Environment Variables mein set nahi hai' };
  }

  const params = new URLSearchParams();
  params.append('key', API_KEY);

  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined && value !== null) {
      params.append(key, value);
    }
  }

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/4.0 (compatible; MSIE 5.01; Windows NT 5.0)'
      },
      body: params.toString()
    });

    return await response.json();
  } catch (err) {
    console.error('SMM API Connection Error:', err);
    return { error: err.message };
  }
}

// 1. SMM Wallet Balance check karne ke liye
async function getBalance() {
  return await callSmmApi({ action: 'balance' });
}

// 2. Saari services aur unke Service IDs nikalne ke liye
async function getServices() {
  return await callSmmApi({ action: 'services' });
}

// 3. Naya Order (Followers/Likes/Views) lagane ke liye
async function placeOrder({ serviceId, link, quantity }) {
  return await callSmmApi({
    action: 'add',
    service: serviceId,
    link: link,
    quantity: quantity
  });
}

// 4. Order ka live status check karne ke liye
async function checkOrderStatus(orderId) {
  return await callSmmApi({
    action: 'status',
    order: orderId
  });
}

// 5. Refill request bhejne ke liye (agar followers drop hon)
async function refillOrder(orderId) {
  return await callSmmApi({
    action: 'refill',
    order: orderId
  });
}

module.exports = {
  getBalance,
  getServices,
  placeOrder,
  checkOrderStatus,
  refillOrder
};

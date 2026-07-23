const fetch = require("node-fetch");
const crypto = require("crypto");

const BASE = "https://accept.paymob.com/api";

async function getAuthToken() {
  const r = await fetch(`${BASE}/auth/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: process.env.PAYMOB_API_KEY }),
  });
  const data = await r.json();
  if (!data.token) throw new Error("فشل الاتصال بـ Paymob (تحقق من PAYMOB_API_KEY)");
  return data.token;
}

async function registerOrder(authToken, { amountCents, items, merchantOrderId }) {
  const r = await fetch(`${BASE}/ecommerce/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_token: authToken,
      delivery_needed: false,
      amount_cents: amountCents,
      currency: "EGP",
      merchant_order_id: merchantOrderId,
      items,
    }),
  });
  const data = await r.json();
  if (!data.id) throw new Error("فشل إنشاء الطلب لدى Paymob");
  return data.id;
}

async function getPaymentKey(authToken, { amountCents, orderId, billingData }) {
  const r = await fetch(`${BASE}/acceptance/payment_keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_token: authToken,
      amount_cents: amountCents,
      expiration: 3600,
      order_id: orderId,
      billing_data: billingData,
      currency: "EGP",
      integration_id: Number(process.env.PAYMOB_INTEGRATION_ID),
    }),
  });
  const data = await r.json();
  if (!data.token) throw new Error("فشل إنشاء مفتاح الدفع لدى Paymob");
  return data.token;
}

function getIframeUrl(paymentToken) {
  return `${BASE}/acceptance/iframes/${process.env.PAYMOB_IFRAME_ID}?payment_token=${paymentToken}`;
}

async function createPaymentSession({ amountEGP, merchantOrderId, items, billingData }) {
  const authToken = await getAuthToken();
  const amountCents = Math.round(amountEGP * 100);
  const paymobOrderId = await registerOrder(authToken, { amountCents, items, merchantOrderId });
  const paymentToken = await getPaymentKey(authToken, { amountCents, orderId: paymobOrderId, billingData });
  return { paymobOrderId, iframeUrl: getIframeUrl(paymentToken) };
}

function verifyHmac(query, body) {
  const obj = body.obj || {};
  const fields = [
    obj.amount_cents, obj.created_at, obj.currency, obj.error_occured,
    obj.has_parent_transaction, obj.id, obj.integration_id, obj.is_3d_secure,
    obj.is_auth, obj.is_capture, obj.is_refunded, obj.is_standalone_payment,
    obj.is_voided, obj.order?.id, obj.owner, obj.pending,
    obj.source_data?.pan, obj.source_data?.sub_type, obj.source_data?.type,
    obj.success,
  ].map((v) => (v === undefined || v === null ? "" : String(v)));

  const concatenated = fields.join("");
  const computed = crypto
    .createHmac("sha512", process.env.PAYMOB_HMAC_SECRET)
    .update(concatenated)
    .digest("hex");

  return computed === query.hmac;
}

module.exports = { createPaymentSession, verifyHmac };

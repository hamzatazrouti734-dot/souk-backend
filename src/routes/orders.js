const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { createPaymentSession, verifyHmac } = require("../paymob");

const router = express.Router();

router.post("/checkout", requireAuth, async (req, res) => {
  const { items, address } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "السلة فارغة" });
  }

  const resolvedItems = [];
  let total = 0;
  for (const it of items) {
    const p = db.prepare("SELECT * FROM products WHERE id = ?").get(it.productId);
    if (!p) return res.status(400).json({ error: `منتج غير موجود: ${it.productId}` });
    if (p.stock < it.qty) return res.status(400).json({ error: `الكمية غير متاحة لمنتج: ${p.title}` });
    resolvedItems.push({ product: p, qty: it.qty });
    total += p.price * it.qty;
  }

  const orderId = crypto.randomUUID();
  db.prepare(
    "INSERT INTO orders (id, buyer_id, total, address, status, created_at) VALUES (?,?,?,?,?,?)"
  ).run(orderId, req.user.id, total, address || "", "pending", Date.now());

  for (const { product, qty } of resolvedItems) {
    db.prepare(
      "INSERT INTO order_items (id, order_id, product_id, seller_id, title, price, qty) VALUES (?,?,?,?,?,?,?)"
    ).run(crypto.randomUUID(), orderId, product.id, product.seller_id, product.title, product.price, qty);
  }

  try {
    const { paymobOrderId, iframeUrl } = await createPaymentSession({
      amountEGP: total,
      merchantOrderId: orderId,
      items: resolvedItems.map(({ product, qty }) => ({
        name: product.title, amount_cents: Math.round(product.price * 100), quantity: qty,
      })),
      billingData: {
        first_name: req.user.name?.split(" ")[0] || "N/A",
        last_name: req.user.name?.split(" ").slice(1).join(" ") || "N/A",
        email: req.user.email,
        phone_number: "+20000000000",
        street: address || "N/A", city: "N/A", country: "EG",
        apartment: "N/A", floor: "N/A", building: "N/A", state: "N/A",
      },
    });
    db.prepare("UPDATE orders SET paymob_order_id = ? WHERE id = ?").run(paymobOrderId, orderId);
    res.json({ orderId, paymentUrl: iframeUrl });
  } catch (e) {
    res.status(502).json({ error: "تعذّر بدء عملية الدفع: " + e.message });
  }
});

router.post("/paymob-webhook", express.json(), (req, res) => {
  const valid = verifyHmac(req.query, req.body);
  if (!valid) return res.status(401).json({ error: "توقيع غير صالح" });

  const obj = req.body.obj || {};
  const merchantOrderId = obj.order?.merchant_order_id;
  if (!merchantOrderId) return res.status(400).end();

  if (obj.success) {
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(merchantOrderId);
    if (order && order.status !== "paid") {
      db.prepare("UPDATE orders SET status = 'paid' WHERE id = ?").run(merchantOrderId);
      const items = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(merchantOrderId);
      for (const it of items) {
        db.prepare("UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?").run(it.qty, it.product_id);
      }
    }
  } else {
    db.prepare("UPDATE orders SET status = 'failed' WHERE id = ?").run(merchantOrderId);
  }
  res.json({ received: true });
});

router.get("/mine", requireAuth, (req, res) => {
  const orders = db.prepare("SELECT * FROM orders WHERE buyer_id = ? ORDER BY created_at DESC").all(req.user.id);
  const withItems = orders.map((o) => ({
    ...o,
    items: db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(o.id),
  }));
  res.json(withItems);
});

router.get("/sales", requireAuth, (req, res) => {
  const items = db.prepare(
    `SELECT oi.*, o.created_at, o.status, o.id AS order_id
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE oi.seller_id = ? AND o.status = 'paid' ORDER BY o.created_at DESC`
  ).all(req.user.id);
  res.json(items);
});

module.exports = router;

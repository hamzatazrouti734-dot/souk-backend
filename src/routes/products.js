const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.get("/", (req, res) => {
  const { category, search } = req.query;
  let sql = `SELECT p.*, u.name AS seller_name FROM products p JOIN users u ON u.id = p.seller_id WHERE 1=1`;
  const params = [];
  if (category && category !== "all") {
    sql += " AND p.category = ?";
    params.push(category);
  }
  if (search) {
    sql += " AND (p.title LIKE ? OR p.description LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }
  sql += " ORDER BY p.created_at DESC";
  res.json(db.prepare(sql).all(...params));
});

router.get("/mine", requireAuth, requireRole("seller"), (req, res) => {
  res.json(
    db.prepare("SELECT * FROM products WHERE seller_id = ? ORDER BY created_at DESC").all(req.user.id)
  );
});

router.post("/", requireAuth, requireRole("seller"), (req, res) => {
  const { title, description, category, price, stock } = req.body || {};
  if (!title || !category || price == null || stock == null) {
    return res.status(400).json({ error: "بيانات المنتج ناقصة" });
  }
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO products (id, seller_id, title, description, category, price, stock, created_at) VALUES (?,?,?,?,?,?,?,?)"
  ).run(id, req.user.id, title, description || "", category, price, stock, Date.now());
  res.status(201).json(db.prepare("SELECT * FROM products WHERE id = ?").get(id));
});

router.put("/:id", requireAuth, requireRole("seller"), (req, res) => {
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  if (!product) return res.status(404).json({ error: "المنتج غير موجود" });
  if (product.seller_id !== req.user.id) return res.status(403).json({ error: "هذا المنتج ليس ملكك" });

  const { title, description, category, price, stock } = req.body || {};
  db.prepare(
    "UPDATE products SET title=?, description=?, category=?, price=?, stock=? WHERE id=?"
  ).run(
    title ?? product.title,
    description ?? product.description,
    category ?? product.category,
    price ?? product.price,
    stock ?? product.stock,
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id));
});

router.delete("/:id", requireAuth, requireRole("seller"), (req, res) => {
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  if (!product) return res.status(404).json({ error: "المنتج غير موجود" });
  if (product.seller_id !== req.user.id) return res.status(403).json({ error: "هذا المنتج ليس ملكك" });
  db.prepare("DELETE FROM products WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

module.exports = router;

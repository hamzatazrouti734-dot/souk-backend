const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("../db");

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );
}

router.post("/register", async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password || !["buyer", "seller"].includes(role)) {
    return res.status(400).json({ error: "بيانات ناقصة أو غير صحيحة" });
  }
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: "البريد الإلكتروني مستخدم بالفعل" });

  const id = crypto.randomUUID();
  const password_hash = await bcrypt.hash(password, 10);
  db.prepare(
    "INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?,?,?,?,?,?)"
  ).run(id, name, email.toLowerCase(), password_hash, role, Date.now());

  const user = { id, name, email, role };
  res.status(201).json({ token: signToken(user), user });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get((email || "").toLowerCase());
  if (!row) return res.status(401).json({ error: "البيانات غير صحيحة" });
  const ok = await bcrypt.compare(password || "", row.password_hash);
  if (!ok) return res.status(401).json({ error: "البيانات غير صحيحة" });

  const user = { id: row.id, name: row.name, email: row.email, role: row.role };
  res.json({ token: signToken(user), user });
});

module.exports = router;

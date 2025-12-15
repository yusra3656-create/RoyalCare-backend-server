// =========================
//  IMPORTS
// =========================
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { pool } = require("./db");

// =========================
//  INIT APP
// =========================
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// =========================
//  ROOT
// =========================
app.get("/", (req, res) => {
  res.json({ status: "OK", message: "RoyalCare Backend Server is running 🚀" });
});

// =========================
//  UPLOADS
// =========================
const uploadsPath = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsPath)) fs.mkdirSync(uploadsPath);
app.use("/uploads", express.static(uploadsPath));

const storage = multer.diskStorage({
  destination: uploadsPath,
  filename: (_, file, cb) =>
    cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

// =========================
//  LOGIN
// =========================
app.post("/auth/login", async (req, res) => {
  const { username, password } = req.body;
  const result = await pool.query(
    `SELECT id, username, role, department
     FROM users WHERE username=$1 AND password=$2 LIMIT 1`,
    [username, password]
  );

  if (!result.rows.length)
    return res.status(401).json({ error: "Wrong credentials" });

  res.json({ user: result.rows[0] });
});

// =========================
//  DEVICES (FILTER BY DEPARTMENT)
// =========================
app.get("/devices", async (req, res) => {
  const { department } = req.query;
  let q = "SELECT * FROM devices";
  let p = [];

  if (department) {
    q += " WHERE department=$1";
    p.push(department);
  }

  const r = await pool.query(q + " ORDER BY id ASC", p);
  res.json(r.rows);
});

// =========================
//  ADD DEVICE (ADMIN)
// =========================
app.post("/devices", async (req, res) => {
  if (req.headers["x-role"] !== "admin")
    return res.status(403).json({ error: "Permission denied" });

  const d = req.body;
  const r = await pool.query(
    `INSERT INTO devices
    ("device name", model, serial_number, location, branch, department, status,
     lasr_service_date, next_service_date, files)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'[]')
    RETURNING *`,
    [
      d["device name"],
      d.model,
      d.serial_number,
      d.location,
      d.branch,
      d.department,
      d.status,
      d.lasr_service_date,
      d.next_service_date,
    ]
  );
  res.json(r.rows[0]);
});

// =========================
//  FILE UPLOAD
// =========================
app.post("/devices/:id/upload", upload.array("files", 10), async (req, res) => {
  const id = req.params.id;
  const r = await pool.query("SELECT files FROM devices WHERE id=$1", [id]);
  let files = r.rows[0]?.files || [];
  req.files.forEach(f => files.push(f.filename));

  await pool.query(
    "UPDATE devices SET files=$1::jsonb WHERE id=$2",
    [JSON.stringify(files), id]
  );
  res.json({ message: "Files uploaded" });
});

// =========================
//  FAULTS (ROLE BASED)
// =========================
app.post("/faults", async (req, res) => {
  const { device_id, description } = req.body;
  const userId = req.headers["x-user-id"];

  if (!userId) return res.status(400).json({ error: "User ID required" });

  const r = await pool.query(
    `INSERT INTO fault_reports (device_id, description, user_id)
     VALUES ($1,$2,$3) RETURNING *`,
    [device_id, description, userId]
  );
  res.json(r.rows[0]);
});

app.get("/faults", async (req, res) => {
  const role = req.headers["x-role"];
  const userId = req.headers["x-user-id"];

  let q = `
    SELECT f.id, f.device_id, f.description, f.status, f.created_at,
           d."device name" AS device_name
    FROM fault_reports f
    LEFT JOIN devices d ON d.id=f.device_id
  `;
  let p = [];

  if (role !== "admin") {
    q += " WHERE f.user_id=$1";
    p.push(userId);
  }

  const r = await pool.query(q + " ORDER BY f.id DESC", p);
  res.json(r.rows);
});

// =========================
//  START SERVER
// =========================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});

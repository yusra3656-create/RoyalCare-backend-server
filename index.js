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

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// =========================
//   STATIC UPLOADS FOLDER
// =========================
const uploadsPath = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsPath)) fs.mkdirSync(uploadsPath);

app.use("/uploads", express.static(uploadsPath));

// =========================
//   MULTER STORAGE
// =========================
const storage = multer.diskStorage({
  destination: uploadsPath,
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 999999);
    cb(null, unique + "-" + file.originalname);
  }
});
const upload = multer({ storage });

// =========================
//       LOGIN (DB)
// =========================
app.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const query = `
      SELECT id, username, role 
      FROM users 
      WHERE username=$1 AND password=$2
      LIMIT 1
    `;

    const result = await pool.query(query, [username, password]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Wrong credentials" });
    }

    res.json({ user: result.rows[0] });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// =========================
//       GET DEVICES
// =========================
app.get("/devices", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM devices ORDER BY id ASC");
    res.json(result.rows);
  } catch (err) {
    console.error("GET /devices ERROR:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// =========================
//     ADD DEVICE (Admin)
// =========================
app.post("/devices", async (req, res) => {
  if (req.headers["x-role"] !== "admin")
    return res.status(403).json({ error: "Permission denied" });

  const d = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO devices 
        ("device name", model, serial_number, location, branch, status, lasr_service_date, next_service_date, files)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        d["device name"],
        d.model,
        d.serial_number,
        d.location,
        d.branch,
        d.status,
        d.lasr_service_date,
        d.next_service_date,
        '[]'
      ]
    );

    res.json(result.rows[0]);

  } catch (err) {
    console.error("POST /devices ERROR:", err);
    res.status(500).json({ error: "Insert failed" });
  }
});

// =========================
//    UPDATE DEVICE (Admin)
// =========================
app.put("/devices/:id", async (req, res) => {
  if (req.headers["x-role"] !== "admin")
    return res.status(403).json({ error: "Permission denied" });

  const id = req.params.id;
  const d = req.body;

  try {
    const result = await pool.query(
      `UPDATE devices SET
        "device name"=$1, model=$2, serial_number=$3, location=$4,
        branch=$5, status=$6, lasr_service_date=$7, next_service_date=$8
       WHERE id=$9
       RETURNING *`,
      [
        d["device name"],
        d.model,
        d.serial_number,
        d.location,
        d.branch,
        d.status,
        d.lasr_service_date,
        d.next_service_date,
        id
      ]
    );

    res.json(result.rows[0]);

  } catch (err) {
    console.error("PUT /devices ERROR:", err);
    res.status(500).json({ error: "Update failed" });
  }
});

// =========================
//     DELETE DEVICE
// =========================
app.delete("/devices/:id", async (req, res) => {
  if (req.headers["x-role"] !== "admin")
    return res.status(403).json({ error: "Permission denied" });

  try {
    await pool.query("DELETE FROM devices WHERE id=$1", [req.params.id]);
    res.json({ message: "Deleted" });
  } catch (err) {
    console.error("DELETE /devices ERROR:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

// =========================
//     FILE UPLOAD
// =========================
app.post("/devices/:id/upload", upload.array("files", 10), async (req, res) => {
  const id = req.params.id;

  if (!req.files.length)
    return res.status(400).json({ error: "No files uploaded" });

  try {
    const check = await pool.query("SELECT files FROM devices WHERE id=$1", [id]);

    let oldFiles = [];
    if (check.rows[0].files) {
      if (Array.isArray(check.rows[0].files)) oldFiles = check.rows[0].files;
      else oldFiles = JSON.parse(check.rows[0].files);
    }

    req.files.forEach(f => oldFiles.push(f.filename));

    await pool.query(
      "UPDATE devices SET files=$1::jsonb WHERE id=$2",
      [JSON.stringify(oldFiles), id]
    );

    res.json({ message: "Files uploaded" });

  } catch (err) {
    console.error("FILE UPLOAD ERROR:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// =========================
//     DELETE FILE
// =========================
app.delete("/devices/:id/files/:filename", async (req, res) => {
  const { id, filename } = req.params;

  try {
    const filePath = path.join(uploadsPath, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    await pool.query(
      `
      UPDATE devices
      SET files = (
        SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
        FROM jsonb_array_elements_text(files) AS value
        WHERE value <> $1
      )
      WHERE id=$2`,
      [filename, id]
    );

    res.json({ message: "File deleted" });

  } catch (err) {
    console.error("DELETE FILE ERROR:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

// =========================
//      FAULT REPORTS
// =========================
app.post("/faults", async (req, res) => {
  const { device_id, description } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO fault_reports (device_id, description)
       VALUES ($1,$2) RETURNING *`,
      [device_id, description]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("FAULT ERROR:", err);
    res.status(500).json({ error: "Failed to add fault" });
  }
});

// =========================
//   GET ALL FAULTS
// =========================
app.get("/faults", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT f.id, f.device_id, f.description, f.status, f.created_at,
             d."device name" AS device_name
      FROM fault_reports f
      LEFT JOIN devices d ON d.id=f.device_id
      ORDER BY f.id DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("GET FAULTS ERROR:", err);
    res.status(500).json({ error: "Failed to load faults" });
  }
});

// =========================
//   CLOSE FAULT (Admin)
// =========================
app.put("/faults/:id/close", async (req, res) => {
  if (req.headers["x-role"] !== "admin")
    return res.status(403).json({ error: "Permission denied" });

  try {
    const result = await pool.query(
      `UPDATE fault_reports SET status='Closed' WHERE id=$1 RETURNING *`,
      [req.params.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("CLOSE FAULT ERROR:", err);
    res.status(500).json({ error: "Close failed" });
  }
});

// =========================
//   DELETE FAULT (Admin)
// =========================
app.delete("/faults/:id", async (req, res) => {
  if (req.headers["x-role"] !== "admin")
    return res.status(403).json({ error: "Permission denied" });

  try {
    await pool.query("DELETE FROM fault_reports WHERE id=$1", [req.params.id]);
    res.json({ message: "Fault deleted" });
  } catch (err) {
    console.error("DELETE FAULT ERROR:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

// =========================
//   FIND LOCAL IP
// =========================
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "localhost";
}
const localIP = getLocalIP();

// =========================
//     START SERVER
// =========================
app.listen(3000, "0.0.0.0", () => {
  console.log(`✓ Server running at http://${localIP}:3000`);
});


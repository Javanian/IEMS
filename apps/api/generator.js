const fs = require('fs');
const path = require('path');

const name = process.argv[2];
if (!name) {
  console.error('❌ Masukkan nama tabel. Contoh: node generator.js sow');
  process.exit(1);
}

const controllerName = `${name}Controller.js`;
const routeName = `${name}.js`;

const controllerDir = path.join(__dirname, 'controllers');
const routeDir = path.join(__dirname, 'routes');

const controllerTemplate = `const db = require("../db");

exports.getAll = async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM ${name}");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query("SELECT * FROM ${name} WHERE id = $1", [id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    // TODO: sesuaikan kolom tabel
    res.json({ message: "Create ${name}" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    // TODO: sesuaikan kolom tabel
    res.json({ message: "Update ${name} with id " + id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    await db.query("DELETE FROM ${name} WHERE id = $1", [id]);
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
`;

const routeTemplate = `const express = require("express");
const router = express.Router();
const controller = require("../controllers/${name}Controller");

router.get("/", controller.getAll);
router.get("/:id", controller.getById);
router.post("/", controller.create);
router.put("/:id", controller.update);
router.delete("/:id", controller.remove);

module.exports = router;
`;

if (!fs.existsSync(controllerDir)) fs.mkdirSync(controllerDir);
fs.writeFileSync(path.join(controllerDir, controllerName), controllerTemplate);
console.log(`✅ Created controllers/${controllerName}`);

if (!fs.existsSync(routeDir)) fs.mkdirSync(routeDir);
fs.writeFileSync(path.join(routeDir, routeName), routeTemplate);
console.log(`✅ Created routes/${routeName}`);

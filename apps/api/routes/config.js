"use strict";
const express = require("express");
const router = express.Router();
const { getPublicConfig } = require("../config/plantConfig");
const {
  getConfigRules,
  putConfigRules,
  getActivityCatalog,
} = require("../controllers/configRulesController");


router.get("/", (req, res) => {
  try {
    res.set("Cache-Control", "public, max-age=60");
    res.json(getPublicConfig());
  } catch (err) {
    res.status(503).json({ error: "plant config belum siap" });
  }
});




router.get("/rules", getConfigRules);
router.put("/rules", putConfigRules);



router.get("/activity-catalog", getActivityCatalog);

module.exports = router;

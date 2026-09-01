"use strict";
const path = require("path");
process.chdir("D:/website/MPS2/apps/api");
const {
  normalizeMaxRecordMinutes,
  legacyCategoryMinutes,
  expandLegacyIntoTypeMaps,
} = require("../controllers/configRulesController");

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.log(`FAIL ${label}\n  got  ${g}\n  want ${w}`);
    fail++;
  } else {
    console.log(`ok   ${label}`);
  }
};

const CATALOG = {
  mch: [
    { statusid: 1, category: "va" },
    { statusid: 2, category: "nva" },
    { statusid: 7, category: "nnva" },
    { statusid: 12, category: "nva" },
  ],
  timesheet: [
    { activitytype: "", category: "va" },
    { activitytype: "1520", category: "nva" },
    { activitytype: "1670", category: "nva" },
  ],
};

// 1. legacy angka tunggal -> map kosong + legacy terdeteksi
eq("legacy number", legacyCategoryMinutes(150), { va: 150, nnva: 150, nva: 150 });
// 2. legacy object
eq("legacy object", legacyCategoryMinutes({ va: 300, nnva: 150, nva: 150 }), { va: 300, nnva: 150, nva: 150 });
// 3. struktur baru -> legacy null
eq("new structure no legacy", legacyCategoryMinutes({ mch: { "1": 300 }, timesheet: { "": 300 } }), null);
// 4. normalize map + null + garbage dibuang
eq("normalize per-type", normalizeMaxRecordMinutes({ mch: { "1": 300, "2": null, x: 5 }, timesheet: { "": 480, "1520": 30, "xx": 9 } }), {
  mch: { "1": 300, "2": null },
  timesheet: { "": 480, "1520": 30 },
});
// 5. expand: jenis tanpa entry diisi legacy kategori; entry ada (termasuk null) tidak ditimpa
const expanded = expandLegacyIntoTypeMaps(
  normalizeMaxRecordMinutes({ mch: { "1": null }, timesheet: {} }),
  { va: 300, nnva: 150, nva: 150 },
  CATALOG
);
eq("expand legacy", expanded, {
  mch: { "1": null, "2": 150, "7": 150, "12": 150 },
  timesheet: { "": 300, "1520": 150, "1670": 150 },
});
// 6. round-trip idempoten: expand dua kali sama
eq("expand idempotent", expandLegacyIntoTypeMaps(expanded, { va: 300, nnva: 150, nva: 150 }, CATALOG), expanded);

console.log(fail === 0 ? "\n6/6 PASS" : `\n${fail} FAIL`);
process.exitCode = fail ? 1 : 0;

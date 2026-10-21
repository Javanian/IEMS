/**
 * Canonical master data fixtures for IEMS domain testing.
 * Provides immutable reference data for organizations, legal entities, plants,
 * work centers, warehouses, currencies, UOMs, parties, employees, and items.
 */

'use strict';

const masterData = {
  organization: {
    id: 'ORG-001',
    code: 'IEMS-GROUP',
    name: 'PT Industri Equipment Manufaktur dan Servis'
  },

  legalEntities: {
    'LE-ID-001': {
      id: 'LE-ID-001',
      organization_id: 'ORG-001',
      code: 'IEMS-ID',
      name: 'PT IEMS Indonesia',
      tax_id: '01.345.678.9-012.000',
      currency_code: 'USD',
      local_currency_code: 'IDR'
    }
  },

  plants: {
    'PLANT-CKR': {
      id: 'PLANT-CKR',
      legal_entity_id: 'LE-ID-001',
      code: 'CKR',
      name: 'Cikarang Equipment Manufacturing Plant',
      timezone: 'Asia/Jakarta',
      currency: 'USD',
      address: {
        street: 'Kawasan Industri GIIC Blok AB No. 12',
        city: 'Cikarang Pusat',
        province: 'Jawa Barat',
        postal_code: '17530',
        country: 'ID'
      }
    },
    'PLANT-BPN': {
      id: 'PLANT-BPN',
      legal_entity_id: 'LE-ID-001',
      code: 'BPN',
      name: 'Balikpapan Mining Component Repair Center',
      timezone: 'Asia/Makassar',
      currency: 'USD',
      address: {
        street: 'Jl. Mulawarman KM 18.5 No. 88',
        city: 'Balikpapan',
        province: 'Kalimantan Timur',
        postal_code: '76116',
        country: 'ID'
      }
    }
  },

  currencies: {
    USD: { code: 'USD', name: 'US Dollar', decimals: 2, symbol: '$' },
    IDR: { code: 'IDR', name: 'Indonesian Rupiah', decimals: 2, symbol: 'Rp' }
  },

  uoms: {
    UN: { code: 'UN', name: 'Unit / Piece', category: 'COUNT', decimals: 4 },
    SET: { code: 'SET', name: 'Set', category: 'COUNT', decimals: 4 },
    KG: { code: 'KG', name: 'Kilogram', category: 'MASS', decimals: 4 },
    M: { code: 'M', name: 'Meter', category: 'LENGTH', decimals: 4 },
    HR: { code: 'HR', name: 'Hours', category: 'TIME', decimals: 4 }
  },

  workcenters: {
    'WC-CNC-01': {
      id: 'WC-CNC-01',
      plant_id: 'PLANT-CKR',
      code: 'WC-CNC-01',
      name: 'CNC Vertical Machining Center VMC-1200',
      area: 'AREA-MACHINING',
      capacity_hours_per_day: '16.0000',
      hourly_rate: '65.00'
    },
    'WC-MILL-02': {
      id: 'WC-MILL-02',
      plant_id: 'PLANT-CKR',
      code: 'WC-MILL-02',
      name: 'Heavy Horizontal Boring and Milling Center',
      area: 'AREA-MACHINING',
      capacity_hours_per_day: '16.0000',
      hourly_rate: '75.00'
    },
    'WC-BAL-01': {
      id: 'WC-BAL-01',
      plant_id: 'PLANT-CKR',
      code: 'WC-BAL-01',
      name: 'Dynamic Balancing Rig Schenck 5-Ton',
      area: 'AREA-BALANCING',
      capacity_hours_per_day: '8.0000',
      hourly_rate: '55.00'
    },
    'WC-ASM-01': {
      id: 'WC-ASM-01',
      plant_id: 'PLANT-CKR',
      code: 'WC-ASM-01',
      name: 'Cleanroom Mechanical Assembly and Torquing Bay',
      area: 'AREA-ASSEMBLY',
      capacity_hours_per_day: '16.0000',
      hourly_rate: '45.00'
    },
    'WC-TST-01': {
      id: 'WC-TST-01',
      plant_id: 'PLANT-CKR',
      code: 'WC-TST-01',
      name: 'Hydrostatic and Rotation Test Cell 500 Bar',
      area: 'AREA-TESTING',
      capacity_hours_per_day: '8.0000',
      hourly_rate: '80.00'
    },
    'WC-BPN-INTAKE': {
      id: 'WC-BPN-INTAKE',
      plant_id: 'PLANT-BPN',
      code: 'WC-BPN-INTAKE',
      name: 'Heavy Teardown and Wash Bay 50-Ton',
      area: 'AREA-TEARDOWN',
      capacity_hours_per_day: '16.0000',
      hourly_rate: '50.00'
    },
    'WC-BPN-HONE': {
      id: 'WC-BPN-HONE',
      plant_id: 'PLANT-BPN',
      code: 'WC-BPN-HONE',
      name: 'Precision Hydraulic Cylinder Honing Station',
      area: 'AREA-MACHINING',
      capacity_hours_per_day: '16.0000',
      hourly_rate: '70.00'
    },
    'WC-BPN-CHROME': {
      id: 'WC-BPN-CHROME',
      plant_id: 'PLANT-BPN',
      code: 'WC-BPN-CHROME',
      name: 'Hard Chrome Plating and Cylindrical Grinding Bay',
      area: 'AREA-PLATING',
      capacity_hours_per_day: '16.0000',
      hourly_rate: '85.00'
    },
    'WC-BPN-ASM': {
      id: 'WC-BPN-ASM',
      plant_id: 'PLANT-BPN',
      code: 'WC-BPN-ASM',
      name: 'Hydraulic Cylinder Clean Assembly Bench',
      area: 'AREA-ASSEMBLY',
      capacity_hours_per_day: '16.0000',
      hourly_rate: '48.00'
    },
    'WC-BPN-TEST': {
      id: 'WC-BPN-TEST',
      plant_id: 'PLANT-BPN',
      code: 'WC-BPN-TEST',
      name: 'High-Pressure Hydraulic Test Stand 700 Bar',
      area: 'AREA-TESTING',
      capacity_hours_per_day: '8.0000',
      hourly_rate: '90.00'
    }
  },

  warehouses: {
    'WH-RAW-CKR': {
      id: 'WH-RAW-CKR',
      plant_id: 'PLANT-CKR',
      code: 'WH-RAW-CKR',
      name: 'Cikarang Central Raw Materials Warehouse',
      locations: ['LOC-RAW-STL-01', 'LOC-RAW-CST-03', 'LOC-SEL-ROOM-01']
    },
    'WH-FG-CKR': {
      id: 'WH-FG-CKR',
      plant_id: 'PLANT-CKR',
      code: 'WH-FG-CKR',
      name: 'Cikarang Finished Goods Dispatch Warehouse',
      locations: ['LOC-FG-STG-A']
    },
    'WH-CUST-BPN': {
      id: 'WH-CUST-BPN',
      plant_id: 'PLANT-BPN',
      code: 'WH-CUST-BPN',
      name: 'Balikpapan Customer Asset Receiving and Custody Yard',
      locations: ['LOC-INTK-01', 'LOC-WIP-01', 'LOC-RET-01']
    },
    'WH-SPR-BPN': {
      id: 'WH-SPR-BPN',
      plant_id: 'PLANT-BPN',
      code: 'WH-SPR-BPN',
      name: 'Balikpapan Spares and Consumables Warehouse',
      locations: ['LOC-SPR-B2']
    }
  },

  parties: {
    'PRT-CUST-NMR': {
      id: 'PRT-CUST-NMR',
      code: 'NMR',
      name: 'PT Nusantara Mining Resources',
      role: 'CUSTOMER',
      tax_id: '02.890.123.4-041.000',
      payment_terms_days: 30,
      currency: 'USD',
      billing_address: {
        street: 'Wisma Mining Tower 18th Floor, Jl. H.R. Rasuna Said',
        city: 'Jakarta Selatan',
        province: 'DKI Jakarta',
        postal_code: '12920',
        country: 'ID'
      },
      delivery_address: {
        street: 'Site Sangatta Coal Terminal, Port Processing Area',
        city: 'Kutai Timur',
        province: 'Kalimantan Timur',
        postal_code: '75611',
        country: 'ID'
      }
    },
    'PRT-CUST-KPC': {
      id: 'PRT-CUST-KPC',
      code: 'KPC',
      name: 'PT Kaltim Prima Coal',
      role: 'CUSTOMER',
      tax_id: '01.234.567.8-032.000',
      payment_terms_days: 30,
      currency: 'USD',
      billing_address: {
        street: 'M1 Building, Mine Operations Complex',
        city: 'Sangatta',
        province: 'Kalimantan Timur',
        postal_code: '75611',
        country: 'ID'
      },
      delivery_address: {
        street: 'Central Workshop West Mine Warehouse 04',
        city: 'Sangatta',
        province: 'Kalimantan Timur',
        postal_code: '75611',
        country: 'ID'
      }
    },
    'PRT-SUP-ICP': {
      id: 'PRT-SUP-ICP',
      code: 'ICP',
      name: 'PT Indo Casting Pratama',
      role: 'SUPPLIER',
      tax_id: '01.999.888.7-013.000',
      currency: 'USD',
      address: {
        street: 'Kawasan Industri Mitra Karawang Blok D-4',
        city: 'Karawang',
        province: 'Jawa Barat',
        postal_code: '41361',
        country: 'ID'
      }
    },
    'PRT-SUP-PRK': {
      id: 'PRT-SUP-PRK',
      code: 'PRK',
      name: 'PT Parker Hannifin Indonesia',
      role: 'SUPPLIER',
      tax_id: '02.111.222.3-054.000',
      currency: 'USD',
      address: {
        street: 'Delta Silicon 3 Industrial Park, Jl. Trembesi Blok F21',
        city: 'Cikarang Pusat',
        province: 'Jawa Barat',
        postal_code: '17530',
        country: 'ID'
      }
    }
  },

  employees: {
    'EMP-0104': {
      id: 'EMP-0104',
      badge_no: 'BDG-0104',
      name: 'Hendra Wijaya',
      role: 'MACHINIST',
      plant_id: 'PLANT-CKR',
      qualifications: [
        { skill_code: 'SKILL-CNC-3AXIS', valid_until: '2027-12-31' },
        { skill_code: 'SKILL-PRECISION-BALANCING', valid_until: '2027-10-15' }
      ]
    },
    'EMP-0108': {
      id: 'EMP-0108',
      badge_no: 'BDG-0108',
      name: 'Bambang Sutrisno',
      role: 'ASSEMBLY_TECH',
      plant_id: 'PLANT-CKR',
      qualifications: [
        { skill_code: 'SKILL-HYD-ASSEMBLY', valid_until: '2027-06-30' },
        { skill_code: 'SKILL-TORQUE-CALIBRATED', valid_until: '2027-06-30' }
      ]
    },
    'EMP-0112': {
      id: 'EMP-0112',
      badge_no: 'BDG-0112',
      name: 'Agus Priyanto',
      role: 'WELDER',
      plant_id: 'PLANT-CKR',
      qualifications: [
        { skill_code: 'SKILL-ASME-IX-6G', valid_until: '2025-12-31' } // Expired qualification for negative testing
      ]
    },
    'EMP-0201': {
      id: 'EMP-0201',
      badge_no: 'BDG-0201',
      name: 'David Santoso',
      role: 'QC_INSPECTOR',
      plant_id: 'PLANT-CKR',
      qualifications: [
        { skill_code: 'SKILL-NDT-MT-PT-L2', valid_until: '2028-01-31' },
        { skill_code: 'SKILL-HYDRO-TEST-SIGNOFF', valid_until: '2028-01-31' }
      ]
    },
    'EMP-0205': {
      id: 'EMP-0205',
      badge_no: 'BDG-0205',
      name: 'Siti Rahmawati',
      role: 'QC_LEAD',
      plant_id: 'PLANT-CKR',
      qualifications: [
        { skill_code: 'SKILL-QA-SIGNOFF', valid_until: '2028-05-31' },
        { skill_code: 'SKILL-AIRWORTHINESS-INDUSTRIAL', valid_until: '2028-05-31' }
      ]
    },
    'EMP-0701': {
      id: 'EMP-0701',
      badge_no: 'BDG-0701',
      name: 'Iwan Setiawan',
      role: 'REPAIR_SPECIALIST',
      plant_id: 'PLANT-BPN',
      qualifications: [
        { skill_code: 'SKILL-HYD-CYL-TEARDOWN', valid_until: '2027-11-30' },
        { skill_code: 'SKILL-HARD-CHROME-GRIND', valid_until: '2027-09-30' },
        { skill_code: 'SKILL-700BAR-TEST-CERT', valid_until: '2027-11-30' }
      ]
    },
    'EMP-0705': {
      id: 'EMP-0705',
      badge_no: 'BDG-0705',
      name: 'Rahmat Hidayat',
      role: 'QC_INSPECTOR_BPN',
      plant_id: 'PLANT-BPN',
      qualifications: [
        { skill_code: 'SKILL-NDT-MT-PT-L2', valid_until: '2028-03-31' },
        { skill_code: 'SKILL-QA-SIGNOFF', valid_until: '2028-03-31' }
      ]
    }
  },

  equipment: {
    'EQP-TORQUE-250': {
      id: 'EQP-TORQUE-250',
      plant_id: 'PLANT-CKR',
      code: 'EQP-TORQUE-250',
      name: 'Stahlwille Digital Torque Wrench 50-250 Nm',
      serial_no: 'STW-2024-8891',
      calibration: {
        certificate_no: 'CAL-2026-0819',
        calibrated_at: '2026-02-15',
        expires_at: '2027-02-15',
        status: 'VALID'
      }
    },
    'EQP-PRESS-600': {
      id: 'EQP-PRESS-600',
      plant_id: 'PLANT-CKR',
      code: 'EQP-PRESS-600',
      name: 'WIKA Digital Test Gauge 0-600 Bar Cl 0.1',
      serial_no: 'WIK-2025-1004',
      calibration: {
        certificate_no: 'CAL-2026-0312',
        calibrated_at: '2026-03-10',
        expires_at: '2027-03-10',
        status: 'VALID'
      }
    },
    'EQP-TW-EXPIRED': {
      id: 'EQP-TW-EXPIRED',
      plant_id: 'PLANT-CKR',
      code: 'EQP-TW-044',
      name: 'Snap-on Calibrated Click-Type Torque Wrench 40-200 Nm',
      serial_no: 'SPO-2022-4401',
      calibration: {
        certificate_no: 'CAL-2025-0914',
        calibrated_at: '2025-09-15',
        expires_at: '2026-09-15', // Expired as of October 2026
        status: 'EXPIRED'
      }
    },
    'EQP-BPN-TEST-700': {
      id: 'EQP-BPN-TEST-700',
      plant_id: 'PLANT-BPN',
      code: 'EQP-BPN-TEST-700',
      name: 'Enerpac High-Pressure Hydrostatic Bench 700 Bar',
      serial_no: 'ENR-2023-7002',
      calibration: {
        certificate_no: 'CAL-BPN-2026-0102',
        calibrated_at: '2026-01-10',
        expires_at: '2027-01-10',
        status: 'VALID'
      }
    }
  },

  items: {
    'ASY-SLP-250-HC': {
      id: 'ITM-ASY-SLP-250',
      code: 'ASY-SLP-250-HC',
      name: 'Slurry Pump Impeller Shaft Assembly 250mm High-Chrome Alloy',
      category: 'MANUFACTURED_ASSEMBLY',
      uom: 'UN',
      serialized: true,
      standard_cost: '6850.00',
      drawing_no: 'DWG-SLP-250-REV-C',
      revisions: ['REV-A', 'REV-B', 'REV-C'],
      current_revision: 'REV-C'
    },
    'CST-HC-250': {
      id: 'ITM-CST-HC-250',
      code: 'CST-HC-250',
      name: 'High-Chrome 28% Alloy Impeller Raw Casting 250mm',
      category: 'RAW_MATERIAL',
      uom: 'UN',
      serialized: false,
      lot_tracked: true,
      standard_cost: '2400.00'
    },
    'SFT-4140-100': {
      id: 'ITM-SFT-4140-100',
      code: 'SFT-4140-100',
      name: 'AISI 4140 Quenched and Tempered Steel Shaft Blank dia 100mm x 1200mm',
      category: 'RAW_MATERIAL',
      uom: 'UN',
      serialized: false,
      lot_tracked: true,
      standard_cost: '850.00'
    },
    'SEL-VTN-100': {
      id: 'ITM-SEL-VTN-100',
      code: 'SEL-VTN-100',
      name: 'Viton Heavy Duty Mechanical Seal Cartridge 100mm Shaft',
      category: 'PURCHASED_COMPONENT',
      uom: 'UN',
      serialized: false,
      lot_tracked: true,
      standard_cost: '950.00'
    },
    'BRG-SKF-22220': {
      id: 'ITM-BRG-SKF-22220',
      code: 'BRG-SKF-22220',
      name: 'SKF Explorer Spherical Roller Bearing 22220-E',
      category: 'PURCHASED_COMPONENT',
      uom: 'UN',
      serialized: false,
      lot_tracked: true,
      standard_cost: '380.00'
    },
    'FST-KIT-M24': {
      id: 'ITM-FST-KIT-M24',
      code: 'FST-KIT-M24',
      name: 'Fastener Kit Class 10.9 Zinc-Flake Coated M24 x 120mm with Belleville Washers',
      category: 'HARDWARE',
      uom: 'SET',
      serialized: false,
      lot_tracked: true,
      standard_cost: '110.00'
    },
    'KIT-SEAL-793D-OEM': {
      id: 'ITM-KIT-SEAL-793D',
      code: 'KIT-SEAL-793D-OEM',
      name: 'Parker OEM Complete Rod Seal and Wiper Kit for Cat 793D Suspension Cylinder',
      category: 'PURCHASED_COMPONENT',
      uom: 'SET',
      serialized: false,
      lot_tracked: true,
      standard_cost: '1450.00'
    },
    'RNG-BKUP-04': {
      id: 'ITM-RNG-BKUP-04',
      code: 'RNG-BKUP-04',
      name: 'Virgin PTFE Split Backup Ring 180mm x 5mm',
      category: 'HARDWARE',
      uom: 'UN',
      serialized: false,
      lot_tracked: false,
      standard_cost: '35.00'
    }
  }
};

module.exports = { masterData };

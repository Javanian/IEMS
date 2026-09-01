const db = global.pool || require('../db');

const ORDER_FIELDS = [
  'ssbr_ident',
  'customer_id',
  'received_date',
  'tagging_time',
  'received_by_id',
  'reff_number',
  'ex_unit',
  'packing_list',
  'da_ckb_received',
  'packing_type_id',
  'raw_sow_text',
];

const SHIPPING_FIELDS = [
  'delivery_note_number',
  'send_by_id',
  'destination',
  'consignment_notes',
  'shipping_list',
  'freight_cost_bill',
  'delivery_date',
  'return_to_stock_date',
  'dn_received_by_customer',
  'dn_received_by_ssb',
  'dn_submit_date',
];

const COMPONENT_FIELDS = [
  'part_level',
  'component_id',
  'part_number',
  'part_description',
  'model_code',
  'part_type',
  'part_category_id',
  'production_order',
  'actual_component',
];

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const hasOwn = (source, key) => Object.prototype.hasOwnProperty.call(source, key);

const normalizeEmpty = (value) => (value === '' ? null : value);

const buildUpdate = (table, fields, source, whereClause, whereParams) => {
  const sets = [];
  const values = [];

  fields.forEach((field) => {
    if (hasOwn(source, field)) {
      values.push(normalizeEmpty(source[field]));
      sets.push(`${field} = $${values.length}`);
    }
  });

  if (!sets.length) {
    return null;
  }

  values.push(...whereParams);
  const whereSql = whereClause.replace(
    /\$(\d+)/g,
    (_, index) => `$${values.length - whereParams.length + Number(index)}`
  );

  return {
    text: `
      UPDATE ${table}
      SET ${sets.join(', ')}, updated_at = NOW()
      WHERE ${whereSql}
      RETURNING *
    `,
    values,
  };
};

const getClient = async () => {
  if (typeof db.connect === 'function') {
    return db.connect();
  }

  throw new Error('Database pool connection is not available');
};

const upsertCustomer = async (client, customer) => {
  if (!customer || !customer.name) {
    return null;
  }

  const result = await client.query(
    `
      INSERT INTO customers (
        name, site_name, site_location, contact_person, phone, email, address
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (name, site_name)
      DO UPDATE SET
        site_location = COALESCE(EXCLUDED.site_location, customers.site_location),
        contact_person = COALESCE(EXCLUDED.contact_person, customers.contact_person),
        phone = COALESCE(EXCLUDED.phone, customers.phone),
        email = COALESCE(EXCLUDED.email, customers.email),
        address = COALESCE(EXCLUDED.address, customers.address),
        updated_at = NOW()
      RETURNING id
    `,
    [
      customer.name,
      normalizeEmpty(customer.site_name),
      normalizeEmpty(customer.site_location),
      normalizeEmpty(customer.contact_person),
      normalizeEmpty(customer.phone),
      normalizeEmpty(customer.email),
      normalizeEmpty(customer.address),
    ]
  );

  return result.rows[0].id;
};

const insertComponents = async (client, receivingOrderId, components = []) => {
  const inserted = [];
  const idMap = new Map();
  let currentParentId = null;

  for (const component of components) {
    const level = Number(component.part_level);
    if (![1, 2].includes(level)) {
      throw new Error('component.part_level must be 1 or 2');
    }

    if (!component.part_description) {
      throw new Error('component.part_description is required');
    }

    let parentComponentId = null;
    if (level === 2) {
      parentComponentId =
        idMap.get(component.parent_temp_id) ||
        idMap.get(component.parent_component_id) ||
        currentParentId ||
        null;

      if (!parentComponentId) {
        throw new Error('Level 2 component must follow a level 1 parent');
      }
    }

    const result = await client.query(
      `
        INSERT INTO receiving_components (
          receiving_order_id,
          parent_component_id,
          part_level,
          part_number,
          component_id,
          part_description,
          model_code,
          part_type,
          part_category_id,
          production_order,
          actual_component
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `,
      [
        receivingOrderId,
        parentComponentId,
        level,
        normalizeEmpty(component.part_number),
        normalizeEmpty(component.component_id),
        component.part_description,
        normalizeEmpty(component.model_code),
        normalizeEmpty(component.part_type),
        normalizeEmpty(component.part_category_id),
        normalizeEmpty(component.production_order),
        normalizeEmpty(component.actual_component),
      ]
    );

    const row = result.rows[0];
    inserted.push(row);

    if (component.temp_id !== undefined && component.temp_id !== null) {
      idMap.set(component.temp_id, row.id);
    }
    if (component.id !== undefined && component.id !== null) {
      idMap.set(component.id, row.id);
    }
    if (level === 1) {
      currentParentId = row.id;
    }
  }

  return inserted;
};

const upsertShipping = async (client, receivingOrderId, shipping) => {
  if (!shipping) {
    return null;
  }

  const values = SHIPPING_FIELDS.map((field) => normalizeEmpty(shipping[field]));
  const result = await client.query(
    `
      INSERT INTO shipping_records (
        receiving_order_id,
        delivery_note_number,
        send_by_id,
        destination,
        consignment_notes,
        shipping_list,
        freight_cost_bill,
        delivery_date,
        return_to_stock_date,
        dn_received_by_customer,
        dn_received_by_ssb,
        dn_submit_date
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (receiving_order_id)
      DO UPDATE SET
        delivery_note_number = EXCLUDED.delivery_note_number,
        send_by_id = EXCLUDED.send_by_id,
        destination = EXCLUDED.destination,
        consignment_notes = EXCLUDED.consignment_notes,
        shipping_list = EXCLUDED.shipping_list,
        freight_cost_bill = EXCLUDED.freight_cost_bill,
        delivery_date = EXCLUDED.delivery_date,
        return_to_stock_date = EXCLUDED.return_to_stock_date,
        dn_received_by_customer = EXCLUDED.dn_received_by_customer,
        dn_received_by_ssb = EXCLUDED.dn_received_by_ssb,
        dn_submit_date = EXCLUDED.dn_submit_date,
        updated_at = NOW()
      RETURNING *
    `,
    [receivingOrderId, ...values]
  );

  return result.rows[0];
};

const getDetailById = async (id) => {
  const orderResult = await db.query(
    `
      SELECT
        ro.*,
        c.name AS customer_name,
        c.site_name AS customer_site_name,
        c.site_location AS customer_site_location,
        rb.name AS received_by_name,
        pt.name AS packing_type_name,
        sr.id AS shipping_id,
        sr.delivery_note_number,
        sr.send_by_id,
        sb.name AS send_by_name,
        sr.destination,
        sr.consignment_notes,
        sr.shipping_list,
        sr.freight_cost_bill,
        sr.delivery_date,
        sr.return_to_stock_date,
        sr.dn_received_by_customer,
        sr.dn_received_by_ssb,
        sr.dn_submit_date,
        sr.created_at AS shipping_created_at,
        sr.updated_at AS shipping_updated_at
      FROM receiving_orders ro
      JOIN customers c ON c.id = ro.customer_id
      LEFT JOIN users rb ON rb.id = ro.received_by_id
      LEFT JOIN packing_types pt ON pt.id = ro.packing_type_id
      LEFT JOIN shipping_records sr ON sr.receiving_order_id = ro.id
      LEFT JOIN users sb ON sb.id = sr.send_by_id
      WHERE ro.id = $1
    `,
    [id]
  );

  if (!orderResult.rows.length) {
    return null;
  }

  const componentsResult = await db.query(
    `
      SELECT
        rc.*,
        pc.part_description AS parent_part_description,
        pc.part_number AS parent_part_number,
        cm.part_number AS master_part_number,
        cm.part_name AS master_part_description,
        cm.model AS master_model,
        cat.name AS part_category_name
      FROM receiving_components rc
      LEFT JOIN receiving_components pc ON pc.id = rc.parent_component_id
      LEFT JOIN components cm ON cm.component_id = rc.component_id
      LEFT JOIN part_categories cat ON cat.id = rc.part_category_id
      WHERE rc.receiving_order_id = $1
      ORDER BY rc.id ASC
    `,
    [id]
  );

  const row = orderResult.rows[0];
  const shipping = row.shipping_id
    ? {
        id: row.shipping_id,
        receiving_order_id: row.id,
        delivery_note_number: row.delivery_note_number,
        send_by_id: row.send_by_id,
        send_by_name: row.send_by_name,
        destination: row.destination,
        consignment_notes: row.consignment_notes,
        shipping_list: row.shipping_list,
        freight_cost_bill: row.freight_cost_bill,
        delivery_date: row.delivery_date,
        return_to_stock_date: row.return_to_stock_date,
        dn_received_by_customer: row.dn_received_by_customer,
        dn_received_by_ssb: row.dn_received_by_ssb,
        dn_submit_date: row.dn_submit_date,
        created_at: row.shipping_created_at,
        updated_at: row.shipping_updated_at,
      }
    : null;

  delete row.shipping_id;
  delete row.delivery_note_number;
  delete row.send_by_id;
  delete row.send_by_name;
  delete row.destination;
  delete row.consignment_notes;
  delete row.shipping_list;
  delete row.freight_cost_bill;
  delete row.delivery_date;
  delete row.return_to_stock_date;
  delete row.dn_received_by_customer;
  delete row.dn_received_by_ssb;
  delete row.dn_submit_date;
  delete row.shipping_created_at;
  delete row.shipping_updated_at;

  return {
    ...row,
    shipping,
    components: componentsResult.rows,
  };
};

exports.getAll = async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(parsePositiveInt(req.query.limit, 25), 100);
    const offset = (page - 1) * limit;
    const filters = [];
    const values = [];

    if (req.query.q) {
      values.push(`%${req.query.q}%`);
      filters.push(`
        (
          ro.ssbr_ident ILIKE $${values.length}
          OR c.name ILIKE $${values.length}
          OR c.site_name ILIKE $${values.length}
          OR sr.delivery_note_number ILIKE $${values.length}
          OR EXISTS (
            SELECT 1
            FROM receiving_components rc_search
            WHERE rc_search.receiving_order_id = ro.id
              AND (
                rc_search.part_number ILIKE $${values.length}
                OR rc_search.part_description ILIKE $${values.length}
                OR rc_search.production_order ILIKE $${values.length}
              )
          )
        )
      `);
    }

    if (req.query.from) {
      values.push(req.query.from);
      filters.push(`ro.received_date >= $${values.length}`);
    }

    if (req.query.to) {
      values.push(req.query.to);
      filters.push(`ro.received_date <= $${values.length}`);
    }

    if (req.query.shipped === 'true') {
      filters.push('sr.id IS NOT NULL');
    }

    if (req.query.shipped === 'false') {
      filters.push('sr.id IS NULL');
    }

    const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const countResult = await db.query(
      `
        SELECT COUNT(*)::int AS total
        FROM receiving_orders ro
        JOIN customers c ON c.id = ro.customer_id
        LEFT JOIN shipping_records sr ON sr.receiving_order_id = ro.id
        ${whereSql}
      `,
      values
    );

    values.push(limit, offset);
    const dataResult = await db.query(
      `
        SELECT
          ro.id,
          ro.ssbr_ident,
          ro.received_date,
          ro.tagging_time,
          ro.reff_number,
          ro.ex_unit,
          ro.packing_list,
          ro.da_ckb_received,
          c.name AS customer_name,
          c.site_name AS customer_site_name,
          rb.name AS received_by_name,
          pt.name AS packing_type_name,
          sr.id AS shipping_id,
          sr.delivery_note_number,
          sr.destination,
          sr.delivery_date,
          sb.name AS send_by_name,
          COUNT(rc.id)::int AS component_count,
          COUNT(rc.id) FILTER (WHERE rc.part_level = 1)::int AS parent_component_count,
          COUNT(rc.id) FILTER (WHERE rc.part_level = 2)::int AS child_component_count
        FROM receiving_orders ro
        JOIN customers c ON c.id = ro.customer_id
        LEFT JOIN users rb ON rb.id = ro.received_by_id
        LEFT JOIN packing_types pt ON pt.id = ro.packing_type_id
        LEFT JOIN shipping_records sr ON sr.receiving_order_id = ro.id
        LEFT JOIN users sb ON sb.id = sr.send_by_id
        LEFT JOIN receiving_components rc ON rc.receiving_order_id = ro.id
        ${whereSql}
        GROUP BY ro.id, c.id, rb.id, pt.id, sr.id, sb.id
        ORDER BY ro.received_date DESC, ro.id DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}
      `,
      values
    );

    res.json({
      data: dataResult.rows,
      pagination: {
        page,
        limit,
        total: countResult.rows[0].total,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const data = await getDetailById(req.params.id);
    if (!data) {
      return res.status(404).json({ error: 'Receiving shipment not found' });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSowComponentOptions = async (req, res) => {
  try {
    const limit = Math.min(parsePositiveInt(req.query.limit, 30), 100);
    const page = parsePositiveInt(req.query.page, 1);
    const offset = (page - 1) * limit;
    const filterValues = [];
    let whereSql = '';

    if (req.query.q) {
      filterValues.push(`%${req.query.q}%`);
      whereSql = `
        WHERE ro.ssbr_ident ILIKE $1
           OR rc.production_order ILIKE $1
           OR rc.part_number ILIKE $1
           OR rc.part_description ILIKE $1
           OR rc.model_code ILIKE $1
           OR cust.name ILIKE $1
           OR cust.site_name ILIKE $1
      `;
    }

    const countResult = await db.query(
      `
        SELECT COUNT(*)::int AS total
        FROM receiving_components rc
        JOIN receiving_orders ro ON ro.id = rc.receiving_order_id
        JOIN customers cust ON cust.id = ro.customer_id
        ${whereSql}
      `,
      filterValues
    );

    const values = [...filterValues, limit, offset];
    const result = await db.query(
      `
        SELECT
          rc.id AS receiving_component_id,
          rc.receiving_order_id,
          rc.parent_component_id,
          rc.part_level,
          rc.part_type,
          rc.production_order,
          (NULLIF(TRIM(COALESCE(rc.production_order, '')), '') IS NOT NULL) AS has_order_no,
          NULLIF(TRIM(REPLACE(COALESCE(rc.production_order, ''), '-', '000')), '') AS sow_order_no,
          rc.actual_component,
          rc.component_id AS receiving_component_master_id,
          ro.ssbr_ident,
          ro.received_date,
          ro.reff_number,
          ro.ex_unit,
          cust.name AS customer_name,
          cust.site_name AS customer_site_name,
          cust.site_location AS customer_site_location,
          pc.part_description AS parent_part_name,
          pc.part_number AS parent_part_number,
          cm.component_id AS component_id,
          COALESCE(cm.part_name, rc.part_description) AS part_name,
          COALESCE(cm.part_number, rc.part_number) AS part_number,
          COALESCE(cm.model, rc.model_code) AS model,
          COUNT(ss.id)::int AS operation_count,
          COALESCE(sm.sow_exists, false) AS sow_exists,
          COALESCE(sm.sow_row_count, 0)::int AS sow_row_count,
          sm.latest_sow_at
        FROM receiving_components rc
        JOIN receiving_orders ro ON ro.id = rc.receiving_order_id
        JOIN customers cust ON cust.id = ro.customer_id
        LEFT JOIN receiving_components pc ON pc.id = rc.parent_component_id
        LEFT JOIN LATERAL (
          SELECT c.component_id, c.part_name, c.part_number, c.model
          FROM components c
          WHERE c.component_id = rc.component_id
             OR (
               NULLIF(TRIM(COALESCE(rc.part_number, '')), '') IS NOT NULL
               AND c.part_number = rc.part_number
               AND c.model = rc.model_code
             )
             OR (
               NULLIF(TRIM(COALESCE(rc.part_description, '')), '') IS NOT NULL
               AND c.part_name = rc.part_description
               AND c.model = rc.model_code
             )
          ORDER BY
            (c.component_id = rc.component_id) DESC,
            (c.part_number = rc.part_number AND c.model = rc.model_code) DESC,
            (c.part_name = rc.part_description AND c.model = rc.model_code) DESC,
            c.component_id ASC
          LIMIT 1
        ) cm ON true
        LEFT JOIN LATERAL (
          SELECT
            (COUNT(*) > 0) AS sow_exists,
            COUNT(*)::int AS sow_row_count,
            MAX(s.updated_at) AS latest_sow_at
          FROM public.sow s
          WHERE NULLIF(TRIM(COALESCE(rc.production_order, '')), '') IS NOT NULL
            AND LTRIM(COALESCE(s.order_no, ''), '0') =
                LTRIM(REPLACE(TRIM(COALESCE(rc.production_order, '')), '-', '000'), '0')
        ) sm ON true
        LEFT JOIN sow_standard ss ON ss.component_id = cm.component_id
        ${whereSql}
        GROUP BY
          rc.id, ro.id, cust.id, pc.id, cm.component_id, cm.part_name, cm.part_number, cm.model,
          sm.sow_exists, sm.sow_row_count, sm.latest_sow_at
        ORDER BY
          ro.received_date DESC,
          ro.id DESC,
          rc.part_level ASC,
          rc.id ASC
        LIMIT $${values.length - 1} OFFSET $${values.length}
      `,
      values
    );

    res.json({
      data: result.rows,
      pagination: {
        page,
        limit,
        total: countResult.rows[0].total,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.create = async (req, res) => {
  const client = await getClient();

  try {
    await client.query('BEGIN');

    const payload = { ...req.body };
    const customerId = payload.customer_id || (await upsertCustomer(client, payload.customer));

    if (!payload.ssbr_ident || !customerId || !payload.received_date) {
      throw new Error('ssbr_ident, customer_id/customer, and received_date are required');
    }

    const orderResult = await client.query(
      `
        INSERT INTO receiving_orders (
          ssbr_ident,
          customer_id,
          received_date,
          tagging_time,
          received_by_id,
          reff_number,
          ex_unit,
          packing_list,
          da_ckb_received,
          packing_type_id,
          raw_sow_text
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `,
      [
        payload.ssbr_ident,
        customerId,
        payload.received_date,
        normalizeEmpty(payload.tagging_time),
        normalizeEmpty(payload.received_by_id),
        normalizeEmpty(payload.reff_number),
        normalizeEmpty(payload.ex_unit),
        normalizeEmpty(payload.packing_list),
        normalizeEmpty(payload.da_ckb_received),
        normalizeEmpty(payload.packing_type_id),
        normalizeEmpty(payload.raw_sow_text),
      ]
    );

    const receivingOrder = orderResult.rows[0];
    await insertComponents(client, receivingOrder.id, payload.components || []);
    await upsertShipping(client, receivingOrder.id, payload.shipping);

    await client.query('COMMIT');

    const data = await getDetailById(receivingOrder.id);
    res.status(201).json(data);
  } catch (err) {
    await client.query('ROLLBACK');

    if (err.code === '23505') {
      return res.status(409).json({ error: 'SSBR-ID or unique record already exists' });
    }

    if (err.code === '23503') {
      return res.status(400).json({ error: 'Invalid foreign key reference', detail: err.detail });
    }

    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.update = async (req, res) => {
  const client = await getClient();

  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT id FROM receiving_orders WHERE id = $1', [
      req.params.id,
    ]);
    if (!existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Receiving shipment not found' });
    }

    const payload = { ...req.body };
    if (payload.customer) {
      payload.customer_id = await upsertCustomer(client, payload.customer);
    }

    const updateOrder = buildUpdate('receiving_orders', ORDER_FIELDS, payload, 'id = $1', [
      req.params.id,
    ]);
    if (updateOrder) {
      await client.query(updateOrder.text, updateOrder.values);
    }

    if (Array.isArray(payload.components)) {
      await client.query('DELETE FROM receiving_components WHERE receiving_order_id = $1', [
        req.params.id,
      ]);
      await insertComponents(client, req.params.id, payload.components);
    }

    if (payload.shipping === null) {
      await client.query('DELETE FROM shipping_records WHERE receiving_order_id = $1', [
        req.params.id,
      ]);
    } else if (payload.shipping) {
      await upsertShipping(client, req.params.id, payload.shipping);
    }

    await client.query('COMMIT');

    const data = await getDetailById(req.params.id);
    res.json(data);
  } catch (err) {
    await client.query('ROLLBACK');

    if (err.code === '23505') {
      return res.status(409).json({ error: 'SSBR-ID or unique record already exists' });
    }

    if (err.code === '23503') {
      return res.status(400).json({ error: 'Invalid foreign key reference', detail: err.detail });
    }

    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.remove = async (req, res) => {
  const client = await getClient();

  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM shipping_records WHERE receiving_order_id = $1', [
      req.params.id,
    ]);
    const result = await client.query('DELETE FROM receiving_orders WHERE id = $1 RETURNING id', [
      req.params.id,
    ]);

    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Receiving shipment not found' });
    }

    await client.query('COMMIT');
    res.json({ message: 'Receiving shipment deleted successfully', id: Number(req.params.id) });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.getLookups = async (req, res) => {
  try {
    const includeCustomers = req.query.includeCustomers === 'true';
    const includeComponents = req.query.includeComponents === 'true';
    const [customers, users, partCategories, packingTypes, components] = await Promise.all([
      includeCustomers
        ? db.query('SELECT * FROM customers ORDER BY name ASC, site_name ASC NULLS LAST LIMIT 50')
        : Promise.resolve({ rows: [] }),
      db.query('SELECT id, username, name, role FROM users ORDER BY name ASC'),
      db.query('SELECT * FROM part_categories ORDER BY name ASC'),
      db.query('SELECT * FROM packing_types ORDER BY name ASC'),
      includeComponents
        ? db.query(
            'SELECT component_id, part_number, part_name, model FROM components ORDER BY part_name ASC, model ASC, part_number ASC LIMIT 50'
          )
        : Promise.resolve({ rows: [] }),
    ]);

    res.json({
      customers: customers.rows,
      users: users.rows,
      part_categories: partCategories.rows,
      packing_types: packingTypes.rows,
      components: components.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.searchComponents = async (req, res) => {
  try {
    const limit = Math.min(parsePositiveInt(req.query.limit, 25), 100);
    const values = [limit];
    let whereSql = '';

    if (req.query.q) {
      values.unshift(`%${req.query.q}%`);
      whereSql = `
        WHERE part_number ILIKE $1
           OR part_name ILIKE $1
           OR model ILIKE $1
      `;
    }

    const result = await db.query(
      `
        SELECT component_id, part_number, part_name, model
        FROM components
        ${whereSql}
        ORDER BY part_name ASC, model ASC, part_number ASC
        LIMIT $${values.length}
      `,
      values
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.searchCustomers = async (req, res) => {
  try {
    const limit = Math.min(parsePositiveInt(req.query.limit, 25), 100);
    const values = [limit];
    let whereSql = '';

    if (req.query.q) {
      values.unshift(`%${req.query.q}%`);
      whereSql = `
        WHERE name ILIKE $1
           OR site_name ILIKE $1
           OR site_location ILIKE $1
           OR contact_person ILIKE $1
      `;
    }

    const result = await db.query(
      `
        SELECT id, name, site_name, site_location, contact_person, phone, email, address
        FROM customers
        ${whereSql}
        ORDER BY name ASC, site_name ASC NULLS LAST
        LIMIT $${values.length}
      `,
      values
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createCustomer = async (req, res) => {
  try {
    const payload = req.body || {};
    if (!payload.name) {
      return res.status(400).json({ error: 'Customer name is required' });
    }

    const result = await db.query(
      `
        INSERT INTO customers (
          name, site_name, site_location, contact_person, phone, email, address
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (name, site_name)
        DO UPDATE SET
          site_location = COALESCE(EXCLUDED.site_location, customers.site_location),
          contact_person = COALESCE(EXCLUDED.contact_person, customers.contact_person),
          phone = COALESCE(EXCLUDED.phone, customers.phone),
          email = COALESCE(EXCLUDED.email, customers.email),
          address = COALESCE(EXCLUDED.address, customers.address),
          updated_at = NOW()
        RETURNING id, name, site_name, site_location, contact_person, phone, email, address
      `,
      [
        payload.name,
        normalizeEmpty(payload.site_name),
        normalizeEmpty(payload.site_location),
        normalizeEmpty(payload.contact_person),
        normalizeEmpty(payload.phone),
        normalizeEmpty(payload.email),
        normalizeEmpty(payload.address),
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createPartCategory = async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const result = await db.query(
      `
        INSERT INTO part_categories (name)
        VALUES ($1)
        ON CONFLICT (name)
        DO UPDATE SET name = EXCLUDED.name
        RETURNING id, name
      `,
      [name]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.searchPartCategories = async (req, res) => {
  try {
    const limit = Math.min(parsePositiveInt(req.query.limit, 25), 100);
    const values = [limit];
    let whereSql = '';

    if (req.query.q) {
      values.unshift(`%${req.query.q}%`);
      whereSql = 'WHERE name ILIKE $1';
    }

    const result = await db.query(
      `
        SELECT id, name
        FROM part_categories
        ${whereSql}
        ORDER BY name ASC
        LIMIT $${values.length}
      `,
      values
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

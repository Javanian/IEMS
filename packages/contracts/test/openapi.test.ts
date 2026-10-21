import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parse } from 'yaml';
import { openApiDocument } from '../src/openapi/spec.js';
import { generateOpenApiFiles } from '../src/openapi/generate.js';

test('OpenAPI Specification Generation - JSON and YAML artifacts', () => {
  const { jsonPath, yamlPath } = generateOpenApiFiles();

  assert.ok(existsSync(jsonPath), `Expected ${jsonPath} to exist`);
  assert.ok(existsSync(yamlPath), `Expected ${yamlPath} to exist`);

  const jsonContent = readFileSync(jsonPath, 'utf-8');
  const yamlContent = readFileSync(yamlPath, 'utf-8');

  assert.ok(jsonContent.length > 1000);
  assert.ok(yamlContent.length > 1000);

  const parsedJson = JSON.parse(jsonContent);
  const parsedYaml = parse(yamlContent);

  assert.strictEqual(parsedJson.openapi, '3.1.0');
  assert.strictEqual(parsedYaml.openapi, '3.1.0');
  assert.strictEqual(parsedJson.info.title, 'IEMS Core API');
  assert.strictEqual(parsedYaml.info.title, 'IEMS Core API');
});

test('OpenAPI 3.1.0 structure - canonical root requirements', () => {
  assert.strictEqual(openApiDocument.openapi, '3.1.0');
  assert.ok(openApiDocument.info);
  assert.strictEqual(openApiDocument.info.version, '1.0.0');
  assert.ok(Array.isArray(openApiDocument.servers));
  assert.strictEqual(openApiDocument.servers[0]?.url, '/api/v1');
});

test('OpenAPI 3.1.0 structure - all domain path clusters present', () => {
  const paths = Object.keys(openApiDocument.paths);

  // Auth & IAM
  assert.ok(paths.includes('/auth/session'));
  assert.ok(paths.includes('/auth/me'));
  assert.ok(paths.includes('/iam/badges/verify'));

  // Commercial
  assert.ok(paths.includes('/commercial/inquiries'));
  assert.ok(paths.includes('/commercial/quotations'));
  assert.ok(paths.includes('/commercial/quotations/{id}/revisions/{revId}/approve'));
  assert.ok(paths.includes('/commercial/sales-orders'));
  assert.ok(paths.includes('/commercial/sales-orders/{id}/confirm'));

  // Engineering & Repair
  assert.ok(paths.includes('/engineering/documents'));
  assert.ok(paths.includes('/engineering/boms'));
  assert.ok(paths.includes('/engineering/routings'));
  assert.ok(paths.includes('/repair/cases'));
  assert.ok(paths.includes('/repair/cases/{id}/diagnostic-authorizations'));
  assert.ok(paths.includes('/repair/cases/{id}/dispositions'));
  assert.ok(paths.includes('/repair/warranty-claims'));

  // Planning & Execution
  assert.ok(paths.includes('/planning/work-orders'));
  assert.ok(paths.includes('/planning/work-orders/{id}/release'));
  assert.ok(paths.includes('/execution/sessions/start'));
  assert.ok(paths.includes('/execution/consumptions'));
  assert.ok(paths.includes('/execution/outputs'));
  assert.ok(paths.includes('/execution/scrap'));

  // Logistics & Billing
  assert.ok(paths.includes('/logistics/movements'));
  assert.ok(paths.includes('/logistics/reservations'));
  assert.ok(paths.includes('/logistics/shipments'));
  assert.ok(paths.includes('/logistics/shipments/{id}/dispatch'));
  assert.ok(paths.includes('/logistics/shipments/{id}/deliver'));
  assert.ok(paths.includes('/billing/invoices'));
  assert.ok(paths.includes('/billing/invoices/{id}/post'));
  assert.ok(paths.includes('/billing/payments'));
  assert.ok(paths.includes('/billing/deposits/apply'));
});

test('OpenAPI $ref integrity - all schema and parameter references resolve', () => {
  const schemas = openApiDocument.components.schemas;
  const parameters = openApiDocument.components.parameters;

  const serialized = JSON.stringify(openApiDocument);
  const refMatches = serialized.match(/"\$ref":"(#[^"]+)"/g) || [];

  for (const refStr of refMatches) {
    const ref = refStr.replace(/"\$ref":"/, '').replace(/"$/, '');
    if (ref.startsWith('#/components/schemas/')) {
      const schemaName = ref.replace('#/components/schemas/', '');
      assert.ok(
        (schemas as Record<string, unknown>)[schemaName] !== undefined,
        `Unresolved schema $ref: ${ref}`
      );
    } else if (ref.startsWith('#/components/parameters/')) {
      const paramName = ref.replace('#/components/parameters/', '');
      assert.ok(
        (parameters as Record<string, unknown>)[paramName] !== undefined,
        `Unresolved parameter $ref: ${ref}`
      );
    }
  }
});

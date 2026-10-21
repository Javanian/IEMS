/**
 * OpenAPI Generator Script
 *
 * Serializes the canonical OpenAPI 3.1.0 specification into:
 * - openapi.json
 * - openapi.yaml
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { openApiDocument } from './spec.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Target directory is packages/contracts root
const contractsRoot = resolve(__dirname, '../../..');
const jsonPath = resolve(contractsRoot, 'openapi.json');
const yamlPath = resolve(contractsRoot, 'openapi.yaml');

export function generateOpenApiFiles(): { jsonPath: string; yamlPath: string } {
  const jsonContent = JSON.stringify(openApiDocument, null, 2);
  const yamlContent = stringify(openApiDocument, { indent: 2 });

  writeFileSync(jsonPath, jsonContent, 'utf-8');
  writeFileSync(yamlPath, yamlContent, 'utf-8');

  return { jsonPath, yamlPath };
}

// Execute when run directly as CLI
const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectExecution) {
  const { jsonPath: outJson, yamlPath: outYaml } = generateOpenApiFiles();
  console.log(`Generated OpenAPI 3.1 specifications:`);
  console.log(`- JSON: ${outJson}`);
  console.log(`- YAML: ${outYaml}`);
}

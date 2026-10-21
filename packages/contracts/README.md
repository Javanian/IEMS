# IEMS domain contracts

TypeScript types, JSON schemas and an OpenAPI draft for the manufacturing and repair domains. The package also defines decimal-string values, error responses, pagination, permissions and idempotency records.

These definitions describe the target API. The generated OpenAPI files are not a record of deployed endpoints; route compatibility must be checked against the API implementation before generating a client.

From the repository root:

```sh
npm ci --prefix packages/contracts
npm test --prefix packages/contracts
npm run build --prefix packages/contracts
```

Tests compile the TypeScript sources, validate schemas with Ajv, check decimal helpers and permissions, and resolve references in the OpenAPI document. They do not start the API or verify database authorization and transaction behavior.

`npm run build` writes compiled files to `dist/` and regenerates `openapi.json` and `openapi.yaml`. Compiled files and dependencies are local build outputs.

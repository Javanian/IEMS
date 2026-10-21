/**
 * Complete OpenAPI 3.1.0 Specification Definition for IEMS Core API
 */

import {
  DecimalSchema,
  SignedDecimalSchema,
  CurrencySchema,
  UomSchema
} from '../common/decimal.js';
import { ErrorEnvelopeSchema, FieldErrorSchema } from '../common/error.js';
import { IdempotencyRecordSchema } from '../common/idempotency.js';
import { PaginationQuerySchema } from '../common/pagination.js';
import { AuditMetadataSchema, TransitionRecordSchema } from '../common/audit.js';

import {
  OrganizationSchema,
  LegalEntitySchema,
  PlantSchema,
  UserSchema,
  RoleSchema,
  PermissionSchema,
  UserScopeSchema,
  SessionSchema,
  BadgeSchema,
  EmployeeQualificationSchema
} from '../domains/core-iam/schemas.js';

import {
  CustomerSchema,
  InquirySchema,
  InquiryLineSchema,
  QuotationSchema,
  QuoteRevisionSchema,
  QuoteLineSchema,
  EstimateComponentSchema,
  QuoteAcceptanceSchema,
  SalesOrderSchema,
  SalesOrderLineSchema,
  OrderAmendmentSchema,
  BillingEntitlementSchema
} from '../domains/commercial/schemas.js';

import {
  DocumentSchema,
  DocumentRevisionSchema,
  BOMRevisionSchema,
  BOMLineSchema,
  RoutingRevisionSchema,
  RoutingOperationSchema,
  CustomerAssetSchema,
  RepairCaseSchema,
  DiagnosticAuthorizationSchema,
  TeardownFindingSchema,
  DispositionSchema,
  ComponentInstallationSchema,
  WarrantyClaimSchema
} from '../domains/engineering-repair/schemas.js';

import {
  WorkOrderSchema,
  WorkOperationSchema,
  ExecutionSessionSchema,
  MaterialConsumptionSchema,
  OutputUnitSchema,
  ScrapRecordSchema,
  ReworkOrderSchema
} from '../domains/planning-execution/schemas.js';

import {
  StockMovementSchema,
  ReservationSchema,
  ShipmentSchema,
  ShipmentLineSchema,
  FulfillmentAllocationSchema,
  InvoiceSchema,
  InvoiceLineSchema,
  DeliveryBillingAllocationSchema,
  MilestoneBillingAllocationSchema,
  PaymentAllocationSchema,
  DepositApplicationSchema
} from '../domains/logistics-billing/schemas.js';

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'IEMS Core API',
    version: '1.0.0',
    description:
      'Canonical OpenAPI 3.1.0 specification for IEMS (Integrated Enterprise Manufacturing & Repair System). Enforces exact decimal strings for currency and quantities, server-side session RBAC per plant, and idempotency guarantees on state mutations.'
  },
  servers: [
    {
      url: '/api/v1',
      description: 'Default API v1 Gateway'
    }
  ],
  tags: [
    { name: 'Auth', description: 'Session management and credential verification' },
    { name: 'IAM', description: 'Identity, roles, and badge qualifications' },
    { name: 'Commercial: Inquiries & Quotes', description: 'Customer RFQs, cost estimation, and quote revisions' },
    { name: 'Commercial: Sales Orders', description: 'Confirmed sales orders, amendments, and billing entitlements' },
    { name: 'Engineering', description: 'CAD/drawing control, BOMs, and routing operations' },
    { name: 'Repair', description: 'Customer unit intake, diagnostic authorization, and teardown findings' },
    { name: 'Planning', description: 'Work orders, finite scheduling, and operations dispatch' },
    { name: 'Execution', description: 'Shop floor traveler, machine/labor sessions, consumption, and scrap' },
    { name: 'Logistics', description: 'Inventory ledger, lot reservations, and shipments' },
    { name: 'Billing', description: 'Invoices, milestone allocations, and payment settlements' }
  ],
  paths: {
    '/auth/session': {
      post: {
        tags: ['Auth'],
        summary: 'Establish an authenticated session',
        operationId: 'createSession',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'password', 'plantId'],
                properties: {
                  username: { type: 'string' },
                  password: { type: 'string' },
                  plantId: { type: 'string', format: 'uuid' }
                }
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'Session created successfully',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Session' } } }
          },
          '401': {
            description: 'Authentication failed',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
          }
        }
      },
      delete: {
        tags: ['Auth'],
        summary: 'Revoke active session (Logout)',
        operationId: 'revokeSession',
        security: [{ SessionCookie: [] }],
        responses: {
          '204': { description: 'Session successfully revoked' },
          '401': {
            description: 'Unauthorized',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
          }
        }
      }
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Get active session profile and granted scopes',
        operationId: 'getCurrentSession',
        security: [{ SessionCookie: [] }],
        responses: {
          '200': {
            description: 'Current user profile with active plant and granted roles',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['user', 'activePlantId', 'roles', 'permissions'],
                  properties: {
                    user: { $ref: '#/components/schemas/User' },
                    activePlantId: { type: 'string', format: 'uuid' },
                    roles: { type: 'array', items: { type: 'string' } },
                    permissions: { type: 'array', items: { type: 'string' } }
                  }
                }
              }
            }
          },
          '401': {
            description: 'Unauthorized',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
          }
        }
      }
    },
    '/iam/badges/verify': {
      post: {
        tags: ['IAM'],
        summary: 'Verify operator NFC badge and qualifications for plant operation',
        operationId: 'verifyBadge',
        parameters: [{ $ref: '#/components/parameters/PlantId' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['nfcTagId', 'requiredSkillCode'],
                properties: {
                  nfcTagId: { type: 'string' },
                  requiredSkillCode: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Badge verified and qualification valid',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['badge', 'qualificationValid', 'operatorName'],
                  properties: {
                    badge: { $ref: '#/components/schemas/Badge' },
                    qualificationValid: { type: 'boolean' },
                    operatorName: { type: 'string' }
                  }
                }
              }
            }
          },
          '403': {
            description: 'Badge invalid or operator lacks qualification',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
          }
        }
      }
    },
    '/commercial/inquiries': {
      get: {
        tags: ['Commercial: Inquiries & Quotes'],
        summary: 'List customer inquiries with plant scoping',
        operationId: 'listInquiries',
        parameters: [{ $ref: '#/components/parameters/PlantId' }],
        responses: {
          '200': {
            description: 'Inquiries list',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Inquiry' }
                }
              }
            }
          }
        }
      },
      post: {
        tags: ['Commercial: Inquiries & Quotes'],
        summary: 'Create a new customer inquiry',
        operationId: 'createInquiry',
        parameters: [
          { $ref: '#/components/parameters/IdempotencyKey' },
          { $ref: '#/components/parameters/PlantId' }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Inquiry' } } }
        },
        responses: {
          '201': {
            description: 'Inquiry created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Inquiry' } } }
          },
          '400': {
            description: 'Validation failed',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
          }
        }
      }
    },
    '/commercial/inquiries/{id}': {
      get: {
        tags: ['Commercial: Inquiries & Quotes'],
        summary: 'Get inquiry details by ID',
        operationId: 'getInquiryById',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          '200': {
            description: 'Inquiry details',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Inquiry' } } }
          },
          '404': {
            description: 'Inquiry not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
          }
        }
      }
    },
    '/commercial/inquiries/{id}/lines': {
      post: {
        tags: ['Commercial: Inquiries & Quotes'],
        summary: 'Add line item to customer inquiry',
        operationId: 'addInquiryLine',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { $ref: '#/components/parameters/IdempotencyKey' }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/InquiryLine' } } }
        },
        responses: {
          '201': {
            description: 'Line added',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/InquiryLine' } } }
          }
        }
      }
    },
    '/commercial/quotations': {
      get: {
        tags: ['Commercial: Inquiries & Quotes'],
        summary: 'List quotations',
        operationId: 'listQuotations',
        parameters: [{ $ref: '#/components/parameters/PlantId' }],
        responses: {
          '200': {
            description: 'Quotations list',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Quotation' } }
              }
            }
          }
        }
      },
      post: {
        tags: ['Commercial: Inquiries & Quotes'],
        summary: 'Create initial quotation container',
        operationId: 'createQuotation',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Quotation' } } }
        },
        responses: {
          '201': {
            description: 'Quotation created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Quotation' } } }
          }
        }
      }
    },
    '/commercial/quotations/{id}': {
      get: {
        tags: ['Commercial: Inquiries & Quotes'],
        summary: 'Get quotation with active revisions and cost breakdown',
        operationId: 'getQuotationById',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': {
            description: 'Quotation record',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Quotation' } } }
          }
        }
      }
    },
    '/commercial/quotations/{id}/revisions': {
      post: {
        tags: ['Commercial: Inquiries & Quotes'],
        summary: 'Create and calculate a new quote revision',
        operationId: 'createQuoteRevision',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { $ref: '#/components/parameters/IdempotencyKey' }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/QuoteRevision' } } }
        },
        responses: {
          '201': {
            description: 'Revision created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/QuoteRevision' } } }
          }
        }
      }
    },
    '/commercial/quotations/{id}/revisions/{revId}/approve': {
      post: {
        tags: ['Commercial: Inquiries & Quotes'],
        summary: 'Internal commercial approval of quotation revision (Sales/Supervisor role)',
        operationId: 'approveQuoteRevision',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'revId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          '200': {
            description: 'Revision approved and locked for sending',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/QuoteRevision' } } }
          },
          '403': {
            description: 'User lacks commercial approval role (admin is prohibited)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
          }
        }
      }
    },
    '/commercial/quotations/{id}/revisions/{revId}/accept': {
      post: {
        tags: ['Commercial: Inquiries & Quotes'],
        summary: 'Record formal customer acceptance of quotation revision',
        operationId: 'acceptQuotationRevision',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'revId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { $ref: '#/components/parameters/IdempotencyKey' }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/QuoteAcceptance' } } }
        },
        responses: {
          '201': {
            description: 'Acceptance recorded and revision marked ACCEPTED',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/QuoteAcceptance' } } }
          }
        }
      }
    },
    '/commercial/sales-orders': {
      get: {
        tags: ['Commercial: Sales Orders'],
        summary: 'List sales orders',
        operationId: 'listSalesOrders',
        parameters: [{ $ref: '#/components/parameters/PlantId' }],
        responses: {
          '200': {
            description: 'Sales orders list',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/SalesOrder' } }
              }
            }
          }
        }
      },
      post: {
        tags: ['Commercial: Sales Orders'],
        summary: 'Create native commercial sales order from accepted quote or customer PO',
        operationId: 'createSalesOrder',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/SalesOrder' } } }
        },
        responses: {
          '201': {
            description: 'Sales order created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SalesOrder' } } }
          }
        }
      }
    },
    '/commercial/sales-orders/{id}': {
      get: {
        tags: ['Commercial: Sales Orders'],
        summary: 'Get sales order details with lines and billing entitlements',
        operationId: 'getSalesOrderById',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': {
            description: 'Sales order details',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SalesOrder' } } }
          }
        }
      }
    },
    '/commercial/sales-orders/{id}/confirm': {
      post: {
        tags: ['Commercial: Sales Orders'],
        summary: 'Confirm sales order and activate demand planning allocations',
        operationId: 'confirmSalesOrder',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { $ref: '#/components/parameters/IdempotencyKey' }
        ],
        responses: {
          '200': {
            description: 'Order confirmed',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SalesOrder' } } }
          }
        }
      }
    },
    '/commercial/sales-orders/{id}/amendments': {
      post: {
        tags: ['Commercial: Sales Orders'],
        summary: 'Propose order amendment (scope/price/delivery change)',
        operationId: 'createOrderAmendment',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { $ref: '#/components/parameters/IdempotencyKey' }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/OrderAmendment' } } }
        },
        responses: {
          '201': {
            description: 'Amendment recorded',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/OrderAmendment' } } }
          }
        }
      }
    },
    '/engineering/documents': {
      get: {
        tags: ['Engineering'],
        summary: 'List engineering documents and approved revisions',
        operationId: 'listDocuments',
        responses: {
          '200': {
            description: 'Documents list',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Document' } }
              }
            }
          }
        }
      },
      post: {
        tags: ['Engineering'],
        summary: 'Register engineering document metadata',
        operationId: 'createDocument',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Document' } } }
        },
        responses: {
          '201': {
            description: 'Document created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Document' } } }
          }
        }
      }
    },
    '/engineering/boms': {
      get: {
        tags: ['Engineering'],
        summary: 'List released BOM revisions',
        operationId: 'listBOMs',
        responses: {
          '200': {
            description: 'BOM revisions list',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/BOMRevision' } }
              }
            }
          }
        }
      },
      post: {
        tags: ['Engineering'],
        summary: 'Release a new BOM revision',
        operationId: 'createBOMRevision',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/BOMRevision' } } }
        },
        responses: {
          '201': {
            description: 'BOM revision released',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/BOMRevision' } } }
          }
        }
      }
    },
    '/engineering/routings': {
      get: {
        tags: ['Engineering'],
        summary: 'List released Routing revisions',
        operationId: 'listRoutings',
        responses: {
          '200': {
            description: 'Routings list',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/RoutingRevision' } }
              }
            }
          }
        }
      },
      post: {
        tags: ['Engineering'],
        summary: 'Release a new Routing revision with operations',
        operationId: 'createRoutingRevision',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RoutingRevision' } } }
        },
        responses: {
          '201': {
            description: 'Routing revision released',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RoutingRevision' } } }
          }
        }
      }
    },
    '/repair/cases': {
      get: {
        tags: ['Repair'],
        summary: 'List active repair intake cases',
        operationId: 'listRepairCases',
        parameters: [{ $ref: '#/components/parameters/PlantId' }],
        responses: {
          '200': {
            description: 'Repair cases list',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/RepairCase' } }
              }
            }
          }
        }
      },
      post: {
        tags: ['Repair'],
        summary: 'Intake customer asset and create repair case',
        operationId: 'intakeRepairCase',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RepairCase' } } }
        },
        responses: {
          '201': {
            description: 'Repair case intake recorded',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RepairCase' } } }
          }
        }
      }
    },
    '/repair/cases/{id}': {
      get: {
        tags: ['Repair'],
        summary: 'Get repair case with diagnostic scope, teardown findings, and dispositions',
        operationId: 'getRepairCaseById',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': {
            description: 'Repair case details',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RepairCase' } } }
          }
        }
      }
    },
    '/repair/cases/{id}/diagnostic-authorizations': {
      post: {
        tags: ['Repair'],
        summary: 'Record customer authorization for teardown and diagnostic inspection cap',
        operationId: 'authorizeDiagnosticScope',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { $ref: '#/components/parameters/IdempotencyKey' }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/DiagnosticAuthorization' } } }
        },
        responses: {
          '201': {
            description: 'Diagnostic authorization locked',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/DiagnosticAuthorization' } } }
          }
        }
      }
    },
    '/repair/cases/{id}/findings': {
      post: {
        tags: ['Repair'],
        summary: 'Record component defect during authorized teardown',
        operationId: 'recordTeardownFinding',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/TeardownFinding' } } }
        },
        responses: {
          '201': {
            description: 'Finding recorded',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/TeardownFinding' } } }
          }
        }
      }
    },
    '/repair/cases/{id}/dispositions': {
      post: {
        tags: ['Repair'],
        summary: 'Formally record engineering disposition (REUSE, REPAIR, REPLACE, SCRAP)',
        operationId: 'recordDisposition',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { $ref: '#/components/parameters/IdempotencyKey' }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Disposition' } } }
        },
        responses: {
          '201': {
            description: 'Disposition approved',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Disposition' } } }
          }
        }
      }
    },
    '/repair/warranty-claims': {
      get: {
        tags: ['Repair'],
        summary: 'List warranty claims',
        operationId: 'listWarrantyClaims',
        responses: {
          '200': {
            description: 'Warranty claims list',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/WarrantyClaim' } }
              }
            }
          }
        }
      },
      post: {
        tags: ['Repair'],
        summary: 'File customer warranty claim linking prior delivery and serial identity',
        operationId: 'createWarrantyClaim',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/WarrantyClaim' } } }
        },
        responses: {
          '201': {
            description: 'Warranty claim filed',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/WarrantyClaim' } } }
          }
        }
      }
    },
    '/planning/work-orders': {
      get: {
        tags: ['Planning'],
        summary: 'List manufacturing and repair work orders',
        operationId: 'listWorkOrders',
        parameters: [{ $ref: '#/components/parameters/PlantId' }],
        responses: {
          '200': {
            description: 'Work orders list',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/WorkOrder' } }
              }
            }
          }
        }
      },
      post: {
        tags: ['Planning'],
        summary: 'Create new work order linked to demand',
        operationId: 'createWorkOrder',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkOrder' } } }
        },
        responses: {
          '201': {
            description: 'Work order created in DRAFT state',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkOrder' } } }
          }
        }
      }
    },
    '/planning/work-orders/{id}': {
      get: {
        tags: ['Planning'],
        summary: 'Get work order traveler, material allocations, and operation progress',
        operationId: 'getWorkOrderById',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': {
            description: 'Work order details',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkOrder' } } }
          }
        }
      }
    },
    '/planning/work-orders/{id}/release': {
      post: {
        tags: ['Planning'],
        summary: 'Release work order for shop floor traveler execution',
        operationId: 'releaseWorkOrder',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { $ref: '#/components/parameters/IdempotencyKey' }
        ],
        responses: {
          '200': {
            description: 'Work order released',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkOrder' } } }
          },
          '409': {
            description: 'Missing approved BOM/Routing revision or material shortage',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
          }
        }
      }
    },
    '/execution/sessions/start': {
      post: {
        tags: ['Execution'],
        summary: 'Operator starts an execution session (Setup, Run, or Downtime)',
        operationId: 'startExecutionSession',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ExecutionSession' } } }
        },
        responses: {
          '201': {
            description: 'Execution session started',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ExecutionSession' } } }
          },
          '403': {
            description: 'Operator badge not qualified for operation workcenter',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
          }
        }
      }
    },
    '/execution/sessions/{id}/stop': {
      post: {
        tags: ['Execution'],
        summary: 'Operator ends active execution session with calculated duration',
        operationId: 'stopExecutionSession',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { $ref: '#/components/parameters/IdempotencyKey' }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['endTime', 'durationMinutes'],
                properties: {
                  endTime: { type: 'string', format: 'date-time' },
                  durationMinutes: { type: 'string', pattern: '^[0-9]+(\\.[0-9]+)?$' },
                  pauseReason: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Execution session closed',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ExecutionSession' } } }
          }
        }
      }
    },
    '/execution/consumptions': {
      post: {
        tags: ['Execution'],
        summary: 'Record material consumption against work order operation',
        operationId: 'consumeMaterial',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/MaterialConsumption' } } }
        },
        responses: {
          '201': {
            description: 'Consumption logged and inventory depleted',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/MaterialConsumption' } } }
          }
        }
      }
    },
    '/execution/outputs': {
      post: {
        tags: ['Execution'],
        summary: 'Log completed unit output and register serial / lot identity',
        operationId: 'recordOutput',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/OutputUnit' } } }
        },
        responses: {
          '201': {
            description: 'Output recorded and pending QC inspection',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/OutputUnit' } } }
          }
        }
      }
    },
    '/execution/scrap': {
      post: {
        tags: ['Execution'],
        summary: 'Log scrap record with root cause defect code and disposition supervisor',
        operationId: 'recordScrap',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ScrapRecord' } } }
        },
        responses: {
          '201': {
            description: 'Scrap recorded and work order updated',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ScrapRecord' } } }
          }
        }
      }
    },
    '/logistics/movements': {
      get: {
        tags: ['Logistics'],
        summary: 'Query immutable stock ledger movements',
        operationId: 'listStockMovements',
        parameters: [{ $ref: '#/components/parameters/PlantId' }],
        responses: {
          '200': {
            description: 'Stock movements ledger',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/StockMovement' } }
              }
            }
          }
        }
      },
      post: {
        tags: ['Logistics'],
        summary: 'Post atomic inventory movement (Issue, Receipt, Transfer)',
        operationId: 'postStockMovement',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/StockMovement' } } }
        },
        responses: {
          '201': {
            description: 'Movement posted',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/StockMovement' } } }
          },
          '409': {
            description: 'Insufficient stock or position locked',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
          }
        }
      }
    },
    '/logistics/reservations': {
      get: {
        tags: ['Logistics'],
        summary: 'List active stock reservations',
        operationId: 'listReservations',
        parameters: [{ $ref: '#/components/parameters/PlantId' }],
        responses: {
          '200': {
            description: 'Reservations list',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Reservation' } }
              }
            }
          }
        }
      },
      post: {
        tags: ['Logistics'],
        summary: 'Reserve inventory lot/serial for work order or customer sales order',
        operationId: 'createReservation',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Reservation' } } }
        },
        responses: {
          '201': {
            description: 'Reservation created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Reservation' } } }
          }
        }
      }
    },
    '/logistics/shipments': {
      get: {
        tags: ['Logistics'],
        summary: 'List shipments',
        operationId: 'listShipments',
        parameters: [{ $ref: '#/components/parameters/PlantId' }],
        responses: {
          '200': {
            description: 'Shipments list',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Shipment' } }
              }
            }
          }
        }
      },
      post: {
        tags: ['Logistics'],
        summary: 'Create draft shipment and allocate fulfilled sales order lines',
        operationId: 'createShipment',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Shipment' } } }
        },
        responses: {
          '201': {
            description: 'Shipment created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Shipment' } } }
          }
        }
      }
    },
    '/logistics/shipments/{id}/dispatch': {
      post: {
        tags: ['Logistics'],
        summary: 'Dispatch shipment to freight carrier',
        operationId: 'dispatchShipment',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { $ref: '#/components/parameters/IdempotencyKey' }
        ],
        responses: {
          '200': {
            description: 'Shipment dispatched',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Shipment' } } }
          }
        }
      }
    },
    '/logistics/shipments/{id}/deliver': {
      post: {
        tags: ['Logistics'],
        summary: 'Record proof of delivery (POD) completion',
        operationId: 'deliverShipment',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { $ref: '#/components/parameters/IdempotencyKey' }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['proofOfDeliveryReference', 'deliveredAt'],
                properties: {
                  proofOfDeliveryReference: { type: 'string' },
                  deliveredAt: { type: 'string', format: 'date-time' }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Delivery confirmed and ready for billing',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Shipment' } } }
          }
        }
      }
    },
    '/billing/invoices': {
      get: {
        tags: ['Billing'],
        summary: 'List customer invoices with outstanding balance tracking',
        operationId: 'listInvoices',
        responses: {
          '200': {
            description: 'Invoices list',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Invoice' } }
              }
            }
          }
        }
      },
      post: {
        tags: ['Billing'],
        summary: 'Generate invoice from delivery allocations or billing milestones',
        operationId: 'createInvoice',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Invoice' } } }
        },
        responses: {
          '201': {
            description: 'Invoice created in DRAFT state',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Invoice' } } }
          },
          '422': {
            description: 'Exceeded billing entitlement cap',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
          }
        }
      }
    },
    '/billing/invoices/{id}': {
      get: {
        tags: ['Billing'],
        summary: 'Get invoice details with lines and applied deposit allocations',
        operationId: 'getInvoiceById',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': {
            description: 'Invoice details',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Invoice' } } }
          }
        }
      }
    },
    '/billing/invoices/{id}/post': {
      post: {
        tags: ['Billing'],
        summary: 'Formally post invoice (Locks document as immutable AR debit)',
        operationId: 'postInvoice',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { $ref: '#/components/parameters/IdempotencyKey' }
        ],
        responses: {
          '200': {
            description: 'Invoice posted',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Invoice' } } }
          },
          '403': {
            description: 'Forbidden: Requires Finance role (admin cannot post business invoice)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
          }
        }
      }
    },
    '/billing/payments': {
      post: {
        tags: ['Billing'],
        summary: 'Allocate payment receipt against outstanding invoice balance',
        operationId: 'allocatePayment',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/PaymentAllocation' } } }
        },
        responses: {
          '201': {
            description: 'Payment allocated and invoice balance updated',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PaymentAllocation' } } }
          }
        }
      }
    },
    '/billing/deposits/apply': {
      post: {
        tags: ['Billing'],
        summary: 'Apply advance deposit to final commercial invoice',
        operationId: 'applyDeposit',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/DepositApplication' } } }
        },
        responses: {
          '201': {
            description: 'Deposit applied and final invoice balance offset',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/DepositApplication' } } }
          }
        }
      }
    }
  },
  components: {
    securitySchemes: {
      SessionCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'iems_session_id',
        description: 'Server-managed HttpOnly opaque session cookie'
      },
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Bearer token for automation or integration workers'
      },
      BadgeToken: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Badge-Token',
        description: 'Kiosk operator NFC badge assertion token'
      }
    },
    parameters: {
      IdempotencyKey: {
        name: 'Idempotency-Key',
        in: 'header',
        required: false,
        schema: {
          type: 'string',
          pattern: '^[A-Za-z0-9_-]{8,128}$'
        },
        description: 'Client-supplied unique key for guaranteed at-most-once execution.'
      },
      PlantId: {
        name: 'X-Plant-Id',
        in: 'header',
        required: false,
        schema: {
          type: 'string',
          format: 'uuid'
        },
        description: 'Active plant operational context for plant-scoped commands.'
      },
      CorrelationId: {
        name: 'X-Correlation-Id',
        in: 'header',
        required: false,
        schema: {
          type: 'string'
        },
        description: 'Distributed tracing identifier.'
      }
    },
    schemas: {
      // Common
      Decimal: DecimalSchema,
      SignedDecimal: SignedDecimalSchema,
      Currency: CurrencySchema,
      Uom: UomSchema,
      FieldError: FieldErrorSchema,
      ErrorEnvelope: ErrorEnvelopeSchema,
      IdempotencyRecord: IdempotencyRecordSchema,
      PaginationQuery: PaginationQuerySchema,
      AuditMetadata: AuditMetadataSchema,
      TransitionRecord: TransitionRecordSchema,

      // Core & IAM
      Organization: OrganizationSchema,
      LegalEntity: LegalEntitySchema,
      Plant: PlantSchema,
      User: UserSchema,
      Role: RoleSchema,
      Permission: PermissionSchema,
      UserScope: UserScopeSchema,
      Session: SessionSchema,
      Badge: BadgeSchema,
      EmployeeQualification: EmployeeQualificationSchema,

      // Commercial
      Customer: CustomerSchema,
      Inquiry: InquirySchema,
      InquiryLine: InquiryLineSchema,
      Quotation: QuotationSchema,
      QuoteRevision: QuoteRevisionSchema,
      QuoteLine: QuoteLineSchema,
      EstimateComponent: EstimateComponentSchema,
      QuoteAcceptance: QuoteAcceptanceSchema,
      SalesOrder: SalesOrderSchema,
      SalesOrderLine: SalesOrderLineSchema,
      OrderAmendment: OrderAmendmentSchema,
      BillingEntitlement: BillingEntitlementSchema,

      // Engineering & Repair
      Document: DocumentSchema,
      DocumentRevision: DocumentRevisionSchema,
      BOMRevision: BOMRevisionSchema,
      BOMLine: BOMLineSchema,
      RoutingRevision: RoutingRevisionSchema,
      RoutingOperation: RoutingOperationSchema,
      CustomerAsset: CustomerAssetSchema,
      RepairCase: RepairCaseSchema,
      DiagnosticAuthorization: DiagnosticAuthorizationSchema,
      TeardownFinding: TeardownFindingSchema,
      Disposition: DispositionSchema,
      ComponentInstallation: ComponentInstallationSchema,
      WarrantyClaim: WarrantyClaimSchema,

      // Planning & Execution
      WorkOrder: WorkOrderSchema,
      WorkOperation: WorkOperationSchema,
      ExecutionSession: ExecutionSessionSchema,
      MaterialConsumption: MaterialConsumptionSchema,
      OutputUnit: OutputUnitSchema,
      ScrapRecord: ScrapRecordSchema,
      ReworkOrder: ReworkOrderSchema,

      // Logistics & Billing
      StockMovement: StockMovementSchema,
      Reservation: ReservationSchema,
      Shipment: ShipmentSchema,
      ShipmentLine: ShipmentLineSchema,
      FulfillmentAllocation: FulfillmentAllocationSchema,
      Invoice: InvoiceSchema,
      InvoiceLine: InvoiceLineSchema,
      DeliveryBillingAllocation: DeliveryBillingAllocationSchema,
      MilestoneBillingAllocation: MilestoneBillingAllocationSchema,
      PaymentAllocation: PaymentAllocationSchema,
      DepositApplication: DepositApplicationSchema
    }
  }
} as const;

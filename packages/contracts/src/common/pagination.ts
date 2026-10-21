/**
 * Canonical Pagination Contracts
 */

export interface PaginationQuery {
  page?: number;
  limit?: number;
  cursor?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export const PaginationQuerySchema = {
  $id: 'https://iems.org/schemas/common/pagination-query.json',
  type: 'object',
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
    cursor: { type: 'string' },
    sortBy: { type: 'string' },
    sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'asc' }
  },
  additionalProperties: false
} as const;

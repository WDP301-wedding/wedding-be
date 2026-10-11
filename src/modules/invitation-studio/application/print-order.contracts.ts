import type { PrintOrderStatus } from '../domain/print-policy.js';
import type { z } from 'zod';
import type { commercialPrintSnapshotSchema } from '../domain/contracted-print.js';

export interface PrintLineView {
  lineId: string;
  designId: string;
  quantity: number;
  printableRevisionId: string | null;
  commercialSource?: z.infer<typeof commercialPrintSnapshotSchema>;
}

export interface QuotedLineView {
  lineId: string;
  designId: string;
  quantity: number;
  unitPriceVnd: number;
  lineTotalVnd: number;
  designRevisionId?: string;
}

export interface CommercialRevisionView {
  commercialRevisionId: string;
  revisionNumber: number;
  lines: QuotedLineView[];
  orderTotalVnd: number;
  estimatedHandoverAt: string;
  expiresAt: string;
  createdAt: string;
}

export interface PrintOrderView {
  orderId: string;
  bookingId: string;
  status: PrintOrderStatus;
  revision: number;
  lines: PrintLineView[];
  currentCommercialRevisionId: string | null;
  currentCommercialRevision: CommercialRevisionView | null;
  pendingReplacementProposal: CommercialRevisionView | null;
  receivableChargeId: string | null;
  readyAt: string | null;
  handedOverAt: string | null;
  evidenceReference: string | null;
  createdAt: string;
  updatedAt: string;
}

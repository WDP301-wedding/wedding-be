import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type { EffectiveCommercialReader } from '../../booking-lifecycle/infrastructure/effective-commercial.reader.js';
import type { PrintOfferingReader } from '../../venue-catalog/application/print-offering.service.js';
import {
  commercialPrintSnapshotSchema,
  requireContractedPrint,
  type CommercialPrintSource,
} from '../domain/contracted-print.js';
import { printOrderConflict } from '../domain/print-policy.js';

type Client = Prisma.TransactionClient | PrismaClient;
export type ContractedPrintOwners = {
  commercial(client: Client): EffectiveCommercialReader;
  model(client: Client, bookingId: string): Promise<'FULL_CONTRACT_V1' | 'LEGACY_PROPOSAL_V1'>;
  offerings(client: Client): Pick<PrintOfferingReader, 'resolveRevision'>;
  contractObligation(client: Client, bookingId: string): Promise<string>;
};
export class ContractedPrintFulfillment {
  constructor(readonly owners: ContractedPrintOwners) {}
  async requireTemplate(client: Client, bookingId: string, templateVersionId: string) {
    const effective = await this.owners.commercial(client).getEffective(bookingId);
    for (const line of effective.lines.filter((l) => l.category === 'PRINT')) {
      const offering = await this.owners.offerings(client).resolveRevision(line.sourceRevisionId);
      if (offering.templateVersionId === templateVersionId) return;
    }
    throw printOrderConflict('CONTRACT_PRINT_TEMPLATE_CONFLICT');
  }
  async snapshot(
    client: Client,
    bookingId: string,
    designId: string,
    quantity: number,
    binding?: CommercialPrintSource,
  ) {
    const model = await this.owners.model(client, bookingId);
    if (model === 'LEGACY_PROPOSAL_V1') {
      if (binding) throw printOrderConflict('CONTRACT_PRINT_SOURCE_CONFLICT');
      return null;
    }
    if (!binding) throw printOrderConflict('CONTRACT_FULFILLMENT_REQUIRED');
    const effective = await this.owners.commercial(client).getEffective(bookingId);
    const line = effective.lines.find(
      (l) => l.category === 'PRINT' && l.sourceId === binding.offeringId,
    );
    if (!line) throw printOrderConflict('CONTRACT_PRINT_SOURCE_CONFLICT');
    requireContractedPrint(binding, effective.revisionId, line, quantity, 0, line.unitPriceVnd);
    const facts = await this.owners.offerings(client).resolveRevision(binding.sourceRevisionId);
    const design = await client.invitationDesign.findFirst({ where: { id: designId, bookingId } });
    if (!design) throw printOrderConflict('CONTRACT_PRINT_SOURCE_CONFLICT');
    const content = await client.invitationDesignRevision.findUniqueOrThrow({
      where: { id: design.currentRevisionId },
    });
    if (
      content.sourceTemplateVersionId !== facts.templateVersionId ||
      facts.offeringId !== binding.offeringId ||
      facts.unitPriceVnd !== line.unitPriceVnd
    )
      throw printOrderConflict('CONTRACT_PRINT_TEMPLATE_CONFLICT');
    return commercialPrintSnapshotSchema.parse({
      ...binding,
      templateVersionId: facts.templateVersionId,
      material: facts.material,
      printType: facts.printType,
      unitPriceVnd: facts.unitPriceVnd,
    });
  }
  async validateOrder(
    client: Client,
    bookingId: string,
    orderId: string,
    prices?: ReadonlyMap<string, number>,
    exactRevision = true,
  ) {
    if ((await this.owners.model(client, bookingId)) === 'LEGACY_PROPOSAL_V1') return null;
    const effective = await this.owners.commercial(client).getEffective(bookingId);
    const lines = await client.invitationPrintLine.findMany({ where: { orderId, bookingId } });
    const allocated = await client.invitationPrintLine.findMany({
      where: { bookingId, commercialSource: { not: Prisma.JsonNull } },
    });
    const activeOrders = await client.invitationPrintOrder.findMany({
      where: {
        bookingId,
        status: { in: ['APPROVED', 'IN_PRODUCTION', 'READY_FOR_HANDOVER', 'HANDED_OVER'] },
      },
    });
    const active = new Set(activeOrders.map((o) => o.id));
    const sums = new Map<string, number>();
    for (const l of allocated.filter((l) => l.orderId === orderId || active.has(l.orderId))) {
      if (l.commercialSource === null) continue;
      const source = commercialPrintSnapshotSchema.parse(l.commercialSource);
      sums.set(source.offeringId, (sums.get(source.offeringId) ?? 0) + l.quantity);
    }
    for (const l of lines) {
      if (!l.commercialSource) throw printOrderConflict('CONTRACT_FULFILLMENT_REQUIRED');
      const binding = commercialPrintSnapshotSchema.parse(l.commercialSource);
      const line = effective.lines.find(
        (v) => v.category === 'PRINT' && v.sourceId === binding.offeringId,
      );
      if (!line) throw printOrderConflict('CONTRACT_PRINT_SOURCE_CONFLICT');
      requireContractedPrint(
        exactRevision ? binding : { ...binding, agreementRevisionId: effective.revisionId },
        effective.revisionId,
        line,
        l.quantity,
        (sums.get(binding.offeringId) ?? 0) - l.quantity,
        prices?.get(l.id) ?? binding.unitPriceVnd,
      );
      await this.snapshot(
        client,
        bookingId,
        l.designId,
        l.quantity,
        exactRevision ? binding : { ...binding, agreementRevisionId: effective.revisionId },
      );
    }
    return this.owners.contractObligation(client, bookingId);
  }
}

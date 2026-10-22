import type { PrismaClient } from '../../../generated/prisma/client.js';
import { AppError, NotFoundError } from '../../../core/errors/app-error.js';
import { createMenuService } from './menu.service.js';
import { createVenueService } from './venue.service.js';
import { createRestaurantServiceReader } from './restaurant-service.service.js';
import { createPrintOfferingReader } from './print-offering.service.js';
import { createInvitationTemplateSelectionReader } from '../../invitation-studio/infrastructure/template-selection.reader.js';
import { checkedLineTotal } from '../domain/commercial-offering.js';

type Selection = Readonly<{
  category: 'MENU' | 'PRINT' | 'SERVICE';
  sourceId: string;
  sourceRevisionId: string;
  quantity: number;
}>;
export function createCommercialSelectionReader(prisma: PrismaClient) {
  const venue = createVenueService(prisma);
  const menu = createMenuService(prisma);
  const services = createRestaurantServiceReader(prisma);
  const print = createPrintOfferingReader(prisma, createInvitationTemplateSelectionReader);
  return Object.freeze({
    async requireVenue(hallId: string, shiftCode: 'LUNCH' | 'DINNER') {
      // Owner facts only. A single enlisted snapshot shares the Booking transaction.
      const restaurant = await venue.getRestaurantProfile();
      const hall = await venue.requireActiveHallSnapshot(hallId);
      const shift = await venue.requireActiveShiftSnapshot(shiftCode);
      return Object.freeze({ restaurant, hall, shift });
    },
    async requireSelection(input: Selection, restaurantId: string) {
      try {
        return await resolveSelection(input, restaurantId);
      } catch (error) {
        if (error instanceof RangeError)
          throw new AppError({
            status: 409,
            code: 'COMMERCIAL_AMOUNT_OVERFLOW',
            message: 'The selected line exceeds the safe integer VND range.',
          });
        throw error;
      }
    },
    async requireSelections(inputs: readonly Selection[], restaurantId: string) {
      try {
        return await resolveSelections(inputs, restaurantId);
      } catch (error) {
        if (error instanceof RangeError)
          throw new AppError({
            status: 409,
            code: 'COMMERCIAL_AMOUNT_OVERFLOW',
            message: 'The selected line exceeds the safe integer VND range.',
          });
        throw error;
      }
    },
  });
  async function resolveSelections(
    inputs: readonly Selection[],
    restaurantId: string,
  ): Promise<Map<string, ResolvedCommercialLine>> {
    const result = new Map<string, ResolvedCommercialLine>();
    if (inputs.length === 0) return result;

    const sortedInputs = [...inputs].sort((a, b) =>
      (a.category + a.sourceId).localeCompare(b.category + b.sourceId),
    );

    const menuInputs = sortedInputs.filter((i) => i.category === 'MENU');
    const printInputs = sortedInputs.filter((i) => i.category === 'PRINT');
    const serviceInputs = sortedInputs.filter((i) => i.category === 'SERVICE');

    if (menuInputs.length > 0) {
      const menuPackageIds = menuInputs.map((i) => i.sourceId);
      const menuHeadersMap = await menu.requireCurrentMenuPackageHeaders(menuPackageIds);
      for (const input of menuInputs) {
        const facts = menuHeadersMap.get(input.sourceId);
        if (!facts) throw new NotFoundError();
        if (facts.id !== input.sourceRevisionId) throw stale();
        result.set(
          input.category + input.sourceId,
          Object.freeze({
            ...input,
            name: facts.name,
            description: facts.description,
            unit: 'table',
            unitPriceVnd: facts.priceVndPerTable,
            lineTotalVnd: checkedLineTotal(facts.priceVndPerTable, input.quantity),
          }),
        );
      }
    }

    if (printInputs.length > 0) {
      const printFactsMap = await print.requireBatchSelections(
        printInputs.map((i) => ({
          offeringId: i.sourceId,
          sourceRevisionId: i.sourceRevisionId,
          quantity: i.quantity,
        })),
      );
      for (const input of printInputs) {
        const facts = printFactsMap.get(input.sourceId);
        if (!facts) throw stale();
        if (facts.restaurantId !== restaurantId) throw stale();
        result.set(
          input.category + input.sourceId,
          Object.freeze({
            ...input,
            name: facts.name,
            description: [
              facts.printType,
              facts.material,
              facts.templateTitle,
              facts.templateVersionId,
            ].join(' · '),
            unit: facts.unit,
            unitPriceVnd: facts.unitPriceVnd,
            lineTotalVnd: checkedLineTotal(facts.unitPriceVnd, input.quantity),
          }),
        );
      }
    }

    if (serviceInputs.length > 0) {
      const serviceFactsMap = await services.requireBatchSelections(
        serviceInputs.map((i) => ({
          serviceId: i.sourceId,
          sourceRevisionId: i.sourceRevisionId,
          quantity: i.quantity,
        })),
      );
      for (const input of serviceInputs) {
        const facts = serviceFactsMap.get(input.sourceId);
        if (!facts) throw stale();
        if (facts.restaurantId !== restaurantId) throw stale();
        result.set(
          input.category + input.sourceId,
          Object.freeze({
            ...input,
            name: facts.name,
            description: facts.description,
            unit: facts.unit,
            unitPriceVnd: facts.unitPriceVnd,
            lineTotalVnd: checkedLineTotal(facts.unitPriceVnd, input.quantity),
          }),
        );
      }
    }

    return result;
  }
  async function resolveSelection(
    input: Selection,
    restaurantId: string,
  ): Promise<ResolvedCommercialLine> {
    if (input.category === 'MENU') {
      const facts = await menu.requireCurrentMenuPackageVersion(input.sourceId);
      if (facts.id !== input.sourceRevisionId) throw stale();
      return Object.freeze({
        ...input,
        name: facts.name,
        description: facts.description,
        unit: 'table',
        unitPriceVnd: facts.priceVndPerTable,
        lineTotalVnd: checkedLineTotal(facts.priceVndPerTable, input.quantity),
      });
    }
    if (input.category === 'SERVICE') {
      const facts = await services.requireSelection({
        serviceId: input.sourceId,
        sourceRevisionId: input.sourceRevisionId,
        quantity: input.quantity,
      });
      if (facts.restaurantId !== restaurantId) throw stale();
      return Object.freeze({
        ...input,
        name: facts.name,
        description: facts.description,
        unit: facts.unit,
        unitPriceVnd: facts.unitPriceVnd,
        lineTotalVnd: facts.lineTotalVnd,
      });
    }
    const facts = await print.requireSelection({
      offeringId: input.sourceId,
      sourceRevisionId: input.sourceRevisionId,
      quantity: input.quantity,
    });
    if (facts.restaurantId !== restaurantId) throw stale();
    return Object.freeze({
      ...input,
      name: facts.name,
      description: [
        facts.printType,
        facts.material,
        facts.templateTitle,
        facts.templateVersionId,
      ].join(' · '),
      unit: facts.unit,
      unitPriceVnd: facts.unitPriceVnd,
      lineTotalVnd: facts.lineTotalVnd,
    });
  }
}
export type ResolvedCommercialLine = Readonly<{
  category: 'MENU' | 'PRINT' | 'SERVICE';
  sourceId: string;
  sourceRevisionId: string;
  quantity: number;
  name: string;
  description: string;
  unit: string;
  unitPriceVnd: number;
  lineTotalVnd: number;
}>;
function stale() {
  return new AppError({
    status: 409,
    code: 'COMMERCIAL_PRICE_REVISION_STALE',
    message: 'Reselect the active current catalog version.',
  });
}
export type CommercialSelectionReader = ReturnType<typeof createCommercialSelectionReader>;

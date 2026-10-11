import { randomUUID } from 'node:crypto';
import {
  contractDocumentSchema,
  INCIDENTAL_CLAUSE,
} from '../../src/modules/booking-lifecycle/domain/commercial-contract.js';
export function commercialDocumentFixture() {
  return contractDocumentSchema.parse({
    modelVersion: 'FULL_CONTRACT_V1',
    bookingId: randomUUID(),
    timelineRevisionId: randomUUID(),
    timelineDigest: 'a'.repeat(64),
    timeline: [{ order: 0, startTime: '18:00', title: 'Đón khách', description: null }],
    brideName: 'Nguyễn Thị Ánh',
    groomName: 'Trần Minh',
    restaurantId: randomUUID(),
    restaurantName: 'Nhà hàng thử',
    restaurantAddress: 'Địa chỉ thử',
    hallId: randomUUID(),
    hallName: 'Sảnh thử',
    maxGuests: 300,
    eventDate: '2027-02-01',
    shiftCode: 'DINNER',
    shiftStartTime: '17:00',
    shiftEndTime: '22:00',
    planningHeadcount: 100,
    tableCount: 10,
    lines: [
      {
        category: 'MENU',
        sourceId: randomUUID(),
        sourceRevisionId: randomUUID(),
        quantity: 10,
        name: 'Menu thử',
        description: '',
        unit: 'table',
        unitPriceVnd: 3500000,
        lineTotalVnd: 35000000,
      },
    ],
    contractTotalVnd: 35000000,
    depositAmountVnd: 10500000,
    incidentalClause: INCIDENTAL_CLAUSE,
  });
}

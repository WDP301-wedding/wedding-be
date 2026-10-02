import { describe, expect, it } from 'vitest';

import { evaluateDependencyAudit } from '../../scripts/dependency-audit-policy.js';

const documentedException = {
  advisoryId: '1145093',
  package: 'deepmerge-ts',
  severity: 'high',
  advisoryUrl: 'https://github.com/advisories/GHSA-ggr8-5vv4-36mx',
  reachability: 'Only Prisma CLI configuration consumes this package.',
  mitigation: 'Configuration is committed and does not merge request data.',
  owner: 'backend maintainers',
  reviewBy: '2026-10-16',
};

const auditReport = {
  auditReportVersion: 2,
  vulnerabilities: {
    'deepmerge-ts': {
      name: 'deepmerge-ts',
      severity: 'high',
      via: [
        {
          source: 1145093,
          name: 'deepmerge-ts',
          dependency: 'deepmerge-ts',
          title: 'Recursive merge stack exhaustion',
          url: 'https://github.com/advisories/GHSA-ggr8-5vv4-36mx',
          severity: 'high',
        },
      ],
    },
    '@prisma/config': {
      name: '@prisma/config',
      severity: 'high',
      via: ['deepmerge-ts'],
    },
  },
};

describe('dependency audit policy', () => {
  it('accepts a matching, documented, unexpired high-severity exception', () => {
    expect(
      evaluateDependencyAudit(auditReport, { exceptions: [documentedException] }, '2026-10-02'),
    ).toEqual({
      accepted: [
        {
          advisoryId: '1145093',
          package: 'deepmerge-ts',
          severity: 'high',
          advisoryUrl: 'https://github.com/advisories/GHSA-ggr8-5vv4-36mx',
        },
      ],
      staleExceptions: [],
    });
  });

  it('rejects an undocumented high-severity advisory', () => {
    expect(() =>
      evaluateDependencyAudit(auditReport, { exceptions: [] }, '2026-10-02'),
    ).toThrowError('Undocumented high/critical advisories: 1145093 (deepmerge-ts)');
  });

  it('rejects an exception on and after its review date', () => {
    expect(() =>
      evaluateDependencyAudit(auditReport, { exceptions: [documentedException] }, '2026-10-16'),
    ).toThrowError('Expired dependency audit exceptions: 1145093 (review by 2026-10-16)');
  });

  it('fails closed when a high-severity vulnerability has no advisory details', () => {
    expect(() =>
      evaluateDependencyAudit(
        {
          auditReportVersion: 2,
          vulnerabilities: {
            opaque: { name: 'opaque', severity: 'high', via: [] },
          },
        },
        { exceptions: [] },
        '2026-10-02',
      ),
    ).toThrowError('Audit report did not identify the advisory behind opaque');
  });

  it('reports policy entries that no longer match an active advisory', () => {
    expect(
      evaluateDependencyAudit(
        { auditReportVersion: 2, vulnerabilities: {} },
        { exceptions: [documentedException] },
        '2026-10-02',
      ),
    ).toEqual({ accepted: [], staleExceptions: ['1145093'] });
  });
});

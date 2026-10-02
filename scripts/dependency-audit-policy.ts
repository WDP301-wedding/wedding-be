type BlockingSeverity = 'critical' | 'high';

type AcceptedAdvisory = {
  advisoryId: string;
  advisoryUrl: string;
  package: string;
  severity: BlockingSeverity;
};

type AuditEvaluation = {
  accepted: AcceptedAdvisory[];
  staleExceptions: string[];
};

type AuditAdvisory = AcceptedAdvisory;

type AuditException = AcceptedAdvisory & {
  mitigation: string;
  owner: string;
  reachability: string;
  reviewBy: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBlockingSeverity(value: unknown): value is BlockingSeverity {
  return value === 'critical' || value === 'high';
}

function requiredString(record: Record<string, unknown>, key: string, context: string): string {
  const value = record[key];

  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${context}.${key} must be a non-empty string`);
  }

  return value;
}

function parseIsoDate(value: string, context: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error(`${context} must use YYYY-MM-DD`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${context} must be a valid calendar date`);
  }

  return value;
}

function parsePolicy(policy: unknown): AuditException[] {
  if (!isRecord(policy) || !Array.isArray(policy.exceptions)) {
    throw new Error('Dependency audit policy must contain an exceptions array');
  }

  const seen = new Set<string>();

  return policy.exceptions.map((entry, index) => {
    const context = `exceptions[${index}]`;
    if (!isRecord(entry)) {
      throw new Error(`${context} must be an object`);
    }

    const advisoryId = requiredString(entry, 'advisoryId', context);
    const severity = entry.severity;
    if (!isBlockingSeverity(severity)) {
      throw new Error(`${context}.severity must be high or critical`);
    }
    if (seen.has(advisoryId)) {
      throw new Error(`Duplicate dependency audit exception: ${advisoryId}`);
    }
    seen.add(advisoryId);

    return {
      advisoryId,
      package: requiredString(entry, 'package', context),
      severity,
      advisoryUrl: requiredString(entry, 'advisoryUrl', context),
      reachability: requiredString(entry, 'reachability', context),
      mitigation: requiredString(entry, 'mitigation', context),
      owner: requiredString(entry, 'owner', context),
      reviewBy: parseIsoDate(requiredString(entry, 'reviewBy', context), `${context}.reviewBy`),
    };
  });
}

function parseAdvisory(value: Record<string, unknown>): AuditAdvisory | undefined {
  if (!isBlockingSeverity(value.severity)) {
    return undefined;
  }

  const source = value.source;
  if ((typeof source !== 'number' && typeof source !== 'string') || String(source).trim() === '') {
    throw new Error('A high/critical npm advisory is missing its source identifier');
  }

  return {
    advisoryId: String(source),
    package: requiredString(value, 'name', `advisory ${String(source)}`),
    severity: value.severity,
    advisoryUrl: requiredString(value, 'url', `advisory ${String(source)}`),
  };
}

function collectBlockingAdvisories(report: unknown): AuditAdvisory[] {
  if (!isRecord(report) || report.auditReportVersion !== 2 || !isRecord(report.vulnerabilities)) {
    throw new Error('Unsupported or malformed npm audit report');
  }

  const vulnerabilities = report.vulnerabilities;
  const advisories = new Map<string, AuditAdvisory>();

  const visit = (packageName: string, visited: Set<string>): number => {
    if (visited.has(packageName)) {
      return 0;
    }
    visited.add(packageName);

    const vulnerability = vulnerabilities[packageName];
    if (!isRecord(vulnerability) || !Array.isArray(vulnerability.via)) {
      throw new Error(`Audit report contains an invalid vulnerability entry for ${packageName}`);
    }

    let found = 0;
    for (const via of vulnerability.via) {
      if (typeof via === 'string') {
        found += visit(via, visited);
        continue;
      }
      if (!isRecord(via)) {
        throw new Error(`Audit report contains invalid advisory data for ${packageName}`);
      }

      const advisory = parseAdvisory(via);
      if (advisory !== undefined) {
        const existing = advisories.get(advisory.advisoryId);
        if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(advisory)) {
          throw new Error(`Audit report contains conflicting data for ${advisory.advisoryId}`);
        }
        advisories.set(advisory.advisoryId, advisory);
        found += 1;
      }
    }

    return found;
  };

  for (const [packageName, value] of Object.entries(vulnerabilities)) {
    if (!isRecord(value)) {
      throw new Error(`Audit report contains an invalid vulnerability entry for ${packageName}`);
    }
    if (isBlockingSeverity(value.severity) && visit(packageName, new Set()) === 0) {
      throw new Error(`Audit report did not identify the advisory behind ${packageName}`);
    }
  }

  return [...advisories.values()].sort((left, right) =>
    left.advisoryId.localeCompare(right.advisoryId),
  );
}

export function evaluateDependencyAudit(
  report: unknown,
  policy: unknown,
  currentDate: string,
): AuditEvaluation {
  const today = parseIsoDate(currentDate, 'currentDate');
  const exceptions = parsePolicy(policy);
  const advisories = collectBlockingAdvisories(report);
  const accepted: AcceptedAdvisory[] = [];
  const expired: AuditException[] = [];
  const undocumented: AuditAdvisory[] = [];

  for (const advisory of advisories) {
    const exception = exceptions.find(
      (candidate) =>
        candidate.advisoryId === advisory.advisoryId &&
        candidate.package === advisory.package &&
        candidate.severity === advisory.severity &&
        candidate.advisoryUrl === advisory.advisoryUrl,
    );

    if (exception === undefined) {
      undocumented.push(advisory);
    } else if (exception.reviewBy <= today) {
      expired.push(exception);
    } else {
      accepted.push(advisory);
    }
  }

  if (expired.length > 0) {
    throw new Error(
      `Expired dependency audit exceptions: ${expired
        .map(({ advisoryId, reviewBy }) => `${advisoryId} (review by ${reviewBy})`)
        .join(', ')}`,
    );
  }
  if (undocumented.length > 0) {
    throw new Error(
      `Undocumented high/critical advisories: ${undocumented
        .map(({ advisoryId, package: packageName }) => `${advisoryId} (${packageName})`)
        .join(', ')}`,
    );
  }

  const activeIds = new Set(advisories.map(({ advisoryId }) => advisoryId));
  return {
    accepted,
    staleExceptions: exceptions
      .map(({ advisoryId }) => advisoryId)
      .filter((advisoryId) => !activeIds.has(advisoryId))
      .sort(),
  };
}

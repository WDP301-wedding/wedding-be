import { describe, expect, it } from 'vitest';
import { retentionOptions } from '../../scripts/retention-options.js';
const url = 'postgresql://user:do-not-log@127.0.0.1:55435/fixture?schema=public';
describe('operator retention target confirmation', () => {
  it('inspects only non-secret target data without execution', () => {
    const result = retentionOptions(['--inspect-target'], url);
    expect(result.inspect).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/do-not-log|user/u);
    expect(result.fingerprint).toHaveLength(64);
    expect(
      retentionOptions(['--inspect-target'], url.replace('do-not-log', 'changed-password'))
        .fingerprint,
    ).toBe(result.fingerprint);
  });
  it('requires exact target, operator and strict bounded arguments', () => {
    const fingerprint = retentionOptions(['--inspect-target'], url).fingerprint;
    const good = [
      '--confirm-retention',
      `--target-fingerprint=${fingerprint}`,
      '--operator=rv06-test',
    ];
    expect(retentionOptions(good, url)).toMatchObject({
      inspect: false,
      batchSize: 100,
      operatorId: 'rv06-test',
    });
    for (const args of [
      [],
      good.slice(1),
      [...good, '--batch-size=0'],
      [...good, '--batch-size=1001'],
      [...good, '--batch-size=1.2'],
      [...good, '--batch-size=1e2'],
      [...good, '--unknown=1'],
      [...good, '--operator=duplicate'],
      ['--inspect-target', ...good],
    ])
      expect(() => retentionOptions(args, url)).toThrow();
    expect(() => retentionOptions(good, url.replace('/fixture', '/wrong'))).toThrow();
    expect(() => retentionOptions(good, undefined)).toThrow();
    expect(() => retentionOptions(good, 'https://example.test')).toThrow();
    expect(() =>
      retentionOptions(good, url.replace('schema=public', 'schema=invalid%22')),
    ).toThrow();
  });
  it('refuses driver destination overrides and environment-dependent destinations', () => {
    const fingerprint = retentionOptions(['--inspect-target'], url).fingerprint;
    const execution = [
      '--confirm-retention',
      `--target-fingerprint=${fingerprint}`,
      '--operator=rv06-test',
    ];
    for (const unsafe of [
      ...['host', 'hostaddr', 'port', 'database', 'db', 'dbname', 'connectionString'].map(
        (key) => `${url}&${key}=different-target`,
      ),
      `${url}&h%6fst=other.example.test&port=5433`,
      url.replace(':55435', ''),
      url.replace('/fixture', '/'),
      'postgresql://user:do-not-log@:55435/fixture',
      'postgresql://user:do-not-log@%2Ftmp:55435/fixture',
    ]) {
      expect(() => retentionOptions(['--inspect-target'], unsafe)).toThrow();
      expect(() => retentionOptions(execution, unsafe)).toThrow();
    }
    expect(
      retentionOptions(
        ['--inspect-target'],
        `${url}&sslmode=verify-full&application_name=retention`,
      ).fingerprint,
    ).toBe(fingerprint);
  });
});

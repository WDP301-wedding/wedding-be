import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, openSync, closeSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { ReadStream, WriteStream } from 'node:tty';
import { isatty } from 'node:tty';
import { describe, expect, it, vi } from 'vitest';
import { readBootstrapPassword, readHiddenPassword } from './bootstrap-secret.js';

vi.mock('node:tty', () => ({
  isatty: vi.fn(() => false),
}));

describe('bootstrap secret input', () => {
  it('refuses a terminal supplied through any descriptor before reading echoed input', async () => {
    vi.mocked(isatty).mockReturnValueOnce(true);
    await expect(readBootstrapPassword(3)).rejects.toThrow('hidden prompt');
  });
  it('reads a bounded descriptor without echo, and rejects multi-line/oversized input', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rv-bootstrap-'));
    const file = join(directory, 'input');
    const secret = randomUUID();
    try {
      for (const value of [`${secret}\r\n`, `${secret}\nsecond-line`, 'x'.repeat(515)]) {
        writeFileSync(file, value);
        const fd = openSync(file, 'r');
        try {
          if (value === `${secret}\r\n`) expect(await readBootstrapPassword(fd)).toBe(secret);
          else await expect(readBootstrapPassword(fd)).rejects.toThrow();
        } finally {
          closeSync(fd);
        }
      }
    } finally {
      unlinkSync(file);
      rmdirSync(directory);
    }
  });

  function terminal() {
    const input = Object.assign(new PassThrough(), {
      isTTY: true,
      isRaw: false,
      setRawMode: vi.fn(),
    });
    const output = Object.assign(new PassThrough(), { isTTY: true });
    const write = vi.spyOn(output, 'write');
    const read = () =>
      readHiddenPassword(input as unknown as ReadStream, output as unknown as WriteStream);
    return { input, write, read };
  }
  it('hides terminal input, handles editing and restores terminal mode', async () => {
    const f = terminal();
    const pending = f.read();
    f.input.emit('keypress', 'a', { name: 'a' });
    f.input.emit('keypress', 'b', { name: 'b' });
    f.input.emit('keypress', undefined, { name: 'backspace' });
    f.input.emit('keypress', undefined, { name: 'return' });
    expect(await pending).toBe('a');
    expect(f.write.mock.calls.map(([text]) => String(text))).toEqual([
      'Manager password (hidden): ',
      '\n',
    ]);
    expect(f.input.setRawMode.mock.calls).toEqual([[true], [false]]);
    expect(f.input.listenerCount('keypress')).toBe(0);
  });
  it('restores terminal mode on cancellation and refuses non-terminal default input', async () => {
    const f = terminal();
    const pending = f.read();
    f.input.emit('keypress', undefined, { ctrl: true, name: 'c' });
    await expect(pending).rejects.toThrow();
    expect(f.input.setRawMode).toHaveBeenLastCalledWith(false);
    await expect(readHiddenPassword(new PassThrough() as unknown as ReadStream)).rejects.toThrow();
  });
});

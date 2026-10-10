import { createReadStream } from 'node:fs';
import { emitKeypressEvents } from 'node:readline';
import { isatty, type ReadStream, type WriteStream } from 'node:tty';

export async function readBootstrapPassword(descriptor?: number): Promise<string> {
  if (descriptor === undefined) return readHiddenPassword();
  if (isatty(descriptor)) throw new Error('Use the hidden prompt for a terminal.');
  const stream =
    descriptor === 0 ? process.stdin : createReadStream('', { fd: descriptor, autoClose: false });
  const chunks: Buffer[] = [];
  let size = 0;
  const timeout = setTimeout(() => stream.destroy(new Error('Secret input timed out.')), 30_000);
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk as Uint8Array);
      size += bytes.length;
      if (size > 514) throw new Error('Secret input exceeds the password bound.');
      chunks.push(bytes);
    }
    const password = Buffer.concat(chunks)
      .toString('utf8')
      .replace(/\r?\n$/u, '');
    if (!password || /[\r\n\0]/u.test(password) || Buffer.byteLength(password) > 512)
      throw new Error('Secret input must be one bounded password.');
    return password;
  } finally {
    clearTimeout(timeout);
    for (const chunk of chunks) chunk.fill(0);
  }
}

export function readHiddenPassword(
  input: ReadStream = process.stdin,
  output: WriteStream = process.stderr,
): Promise<string> {
  if (!input.isTTY || !output.isTTY)
    return Promise.reject(new Error('A terminal or approved password descriptor is required.'));
  return new Promise((resolve, reject) => {
    const wasRaw = input.isRaw;
    const wasPaused = input.isPaused();
    const characters: string[] = [];
    let finished = false;
    const finish = (error?: Error): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      input.off('keypress', onKey);
      input.off('end', onEnd);
      input.off('error', onError);
      process.off('SIGTERM', onEnd);
      input.setRawMode(wasRaw);
      if (wasPaused) input.pause();
      output.write('\n');
      const password = characters.join('');
      characters.length = 0;
      if (error) reject(error);
      else resolve(password);
    };
    const onEnd = (): void => finish(new Error('Secret input cancelled.'));
    const onError = (): void => finish(new Error('Secret input failed.'));
    const onKey = (
      text: string | undefined,
      key: { name?: string; ctrl?: boolean; meta?: boolean },
    ): void => {
      if (key.ctrl && (key.name === 'c' || key.name === 'd')) {
        onEnd();
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        finish();
        return;
      }
      if (key.name === 'backspace') {
        characters.pop();
        return;
      }
      if (
        text &&
        !key.ctrl &&
        !key.meta &&
        Array.from(text).every((character) => {
          const point = character.codePointAt(0)!;
          return point >= 32 && point !== 127;
        })
      )
        characters.push(text);
      if (Buffer.byteLength(characters.join('')) > 512)
        finish(new Error('Secret input exceeds the password bound.'));
    };
    const timeout = setTimeout(onEnd, 120_000);
    emitKeypressEvents(input);
    input.on('keypress', onKey);
    input.once('end', onEnd);
    input.once('error', onError);
    process.once('SIGTERM', onEnd);
    output.write('Manager password (hidden): ');
    input.setRawMode(true);
    input.resume();
  });
}

import type { Redis } from 'ioredis';

type Connection = Pick<Redis, 'status' | 'on' | 'off'>;

/** Pub/Sub cannot replay missed packets. Clients must refetch authorized APIs. */
export function watchFanoutRecovery(
  pair: { pub: Connection; sub: Connection },
  onRecovered: () => void,
): () => void {
  let interrupted = pair.pub.status !== 'ready' || pair.sub.status !== 'ready';
  const onUnavailable = () => {
    interrupted = true;
  };
  const onReady = () => {
    if (!interrupted || pair.pub.status !== 'ready' || pair.sub.status !== 'ready') return;
    interrupted = false;
    onRecovered();
  };
  for (const connection of [pair.pub, pair.sub]) {
    connection.on('close', onUnavailable);
    connection.on('ready', onReady);
  }
  return () => {
    for (const connection of [pair.pub, pair.sub]) {
      connection.off('close', onUnavailable);
      connection.off('ready', onReady);
    }
  };
}

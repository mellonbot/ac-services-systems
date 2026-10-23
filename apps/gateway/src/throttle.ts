/**
 * A fixed-window counter per key, in memory. One gateway process is one
 * container (infra/cloudflare/worker.mjs), so this is the whole count; a
 * second process would be a second, separate count, which still bounds the
 * rate. The point is that an anonymous caller cannot send logins, sessions
 * or leads as fast as the network carries them.
 */
export type Throttle = {
  readonly hit: (key: string, now?: number) => boolean;
  /** True once the key has used its limit this window — without counting this look. */
  readonly spent: (key: string, now?: number) => boolean;
  readonly size: () => number;
};

export const createThrottle = (opts: { readonly limit: number; readonly windowMs: number; readonly maxKeys?: number }): Throttle => {
  const windows = new Map<string, { start: number; count: number }>();
  const maxKeys = opts.maxKeys ?? 50_000;
  return {
    /** True while the key is within its limit for the current window. */
    hit(key, now = Date.now()) {
      let w = windows.get(key);
      if (!w || now - w.start >= opts.windowMs) {
        if (!w && windows.size >= maxKeys) {
          for (const [k, v] of windows) if (now - v.start >= opts.windowMs) windows.delete(k);
          // Still full of live windows: refuse rather than grow without bound.
          if (windows.size >= maxKeys) return false;
        }
        w = { start: now, count: 0 };
        windows.set(key, w);
      }
      w.count += 1;
      return w.count <= opts.limit;
    },
    spent(key, now = Date.now()) {
      const w = windows.get(key);
      return !!w && now - w.start < opts.windowMs && w.count >= opts.limit;
    },
    size: () => windows.size,
  };
};

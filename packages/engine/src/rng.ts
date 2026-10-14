// Aleatoriedad. En producción el servidor usa crypto.getRandomValues (CSPRNG).
// Para pruebas y simulaciones reproducibles se puede inyectar un generador con semilla.

export type Rng = () => number; // [0,1)

export const secureRng: Rng = () => {
  const buf = new Uint32Array(2);
  globalThis.crypto.getRandomValues(buf);
  // 53 bits de entropía
  return (buf[0] * 2 ** 21 + (buf[1] >>> 11)) / 2 ** 53;
};

/** Entero uniforme en [0, n) sin sesgo de módulo, usando CSPRNG. */
export function secureInt(n: number): number {
  if (n <= 0) throw new Error('n inválido');
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % n;
}

export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates. Si no se pasa rng, usa CSPRNG sin sesgo. */
export function shuffle<T>(arr: T[], rng?: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng ? Math.floor(rng() * (i + 1)) : secureInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Moderación de chat: longitud, caracteres de control, enlaces, lista de palabras y ritmo.
// El cliente siempre pinta los mensajes como texto plano (textContent), nunca como HTML.

const BLOCKED = [
  'pendejo', 'pendeja', 'puto', 'puta', 'idiota', 'imbecil', 'imbécil', 'estupido', 'estúpido', 'cabron', 'cabrón',
  'verga', 'chinga', 'mierda', 'marica', 'joto', 'zorra', 'fuck', 'shit', 'bitch', 'asshole', 'nigger', 'retard',
];

const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[0@]/g, 'o').replace(/[1!|]/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/[5$]/g, 's');

const BLOCKED_NORM = BLOCKED.map(w => normalize(w));

export const EMOTES = ['👍', '👏', '😄', '😮', '🤔', '😅', '🔥', '🐸', '⚡', '🌿', 'GG', '¡Bien jugado!', '¡Suerte!', 'Gracias'];

export function moderate(text: unknown): { ok: true; text: string; censored: boolean } | { ok: false; reason: string } {
  if (typeof text !== 'string') return { ok: false, reason: 'Mensaje inválido' };
  let t = text.replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return { ok: false, reason: 'Mensaje vacío' };
  if (t.length > 200) return { ok: false, reason: 'Máximo 200 caracteres' };
  if (/(https?:\/\/|www\.|\.[a-z]{2,}\/)/i.test(t)) return { ok: false, reason: 'No se permiten enlaces en el chat' };
  if (/(.)\1{9,}/.test(t)) return { ok: false, reason: 'Mensaje repetitivo' };
  let censored = false;
  t = t.split(' ').map(word => {
    const n = normalize(word).replace(/[^a-zñ]/g, '');
    if (BLOCKED_NORM.some(b => n.includes(b))) { censored = true; return '•'.repeat(Math.min(8, word.length)); }
    return word;
  }).join(' ');
  return { ok: true, text: t, censored };
}

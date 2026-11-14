/** Escapes text for Telegram's HTML parse mode. */
export function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Cuts a button label so long alert names do not break the keyboard. */
export function truncate(value: string, max = 40): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

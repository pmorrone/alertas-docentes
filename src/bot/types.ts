/** A button under a message. `data` is the callback payload (Telegram caps it at 64 bytes). */
export interface Button {
  text: string;
  data: string;
}

/** What the bot says. `text` is Telegram HTML; build it with `esc` for anything dynamic. */
export interface BotReply {
  text: string;
  /** Rows of inline buttons. */
  buttons?: Button[][];
}

/** A button that sends `data` back to the bot (Telegram caps it at 64 bytes). */
export interface CallbackButton {
  text: string;
  data: string;
}

/** A button that opens a link. */
export interface LinkButton {
  text: string;
  url: string;
}

export type Button = CallbackButton | LinkButton;

/** What the bot says. `text` is Telegram HTML; build it with `esc` for anything dynamic. */
export interface BotReply {
  text: string;
  /** Rows of inline buttons. */
  buttons?: Button[][];
}

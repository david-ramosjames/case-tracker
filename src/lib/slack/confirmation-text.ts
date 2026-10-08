/** Slack sends emoji in message text as shortcodes (`:white_check_mark:`), optionally with a skin tone. */
const CONFIRM_EMOJI_SHORTCODE_RE =
  /:(?:white_check_mark|heavy_check_mark|ballot_box_with_check|\+1|thumbsup|ok_hand)(?:::skin-tone-\d)?:/gi;

/** Maps confirmation emoji to ✅ and drops trailing punctuation so "Yes!", "confirmed." and ":white_check_mark:" match. */
export function normalizeConfirmationText(text: string) {
  return text
    .trim()
    .replace(CONFIRM_EMOJI_SHORTCODE_RE, "✅")
    .replace(/[✔☑👌]\uFE0F?/gu, "✅")
    .replace(/👍[\u{1F3FB}-\u{1F3FF}]?/gu, "✅")
    .replace(/(?:\s*✅)+/gu, " ✅")
    .replace(/[.!\s]+$/u, "")
    .trim();
}

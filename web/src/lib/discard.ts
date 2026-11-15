/** The reasons offered in the discard popout. One may be chosen; the comment box covers anything else. */
export const discardReasons = [
  'Expired',
  'Seniority mismatch',
  'Title mismatch',
  'Wrong role',
  'Wrong location',
  'Duplicate',
];

/** The server and the SQL function reject an empty discard reason, so "none" is sent as this text. */
export const NO_REASON = 'No reason given';

/** The server stores at most this many characters of reason. */
export const DISCARD_REASON_LIMIT = 200;

/**
 * The reason sent for a discard: "Reason: comment", the reason alone, the comment alone, or
 * "No reason given" when both are empty.
 */
export function discardReasonText(reason: string | null, comment: string): string {
  const text = comment.trim();
  if (reason) return text ? `${reason}: ${text}` : reason;
  return text || NO_REASON;
}

/** How many characters of comment still fit once the chosen reason is written in front. */
export function commentRoom(reason: string | null): number {
  return DISCARD_REASON_LIMIT - (reason ? reason.length + 2 : 0);
}

/** Why the reason cannot be sent, or undefined when it can. */
export function discardProblem(reason: string | null, comment: string): string | undefined {
  const length = discardReasonText(reason, comment).length;
  return length > DISCARD_REASON_LIMIT
    ? `The reason is ${length - DISCARD_REASON_LIMIT} characters too long. Shorten the comment.`
    : undefined;
}

/** A job discarded without a reason shows just "Discarded"; any other stored text is the reason. */
export const visibleDiscardReason = (reason: string | null): string | null =>
  reason && reason !== NO_REASON ? reason : null;

// Limits on model requests made by people (the chat's typed questions and the content
// assistant's suggestions), counted from the ai_generations audit. Pure, so it is tested
// without a database.

export const DEFAULT_MAX_PER_HOUR = 20;
/** Model requests per organization per day, across everyone, for the chat and the assistant. */
export const MAX_PER_ORG_PER_DAY = 200;

export type LimitCheck = { ok: true } | { ok: false; message: string };

export function checkModelLimit(input: {
  /** This person's model requests in the last hour. */
  userLastHour: number;
  /** The organization's model requests in the last 24 hours. */
  orgLastDay: number;
  perHour: number;
  perOrgDay?: number;
}): LimitCheck {
  const perOrgDay = input.perOrgDay ?? MAX_PER_ORG_PER_DAY;
  if (input.userLastHour >= input.perHour) {
    return {
      ok: false,
      message: `You reached the limit of ${input.perHour} AI requests per hour. Try again later; ready questions still work.`,
    };
  }
  if (input.orgLastDay >= perOrgDay) {
    return {
      ok: false,
      message: `Your organization reached its limit of ${perOrgDay} AI requests per day. Try again tomorrow; ready questions still work.`,
    };
  }
  return { ok: true };
}

/**
 * The platform provider contract.
 *
 * Every OS-specific capability WinDock needs is declared here once, so the
 * server never reaches for an OS primitive directly. A provider is a plain
 * object implementing every method below; `verify-contract.mjs` proves that
 * each shipped provider does, with the declared arity.
 *
 * Providers receive an injected `exec(file, args)` rather than calling
 * child_process themselves. That is what makes launch/focus/control argv
 * assertable in tests, and it is why no provider ever builds a shell string.
 */

/** Control verbs the UI may request. A provider maps each to a native action. */
export const CONTROL_VERBS = Object.freeze([
  "volume-up",
  "volume-down",
  "volume-set",
  "mute-toggle",
  "media-play-pause",
  "media-next",
  "media-previous",
  "media-stop",
  "brightness-set",
  "lock",
  "sleep",
  "shutdown",
  "restart",
]);

/** Verbs that carry a numeric argument, with their inclusive accepted range. */
export const CONTROL_VERB_RANGES = Object.freeze({
  "volume-set": Object.freeze({ min: 0, max: 100 }),
  "brightness-set": Object.freeze({ min: 0, max: 100 }),
});

/** Verbs that end the user's session or power state, gated separately in the API. */
export const DESTRUCTIVE_VERBS = Object.freeze([
  "lock",
  "sleep",
  "shutdown",
  "restart",
]);

/**
 * Required provider methods and their declared arity.
 * Arity is part of the contract: a provider that silently ignores an argument
 * is a defect the contract gate should catch.
 */
export const PROVIDER_METHODS = Object.freeze({
  listInstalledApps: 0,
  listRunningApps: 0,
  launchApp: 1,
  focusApp: 1,
  closeApp: 1,
  control: 2,
  nowPlaying: 0,
  systemStats: 0,
});

/** Required non-function provider properties. */
export const PROVIDER_FIELDS = Object.freeze(["id", "displayName"]);

export function isControlVerb(verb) {
  return CONTROL_VERBS.includes(verb);
}

/**
 * True when the verb requires a numeric argument.
 * A tile for such a verb must store its value, otherwise tapping it would send
 * a valueless request that `validateControl` correctly rejects.
 */
export function verbTakesValue(verb) {
  return Object.prototype.hasOwnProperty.call(CONTROL_VERB_RANGES, verb);
}

export function isDestructiveVerb(verb) {
  return DESTRUCTIVE_VERBS.includes(verb);
}

/**
 * Validate a control request before any provider touches it.
 * Returns `{ ok: true, verb, value }` or `{ ok: false, error }`.
 * Verbs are matched against a fixed allowlist, so an attacker-supplied verb can
 * never become part of a command line.
 */
export function validateControl(verb, value) {
  if (typeof verb !== "string" || !isControlVerb(verb)) {
    return { ok: false, error: "unknown control verb" };
  }
  const range = CONTROL_VERB_RANGES[verb];
  if (!range) {
    if (value !== undefined && value !== null) {
      return { ok: false, error: `${verb} takes no value` };
    }
    return { ok: true, verb, value: null };
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, error: `${verb} requires a numeric value` };
  }
  if (!Number.isInteger(value)) {
    return { ok: false, error: `${verb} requires an integer value` };
  }
  if (value < range.min || value > range.max) {
    return { ok: false, error: `${verb} accepts ${range.min}..${range.max}` };
  }
  return { ok: true, verb, value };
}

/**
 * Structural check used by the contract gate and by provider selection.
 * Returns a list of human-readable problems; empty means conformant.
 */
export function contractViolations(provider) {
  const problems = [];
  if (!provider || typeof provider !== "object") {
    return ["provider is not an object"];
  }
  for (const field of PROVIDER_FIELDS) {
    if (typeof provider[field] !== "string" || provider[field].length === 0) {
      problems.push(`missing string field: ${field}`);
    }
  }
  for (const [method, arity] of Object.entries(PROVIDER_METHODS)) {
    const fn = provider[method];
    if (typeof fn !== "function") {
      problems.push(`missing method: ${method}`);
      continue;
    }
    if (fn.length !== arity) {
      problems.push(`${method} arity ${fn.length}, expected ${arity}`);
    }
  }
  return problems;
}

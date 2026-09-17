/**
 * Minimal assertion helper for gate oracles.
 *
 * Every check accumulates failures and only prints its success marker after all
 * assertions pass, so a marker can never appear alongside a failure.
 */

export function createChecker(name) {
  const failures = [];
  let count = 0;

  const api = {
    ok(condition, message) {
      count += 1;
      if (!condition) failures.push(message);
      return Boolean(condition);
    },
    equal(actual, expected, message) {
      const same = Object.is(actual, expected);
      return api.ok(same, `${message} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
    },
    deepEqual(actual, expected, message) {
      const a = JSON.stringify(actual);
      const b = JSON.stringify(expected);
      return api.ok(a === b, `${message}\n    got:  ${a}\n    want: ${b}`);
    },
    /** Assert that `fn` throws. Used for negative controls. */
    throws(fn, message) {
      count += 1;
      try {
        const result = fn();
        if (result && typeof result.then === "function") {
          failures.push(`${message} (returned a promise; use rejects)`);
          return false;
        }
        failures.push(`${message} (did not throw)`);
        return false;
      } catch {
        return true;
      }
    },
    async rejects(promiseFn, message) {
      count += 1;
      try {
        await promiseFn();
        failures.push(`${message} (did not reject)`);
        return false;
      } catch {
        return true;
      }
    },
    get assertions() {
      return count;
    },
    /** Print the success marker, or every failure and exit nonzero. */
    done(marker) {
      if (failures.length) {
        process.stderr.write(`${name}: ${failures.length} failure(s)\n`);
        for (const f of failures) process.stderr.write(`  - ${f}\n`);
        process.exit(1);
      }
      if (count === 0) {
        process.stderr.write(`${name}: no assertions ran\n`);
        process.exit(1);
      }
      process.stdout.write(`${count} assertions\n${marker}\n`);
    },
  };
  return api;
}

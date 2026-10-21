/**
 * Deliberately CPU-bound: count primes below `limit` by trial division.
 * Shared by the worker (good) and the blocking endpoint (bad) for comparison.
 */
export function countPrimes(limit) {
  let count = 0;
  for (let n = 2; n < limit; n++) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) {
      if (n % d === 0) {
        prime = false;
        break;
      }
    }
    if (prime) count++;
  }
  return count;
}

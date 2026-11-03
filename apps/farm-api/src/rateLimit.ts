// Fixed-window rate limit per key, in memory. Enough for one small instance; resets on restart.
export class RateLimiter {
	private hits = new Map<string, { count: number; resetAt: number }>()

	constructor(
		private readonly limit: number,
		private readonly windowMs: number,
		private readonly now: () => number = Date.now,
	) {}

	allow(key: string): boolean {
		const now = this.now()
		// Drop expired windows as we go so the map can't grow without bound.
		if (this.hits.size > 10_000) {
			for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k)
		}
		const hit = this.hits.get(key)
		if (!hit || hit.resetAt <= now) {
			this.hits.set(key, { count: 1, resetAt: now + this.windowMs })
			return true
		}
		hit.count++
		return hit.count <= this.limit
	}
}

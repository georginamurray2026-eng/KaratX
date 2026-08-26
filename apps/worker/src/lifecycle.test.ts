import { describe, expect, it, vi } from 'vitest'

import { Lifecycle, type LifecycleEvent } from './lifecycle'

/**
 * Shutdown behaviour, tested as pure logic with no process and no signals.
 *
 * Every case here is a way OPS-3 fails in production: a hook that hangs, a
 * hook that throws, a second signal arriving mid-shutdown, or hooks running in
 * an order that closes a resource before the things using it.
 */

function recorder(): { events: LifecycleEvent[]; onEvent: (e: LifecycleEvent) => void } {
  const events: LifecycleEvent[] = []
  return { events, onEvent: (e) => events.push(e) }
}

describe('ordering', () => {
  it('runs hooks in REVERSE registration order', async () => {
    // Registration mirrors construction: the pool is opened before its users,
    // so it must close after them. Closing first would make every dependent
    // hook fail while trying to finish its work.
    const order: string[] = []
    const lifecycle = new Lifecycle()

    lifecycle.onShutdown('database-pool', () => void order.push('database-pool'))
    lifecycle.onShutdown('feed', () => void order.push('feed'))
    lifecycle.onShutdown('scheduler', () => void order.push('scheduler'))

    await lifecycle.shutdown('test')

    expect(order).toEqual(['scheduler', 'feed', 'database-pool'])
  })

  it('awaits each hook before starting the next', async () => {
    const order: string[] = []
    const lifecycle = new Lifecycle()

    lifecycle.onShutdown('slow', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      order.push('slow-finished')
    })
    lifecycle.onShutdown('fast', () => void order.push('fast-finished'))

    await lifecycle.shutdown('test')

    expect(order).toEqual(['fast-finished', 'slow-finished'])
  })
})

describe('in-flight work', () => {
  it('lets a running task finish before shutdown completes', async () => {
    // The synthetic in-flight task OPS-3 is really about. Testing against zero
    // hooks would pass without exercising anything.
    let finished = false
    const lifecycle = new Lifecycle()

    lifecycle.onShutdown('in-flight-candle-write', async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      finished = true
    })

    const clean = await lifecycle.shutdown('SIGTERM')

    expect(finished).toBe(true)
    expect(clean).toBe(true)
  })

  it('exposes isShuttingDown so long-running work can stop accepting more', async () => {
    const lifecycle = new Lifecycle()
    expect(lifecycle.isShuttingDown).toBe(false)

    let seenDuringShutdown: boolean | undefined
    lifecycle.onShutdown('observer', () => void (seenDuringShutdown = lifecycle.isShuttingDown))

    await lifecycle.shutdown('SIGTERM')

    expect(seenDuringShutdown).toBe(true)
    expect(lifecycle.isShuttingDown).toBe(true)
  })
})

describe('a hook that fails', () => {
  it('does not prevent the remaining hooks from running', async () => {
    // Releasing four of five resources beats releasing none.
    const ran: string[] = []
    const lifecycle = new Lifecycle()

    lifecycle.onShutdown('database-pool', () => void ran.push('database-pool'))
    lifecycle.onShutdown('broken', () => {
      throw new Error('hook exploded')
    })
    lifecycle.onShutdown('feed', () => void ran.push('feed'))

    await lifecycle.shutdown('SIGTERM')

    expect(ran).toEqual(['feed', 'database-pool'])
  })

  it('reports the shutdown as not clean, and never throws', async () => {
    const lifecycle = new Lifecycle()
    lifecycle.onShutdown('broken', () => {
      throw new Error('hook exploded')
    })

    // A shutdown path that throws is one that skips the remaining hooks.
    await expect(lifecycle.shutdown('SIGTERM')).resolves.toBe(false)
  })

  it('names the failing hook, because "a hook failed" is not actionable', async () => {
    const { events, onEvent } = recorder()
    const lifecycle = new Lifecycle({ onEvent })

    lifecycle.onShutdown('feed-consumer', () => {
      throw new Error('hook exploded')
    })
    await lifecycle.shutdown('SIGTERM')

    const failure = events.find((e) => e.type === 'shutdown.hook.failed')
    expect(failure).toMatchObject({ name: 'feed-consumer' })
  })
})

describe('a hook that hangs', () => {
  it('times out and moves on rather than holding the process open', async () => {
    // Otherwise a supervisor eventually SIGKILLs, turning a graceful shutdown
    // into an abrupt one - the outcome this exists to avoid.
    vi.useFakeTimers()
    try {
      const { events, onEvent } = recorder()
      const lifecycle = new Lifecycle({ hookTimeoutMs: 50, onEvent })

      lifecycle.onShutdown('wedged', () => new Promise<void>(() => undefined))
      lifecycle.onShutdown('after-the-wedged-one', () => undefined)

      const shutdown = lifecycle.shutdown('SIGTERM')
      await vi.advanceTimersByTimeAsync(200)
      const clean = await shutdown

      expect(events.some((e) => e.type === 'shutdown.hook.timeout')).toBe(true)
      expect(clean).toBe(false)
      // The hook registered earlier still ran, despite the wedge above it.
      expect(events.some((e) => e.type === 'shutdown.hook.ok')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a second signal', () => {
  it('is ignored rather than starting a second shutdown', async () => {
    // Hooks would otherwise run twice against already-closed resources.
    let runs = 0
    const { events, onEvent } = recorder()
    const lifecycle = new Lifecycle({ onEvent })

    lifecycle.onShutdown('pool', () => void (runs += 1))

    await lifecycle.shutdown('SIGTERM')
    await lifecycle.shutdown('SIGINT')

    expect(runs).toBe(1)
    expect(events.filter((e) => e.type === 'shutdown.started')).toHaveLength(1)
    expect(events.some((e) => e.type === 'shutdown.ignored')).toBe(true)
  })

  it('reports the original outcome, not a fresh clean result', async () => {
    const lifecycle = new Lifecycle()
    lifecycle.onShutdown('broken', () => {
      throw new Error('hook exploded')
    })

    expect(await lifecycle.shutdown('SIGTERM')).toBe(false)
    // The second call must not report success just because it did nothing.
    expect(await lifecycle.shutdown('SIGINT')).toBe(false)
  })
})

describe('with no hooks registered', () => {
  it('completes cleanly', async () => {
    // The T0.8 state, before the feed exists. It should not be the only case
    // covered - see the in-flight tests above.
    await expect(new Lifecycle().shutdown('SIGTERM')).resolves.toBe(true)
  })
})

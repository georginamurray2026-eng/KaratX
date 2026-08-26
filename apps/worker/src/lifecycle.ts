/**
 * Process lifecycle: ordered shutdown, with a bound on how long it may take.
 *
 * OPS-3 requires SIGTERM to stop accepting work, finish what is in flight,
 * close connections, and exit 0. There is no work yet - the feed arrives in
 * T1.7 - so this is the mechanism, tested against a synthetic in-flight task
 * rather than against zero hooks, which would pass vacuously.
 *
 * NFR-2 (the worker reconstructs live state deterministically on boot) lands
 * in Phase 4. `onShutdown` is the seam it needs: whatever holds live state
 * registers here to release it, and the boot sequence will later read back
 * what was released.
 */

export type ShutdownHook = () => Promise<void> | void

interface RegisteredHook {
  readonly name: string
  readonly run: ShutdownHook
}

export interface LifecycleOptions {
  /**
   * How long a single hook may take before shutdown moves on without it.
   *
   * Bounded deliberately. A hook that never settles would hold the process
   * open forever, and a supervisor would eventually SIGKILL it - turning a
   * graceful shutdown into an abrupt one, which is the outcome this exists to
   * avoid. Moving on and reporting it is strictly better than hanging.
   */
  readonly hookTimeoutMs?: number
  /** Reports progress and failures. Injected so this stays testable. */
  readonly onEvent?: (event: LifecycleEvent) => void
}

export type LifecycleEvent =
  | { readonly type: 'shutdown.started'; readonly reason: string; readonly hooks: number }
  | { readonly type: 'shutdown.hook.ok'; readonly name: string; readonly ms: number }
  | { readonly type: 'shutdown.hook.failed'; readonly name: string; readonly error: unknown }
  | { readonly type: 'shutdown.hook.timeout'; readonly name: string; readonly ms: number }
  | { readonly type: 'shutdown.finished'; readonly reason: string; readonly clean: boolean }
  | { readonly type: 'shutdown.ignored'; readonly reason: string }

const DEFAULT_HOOK_TIMEOUT_MS = 10_000

export class Lifecycle {
  readonly #hooks: RegisteredHook[] = []
  readonly #hookTimeoutMs: number
  readonly #onEvent: (event: LifecycleEvent) => void
  #shuttingDown = false
  #clean = true

  constructor(options: LifecycleOptions = {}) {
    this.#hookTimeoutMs = options.hookTimeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS
    this.#onEvent = options.onEvent ?? ((): void => undefined)
  }

  /** True once shutdown has begun. Long-running work should check this. */
  get isShuttingDown(): boolean {
    return this.#shuttingDown
  }

  /**
   * Register something to release on shutdown.
   *
   * Named, because "a hook failed" is not an actionable log line.
   */
  onShutdown(name: string, run: ShutdownHook): void {
    this.#hooks.push({ name, run })
  }

  /**
   * Run every hook in REVERSE registration order, then report.
   *
   * Reverse because registration order mirrors construction order: the
   * database pool is opened before the things that use it, so it must be
   * closed after them. Closing it first would make every dependent hook fail
   * while trying to finish its work.
   *
   * Never throws. A shutdown path that can throw is one that can skip the
   * remaining hooks, leaving connections open precisely when the process is
   * trying to release them.
   *
   * @returns true if every hook completed cleanly.
   */
  async shutdown(reason: string): Promise<boolean> {
    if (this.#shuttingDown) {
      // A second SIGTERM, or SIGINT following SIGTERM, must not start a second
      // shutdown - hooks would run twice against already-closed resources.
      this.#onEvent({ type: 'shutdown.ignored', reason })
      return this.#clean
    }
    this.#shuttingDown = true

    this.#onEvent({ type: 'shutdown.started', reason, hooks: this.#hooks.length })

    for (const hook of [...this.#hooks].reverse()) {
      await this.#runHook(hook)
    }

    this.#onEvent({ type: 'shutdown.finished', reason, clean: this.#clean })
    return this.#clean
  }

  async #runHook(hook: RegisteredHook): Promise<void> {
    const started = Date.now()
    let timer: ReturnType<typeof setTimeout> | undefined

    try {
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), this.#hookTimeoutMs)
      })

      const outcome = await Promise.race([Promise.resolve(hook.run()), timeout])

      if (outcome === 'timeout') {
        this.#clean = false
        this.#onEvent({ type: 'shutdown.hook.timeout', name: hook.name, ms: this.#hookTimeoutMs })
        return
      }

      this.#onEvent({ type: 'shutdown.hook.ok', name: hook.name, ms: Date.now() - started })
    } catch (error) {
      // One failing hook must not prevent the rest from running. Releasing
      // four of five resources beats releasing none.
      this.#clean = false
      this.#onEvent({ type: 'shutdown.hook.failed', name: hook.name, error })
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}

/**
 * Wire OS signals to a lifecycle.
 *
 * Returns a function that removes the listeners, so tests can install and
 * uninstall without leaking handlers between cases.
 *
 * SIGINT as well as SIGTERM: SIGTERM is what a platform sends on deploy or
 * restart, SIGINT is Ctrl-C in development. Handling only one means the
 * shutdown path is exercised in production and never locally.
 */
export function installSignalHandlers(
  lifecycle: Lifecycle,
  onExit: (code: number) => void,
): () => void {
  const signals = ['SIGTERM', 'SIGINT'] as const

  const handlers = signals.map((signal) => {
    const handler = (): void => {
      void lifecycle.shutdown(signal).then((clean) => {
        // Exit 0 on a clean shutdown (OPS-3). A non-clean shutdown exits 1, so
        // a platform can distinguish "released everything" from "gave up on
        // something" rather than both looking like success.
        onExit(clean ? 0 : 1)
      })
    }
    process.on(signal, handler)
    return { signal, handler }
  })

  return (): void => {
    for (const { signal, handler } of handlers) process.off(signal, handler)
  }
}

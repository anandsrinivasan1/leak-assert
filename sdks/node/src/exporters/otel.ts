/**
 * OpenTelemetry exporter for leak-assert.
 * Emits heap samples as OTEL gauges so they appear in Datadog / Grafana / Honeycomb.
 *
 * Usage:
 *
 *   import { OtelExporter } from 'leak-assert/exporters/otel'
 *
 *   const exporter = new OtelExporter({ serviceName: 'my-api' })
 *   exporter.attach(lt)   // lt is a LeakTest instance
 *
 * Requires: @opentelemetry/sdk-node @opentelemetry/api
 */

import type { Sample } from '../samplers/v8'

export interface OtelExporterOptions {
  serviceName?:  string
  /** OTEL metric name prefix (default: 'leak_assert') */
  prefix?:       string
  /** Emit samples to console as OTEL-formatted JSON (fallback if SDK not available) */
  consoleFallback?: boolean
}

// We dynamically import the OTEL SDK so the package doesn't hard-depend on it.
type MeterProvider = { getMeter: (name: string) => Meter }
type Meter         = { createObservableGauge: (name: string, opts: object) => ObservableGauge }
type ObservableGauge = { addCallback: (cb: (result: ObservableResult) => void) => void }
type ObservableResult = { observe: (value: number, attrs?: object) => void }

export class OtelExporter {
  private readonly prefix:   string
  private readonly service:  string
  private readonly fallback: boolean
  private latestSample: Sample | null = null

  constructor(opts: OtelExporterOptions = {}) {
    this.prefix   = opts.prefix       ?? 'leak_assert'
    this.service  = opts.serviceName  ?? 'unknown'
    this.fallback = opts.consoleFallback ?? true
    this.init()
  }

  /** Attach to a LeakTest — called automatically after each sample is taken */
  push(sample: Sample): void {
    this.latestSample = sample

    if (this.fallback && !this.hasOtel()) {
      console.log(JSON.stringify({
        metric:      `${this.prefix}.heap_used`,
        value:       sample.heap_used,
        iter:        sample.iter,
        service:     this.service,
        ts:          sample.ts,
        otel_format: true,
      }))
    }
  }

  private hasOtel(): boolean {
    try { require('@opentelemetry/api'); return true } catch { return false }
  }

  private init(): void {
    if (!this.hasOtel()) return

    try {
      const { metrics } = require('@opentelemetry/api') as { metrics: { getMeterProvider: () => MeterProvider } }
      const meter = metrics.getMeterProvider().getMeter('leak-assert')
      const attrs = { service: this.service }

      const heapGauge = meter.createObservableGauge(`${this.prefix}.heap_used`, {
        description: 'Heap bytes used at last leak-assert sample',
        unit:        'bytes',
      })
      heapGauge.addCallback((result: ObservableResult) => {
        if (this.latestSample) result.observe(this.latestSample.heap_used, attrs)
      })

      const rssGauge = meter.createObservableGauge(`${this.prefix}.rss`, {
        description: 'Process RSS at last leak-assert sample',
        unit:        'bytes',
      })
      rssGauge.addCallback((result: ObservableResult) => {
        if (this.latestSample) result.observe(this.latestSample.rss, attrs)
      })
    } catch {
      // OTEL not configured — fallback to console
    }
  }
}

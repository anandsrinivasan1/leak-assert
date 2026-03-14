"""OpenTelemetry exporter for leak-assert Python SDK.

Emits heap samples as OTEL gauges so they appear in Datadog / Grafana / Honeycomb.

Usage::

    from leak_assert import LeakTest
    from leak_assert.exporters import OtelExporter

    exporter = OtelExporter(service_name="my-api")

    with LeakTest(iterations=1000) as t:
        for _ in t:
            handle_request()
        exporter.flush(t.samples)

Requires: opentelemetry-sdk opentelemetry-api
"""
from __future__ import annotations

import json
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..samplers import Sample


class OtelExporter:
    """Exports leak-assert samples as OpenTelemetry metrics.

    Falls back to JSON console output if the OTEL SDK is not installed.
    """

    def __init__(
        self,
        *,
        service_name: str = "unknown",
        prefix:       str = "leak_assert",
        console_fallback: bool = True,
    ) -> None:
        self.service_name     = service_name
        self.prefix           = prefix
        self.console_fallback = console_fallback
        self._meter           = self._init_meter()

    # ── Public API ─────────────────────────────────────────────────────────────

    def push(self, sample: "Sample") -> None:
        """Push a single sample to OTEL (or console fallback)."""
        if self._meter:
            self._record_otel(sample)
        elif self.console_fallback:
            print(json.dumps({
                "metric":      f"{self.prefix}.heap_used",
                "value":       sample.heap_used,
                "iter":        sample.iter,
                "service":     self.service_name,
                "ts":          sample.ts,
                "otel_format": True,
            }))

    def flush(self, samples: list["Sample"]) -> None:
        """Push all samples (e.g. at end of a LeakTest run)."""
        for s in samples:
            self.push(s)

    # ── OTEL init ──────────────────────────────────────────────────────────────

    def _init_meter(self):
        try:
            from opentelemetry import metrics  # type: ignore
            meter = metrics.get_meter("leak-assert")
            self._heap_gauge = meter.create_observable_gauge(
                f"{self.prefix}.heap_used",
                description="Heap bytes used at last leak-assert sample",
                unit="bytes",
            )
            self._rss_gauge = meter.create_observable_gauge(
                f"{self.prefix}.rss",
                description="RSS bytes at last leak-assert sample",
                unit="bytes",
            )
            self._latest: "Sample | None" = None
            self._heap_gauge.set_callback(self._heap_callback)
            self._rss_gauge.set_callback(self._rss_callback)
            return meter
        except ImportError:
            return None

    def _record_otel(self, sample: "Sample") -> None:
        self._latest = sample  # type: ignore[attr-defined]

    def _heap_callback(self, options):  # type: ignore[override]
        if hasattr(self, "_latest") and self._latest:
            options.observe(
                self._latest.heap_used,
                {"service": self.service_name},
            )

    def _rss_callback(self, options):  # type: ignore[override]
        if hasattr(self, "_latest") and self._latest:
            options.observe(
                self._latest.rss,
                {"service": self.service_name},
            )

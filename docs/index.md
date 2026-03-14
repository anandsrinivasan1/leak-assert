---
layout: home
hero:
  name: leak-assert
  text: Memory leak regression testing
  tagline: Write assertions, not profiler reports. Catch slow leaks before they hit production.
  image:
    src: /logo.svg
    alt: leak-assert
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/leak-assert/leak-assert

features:
  - title: Assertion-first
    details: Write heap growth assertions directly in your test files. If the slope exceeds your threshold, the test fails — just like any other assertion.

  - title: Catches slow leaks
    details: Fits a growth curve over thousands of iterations. Detects 1MB/hour leaks that only appear after days of production traffic — caught in minutes in CI.

  - title: Any language
    details: Native SDKs for Node/TypeScript, Python, and Go. A single Rust analysis engine shared across all three via WASM, PyO3, and C FFI.

  - title: CLI + HTTP sidecar
    details: Run black-box tests against any HTTP service. Mount a one-line sidecar middleware and leak-assert watch polls heap metrics live.
---

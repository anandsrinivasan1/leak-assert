# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-03-14

### Added

#### Core (Rust)
- OLS slope computation via `leak-assert-core` crate
- `AnalysisResult` with `slope`, `delta`, `peak`, `passed` fields
- `Constraint` enum: `GrowthRate`, `Stable`, `Ceiling`
- C FFI bindings (`leak-assert-ffi`) for use from Go and other native languages
- Python PyO3 bindings (`leak-assert-py`) with `analyze` and `slope` exports
- WASM bindings (`leak-assert-wasm`) with `nodejs` and `web` targets, exporting `analyze_json` and `slope_json`

#### Node.js SDK (`@anandsrinivasan2/leak-assert`)
- `LeakTest` class with `run()`, `runAsync()`, `assert()`, `getSamples()`, `getReport()`
- Assertion options: `growthRate`, `stable`, `ceiling` (string `"1kb/iter"` or numeric)
- Heap snapshot diffing: `takeLightSnapshot()`, `takeDetailedSnapshot()`, `diffSnapshots()`, `assertNoDiff()`
- `HeapRetentionError` for snapshot assertion failures
- Reporters: `toHTML()`, `toJUnit()` (exported from `@anandsrinivasan2/leak-assert/reporters`)
- Browser/Deno WASM wrapper: `LeakAssert` class (exported from `@anandsrinivasan2/leak-assert/browser`)
- Utility functions: `kb()`, `mb()`, `gb()`

#### Python SDK (`leak-assert`)
- `LeakTest` context manager with `assert_growth_rate()`, `assert_stable()`, `assert_ceiling()`, `assert_no_retained()`
- `get_report()` returning a fully-populated `Report` object
- Reporters: `to_html()`, `to_junit()`
- Optional native extension via maturin/PyO3 for faster OLS
- pytest plugin: `@pytest.mark.leak_test(max="1kb/iter")` with `leak_test` fixture

#### Go SDK (`github.com/anandsrinivasan1/leak-assert/sdks/go`)
- `LeakTest` struct with `Run()`, `RunAsync()`, `Assert()`, `ForceGC()`
- Assertions: `GrowthRate()`, `Stable()`, `Ceiling()`, `NoRetainedTypes()`
- `AnalysisResult` with `Slope`, `Delta`, `Peak`, `HeapObjectsDelta`
- CGO FFI integration (`sdks/go/ffi`) calling the Rust core for OLS
- OpenTelemetry exporter (`exporters/otel`) via `RecordFunc` callback bridge

#### Jest plugin (`jest-leak-assert`)
- `leakTest()` helper wrapping `it()`/`test()` with leak assertions
- `LeakAssertReporter` writing HTML + JUnit reports per test

#### Vitest plugin (`vitest-leak-assert`)
- `leakTest()` helper with automatic HTML + JUnit report writing
- `leakAssertPlugin()` Vite plugin factory for configuring output directory
- `LeakAssertReporter` class with `onInit()` / `onFinished()` hooks

#### CI / CD
- GitHub Actions CI: lint, unit tests, CGO integration tests, WASM build
- GitHub Actions publish workflow: npm (SDK + plugins), PyPI (OIDC trusted publishing), Go module tag, GitHub Release

[0.1.0]: https://github.com/anandsrinivasan1/leak-assert/releases/tag/v0.1.0

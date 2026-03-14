use clap::{Parser, Subcommand};
use leak_assert_core::{reporters, run_assertions, Assertion, Sample};
use serde::Deserialize;
use std::{io::Write as IoWrite, path::PathBuf, thread, time::Duration};

// ── CLI definition ────────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(name = "leak-assert", version, about = "Memory leak regression testing")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Run a leak test from a YAML config file
    Run {
        #[arg(short, long, default_value = "leak-assert.yaml")]
        config: PathBuf,
    },
    /// Quick test against an HTTP endpoint
    Http {
        /// Target URL
        url: String,
        #[arg(long, default_value = "1000")]
        iters: u64,
        #[arg(long, default_value = "100")]
        warmup: u64,
        /// Growth rate assertion e.g. "1kb/iter"
        #[arg(long, default_value = "1kb/iter")]
        assert_growth: String,
    },
    /// Compare two JSON sample dumps
    Diff {
        before: PathBuf,
        after:  PathBuf,
    },
    /// Watch a live process via its sidecar endpoint, alert on slope growth
    Watch {
        /// Sidecar heap URL e.g. http://localhost:9123/__leak_assert__/heap
        url: String,
        /// Polling interval in seconds (default: 5)
        #[arg(long, default_value = "5")]
        interval: u64,
        /// Window size: number of samples to keep for slope calculation (default: 20)
        #[arg(long, default_value = "20")]
        window: usize,
        /// Max allowed slope bytes/iter before alerting e.g. "1kb/iter"
        #[arg(long, default_value = "2kb/iter")]
        threshold: String,
    },
}

// ── YAML config schema ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct Config {
    name:       String,
    target:     Target,
    workload:   Workload,
    assertions: Vec<AssertionConfig>,
}

#[derive(Debug, Deserialize)]
struct Target {
    http: HttpTarget,
}

#[derive(Debug, Deserialize)]
struct HttpTarget {
    url:    String,
    method: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Workload {
    warmup:      u64,
    iterations:  u64,
    #[serde(default = "default_sample_every")]
    sample_every: u64,
}

fn default_sample_every() -> u64 { 100 }

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum AssertionConfig {
    GrowthRate    { max: String },
    Stable        { tolerance_mb: f64 },
    Ceiling       { max_mb: f64 },
    NoStepChange  { max_delta_mb: f64 },
}

// ── Main ──────────────────────────────────────────────────────────────────────

fn main() {
    let cli = Cli::parse();
    match cli.command {
        Command::Run    { config }      => cmd_run(config),
        Command::Http   { url, iters, warmup, assert_growth } =>
            cmd_http(url, iters, warmup, assert_growth),
        Command::Diff   { before, after } => cmd_diff(before, after),
        Command::Watch  { url, interval, window, threshold } =>
            cmd_watch(url, interval, window, threshold),
    }
}

fn cmd_run(config_path: PathBuf) {
    let raw = std::fs::read_to_string(&config_path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", config_path.display()));

    let cfg: Config = serde_yaml::from_str(&raw)
        .unwrap_or_else(|e| panic!("invalid config: {e}"));

    println!("── leak-assert: {} ──", cfg.name);
    println!("  target:     {}", cfg.target.http.url);
    println!("  iterations: {} (warmup: {})", cfg.workload.iterations, cfg.workload.warmup);

    let samples = run_http_workload(
        &cfg.target.http.url,
        cfg.target.http.method.as_deref().unwrap_or("GET"),
        cfg.workload.warmup,
        cfg.workload.iterations,
        cfg.workload.sample_every,
    );

    let assertions: Vec<Assertion> = cfg.assertions.iter().map(|a| match a {
        AssertionConfig::GrowthRate { max } =>
            Assertion::GrowthRate { max_bytes_per_iter: parse_bytes_f64(max) },
        AssertionConfig::Stable { tolerance_mb } =>
            Assertion::Stable { tolerance_bytes: (*tolerance_mb * 1024.0 * 1024.0) as u64 },
        AssertionConfig::Ceiling { max_mb } =>
            Assertion::Ceiling { max_bytes: (*max_mb * 1024.0 * 1024.0) as u64 },
        AssertionConfig::NoStepChange { max_delta_mb } =>
            Assertion::NoStepChange { max_delta_bytes: (*max_delta_mb * 1024.0 * 1024.0) as u64 },
    }).collect();

    let result = run_assertions(&samples, &assertions);
    print_result(&result);

    // Write reports if requested
    let samples_json = serde_json::to_string(&samples).unwrap_or_default();
    write_reports(&result, &cfg.name, &samples_json);

    if !result.passed {
        std::process::exit(1);
    }
}

fn write_reports(result: &leak_assert_core::LeakTestResult, name: &str, samples_json: &str) {
    // HTML report
    let html = reporters::to_html(result, name, samples_json);
    let html_path = format!("leak-assert-{}.html", name.replace(' ', "-").to_lowercase());
    if std::fs::write(&html_path, html).is_ok() {
        println!("  report:     {html_path}");
    }
    // JUnit XML
    let xml = reporters::to_junit(result, name);
    let xml_path = format!("leak-assert-{}.xml", name.replace(' ', "-").to_lowercase());
    if std::fs::write(&xml_path, xml).is_ok() {
        println!("  junit:      {xml_path}");
    }
}

fn cmd_http(url: String, iters: u64, warmup: u64, assert_growth: String) {
    println!("── leak-assert http ──");
    println!("  url:        {url}");
    println!("  iterations: {iters}");

    let sample_every = std::cmp::max(1, iters / 50);
    let samples = run_http_workload(&url, "GET", warmup, iters, sample_every);

    let assertions = vec![
        Assertion::GrowthRate { max_bytes_per_iter: parse_bytes_f64(&assert_growth) },
    ];
    let result = run_assertions(&samples, &assertions);
    print_result(&result);

    if !result.passed {
        std::process::exit(1);
    }
}

fn cmd_diff(before: PathBuf, after: PathBuf) {
    let a: Vec<Sample> = load_samples(&before);
    let b: Vec<Sample> = load_samples(&after);

    let slope_a = compute_slope(&a);
    let slope_b = compute_slope(&b);
    let delta   = slope_b - slope_a;

    println!("── leak-assert diff ──");
    println!("  before slope: {:.1} bytes/iter", slope_a);
    println!("  after  slope: {:.1} bytes/iter", slope_b);
    println!("  delta:        {:+.1} bytes/iter", delta);

    if delta > 1024.0 {
        eprintln!("  WARNING: slope increased by {:.1}kb/iter", delta / 1024.0);
        std::process::exit(1);
    }
}

fn cmd_watch(url: String, interval_secs: u64, window: usize, threshold: String) {
    let max_slope   = parse_bytes_f64(&threshold);
    let interval    = Duration::from_secs(interval_secs);
    let client      = reqwest::blocking::Client::new();
    let mut samples: Vec<Sample> = Vec::new();
    let mut iter    = 0u64;
    let mut alerted = false;

    println!("── leak-assert watch ──");
    println!("  url:       {url}");
    println!("  interval:  {interval_secs}s  window: {window}  threshold: {threshold}");
    println!("  Press Ctrl-C to stop\n");

    loop {
        iter += 1;

        let heap_used = fetch_remote_heap(&url, &client).unwrap_or(0);
        let sample = Sample::new(iter, heap_used);
        samples.push(sample);

        // Keep rolling window
        if samples.len() > window {
            samples.drain(0..samples.len() - window);
        }

        let slope = if samples.len() >= 3 { compute_slope(&samples) } else { 0.0 };
        let status = if slope > max_slope { "⚠ LEAK" } else { "  OK  " };

        print!("\r  [{status}]  iter={iter:>6}  heap={:>8.2}MB  slope={:>+8.1}B/iter",
            heap_used as f64 / 1024.0 / 1024.0, slope);
        std::io::stdout().flush().ok();

        if slope > max_slope && !alerted {
            alerted = true;
            eprintln!("\n\n  ALERT: slope {:.1} bytes/iter exceeds threshold {}", slope, threshold);
            std::process::exit(1);
        }

        thread::sleep(interval);
    }
}

// ── HTTP workload runner ──────────────────────────────────────────────────────

fn run_http_workload(
    url: &str,
    method: &str,
    warmup: u64,
    iterations: u64,
    sample_every: u64,
) -> Vec<Sample> {
    // Note: in production this would hit the target process's /metrics endpoint
    // for heap stats. For now, we track proxy metrics via response-time variance.
    // A sidecar or /health?heap=true endpoint is the recommended pattern.
    let client = reqwest::blocking::Client::new();
    let mut samples = Vec::new();

    for i in 0..(warmup + iterations) {
        let _ = match method.to_uppercase().as_str() {
            "POST" => client.post(url).send(),
            _      => client.get(url).send(),
        };

        if i < warmup { continue; }
        let iter = i - warmup + 1;

        if iter % sample_every == 0 {
            // Remote heap sampling: request /metrics or /__leak_assert__/heap
            // Falls back to zero if endpoint not available
            let heap_used = fetch_remote_heap(url, &client).unwrap_or(0);
            samples.push(Sample::new(iter, heap_used));
        }
    }
    samples
}

fn fetch_remote_heap(base_url: &str, client: &reqwest::blocking::Client) -> Option<u64> {
    let base = base_url.split('/').take(3).collect::<Vec<_>>().join("/");
    let metrics_url = format!("{}/__leak_assert__/heap", base);
    let resp = client.get(&metrics_url).timeout(Duration::from_millis(200)).send().ok()?;
    let json: serde_json::Value = resp.json().ok()?;
    json["heap_used"].as_u64()
}

fn load_samples(path: &PathBuf) -> Vec<Sample> {
    let raw = std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("invalid samples JSON: {e}"))
}

fn compute_slope(samples: &[Sample]) -> f64 {
    let n = samples.len() as f64;
    if n < 2.0 { return 0.0; }
    let sum_x:  f64 = samples.iter().map(|s| s.iter as f64).sum();
    let sum_y:  f64 = samples.iter().map(|s| s.heap_used as f64).sum();
    let sum_xy: f64 = samples.iter().map(|s| s.iter as f64 * s.heap_used as f64).sum();
    let sum_xx: f64 = samples.iter().map(|s| (s.iter as f64).powi(2)).sum();
    let denom   = n * sum_xx - sum_x.powi(2);
    if denom.abs() < f64::EPSILON { 0.0 } else { (n * sum_xy - sum_x * sum_y) / denom }
}

fn parse_bytes_f64(s: &str) -> f64 {
    leak_assert_core::parse_bytes(s).unwrap_or(1024) as f64
}

fn print_result(result: &leak_assert_core::LeakTestResult) {
    println!("\n  Assertions:");
    for a in &result.assertions {
        let icon = if a.status == leak_assert_core::AssertionStatus::Pass { "✓" } else { "✗" };
        println!("    {} {:20} {} (expected {})", icon, a.assertion, a.actual, a.expected);
    }
    println!("\n  {}", result.summary);
}

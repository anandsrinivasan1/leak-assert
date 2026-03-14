use serde::{Deserialize, Serialize};

/// Language-agnostic memory sample — matches spec/envelope.schema.json
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Sample {
    /// Unix timestamp ms
    pub ts: u64,
    /// Iteration number
    pub iter: u64,
    /// Live heap bytes
    pub heap_used: u64,
    /// Committed heap bytes (optional)
    #[serde(default)]
    pub heap_total: u64,
    /// Resident set size bytes (optional)
    #[serde(default)]
    pub rss: u64,
    /// Off-heap / native bytes (optional)
    #[serde(default)]
    pub external: u64,
    /// GC cycles since test start (optional)
    #[serde(default)]
    pub gc_count: u64,
    /// Optional annotation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

impl Sample {
    pub fn new(iter: u64, heap_used: u64) -> Self {
        Self {
            ts: 0,
            iter,
            heap_used,
            heap_total: 0,
            rss: 0,
            external: 0,
            gc_count: 0,
            label: None,
        }
    }
}

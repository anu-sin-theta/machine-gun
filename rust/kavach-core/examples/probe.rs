use kavach_core::linkintel::*;
fn main() {
    let r = analyze(
        &LinkInput {
            url: std::env::args().nth(1).unwrap_or_default(),
            ..LinkInput::default()
        },
        &LinkIntelConfig::default(),
    );
    println!("score={} level={:?}", r.score, r.level);
    for s in r.signals {
        println!(
            "  {:?} {:?} {:?}: {}",
            s.severity, s.code, s.stage, s.detail
        );
    }
}

//! Link intelligence: static analysis of a payment link and its redirect
//! chain. Pure and deterministic. The caller does the network work (follow
//! redirects, look up domain age via RDAP) and passes the results in.
//!
//! Catches the tricks fake payment requests use: homoglyph / mixed-script
//! domains, brand names in subdomains or hyphenated hosts, one-character
//! lookalikes, `user@host` URLs, raw IPs, shorteners, risky TLDs, brand-new
//! domains and cross-domain or downgraded redirects.

use std::collections::BTreeSet;

use idna::domain_to_unicode;
use serde::{Deserialize, Serialize};
use strsim::damerau_levenshtein;
use unicode_security::{MixedScript, skeleton};
use url::{Host, Url};

use crate::policy::RiskLevel;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Brand {
    pub name: String,
    /// Lowercase tokens that identify the brand inside a host, e.g. `hdfcbank`.
    pub tokens: Vec<String>,
    /// Registrable domains the brand really owns, e.g. `hdfcbank.com`.
    pub domains: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkIntelConfig {
    pub brands: Vec<Brand>,
    /// Last label of the public suffix, e.g. `zip`, `top`.
    pub suspicious_tlds: Vec<String>,
    /// Registrable domains of URL shorteners.
    pub shorteners: Vec<String>,
}

impl Default for LinkIntelConfig {
    fn default() -> Self {
        let brand = |name: &str, tokens: &[&str], domains: &[&str]| Brand {
            name: name.into(),
            tokens: tokens.iter().map(|s| (*s).into()).collect(),
            domains: domains.iter().map(|s| (*s).into()).collect(),
        };
        let list = |items: &[&str]| items.iter().map(|s| (*s).to_string()).collect();
        Self {
            brands: vec![
                brand(
                    "SBI",
                    &["sbi", "onlinesbi", "sbicard"],
                    &["sbi.co.in", "onlinesbi.sbi", "sbicard.com"],
                ),
                brand("HDFC Bank", &["hdfcbank", "hdfc"], &["hdfcbank.com"]),
                brand("ICICI Bank", &["icicibank", "icici"], &["icicibank.com"]),
                brand("Axis Bank", &["axisbank"], &["axisbank.com"]),
                brand("Paytm", &["paytm"], &["paytm.com"]),
                brand("PhonePe", &["phonepe"], &["phonepe.com"]),
                brand("NPCI", &["npci"], &["npci.org.in"]),
                brand("IRCTC", &["irctc"], &["irctc.co.in"]),
                brand("UIDAI", &["uidai"], &["uidai.gov.in"]),
                brand("Income Tax India", &["incometax"], &["incometax.gov.in"]),
                brand("Jio", &["jio"], &["jio.com"]),
                brand("Airtel", &["airtel"], &["airtel.in"]),
                brand("Amazon", &["amazon"], &["amazon.in", "amazon.com"]),
                brand("Flipkart", &["flipkart"], &["flipkart.com"]),
                brand("PayPal", &["paypal"], &["paypal.com"]),
                brand("Google", &["google"], &["google.com"]),
                brand("Microsoft", &["microsoft"], &["microsoft.com"]),
                brand("Apple", &["apple"], &["apple.com"]),
            ],
            suspicious_tlds: list(&[
                "zip", "mov", "top", "xyz", "click", "support", "icu", "cfd", "sbs", "rest",
                "country", "gq", "tk", "ml", "cf", "ga", "work", "live", "loan",
            ]),
            shorteners: list(&[
                "bit.ly",
                "tinyurl.com",
                "t.co",
                "goo.gl",
                "is.gd",
                "cutt.ly",
                "rb.gy",
                "ow.ly",
                "shorturl.at",
                "tiny.cc",
            ]),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkInput {
    pub url: String,
    /// URLs of each redirect hop after `url`, in order. The last is the landing page.
    #[serde(default)]
    pub redirect_chain: Vec<String>,
    /// Registrable-domain age from RDAP, if known. Unknown is not a signal.
    #[serde(default)]
    pub domain_age_days: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Info,
    Low,
    Medium,
    High,
}

impl Severity {
    fn weight(self) -> u32 {
        match self {
            Severity::Info => 0,
            Severity::Low => 10,
            Severity::Medium => 25,
            Severity::High => 50,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SignalCode {
    InvalidUrl,
    NonHttpScheme,
    UserinfoInUrl,
    IpHost,
    InvalidPunycode,
    MixedScript,
    ConfusableBrand,
    BrandImpersonation,
    LookalikeBrand,
    NewDomain,
    RedirectDowngrade,
    RedirectCrossDomain,
    HttpNotHttps,
    UrlShortener,
    SuspiciousTld,
    NonstandardPort,
    NoRegistrableDomain,
    ExcessiveSubdomains,
    LongHost,
    ManyHyphens,
    LongRedirectChain,
    IdnDomain,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Stage {
    Entry,
    Landing,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Signal {
    pub code: SignalCode,
    pub severity: Severity,
    pub stage: Stage,
    pub detail: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkReport {
    /// Punycode host of the entry URL, if it parsed.
    pub host: Option<String>,
    /// Same host in Unicode, as a user would see it.
    pub unicode_host: Option<String>,
    pub registrable_domain: Option<String>,
    pub landing_host: Option<String>,
    /// 0..=100, the capped sum of signal weights.
    pub score: u8,
    pub level: RiskLevel,
    pub signals: Vec<Signal>,
}

struct HostInfo {
    ascii: String,
    unicode: String,
    registrable: Option<String>,
    suffix: Option<String>,
    is_ip: bool,
    punycode_ok: bool,
}

pub fn analyze(input: &LinkInput, cfg: &LinkIntelConfig) -> LinkReport {
    let mut signals: Vec<Signal> = Vec::new();
    let mut push = |code, severity, stage, detail: String| {
        signals.push(Signal {
            code,
            severity,
            stage,
            detail,
        });
    };

    let entry = parse_http(&input.url, Stage::Entry, &mut push);
    let entry_host = entry.as_ref().and_then(host_info);

    if let Some(url) = &entry {
        url_signals(url, Stage::Entry, &mut push);
    }
    if let Some(h) = &entry_host {
        host_signals(h, cfg, Stage::Entry, &mut push);
    }

    if let (Some(days), Some(h)) = (input.domain_age_days, &entry_host)
        && !h.is_ip
    {
        let (severity, text) = match days {
            0..=6 => (Some(Severity::High), "registered less than a week ago"),
            7..=29 => (Some(Severity::Medium), "registered less than a month ago"),
            30..=89 => (Some(Severity::Low), "registered less than three months ago"),
            _ => (None, ""),
        };
        if let Some(severity) = severity {
            push(
                SignalCode::NewDomain,
                severity,
                Stage::Entry,
                format!("domain {text} ({days} days)"),
            );
        }
    }

    let landing = redirect_signals(input, entry.as_ref(), cfg, &mut push);
    let landing_host = landing.as_ref().and_then(host_info);

    signals.sort_by(|a, b| {
        b.severity
            .cmp(&a.severity)
            .then(a.code.cmp(&b.code))
            .then(a.stage.cmp(&b.stage))
            .then_with(|| a.detail.cmp(&b.detail))
    });
    signals.dedup();

    let raw: u32 = signals.iter().map(|s| s.severity.weight()).sum();
    let score = u8::try_from(raw.min(100)).unwrap_or(100);
    let any_high = signals.iter().any(|s| s.severity == Severity::High);
    let level = if any_high || score >= 50 {
        RiskLevel::High
    } else if score >= 20 {
        RiskLevel::Medium
    } else {
        RiskLevel::Low
    };

    LinkReport {
        host: entry_host.as_ref().map(|h| h.ascii.clone()),
        unicode_host: entry_host.as_ref().map(|h| h.unicode.clone()),
        registrable_domain: entry_host.as_ref().and_then(|h| h.registrable.clone()),
        landing_host: landing_host.map(|h| h.ascii),
        score,
        level,
        signals,
    }
}

type Push<'a> = dyn FnMut(SignalCode, Severity, Stage, String) + 'a;

fn parse_http(raw: &str, stage: Stage, push: &mut Push<'_>) -> Option<Url> {
    let url = match Url::parse(raw.trim()) {
        Ok(u) => u,
        Err(e) => {
            push(
                SignalCode::InvalidUrl,
                Severity::High,
                stage,
                format!("unparseable URL: {e}"),
            );
            return None;
        }
    };
    if url.scheme() != "http" && url.scheme() != "https" {
        push(
            SignalCode::NonHttpScheme,
            Severity::High,
            stage,
            format!("scheme {:?} is not http(s)", url.scheme()),
        );
        return None;
    }
    if url.host().is_none() {
        push(
            SignalCode::InvalidUrl,
            Severity::High,
            stage,
            "URL has no host".into(),
        );
        return None;
    }
    Some(url)
}

fn url_signals(url: &Url, stage: Stage, push: &mut Push<'_>) {
    if !url.username().is_empty() || url.password().is_some() {
        push(
            SignalCode::UserinfoInUrl,
            Severity::High,
            stage,
            "URL contains user@ credentials, which can disguise the real host".into(),
        );
    }
    if url.scheme() == "http" {
        push(
            SignalCode::HttpNotHttps,
            Severity::Medium,
            stage,
            "link is not encrypted (http)".into(),
        );
    }
    if let Some(port) = url.port() {
        push(
            SignalCode::NonstandardPort,
            Severity::Low,
            stage,
            format!("non-standard port {port}"),
        );
    }
}

fn host_info(url: &Url) -> Option<HostInfo> {
    match url.host()? {
        Host::Domain(domain) => {
            let (unicode, result) = domain_to_unicode(domain);
            let registrable = psl::domain_str(domain).map(str::to_string);
            let suffix = psl::suffix_str(domain).map(str::to_string);
            Some(HostInfo {
                ascii: domain.to_string(),
                unicode,
                registrable,
                suffix,
                is_ip: false,
                punycode_ok: result.is_ok(),
            })
        }
        Host::Ipv4(_) | Host::Ipv6(_) => {
            let text = url.host_str()?.to_string();
            Some(HostInfo {
                ascii: text.clone(),
                unicode: text,
                registrable: None,
                suffix: None,
                is_ip: true,
                punycode_ok: true,
            })
        }
    }
}

fn tokens(s: &str) -> Vec<String> {
    s.split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(str::to_lowercase)
        .collect()
}

/// Undo common character swaps: `paypa1` -> `paypal`, `rnicrosoft` -> `microsoft`.
fn deleet_variants(s: &str) -> Vec<String> {
    let map = |one_as: char| -> String {
        let mut out = String::with_capacity(s.len());
        for c in s.chars() {
            out.push(match c {
                '0' => 'o',
                '1' => one_as,
                '3' => 'e',
                '4' => 'a',
                '5' => 's',
                '7' => 't',
                '@' => 'a',
                '$' => 's',
                other => other,
            });
        }
        out.replace("rn", "m").replace("vv", "w")
    };
    vec![map('l'), map('i')]
}

fn registrable_label(h: &HostInfo) -> Option<String> {
    let reg = h.registrable.as_deref()?;
    let suffix = h.suffix.as_deref().unwrap_or("");
    let label = reg
        .strip_suffix(suffix)
        .unwrap_or(reg)
        .trim_end_matches('.');
    let (unicode, _) = domain_to_unicode(label);
    Some(unicode)
}

fn host_signals(h: &HostInfo, cfg: &LinkIntelConfig, stage: Stage, push: &mut Push<'_>) {
    if h.is_ip {
        push(
            SignalCode::IpHost,
            Severity::High,
            stage,
            format!("link points at a raw IP address ({})", h.ascii),
        );
        return;
    }

    if !h.punycode_ok {
        push(
            SignalCode::InvalidPunycode,
            Severity::High,
            stage,
            "host has invalid punycode".into(),
        );
    }
    for label in h.unicode.split('.') {
        if !label.is_single_script() {
            push(
                SignalCode::MixedScript,
                Severity::High,
                stage,
                format!("label {label:?} mixes scripts, a homoglyph trick"),
            );
        }
    }

    let Some(registrable) = h.registrable.as_deref() else {
        push(
            SignalCode::NoRegistrableDomain,
            Severity::Low,
            stage,
            "host has no registrable domain".into(),
        );
        return;
    };

    if !h.unicode.is_ascii() {
        push(
            SignalCode::IdnDomain,
            Severity::Low,
            stage,
            format!("internationalised domain, displays as {:?}", h.unicode),
        );
    }
    if h.ascii.len() > 60 {
        push(
            SignalCode::LongHost,
            Severity::Low,
            stage,
            format!("host is {} chars long", h.ascii.len()),
        );
    }
    if h.ascii.split('.').count() > 5 {
        push(
            SignalCode::ExcessiveSubdomains,
            Severity::Low,
            stage,
            "host has many subdomain levels".into(),
        );
    }
    if let Some(tld) = h.suffix.as_deref().and_then(|s| s.rsplit('.').next())
        && cfg.suspicious_tlds.iter().any(|t| t == tld)
    {
        push(
            SignalCode::SuspiciousTld,
            Severity::Low,
            stage,
            format!("TLD .{tld} is common in abuse"),
        );
    }
    if cfg.shorteners.iter().any(|s| s == registrable) {
        push(
            SignalCode::UrlShortener,
            Severity::Medium,
            stage,
            format!("{registrable} is a URL shortener, so the real destination is hidden"),
        );
    }

    let label = registrable_label(h).unwrap_or_default();
    let label_tokens = tokens(&label);
    if label.matches('-').count() >= 3 {
        push(
            SignalCode::ManyHyphens,
            Severity::Low,
            stage,
            "domain name has many hyphens".into(),
        );
    }

    let host_tokens = tokens(&h.unicode);
    // Tokens of the host without its public suffix ("com", "co.in", ...).
    let suffix_unicode = h
        .suffix
        .as_deref()
        .map(|s| domain_to_unicode(s).0)
        .unwrap_or_default();
    let host_candidates = tokens(
        h.unicode
            .strip_suffix(suffix_unicode.as_str())
            .unwrap_or(&h.unicode)
            .trim_end_matches('.'),
    );
    let mut flagged: BTreeSet<(SignalCode, String)> = BTreeSet::new();
    // A host on any brand's real domain is that brand's own, subdomains included
    // (npi.sbi.co.in is SBI's), so it is never an imitation of another brand.
    let on_official_domain = cfg
        .brands
        .iter()
        .any(|b| b.domains.iter().any(|d| d == registrable));
    for brand in &cfg.brands {
        if on_official_domain {
            continue;
        }
        for bt in &brand.tokens {
            let bt = bt.to_lowercase();
            if bt.is_empty() {
                continue;
            }

            // Brand name used inside someone else's host, e.g. paypal.com.evil.xyz.
            let hit = host_tokens
                .iter()
                .any(|t| *t == bt || (bt.chars().count() >= 6 && t.contains(&bt)));
            if hit && flagged.insert((SignalCode::BrandImpersonation, brand.name.clone())) {
                push(
                    SignalCode::BrandImpersonation,
                    Severity::High,
                    stage,
                    format!(
                        "host uses the {} name but is not a {} domain",
                        brand.name, brand.name
                    ),
                );
            }

            // Lookalikes anywhere in the host, subdomains included, so that
            // paypa1.com.evil.top is caught as well as paypa1.com.
            let bt_len = bt.chars().count();
            let joined: String = label_tokens.concat();
            let edit_hit = |t: &String| {
                let max = if bt_len >= 9 { 2 } else { 1 };
                (1..=max).contains(&damerau_levenshtein(t, &bt))
            };
            // A one-letter edit of a long brand (hdfcbamk) is a strong signal. For
            // 4-5 letter brands it also matches ordinary words (apply/apple), so
            // it only earns a medium signal.
            let near_strong = bt_len >= 6 && host_candidates.iter().any(edit_hit);
            let near_weak = (4..=5).contains(&bt_len) && host_candidates.iter().any(edit_hit);
            let swapped = host_candidates
                .iter()
                .any(|t| *t != bt && deleet_variants(t).contains(&bt));
            let split = !label_tokens.contains(&bt) && joined == bt;
            let lookalike = if near_strong || swapped || split {
                Some(Severity::High)
            } else if near_weak {
                Some(Severity::Medium)
            } else {
                None
            };
            if let Some(severity) = lookalike
                && flagged.insert((SignalCode::LookalikeBrand, brand.name.clone()))
            {
                push(
                    SignalCode::LookalikeBrand,
                    severity,
                    stage,
                    format!("host {:?} imitates {}", h.unicode, brand.name),
                );
            }

            // Homoglyphs: different characters, same look.
            let bt_skel: String = skeleton(&bt).collect();
            let confusable = host_candidates
                .iter()
                .any(|t| *t != bt && skeleton(t).collect::<String>() == bt_skel);
            if confusable && flagged.insert((SignalCode::ConfusableBrand, brand.name.clone())) {
                push(
                    SignalCode::ConfusableBrand,
                    Severity::High,
                    stage,
                    format!(
                        "host {:?} is visually confusable with {}",
                        h.unicode, brand.name
                    ),
                );
            }
        }
    }
}

/// Analyses the redirect chain and returns the landing URL (the last hop).
fn redirect_signals(
    input: &LinkInput,
    entry: Option<&Url>,
    cfg: &LinkIntelConfig,
    push: &mut Push<'_>,
) -> Option<Url> {
    if input.redirect_chain.is_empty() {
        return None;
    }
    if input.redirect_chain.len() > 3 {
        push(
            SignalCode::LongRedirectChain,
            Severity::Low,
            Stage::Landing,
            format!("{} redirects before landing", input.redirect_chain.len()),
        );
    }

    let mut prev = entry.cloned();
    let mut cross_domain_reported = false;
    let mut landing = None;
    for hop in &input.redirect_chain {
        let Some(next) = parse_http(hop, Stage::Landing, push) else {
            prev = None;
            landing = None;
            continue;
        };
        if let Some(p) = &prev {
            if p.scheme() == "https" && next.scheme() == "http" {
                push(
                    SignalCode::RedirectDowngrade,
                    Severity::High,
                    Stage::Landing,
                    "redirect downgrades from https to http".into(),
                );
            }
            let a = host_info(p).and_then(|h| h.registrable);
            let b = host_info(&next).and_then(|h| h.registrable);
            if a != b && !cross_domain_reported {
                cross_domain_reported = true;
                push(
                    SignalCode::RedirectCrossDomain,
                    Severity::Medium,
                    Stage::Landing,
                    format!(
                        "redirects from {} to {}",
                        a.as_deref().unwrap_or("?"),
                        b.as_deref().unwrap_or("?")
                    ),
                );
            }
        }
        prev = Some(next.clone());
        landing = Some(next);
    }

    if let Some(l) = &landing {
        url_signals(l, Stage::Landing, push);
        if let Some(h) = host_info(l) {
            host_signals(&h, cfg, Stage::Landing, push);
        }
    }
    landing
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(url: &str) -> LinkReport {
        analyze(
            &LinkInput {
                url: url.into(),
                ..LinkInput::default()
            },
            &LinkIntelConfig::default(),
        )
    }

    fn codes(r: &LinkReport) -> Vec<SignalCode> {
        r.signals.iter().map(|s| s.code).collect()
    }

    #[test]
    fn legitimate_brand_domains_are_clean() {
        for url in [
            "https://www.hdfcbank.com/personal/pay",
            "https://netbanking.hdfcbank.com/login",
            "https://www.google.com/search?q=x",
            "https://www.irctc.co.in/nget/train-search",
            "https://onlinesbi.sbi/",
            "https://example.com/bill/123",
        ] {
            let r = run(url);
            assert_eq!(r.level, RiskLevel::Low, "{url}: {:?}", r.signals);
            assert!(r.signals.is_empty(), "{url}: {:?}", r.signals);
            assert_eq!(r.score, 0);
        }
    }

    #[test]
    fn a_subdomain_of_one_brands_real_domain_is_never_an_imitation_of_another() {
        // Found by the property test: "npi" is one letter from NPCI, but the host is SBI's.
        for url in [
            "https://npi.sbi.co.in/",
            "https://paypa1.sbi.co.in/login",
            "https://hdfcbamk.paypal.com/",
        ] {
            let r = run(url);
            assert!(r.signals.is_empty(), "{url}: {:?}", r.signals);
            assert_eq!(r.level, RiskLevel::Low, "{url}");
        }
        // The same labels on a domain nobody official owns are still caught.
        for url in [
            "https://npi.evil-bank.top/",
            "https://paypa1.sbi-secure.top/",
        ] {
            let r = run(url);
            assert!(
                codes(&r).contains(&SignalCode::LookalikeBrand)
                    || codes(&r).contains(&SignalCode::BrandImpersonation),
                "{url}: {:?}",
                r.signals
            );
        }
    }

    #[test]
    fn brand_in_subdomain_or_hyphenated_host_is_impersonation() {
        for url in [
            "https://paypal.com.account-verify.xyz/login",
            "https://sbi-secure-login.top/pay",
            "https://hdfcbank.verify-now.co/",
            "https://hdfcbanklogin.in/",
        ] {
            let r = run(url);
            assert!(
                codes(&r).contains(&SignalCode::BrandImpersonation),
                "{url}: {:?}",
                r.signals
            );
            assert_eq!(r.level, RiskLevel::High, "{url}");
        }
    }

    #[test]
    fn one_character_lookalikes_are_caught() {
        for (url, brand) in [
            ("https://hdfcbamk.com/", "HDFC"),
            ("https://paypa1.com/", "PayPal"),
            ("https://rnicrosoft.com/", "Microsoft"),
            ("https://hdfc-bank.com/", "HDFC"),
            ("https://amazom.in/", "Amazon"),
        ] {
            let r = run(url);
            assert!(
                codes(&r).contains(&SignalCode::LookalikeBrand),
                "{url} ({brand}): {:?}",
                r.signals
            );
            assert_eq!(r.level, RiskLevel::High);
        }

        // Paytm has a 5-letter token, so a pure one-letter edit is only medium
        // (see short_brand_edit_distance_is_only_medium_to_limit_false_positives).
        let r = run("https://paytn.com/");
        assert_eq!(codes(&r), vec![SignalCode::LookalikeBrand]);
        assert_eq!(r.level, RiskLevel::Medium);
    }

    #[test]
    fn lookalike_in_a_subdomain_is_caught() {
        for url in [
            "https://paypa1.com.account-verify.top/",
            "https://hdfcbamk.secure-pay.co/",
            "https://login.rnicrosoft.com.evil.io/",
        ] {
            let r = run(url);
            assert!(
                codes(&r).contains(&SignalCode::LookalikeBrand),
                "{url}: {:?}",
                r.signals
            );
            assert_eq!(r.level, RiskLevel::High, "{url}");
        }
    }

    #[test]
    fn short_brand_edit_distance_is_only_medium_to_limit_false_positives() {
        // "apply" is one edit from "apple" but is an ordinary word.
        let r = run("https://apply.example.com/");
        assert_eq!(codes(&r), vec![SignalCode::LookalikeBrand]);
        assert_eq!(r.level, RiskLevel::Medium);
        assert_eq!(r.score, 25);
        // Swaps and long-brand edits stay high.
        assert_eq!(run("https://paypa1.com/").level, RiskLevel::High);
        assert_eq!(run("https://hdfcbamk.com/").level, RiskLevel::High);
    }

    #[test]
    fn cyrillic_homoglyph_domain_is_flagged() {
        // "аррӏе" uses Cyrillic а, р, р, ӏ, е: looks like "apple".
        let r = run("https://аррӏе.com/");
        assert_eq!(r.level, RiskLevel::High, "{:?}", r.signals);
        assert!(r.host.as_deref().is_some_and(|h| h.starts_with("xn--")));
        assert!(
            codes(&r).contains(&SignalCode::ConfusableBrand)
                || codes(&r).contains(&SignalCode::MixedScript),
            "{:?}",
            r.signals
        );
        assert_eq!(r.unicode_host.as_deref(), Some("аррӏе.com"));
    }

    #[test]
    fn mixed_script_label_is_flagged() {
        // Latin "paypal" with a Cyrillic "а".
        let r = run("https://pаypal.com/");
        assert!(
            codes(&r).contains(&SignalCode::MixedScript),
            "{:?}",
            r.signals
        );
        assert_eq!(r.level, RiskLevel::High);
    }

    #[test]
    fn plain_idn_is_only_low_risk() {
        let r = run("https://bücher.de/");
        assert_eq!(codes(&r), vec![SignalCode::IdnDomain]);
        assert_eq!(r.level, RiskLevel::Low);
    }

    #[test]
    fn userinfo_trick_ip_hosts_and_bad_schemes() {
        let r = run("https://paypal.com@evil.example/login");
        assert!(codes(&r).contains(&SignalCode::UserinfoInUrl));
        assert_eq!(r.level, RiskLevel::High);

        for url in [
            "http://192.168.1.5/pay",
            "https://[2001:db8::1]/pay",
            "http://3232235777/pay",
        ] {
            let r = run(url);
            assert!(
                codes(&r).contains(&SignalCode::IpHost),
                "{url}: {:?}",
                r.signals
            );
            assert_eq!(r.level, RiskLevel::High);
        }

        for url in [
            "javascript:alert(1)",
            "data:text/html,hi",
            "upi://pay?pa=a@b",
            "ftp://example.com/",
        ] {
            let r = run(url);
            assert!(
                codes(&r).contains(&SignalCode::NonHttpScheme),
                "{url}: {:?}",
                r.signals
            );
            assert_eq!(r.level, RiskLevel::High);
        }
    }

    #[test]
    fn unparseable_input_is_high_risk_not_a_panic() {
        for url in ["", "not a url", "https://", "http://exa mple.com", "://x"] {
            let r = run(url);
            assert_eq!(r.level, RiskLevel::High, "{url:?}");
            assert_eq!(r.score, 50);
            assert!(r.host.is_none());
        }
    }

    #[test]
    fn shorteners_http_ports_and_risky_tlds_add_moderate_risk() {
        let r = run("https://bit.ly/3abc");
        assert_eq!(codes(&r), vec![SignalCode::UrlShortener]);
        assert_eq!(r.level, RiskLevel::Medium);

        let r = run("http://example.com/pay");
        assert_eq!(codes(&r), vec![SignalCode::HttpNotHttps]);
        assert_eq!(r.level, RiskLevel::Medium);

        let r = run("https://example.com:8443/pay");
        assert_eq!(codes(&r), vec![SignalCode::NonstandardPort]);
        assert_eq!(r.level, RiskLevel::Low);

        let r = run("https://my-bill.top/");
        assert_eq!(codes(&r), vec![SignalCode::SuspiciousTld]);
    }

    #[test]
    fn domain_age_bands() {
        let age = |days| {
            analyze(
                &LinkInput {
                    url: "https://example.com/".into(),
                    domain_age_days: Some(days),
                    ..LinkInput::default()
                },
                &LinkIntelConfig::default(),
            )
        };
        assert_eq!(age(3).level, RiskLevel::High);
        assert_eq!(age(6).level, RiskLevel::High);
        assert_eq!(age(7).level, RiskLevel::Medium);
        assert_eq!(age(29).level, RiskLevel::Medium);
        assert_eq!(age(30).level, RiskLevel::Low);
        assert_eq!(age(89).signals.len(), 1);
        assert!(age(90).signals.is_empty());
        // Unknown age is not a signal.
        assert!(run("https://example.com/").signals.is_empty());
    }

    #[test]
    fn redirect_chains() {
        let go = |chain: &[&str], url: &str| {
            analyze(
                &LinkInput {
                    url: url.into(),
                    redirect_chain: chain.iter().map(|s| (*s).into()).collect(),
                    ..LinkInput::default()
                },
                &LinkIntelConfig::default(),
            )
        };

        // Shortener -> a fake brand domain: flagged at the landing stage.
        let r = go(&["https://hdfc-login.top/pay"], "https://bit.ly/x");
        assert!(
            r.signals
                .iter()
                .any(|s| s.code == SignalCode::RedirectCrossDomain)
        );
        assert!(
            r.signals
                .iter()
                .any(|s| s.code == SignalCode::BrandImpersonation && s.stage == Stage::Landing)
        );
        assert_eq!(r.level, RiskLevel::High);
        assert_eq!(r.landing_host.as_deref(), Some("hdfc-login.top"));

        // https -> http downgrade.
        let r = go(&["http://example.com/b"], "https://example.com/a");
        assert!(
            r.signals
                .iter()
                .any(|s| s.code == SignalCode::RedirectDowngrade)
        );
        assert_eq!(r.level, RiskLevel::High);

        // Same-domain redirects are fine.
        let r = go(
            &[
                "https://www.hdfcbank.com/b",
                "https://netbanking.hdfcbank.com/c",
            ],
            "https://hdfcbank.com/a",
        );
        assert!(r.signals.is_empty(), "{:?}", r.signals);

        // Long chain.
        let r = go(
            &[
                "https://a.example.com/1",
                "https://a.example.com/2",
                "https://a.example.com/3",
                "https://a.example.com/4",
            ],
            "https://a.example.com/0",
        );
        assert_eq!(codes(&r), vec![SignalCode::LongRedirectChain]);

        // A hop that isn't http(s) is high risk.
        let r = go(&["javascript:alert(1)"], "https://example.com/");
        assert!(
            r.signals
                .iter()
                .any(|s| s.code == SignalCode::NonHttpScheme && s.stage == Stage::Landing)
        );
    }

    #[test]
    fn score_is_capped_and_report_is_sorted_and_deduplicated() {
        let r = run("http://user@paypa1.com.account-verify.top:8080/login");
        assert!(
            codes(&r).contains(&SignalCode::LookalikeBrand),
            "{:?}",
            r.signals
        );
        // userinfo 50 + lookalike 50 + http 25 + tld 10 + port 10 = 145, capped.
        assert_eq!(r.score, 100);
        let severities: Vec<_> = r.signals.iter().map(|s| s.severity).collect();
        let mut sorted = severities.clone();
        sorted.sort_by(|a, b| b.cmp(a));
        assert_eq!(
            severities, sorted,
            "signals must be ordered most severe first"
        );
        let mut unique = r.signals.clone();
        unique.dedup();
        assert_eq!(unique.len(), r.signals.len());
    }

    #[test]
    fn analysis_is_deterministic() {
        let input = LinkInput {
            url: "https://sbi-secure-login.top/".into(),
            redirect_chain: vec!["https://hdfcbamk.com/".into()],
            domain_age_days: Some(2),
        };
        let cfg = LinkIntelConfig::default();
        assert_eq!(analyze(&input, &cfg), analyze(&input, &cfg));
    }

    #[test]
    fn json_shape() {
        let json = serde_json::to_value(run("https://bit.ly/x")).unwrap_or_default();
        assert_eq!(json.pointer("/level"), Some(&serde_json::json!("medium")));
        assert_eq!(
            json.pointer("/signals/0/code"),
            Some(&serde_json::json!("URL_SHORTENER"))
        );
        assert_eq!(
            json.pointer("/signals/0/stage"),
            Some(&serde_json::json!("entry"))
        );
        assert_eq!(
            json.pointer("/registrableDomain"),
            Some(&serde_json::json!("bit.ly"))
        );

        let input: LinkInput = serde_json::from_str(
            r#"{"url":"https://x.com","redirectChain":["https://y.com"],"domainAgeDays":5}"#,
        )
        .unwrap_or_default();
        assert_eq!(input.domain_age_days, Some(5));
        let minimal: LinkInput =
            serde_json::from_str(r#"{"url":"https://x.com"}"#).unwrap_or_default();
        assert!(minimal.redirect_chain.is_empty());
    }
}

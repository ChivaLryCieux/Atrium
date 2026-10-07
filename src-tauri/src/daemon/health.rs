pub enum HealthOutcome {
    Ready,
    KernelMissing(String),
    Unreachable,
}

pub async fn probe_health(http: &reqwest::Client, port: u16) -> HealthOutcome {
    let url = format!("http://127.0.0.1:{port}/healthz");
    let probe = async {
        let resp = http.get(&url).send().await.ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let body: serde_json::Value = resp.json().await.ok()?;
        let kernel = body.get("kernel").and_then(|v| v.as_str())?.to_string();
        let detail = body
            .get("detail")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        Some((kernel, detail))
    };
    match tokio::time::timeout(std::time::Duration::from_millis(1200), probe).await {
        Ok(Some((kernel, _detail))) if kernel == "ready" => HealthOutcome::Ready,
        Ok(Some((kernel, detail))) => HealthOutcome::KernelMissing(format!("{kernel}: {detail}")),
        _ => HealthOutcome::Unreachable,
    }
}

pub async fn wait_for_health(http: &reqwest::Client, port: u16, seconds: u64) -> HealthOutcome {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(seconds);
    loop {
        match probe_health(http, port).await {
            HealthOutcome::Ready => return HealthOutcome::Ready,
            HealthOutcome::KernelMissing(detail)
                if detail.starts_with("missing") || detail.starts_with("error") =>
            {
                return HealthOutcome::KernelMissing(detail)
            }
            _ => {}
        }
        if tokio::time::Instant::now() >= deadline {
            return HealthOutcome::Unreachable;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
}

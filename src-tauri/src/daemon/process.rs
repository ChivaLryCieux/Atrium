use std::io::{BufRead, BufReader, Write};

pub fn log_stream(tag: &str, stream: impl std::io::Read + Send + 'static) {
    let reader = BufReader::new(stream);
    for line in reader.lines().map_while(Result::ok) {
        eprintln!("[{tag}] {line}");
    }
}

pub fn debug_log(line: &str) {
    let path = std::env::temp_dir().join("atrium_daemon_debug.log");
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{line}");
    }
}

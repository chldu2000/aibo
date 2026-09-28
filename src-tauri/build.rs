fn main() {
    use sha2::{Digest, Sha256};
    use std::{env, fs, path::Path};
    let root = Path::new("resources/node-runtime");
    println!("cargo:rerun-if-changed=resources/node-runtime");
    println!("cargo:rerun-if-changed=../scripts/node-runtime.json");
    let prepared: serde_json::Value = serde_json::from_slice(&fs::read(root.join("runtime.json"))
        .expect("Run pnpm prepare:node before building Aibo or running Rust tests")).unwrap();
    let lock: serde_json::Value = serde_json::from_slice(&fs::read("../scripts/node-runtime.json").unwrap()).unwrap();
    let os = env::var("CARGO_CFG_TARGET_OS").unwrap();
    let arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap();
    let target = format!("{}-{}", match os.as_str() { "macos" => "darwin", "windows" => "win", "linux" => "linux", _ => panic!("Unsupported Node platform") },
        match arch.as_str() { "aarch64" => "arm64", "x86_64" => "x64", _ => panic!("Unsupported Node architecture") });
    assert_ne!(env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default(), "musl", "Bundled Node requires glibc on Linux");
    assert_eq!(prepared["target"], target, "Prepare Node for the Rust target with AIBO_NODE_TARGET");
    assert_eq!(prepared["version"], lock["version"]);
    assert_eq!(prepared["archiveSha256"], lock["targets"][&target]["sha256"]);
    for (file, key) in [(if os == "windows" { "node.exe" } else { "node" }, "binarySha256"), ("LICENSE", "licenseSha256")] {
        assert_eq!(prepared[key], format!("{:x}", Sha256::digest(fs::read(root.join(file)).unwrap())), "Prepared Node is damaged; run pnpm prepare:node");
    }
    if os == "macos" {
        // Tauri copies resources into target/<profile>. Replacing a previously
        // executed Mach-O in place can retain a stale macOS code-signature cache
        // and kill Node with SIGKILL. Give the copied executable a fresh inode.
        let out = std::path::PathBuf::from(env::var_os("OUT_DIR").unwrap());
        let copied_node = out.ancestors().nth(3).unwrap().join("node-runtime/node");
        match fs::remove_file(copied_node) {
            Ok(()) => (),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => panic!("Could not replace bundled Node resource: {error}"),
        }
    }
    tauri_build::build();
}

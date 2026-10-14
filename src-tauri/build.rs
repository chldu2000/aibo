fn main() {
    println!("cargo:rerun-if-changed=../dist/assets");
    let resources: Vec<String> = std::fs::read_dir("../dist/assets").into_iter().flatten().filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().to_str().filter(|name| name.ends_with(".js")).map(|name| format!("assets/{name}"))).collect();
    std::fs::write(std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("diagnostic-resources.json"), serde_json::to_vec(&resources).unwrap()).unwrap();
    println!("cargo:rerun-if-changed=../scripts/node-runtime.json");
    tauri_build::build();
}

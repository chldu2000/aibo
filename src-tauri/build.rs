fn main() {
    println!("cargo:rerun-if-changed=../scripts/node-runtime.json");
    tauri_build::build();
}

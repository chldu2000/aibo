fn main() {
    if std::env::var_os("CARGO_FEATURE_PRESENTATION_DOM_P0").is_some() {
        println!("cargo:rerun-if-changed=p0-permissions");
        tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().permissions_path_pattern("p0-permissions/*.toml"),
        ))
        .expect("P0 ACL build");
    } else {
        tauri_build::build();
    }
}

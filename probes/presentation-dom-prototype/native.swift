// THROWAWAY P0: WKWebView experiment; no Aibo database, Tauri commands or real sends.
import AppKit
import WebKit
import ApplicationServices

let mode = CommandLine.arguments[1]
let htmlPath = CommandLine.arguments[2]
let outputPath = CommandLine.arguments[3]

final class Probe: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    var window: NSWindow!
    var host: WKWebView!
    var plugin: WKWebView?
    var pluginGeneration = 0
    var timer: Timer?
    var stage = 0
    var busy = false
    var lastReply = Date()
    var started = Date()
    var faultAt: Date?
    var faultBeats = 0
    var loopObserved = false
    var reports: [[String: Any]] = []
    var finished = false
    var blockedNavigations = 0
    var nativeConfirmations = 0

    func webview(_ frame: NSRect) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.add(self, name: "p0")
        let view = WKWebView(frame: frame, configuration: config)
        view.navigationDelegate = self
        return view
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 80, y: 80, width: 1100, height: 850), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = "Aibo P0 isolated experiment — \(mode)"
        host = webview(NSRect(x: 0, y: mode == "webview" ? 330 : 0, width: 1100, height: mode == "webview" ? 520 : 850))
        window.contentView!.addSubview(host)
        host.loadHTMLString(try! String(contentsOfFile: htmlPath, encoding: .utf8), baseURL: nil)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.tick() }
    }

    func script(_ code: String) { host.evaluateJavaScript(code, completionHandler: nil) }
    func json(_ object: Any) -> String { String(data: try! JSONSerialization.data(withJSONObject: object, options: [.fragmentsAllowed]), encoding: .utf8)! }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        // WK handlers can also be exposed to subframes; WebView identity alone is insufficient.
        guard message.frameInfo.isMainFrame else { return }
        guard let packet = message.body as? [String: Any], let type = packet["type"] as? String else { return }
        if message.webView === host {
            if type == "mount", let html = packet["html"] as? String, let generation = packet["generation"] as? Int {
                releasePlugin()
                pluginGeneration = generation
                let view = webview(NSRect(x: 0, y: 0, width: 1100, height: 320))
                plugin = view
                window.contentView!.addSubview(view)
                view.loadHTMLString(html, baseURL: nil)
            } else if type == "deliver", let data = packet["data"], packet["generation"] as? Int == pluginGeneration {
                plugin?.evaluateJavaScript("window.p0Receive(\(json(data)))", completionHandler: nil)
            } else if type == "dispose" { releasePlugin() }
        } else if message.webView === plugin {
            if type == "loop-starting" { loopObserved = true }
            // Source ownership comes from WKWebView identity, never plugin-supplied generation.
            script("window.p0.receive(\(json(packet)), \(pluginGeneration))")
        }
    }

    func releasePlugin() {
        plugin?.configuration.userContentController.removeScriptMessageHandler(forName: "p0")
        plugin?.stopLoading()
        plugin?.removeFromSuperview()
        plugin = nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.request.url?.absoluteString == "about:blank" || (mode == "iframe" && action.request.url?.absoluteString == "about:srcdoc") { decisionHandler(.allow) }
        else { blockedNavigations += 1; decisionHandler(.cancel) }
    }

    func tick() {
        if finished { return }
        if Date().timeIntervalSince(started) > 35 { finish(["completed": false, "error": "overall timeout", "stage": stage]); return }
        if let faultAt, Date().timeIntervalSince(faultAt) > 4 && Date().timeIntervalSince(lastReply) > 3 {
            finish(["completed": true, "hostResponsiveDuringLoop": false, "recoveryVerified": false, "verdict": "container fails host availability gate"])
            return
        }
        if busy { return }
        busy = true
        host.evaluateJavaScript("window.p0 ? JSON.stringify(window.p0.stats()) : null") { [weak self] result, error in
            guard let self else { return }
            self.busy = false; self.lastReply = Date()
            guard let string = result as? String, let data = string.data(using: .utf8), let stats = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
            self.advance(stats)
        }
    }

    func advance(_ stats: [String: Any]) {
        switch stage {
        case 0:
            stage = 1; script("p0.mount('react')")
        case 1:
            if stats["active"] as? Bool == true {
                reports.append(["step": "react mounted", "stats": stats]); stage = 2
                script("p0.edit('native shared draft')")
            }
        case 2:
            if stats["draft"] as? String == "native shared draft" { stage = 3; script("p0.attack()") }
        case 3:
            if stats["pending"] is [String: Any], (stats["rejected"] as? Int ?? 0) >= 2 {
                guard stats["executed"] as? Int == 0 else { finish(["completed": false, "error": "forged action executed"]); return }
                reports.append(["step": "forged request did not execute", "stats": stats]); stage = 4
                print("P0_CONFIRM \(getpid())"); fflush(stdout)
            }
        case 4:
            if stats["executed"] as? Int == 1 { nativeConfirmations += 1; stage = 5; script("p0.mount('svelte')") }
        case 5:
            if stats["active"] as? Bool == true, stats["framework"] as? String == "svelte" {
                guard stats["draft"] as? String == "native shared draft" else { finish(["completed": false, "error": "draft lost"]); return }
                reports.append(["step": "Svelte retained draft after React", "stats": stats]); stage = 6
                faultAt = Date(); faultBeats = stats["beats"] as? Int ?? 0; script("p0.attack();p0.fault()")
            }
        case 6:
            if let time = faultAt, Date().timeIntervalSince(time) > 2 {
                guard (stats["beats"] as? Int ?? 0) > faultBeats + 5 else { return }
                // For iframe mode the marker is forwarded through the host before the loop starts.
                let observed = loopObserved || ((stats["log"] as? [String])?.contains("插件即将进入死循环") ?? false)
                guard observed else { finish(["completed": false, "error": "fault did not start"]); return }
                guard stats["pending"] is [String: Any] else { finish(["completed": false, "error": "no pending confirmation during loop"]); return }
                reports.append(["step": "host responsive during DOM loop", "stats": stats]); stage = 7
                print("P0_CONFIRM \(getpid())"); fflush(stdout)
            }
        case 7:
            if stats["executed"] as? Int == 2 {
                nativeConfirmations += 1
                reports.append(["step": "trusted native accessibility input confirmed while plugin loops", "stats": stats])
                stage = 8; script("p0.dispose();p0.mount('react')")
            }
        case 8:
            if stats["active"] as? Bool == true, stats["framework"] as? String == "react" {
                reports.append(["step": "replacement mounted after fault", "stats": stats])
                finish(["completed": true, "hostResponsiveDuringLoop": true, "recoveryVerified": true,
                        "verdict": "WKWebView and native accessibility input experiment passed; Tauri integration remains unverified"])
            }
        default: break
        }
    }

    func finish(_ value: [String: Any]) {
        guard !finished else { return }; finished = true; timer?.invalidate()
        var result = value
        result["mode"] = mode; result["platform"] = ProcessInfo.processInfo.operatingSystemVersionString
        result["axTrusted"] = AXIsProcessTrusted(); result["physicalInputVerified"] = false
        result["nativeAccessibilityConfirmations"] = nativeConfirmations
        result["scope"] = "Standalone WKWebView; scripted setup and AXPress host input; mock side effects; no real Aibo/Tauri IPC or hardware input"
        result["blockedNavigations"] = blockedNavigations; result["evidence"] = reports
        let bytes = try! JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
        try! bytes.write(to: URL(fileURLWithPath: outputPath))
        print(String(data: bytes, encoding: .utf8)!)
        fflush(stdout)
        // Exit the isolated probe process, including stalled content; never address other applications.
        exit(0)
    }
}

let app = NSApplication.shared
let delegate = Probe()
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()

import AppKit
import ApplicationServices

// Only this experiment's explicit PID and window title are considered.
let pid = pid_t(CommandLine.arguments[1])!
let target = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "宿主确认"
guard AXIsProcessTrusted() else { print("Accessibility permission unavailable"); exit(2) }
let app = AXUIElementCreateApplication(pid)
func value(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
    var result: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, key as CFString, &result) == .success ? result : nil
}
func descendants(_ element: AXUIElement, _ depth: Int = 0) -> [AXUIElement] {
    if depth > 18 { return [] }
    return [element] + ((value(element, kAXChildrenAttribute) as? [AXUIElement]) ?? []).flatMap { descendants($0, depth + 1) }
}
let deadline = Date().addingTimeInterval(10)
while Date() < deadline {
    for window in (value(app, kAXWindowsAttribute) as? [AXUIElement]) ?? [] {
        guard (value(window, kAXTitleAttribute) as? String)?.hasPrefix("Aibo") == true else { continue }
        for element in descendants(window) {
            let label = [kAXTitleAttribute, kAXDescriptionAttribute].compactMap { value(element, $0) as? String }
            if value(element, kAXRoleAttribute) as? String == kAXButtonRole && label.contains(target) {
                if AXUIElementPerformAction(element, kAXPressAction as CFString) == .success { print("P0 native AXPress completed"); exit(0) }
            }
        }
    }
    Thread.sleep(forTimeInterval: 0.1)
}
print("P0 host confirmation button unavailable"); exit(1)

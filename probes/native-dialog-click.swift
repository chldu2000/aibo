import AppKit
import ApplicationServices
import Foundation

// Only touch the isolated process supplied by the probe, never a frontmost app.
func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8)); exit(1)
}
let pid = pid_t(CommandLine.arguments[1])!
let marker = CommandLine.arguments[2]
let decision = CommandLine.arguments[3]
guard AXIsProcessTrusted() else { fail("Accessibility automation is unavailable") }
let app = AXUIElementCreateApplication(pid)
NSRunningApplication(processIdentifier: pid)?.activate(options: [.activateIgnoringOtherApps])
func value(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
    var result: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, key as CFString, &result) == .success ? result : nil
}
func descendants(_ element: AXUIElement, _ depth: Int = 0) -> [AXUIElement] {
    if depth > 12 { return [] }
    let children = value(element, kAXChildrenAttribute) as? [AXUIElement] ?? []
    return [element] + children.flatMap { descendants($0, depth + 1) }
}
var lastTexts: [String] = []
let deadline = Date().addingTimeInterval(30)
while Date() < deadline {
    lastTexts = []
    let windows = value(app, kAXWindowsAttribute) as? [AXUIElement] ?? []
    var roots = windows
    for key in [kAXFocusedWindowAttribute, kAXMainWindowAttribute] {
        if let element = value(app, key), CFGetTypeID(element) == AXUIElementGetTypeID() { roots.append(unsafeBitCast(element, to: AXUIElement.self)) }
    }
    for window in roots {
        let elements = descendants(window)
        let texts = elements.flatMap { element in [kAXTitleAttribute, kAXValueAttribute, kAXDescriptionAttribute, kAXRoleAttribute, kAXSubroleAttribute].compactMap { value(element, $0) as? String } }
        lastTexts += texts
        guard texts.contains(where: { $0.contains(marker) }), texts.contains(where: { $0.contains("确认插件操作") }) else { continue }
        if let button = elements.first(where: { (value($0, kAXRoleAttribute) as? String) == kAXButtonRole && (value($0, kAXTitleAttribute) as? String) == decision }) {
            guard AXUIElementPerformAction(button, kAXPressAction as CFString) == .success else { fail("Native dialog click failed") }
            print("clicked isolated dialog: \(decision)")
            exit(0)
        }
    }
    Thread.sleep(forTimeInterval: 0.1)
}
fail("Expected isolated native dialog was not found: \(lastTexts)")

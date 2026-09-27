import AppKit
import ApplicationServices
import Foundation

// Real input for an isolated probe process only: system mouse/keyboard events, which WebKit
// treats as trusted user input, and AXPress, which is how assistive technology activates controls.
// Usage: native-input <pid> click <viewportX> <viewportY> <viewportWidth> <viewportHeight> | key <ArrowDown|ArrowUp|Enter|Escape|Tab> | axpress <name>
func fail(_ message: String) -> Never { FileHandle.standardError.write(Data((message + "\n").utf8)); exit(1) }
let arguments = CommandLine.arguments
guard arguments.count >= 3, let pid = pid_t(arguments[1]) else { fail("Expected <pid> <action>") }
guard AXIsProcessTrusted() else { fail("Accessibility automation is unavailable") }
let app = AXUIElementCreateApplication(pid)
guard let running = NSRunningApplication(processIdentifier: pid) else { fail("Isolated process not found") }
// macOS 14+ ignores forced activation; the accessibility frontmost attribute still brings the probe forward.
running.activate()
AXUIElementSetAttributeValue(app, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
// WebKit builds its accessibility tree for web content only when a client asks for it.
AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
Thread.sleep(forTimeInterval: 0.15)

func value(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
    var result: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, key as CFString, &result) == .success ? result : nil
}
func descendants(_ element: AXUIElement, _ depth: Int = 0) -> [AXUIElement] {
    if depth > 60 { return [] }
    return [element] + ((value(element, kAXChildrenAttribute) as? [AXUIElement]) ?? []).flatMap { descendants($0, depth + 1) }
}
func point(_ element: AXUIElement, _ key: String) -> CGPoint? {
    guard let raw = value(element, key), CFGetTypeID(raw) == AXValueGetTypeID() else { return nil }
    var result = CGPoint.zero
    return AXValueGetValue(raw as! AXValue, .cgPoint, &result) ? result : nil
}
func size(_ element: AXUIElement) -> CGSize? {
    guard let raw = value(element, kAXSizeAttribute), CFGetTypeID(raw) == AXValueGetTypeID() else { return nil }
    var result = CGSize.zero
    return AXValueGetValue(raw as! AXValue, .cgSize, &result) ? result : nil
}
func window() -> AXUIElement {
    for key in [kAXFocusedWindowAttribute, kAXMainWindowAttribute] {
        if let element = value(app, key), CFGetTypeID(element) == AXUIElementGetTypeID() { return unsafeBitCast(element, to: AXUIElement.self) }
    }
    if let first = (value(app, kAXWindowsAttribute) as? [AXUIElement])?.first { return first }
    fail("Isolated window not found")
}
/// The top-level web area is the largest one; nested frames are smaller web areas inside it.
/// Without an exposed web area, the viewport is the bottom-right `viewport` sized region of the window.
func viewportOrigin(_ viewport: CGSize) -> CGPoint {
    let win = window()
    for _ in 0..<10 {
        let areas = descendants(win).filter { (value($0, kAXRoleAttribute) as? String) == "AXWebArea" }
        if let top = areas.max(by: { (size($0)?.width ?? 0) * (size($0)?.height ?? 0) < (size($1)?.width ?? 0) * (size($1)?.height ?? 0) }),
           let origin = point(top, kAXPositionAttribute) { return origin }
        Thread.sleep(forTimeInterval: 0.2)
    }
    guard let origin = point(win, kAXPositionAttribute), let frame = size(win) else { fail("Web content area not found") }
    return CGPoint(x: origin.x + frame.width - viewport.width, y: origin.y + frame.height - viewport.height)
}
func post(_ event: CGEvent?) { event?.post(tap: .cghidEventTap); Thread.sleep(forTimeInterval: 0.04) }

switch arguments[2] {
case "click":
    guard arguments.count == 7, let x = Double(arguments[3]), let y = Double(arguments[4]),
          let width = Double(arguments[5]), let height = Double(arguments[6]) else { fail("click needs viewport x y width height") }
    let origin = viewportOrigin(CGSize(width: width, height: height))
    let target = CGPoint(x: origin.x + x, y: origin.y + y)
    post(CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: target, mouseButton: .left))
    post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: target, mouseButton: .left))
    post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: target, mouseButton: .left))
    print("clicked \(Int(target.x)),\(Int(target.y))")
case "key":
    let codes: [String: CGKeyCode] = ["ArrowDown": 125, "ArrowUp": 126, "Enter": 36, "Escape": 53, "Tab": 48]
    guard arguments.count == 4, let code = codes[arguments[3]] else { fail("Unknown key") }
    post(CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true))
    post(CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false))
    print("pressed \(arguments[3])")
case "axpress":
    guard arguments.count == 4 else { fail("axpress needs a name") }
    let name = arguments[3]
    let deadline = Date().addingTimeInterval(10)
    while Date() < deadline {
        let buttons = descendants(window()).filter { (value($0, kAXRoleAttribute) as? String) == kAXButtonRole }
        if let button = buttons.first(where: { element in [kAXDescriptionAttribute, kAXTitleAttribute].contains { (value(element, $0) as? String) == name } }) {
            guard AXUIElementPerformAction(button, kAXPressAction as CFString) == .success else { fail("AXPress failed") }
            print("axpressed \(name)")
            exit(0)
        }
        Thread.sleep(forTimeInterval: 0.2)
    }
    fail("No accessible button named \(name)")
default:
    fail("Unknown action \(arguments[2])")
}

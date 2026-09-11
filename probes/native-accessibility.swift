import AppKit
import ApplicationServices
import Foundation
func fail(_ message: String) -> Never { FileHandle.standardError.write(Data((message + "\n").utf8)); exit(1) }
guard (2...3).contains(CommandLine.arguments.count), let number = Int32(CommandLine.arguments[1]), AXIsProcessTrusted() else { fail("Expected isolated PID and Accessibility permission") }
let app = AXUIElementCreateApplication(number)
NSRunningApplication(processIdentifier: number)?.activate(options: [.activateIgnoringOtherApps])
AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
func value(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
 var result: CFTypeRef?
 return AXUIElementCopyAttributeValue(element, key as CFString, &result) == .success ? result : nil
}
var count = 0
var truncated = false
func descendants(_ element: AXUIElement, _ depth: Int = 0) -> [AXUIElement] {
 count += 1
 if depth > 60 || count > 12000 { truncated = true; return [] }
 return [element] + ((value(element, kAXChildrenAttribute) as? [AXUIElement]) ?? []).flatMap { descendants($0, depth + 1) }
}
let deadline = Date().addingTimeInterval(20)
while Date() < deadline {
 count = 0; truncated = false
 let elements = descendants(app)
 let buttons = elements.filter { (value($0, kAXRoleAttribute) as? String) == kAXButtonRole }
 let names = buttons.map { element in [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute].compactMap { value(element, $0) as? String }.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } }
 if names.contains(where: { $0.contains("恢复默认呈现") }) {
  let systemRoles: Set<String> = ["AXCloseButton", "AXMinimizeButton", "AXZoomButton", "AXFullScreenButton"]
  var systemControls: [String] = []
  var unnamed = 0
  for (index, button) in buttons.enumerated() where names[index].isEmpty {
   let subrole = value(button, kAXSubroleAttribute) as? String ?? ""
   let description = value(button, kAXRoleDescriptionAttribute) as? String ?? ""
   var actions: CFArray?
   let pressable = AXUIElementCopyActionNames(button, &actions) == .success && ((actions as? [String]) ?? []).contains(kAXPressAction)
   if systemRoles.contains(subrole) && !description.isEmpty && pressable { systemControls.append(subrole) }
   else { unnamed += 1 }
  }
  guard unnamed == 0 else { fail("Native accessibility tree contains \(unnamed) unnamed application buttons") }
  guard !truncated else { fail("Native accessibility traversal exceeded bounds") }
  let pressRecovery = CommandLine.arguments.count == 3 && CommandLine.arguments[2] == "restore"
  if pressRecovery {
   guard let index = names.firstIndex(where: { $0.contains("恢复默认呈现") }), AXUIElementPerformAction(buttons[index], kAXPressAction as CFString) == .success else { fail("Native recovery action failed") }
  }
  let output: [String: Any] = ["nativeButtons": buttons.count, "unnamedButtons": unnamed, "hostRecovery": true, "nativeRecoveryPressed":pressRecovery, "inspectedNodes":count, "systemControlsWithRoleDescription":systemControls]
  print(String(data: try! JSONSerialization.data(withJSONObject:output,options:.sortedKeys),encoding:.utf8)!)
  exit(0)
 }
 Thread.sleep(forTimeInterval:0.1)
}
fail("Isolated accessibility tree did not expose host recovery")

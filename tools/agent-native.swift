// Exact-process native accessibility surface. No synthesized input, selector dispatch,
// or web-content traversal. Observed native actions may change application focus.
import AppKit
import ApplicationServices
import CryptoKit
struct Failure: Error { let message: String }
func attribute(_ element: AXUIElement, _ name: String) -> Any? {
 var value: CFTypeRef?; guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }; return value
}
func actions(_ element: AXUIElement) -> [String] {
 var value: CFArray?; guard AXUIElementCopyActionNames(element, &value) == .success else { return [] }; return value as? [String] ?? []
}
func identity(_ element: AXUIElement) -> [String:String] {
 var result: [String:String] = [:]
 for key in [kAXRoleAttribute, kAXSubroleAttribute, kAXIdentifierAttribute, kAXTitleAttribute, kAXDescriptionAttribute] { if let value = attribute(element,key) as? String { result[key]=value } }
 return result
}
func run() throws -> [String:Any] {
 let args = Array(CommandLine.arguments.dropFirst()); guard args.count >= 3, let pid = Int32(args[0]) else { throw Failure(message:"usage: PID AGENT snapshot|press|set|perform [PATH FINGERPRINT VALUE_OR_ACTION]") }
 let slug=args[1]; guard slug.range(of:"^[a-z][a-z0-9]*(-[a-z0-9]+)*$", options:.regularExpression) != nil, slug.count<=32 else { throw Failure(message:"invalid agent slug") }
 let bundle="company.thebrowser.Browser.mod.agent.\(slug)"
 guard let app=NSRunningApplication(processIdentifier:pid), app.bundleIdentifier==bundle, app.executableURL?.path.hasSuffix("/ArcModAgent-\(slug).app/Contents/MacOS/Arc")==true else { throw Failure(message:"wrong_agent: exact agent PID/bundle/executable required") }
 guard AXIsProcessTrusted() else { throw Failure(message:"accessibility_unavailable: native AX access is not granted to this execution context; no permission prompt was requested") }
 let root=AXUIElementCreateApplication(pid); AXUIElementSetMessagingTimeout(root,2)
 var nodes:[[String:Any]]=[]; var elements:[String:AXUIElement]=[:]; var fingerprints:[String:String]=[:]; var seen:[CFHashCode:[AXUIElement]]=[:]; var truncated=false
 func visit(_ e:AXUIElement,_ path:String,_ depth:Int) {
  if nodes.count>=1000 || depth>25 { truncated=true;return }
  let hash=CFHash(e)
  // CFHash is not an element identity: compare equality within each hash bucket.
  if seen[hash]?.contains(where:{CFEqual($0,e)}) == true { return }
  seen[hash,default:[]].append(e)
  let info=identity(e);let role=info[kAXRoleAttribute] ?? "";let supported=actions(e)
  // Native labels are kept intact; friendly names fill only adapter output.
  let known:[String:String]=["commandBarTextField":"Address or search", "commandBarSuggestions":"Address suggestions", "sidebarAllTabList":"Sidebar tabs", "sidebarToggleButton":"Toggle sidebar", "sidebarPlusButton":"New tab or space", "closeModal":"Close dialog", "confirmCloseModal":"Close dialog", "contentPanelTextField":"Page address", "ArcModBadge":"ArcMod session"]
  let nativeLabel=[info[kAXTitleAttribute] ?? "", info[kAXDescriptionAttribute] ?? "", attribute(e,kAXHelpAttribute) as? String ?? ""].first(where:{ !$0.isEmpty }) ?? ""
  let identifier=info[kAXIdentifierAttribute] ?? "";let subrole=info[kAXSubroleAttribute] ?? ""
  let label=nativeLabel.isEmpty ? known[identifier] ?? (["AXCloseButton":"Close window", "AXMinimizeButton":"Minimize window", "AXFullScreenButton":"Full screen"][subrole]) ?? identifier : nativeLabel
  var node:[String:Any]=["path":path,"role":role,"subrole":subrole,"label":label,"identifier":identifier,"actions":supported,"enabled":attribute(e,kAXEnabledAttribute) as? Bool ?? true,"unlabeledInteractive":label.isEmpty && supported.contains(kAXPressAction) && (attribute(e,kAXEnabledAttribute) as? Bool ?? true)]
  var settable:DarwinBoolean=false; let valueSettable=AXUIElementIsAttributeSettable(e,kAXValueAttribute as CFString,&settable) == .success && settable.boolValue
  node["valueSettable"]=valueSettable
  if info[kAXSubroleAttribute] != kAXSecureTextFieldSubrole, let value=attribute(e,kAXValueAttribute) { if let text=value as? String { node["value"]=String(text.prefix(4000)) } else if let value=value as? NSNumber { node["value"]=value } }
  let encoded=(try? JSONSerialization.data(withJSONObject:node,options:[.sortedKeys])) ?? Data(); let fingerprint=SHA256.hash(data:encoded).map{String(format:"%02x",$0)}.joined();node["fingerprint"]=fingerprint
  nodes.append(node);elements[path]=e;fingerprints[path]=fingerprint
  if role == "AXWebArea" { return }
  let children=attribute(e,kAXChildrenAttribute) as? [AXUIElement] ?? []
  for (i,child) in children.enumerated(){visit(child,path+".\(i)",depth+1)}
 }
 visit(root,"0",0)
 // Menu tracking can replace AXChildren with only the active menu and menu bar.
 // AXWindows still exposes this exact agent's windows; retain PID-bound window actions.
 let windows=attribute(root,kAXWindowsAttribute) as? [AXUIElement] ?? []
 for (i,window) in windows.enumerated(){visit(window,"0.windows.\(i)",1)}
 let before=NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1
 if args[2] != "snapshot" {
  guard args.count>=5, let element=elements[args[3]], fingerprints[args[3]]==args[4] else { throw Failure(message:"stale_native_element: obtain fresh native_state") }
  let result:AXError
  if args[2]=="press" { guard actions(element).contains(kAXPressAction) else { throw Failure(message:"unsupported_action: element does not advertise AXPress") }; result=AXUIElementPerformAction(element,kAXPressAction as CFString) }
  else if args[2]=="set",args.count==6 { var allowed:DarwinBoolean=false;guard AXUIElementIsAttributeSettable(element,kAXValueAttribute as CFString,&allowed) == .success && allowed.boolValue else { throw Failure(message:"not_settable: element value is read-only") };result=AXUIElementSetAttributeValue(element,kAXValueAttribute as CFString,args[5] as CFString) }
  else if args[2]=="perform",args.count==6 {
   let name=args[5]
   guard actions(element).contains(name) else { throw Failure(message:"unsupported_action: element does not advertise requested action") }
   guard (attribute(element,kAXEnabledAttribute) as? Bool ?? true) else { throw Failure(message:"element_disabled: obtain fresh native_state") }
   result=AXUIElementPerformAction(element,name as CFString)
  }
  else { throw Failure(message:"unsupported native action") }
  guard result == .success else { throw Failure(message:"native_action_failed: AX error \(result.rawValue)") }
  return ["pid":pid,"bundle":bundle,"action":args[2],"dispatched":true,"foregroundBefore":before,"foregroundAfter":NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1]
 }
 guard NSRunningApplication(processIdentifier:pid)?.bundleIdentifier==bundle else { throw Failure(message:"agent_stopped") }
 return ["pid":pid,"bundle":bundle,"elements":nodes,"truncated":truncated,"webContentExcluded":true,"reportedWindowCount":windows.count,"reportedWindowRoles":windows.map{attribute($0,kAXRoleAttribute) as? String ?? "unavailable"},"observedWindowCount":nodes.filter{$0["role"] as? String == "AXWindow"}.count,"applicationHidden":app.isHidden,"applicationActive":app.isActive,"foregroundBefore":before,"foregroundAfter":NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1]
}
do { let data=try JSONSerialization.data(withJSONObject:try run(),options:[.sortedKeys]);FileHandle.standardOutput.write(data);FileHandle.standardOutput.write(Data([10])) }
catch { let message=(error as? Failure)?.message ?? String(describing:error);FileHandle.standardError.write(Data((message+"\n").utf8));exit(1) }

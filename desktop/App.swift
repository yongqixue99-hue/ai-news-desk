import AppKit
import WebKit
class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
 var window: NSWindow!
 var web: WKWebView!
 func applicationDidFinishLaunching(_ notification: Notification) {
  let menu = NSMenu(); let appItem = NSMenuItem(); menu.addItem(appItem)
  let appMenu=NSMenu(); appMenu.addItem(withTitle:"退出 AI 新闻台",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q"); appItem.submenu=appMenu
  let editItem=NSMenuItem(); menu.addItem(editItem); let edit=NSMenu(title:"编辑"); editItem.submenu=edit
  for (title,selector,key) in [("撤销","undo:","z"),("剪切","cut:","x"),("复制","copy:","c"),("粘贴","paste:","v"),("全选","selectAll:","a")] {edit.addItem(withTitle:title,action:Selector(selector),keyEquivalent:key)}
  NSApp.mainMenu=menu
  window=NSWindow(contentRect:NSRect(x:0,y:0,width:1320,height:880),styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false)
  window.title="AI 新闻台"; window.center()
  web=WKWebView(); web.navigationDelegate=self;web.uiDelegate=self;window.contentView=web
  web.loadHTMLString("<body style='font:22px system-ui;padding:60px'>正在启动 AI 新闻台…<p style='font-size:15px'>首次准备可能需要几分钟。已有稿件会保留。</p></body>",baseURL:nil)
  window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)
  DispatchQueue.global().async {
   do {
    let config=Bundle.main.url(forResource:"project",withExtension:"txt")!
    let root=try String(contentsOf:config,encoding:.utf8).trimmingCharacters(in:.whitespacesAndNewlines)
    let process=Process();process.executableURL=URL(fileURLWithPath:"/bin/zsh")
    process.arguments=[root+"/scripts/launch-mac.sh","--no-open"]
    let pipe=Pipe();process.standardOutput=pipe;process.standardError=pipe
    try process.run();let output=pipe.fileHandleForReading.readDataToEndOfFile();process.waitUntilExit()
    DispatchQueue.main.async {
     if process.terminationStatus==0 {self.web.load(URLRequest(url:URL(string:"http://127.0.0.1:4317")!))}
     else {self.fail(String(data:output,encoding:.utf8) ?? "启动失败")}
    }
   } catch {DispatchQueue.main.async{self.fail(error.localizedDescription)}}
  }
 }
 func webView(_ webView:WKWebView,runOpenPanelWith parameters:WKOpenPanelParameters,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping([URL]?)->Void){
  let panel=NSOpenPanel();panel.allowsMultipleSelection=parameters.allowsMultipleSelection;panel.canChooseDirectories=parameters.allowsDirectories
  panel.beginSheetModal(for:window){result in completionHandler(result == .OK ? panel.urls : nil)}
 }
 func webView(_ webView:WKWebView,decidePolicyFor response:WKNavigationResponse,decisionHandler:@escaping(WKNavigationResponsePolicy)->Void){
  let attachment=(response.response as? HTTPURLResponse)?.value(forHTTPHeaderField:"Content-Disposition")?.lowercased().contains("attachment") ?? false
  decisionHandler(attachment || !response.canShowMIMEType ? .download : .allow)
 }
 func webView(_ webView:WKWebView,navigationAction:WKNavigationAction,didBecome download:WKDownload){download.delegate=self}
 func webView(_ webView:WKWebView,navigationResponse:WKNavigationResponse,didBecome download:WKDownload){download.delegate=self}
 func download(_ download:WKDownload,decideDestinationUsing response:URLResponse,suggestedFilename:String,completionHandler:@escaping(URL?)->Void){
  let panel=NSSavePanel();panel.nameFieldStringValue=suggestedFilename
  panel.beginSheetModal(for:window){result in completionHandler(result == .OK ? panel.url : nil)}
 }
 func webView(_ webView:WKWebView,runJavaScriptAlertPanelWithMessage message:String,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping()->Void){let alert=NSAlert();alert.messageText=message;alert.beginSheetModal(for:window){_ in completionHandler()}}
 func webView(_ webView:WKWebView,runJavaScriptConfirmPanelWithMessage message:String,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping(Bool)->Void){let alert=NSAlert();alert.messageText=message;alert.addButton(withTitle:"确定");alert.addButton(withTitle:"取消");alert.beginSheetModal(for:window){result in completionHandler(result == .alertFirstButtonReturn)}}
 func fail(_ message:String){let alert=NSAlert();alert.messageText="AI 新闻台启动失败";alert.informativeText=message;alert.runModal();NSApp.terminate(nil)}
 func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool{return true}
 func webView(_ webView:WKWebView,decidePolicyFor action:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void){
  guard let url=action.request.url else {decisionHandler(.cancel);return}
  let local = url.scheme=="http" && url.host=="127.0.0.1" && url.port==4317
  let localBlob = url.absoluteString.hasPrefix("blob:http://127.0.0.1:4317/")
  if action.shouldPerformDownload && (local || localBlob){decisionHandler(.download)}
  else if url.scheme=="about" || local || localBlob {decisionHandler(.allow)}
  else {if ["https","http"].contains(url.scheme ?? ""){NSWorkspace.shared.open(url)};decisionHandler(.cancel)}
 }
 func webView(_ webView:WKWebView,createWebViewWith configuration:WKWebViewConfiguration,for action:WKNavigationAction,windowFeatures:WKWindowFeatures)->WKWebView?{if let url=action.request.url, ["https","http"].contains(url.scheme ?? ""){NSWorkspace.shared.open(url)};return nil}
}
let app=NSApplication.shared;let delegate=AppDelegate();app.delegate=delegate;app.setActivationPolicy(.regular);app.run()

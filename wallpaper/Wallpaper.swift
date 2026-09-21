// The aquarium as a desktop wallpaper.
//
// One borderless window per screen sits at the desktop window level: above the still
// wallpaper picture, below the desktop icons, so files and folders stay on top of the
// water and keep working normally. The scene comes from a web view fed by the copy of
// the aquarium inside this app bundle, served over a private scheme so its module
// imports resolve the way they do from a web server.
//
// The window never takes mouse events. The pointer reaches the fish another way: the
// global cursor position is read on a timer and handed to the page as a pointer move,
// so clicking and dragging on the desktop still belongs to the Finder.

import Cocoa
import WebKit
import IOKit.ps

let sceneScheme = "desktop-habitats"
let sceneHost = "local"
let scenePage = "/scenes/riverscape/wallpaper.html"

/// Serves the bundled copy of the aquarium to the web view.
final class SceneHandler: NSObject, WKURLSchemeHandler {
  private let root: URL
  private static let types = [
    "html": "text/html",
    "js": "text/javascript",
    "css": "text/css",
    "json": "application/json",
    "jpg": "image/jpeg",
    "png": "image/png",
  ]

  init(root: URL) { self.root = root.standardizedFileURL }

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url else { return }
    let path = url.path == "" || url.path == "/" ? scenePage : url.path
    let file = root.appendingPathComponent(path).standardizedFileURL
    guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
      task.didFailWithError(
        NSError(domain: NSURLErrorDomain, code: NSURLErrorFileDoesNotExist))
      return
    }
    let type = Self.types[file.pathExtension.lowercased()] ?? "application/octet-stream"
    task.didReceive(
      URLResponse(
        url: url, mimeType: type, expectedContentLength: data.count, textEncodingName: nil))
    task.didReceive(data)
    task.didFinish()
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

/// Puts whatever the page complains about into the agent's log.
final class Reporter: NSObject, WKScriptMessageHandler {
  static let shared = Reporter()
  func userContentController(
    _ controller: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    NSLog("desktop-habitats page: \(message.body)")
  }
}

/// A Swift string as a full JavaScript string literal (JSON state and ids travel through
/// these injection points, so the escaping must be correct no matter the content). JSON's
/// own encoding is the only escaping that provably covers every character — backslashes,
/// double quotes, \n, \t, \r and CRLF, which a hand-rolled escape list can silently miss. A
/// malformed save that carries raw control characters must still be injected correctly, not
/// drop the whole document-start script. The two JSON line separators (U+2028/U+2029) are
/// then escaped explicitly as well, so the literal is safe inside XHTML/<script> on every
/// JS engine, historical or modern.
func jsStringLiteral(_ s: String) -> String {
  guard let data = try? JSONEncoder().encode(s), let literal = String(data: data, encoding: .utf8)
  else { return "\"\"" }
  return literal
    .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
    .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
}

/// Keeps every display's population outside the app bundle, so a reinstall or update —
/// which rebuilds the bundle from scratch (see install.sh) — never resets a tank. A brand
/// is a stable id per display, remembered across runs so reconnecting a screen restores
/// its own fish. The identity is the display's NSScreenNumber (its CGDirectDisplayID), the
/// best stable handle a wallpaper-app agent is given; a display that keeps its id across a
/// replug keeps its tank too, and this mapping is what that depends on.
final class TankStore {
  static let shared = TankStore()
  private let tanksDir: URL
  private let mappingURL: URL

  init() {
    let support = FileManager.default.urls(
      for: .applicationSupportDirectory, in: .userDomainMask).first!
      .appendingPathComponent("Desktop Habitats", isDirectory: true)
    tanksDir = support.appendingPathComponent("tanks", isDirectory: true)
    mappingURL = support.appendingPathComponent("displays.json")
    try? FileManager.default.createDirectory(at: tanksDir, withIntermediateDirectories: true)
  }

  private var mapping: [String: String] {
    get {
      guard let data = try? Data(contentsOf: mappingURL),
        let dict = try? JSONSerialization.jsonObject(with: data) as? [String: String]
      else { return [:] }
      return dict
    }
    set {
      if let data = try? JSONSerialization.data(withJSONObject: newValue) {
        try? data.write(to: mappingURL, options: .atomic)
      }
    }
  }

  /// Fallback display identities, keyed by the NSScreen object's identity for the lifetime
  /// of this process. When a display number cannot be read there is no hardware identity to
  /// fall back on, so each such screen is given one unique key *for this run* — and reused
  /// on every later call, so the layout check, the tank lookup and every screen notification
  /// all agree on the same id. A fresh UUID per call would make each notification look like
  /// a brand-new display and spawn a fresh tank every time. Caveat: the key derives from the
  /// NSScreen object identity, so it cannot match a screen across a restart, and (rarely,
  /// if AppKit hands out a new instance for the same panel) it is not guaranteed to match the
  /// same physical panel across notifications. Full physical matching needs the display
  /// number to read; see docs/saved-state.md.
  private var fallbackDisplayID: [ObjectIdentifier: String] = [:]

  /// The display's persistent hardware identity. `NSScreenNumber` (a CGDirectDisplayID) is
  /// transient: a replug can hand the same physical panel a different number, so it cannot
  /// be trusted to reconnect a screen to its own tank. `CGDisplayCreateUUIDFromDisplayID`
  /// derives a UUID that is stable for a given physical display, which is what actually
  /// lets a reconnected screen come back to its own population. Returns nil when the
  /// display number cannot be read.
  func physicalID(for screen: NSScreen) -> String? {
    guard
      let id =
        (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?
        .uint32Value,
      let uuid = CGDisplayCreateUUIDFromDisplayID(CGDirectDisplayID(id))?.takeRetainedValue()
    else { return nil }
    return (CFUUIDCreateString(nil, uuid) as String?) ?? nil
  }

  func identity(for screen: NSScreen) -> String {
    // Prefer the persistent physical display UUID, so a reconnected panel comes back to its
    // own tank. When the display number cannot be read, we must NOT fall back to a single
    // shared "unknown" (that would map every unidentifiable screen to the SAME tank and have
    // them overwrite each other), and we must NOT mint a fresh UUID on every call (that
    // would make every screen notification look like a display replacement). Instead each
    // unidentifiable screen reuses one per-object fallback id for the process lifetime, so
    // identity(for:) always agrees with itself — the layout check, tankId(for:) and the
    // rebuild all see the same key. Caveat: that key cannot match a screen across a restart,
    // so such a screen starts a fresh tank each run; documented under the display-mapping
    // caveat in docs/saved-state.md.
    if let physical = physicalID(for: screen) { return physical }
    let key = ObjectIdentifier(screen)
    if let existing = fallbackDisplayID[key] { return existing }
    let id = "unidentifiable-\(UUID().uuidString)"
    fallbackDisplayID[key] = id
    return id
  }

  /// The stable, persistent id for the tank on this screen, assigned once and remembered.
  func tankId(for screen: NSScreen) -> String {
    let key = identity(for: screen)
    var mapping = self.mapping
    if let existing = mapping[key] { return existing }
    let id = UUID().uuidString
    mapping[key] = id
    self.mapping = mapping
    return id
  }

  /// The current population text for a tank, or nil the first time it runs.
  func load(_ id: String) -> String? {
    try? String(contentsOf: tankURL(id), encoding: .utf8)
  }

  func save(_ id: String, _ text: String) {
    // The page bounds a save's size; refuse anything absurd rather than write unlimited data.
    // Atomic writes ensure a half-written tank file (a crash mid-write) never looks like a
    // valid-but-corrupt record to the next launch.
    guard !id.isEmpty, text.count <= 2_000_000, let data = text.data(using: .utf8) else { return }
    try? data.write(to: tankURL(id), options: .atomic)  // best effort: a failed save must not stop the scene
  }

  private func tankURL(_ id: String) -> URL {
    tanksDir.appendingPathComponent("\(id).json")
  }
}

/// Receives population saves from a page and writes them to that display's tank file.
final class TankSaveHandler: NSObject, WKScriptMessageHandler {
  private let tankId: String
  private let store: TankStore
  init(tankId: String, store: TankStore) { self.tankId = tankId; self.store = store }
  func userContentController(
    _ controller: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    guard let text = message.body as? String else { return }
    store.save(tankId, text)
  }
}

/// A window that keeps the exact frame it is given. AppKit insets ordinary windows from
/// the screen edges; a wallpaper has to reach them.
final class DesktopWindow: NSWindow {
  override func constrainFrameRect(_ rect: NSRect, to screen: NSScreen?) -> NSRect { rect }
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}

/// One screen's worth of aquarium.
final class Wallpaper: NSObject, WKNavigationDelegate {
  let window: DesktopWindow
  let view: WKWebView
  // This screen's tank id, resolved once and stored so the page's saves and the explicit
  // host flush both write to the same tank even a while after the window was set up.
  private let tankId: String
  private var loaded = false
  private var inside = false
  private var rate = 0
  private var battery = false

  init(screen: NSScreen, root: URL) {
    let settings = WKWebViewConfiguration()
    settings.setURLSchemeHandler(SceneHandler(root: root), forURLScheme: sceneScheme)
    settings.suppressesIncrementalRendering = true
    // The page holds no WebKit-local state worth keeping between runs: the only durable
    // state is the tank's population, which travels through the host bridge below into a
    // real file, never through this datastore (so the store is kept non-persistent).
    settings.websiteDataStore = .nonPersistent()
    // Load this display's tank so its population survives a restart. Keep the identity and
    // initial state on globals the page's storage adapter reads at startup, and hand every
    // save back to the host through a WebKit message instead of a browser datastore.
    let tank = TankStore.shared
    tankId = tank.tankId(for: screen)
    let initialLiteral = tank.load(tankId).map(jsStringLiteral) ?? "null"
    settings.userContentController.addUserScript(
      WKUserScript(
        source: "window.habitatTankId = \(jsStringLiteral(tankId));\n"
          + "window.habitatTankInitial = \(initialLiteral);",
        injectionTime: .atDocumentStart, forMainFrameOnly: true))
    settings.userContentController.add(TankSaveHandler(tankId: tankId, store: tank), name: "tankSave")
    // The agent has no window to look at, so anything the page reports goes to the log.
    settings.userContentController.addUserScript(
      WKUserScript(
        source: """
          const report = (text) => webkit.messageHandlers.report.postMessage(String(text));
          for (const level of ['error', 'warn']) {
            const original = console[level];
            console[level] = (...parts) => {
              report(parts.map((part) => part && part.stack ? part.stack : part).join(' '));
              original.apply(console, parts);
            };
          }
          addEventListener('error', (event) =>
            report(`${event.message} at ${event.filename}:${event.lineno}`));
          addEventListener('unhandledrejection', (event) => report(event.reason));
          """,
        injectionTime: .atDocumentStart, forMainFrameOnly: true))
    // A pointer move the page can read, sent from the global cursor position.
    settings.userContentController.addUserScript(
      WKUserScript(
        source: """
          window.habitatPointerCount = 0;
          window.habitatPointer = (x, y) => {
            const canvas = document.querySelector('#scene');
            window.habitatPointerCount++;
            if (canvas)
              canvas.dispatchEvent(
                new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
          };
          window.habitatPointerOut = () => {
            const canvas = document.querySelector('#scene');
            if (canvas) canvas.dispatchEvent(new PointerEvent('pointerleave'));
          };
          """,
        injectionTime: .atDocumentStart, forMainFrameOnly: true))

    view = WKWebView(frame: screen.frame, configuration: settings)
    settings.userContentController.add(Reporter.shared, name: "report")
    // WebKit stops a page whose window it thinks is covered, and AppKit never reports a
    // background agent's window as visible, so the scene would never start. This asks
    // WebKit not to make that call; the agent works out what is covered instead.
    if view.responds(to: NSSelectorFromString("setWindowOcclusionDetectionEnabled:"))
      || view.responds(to: NSSelectorFromString("_setWindowOcclusionDetectionEnabled:"))
    {
      view.setValue(false, forKey: "windowOcclusionDetectionEnabled")
    }
    view.underPageBackgroundColor = NSColor(
      calibratedRed: 0.031, green: 0.055, blue: 0.047, alpha: 1)
    view.autoresizingMask = [.width, .height]

    window = DesktopWindow(
      contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false,
      screen: screen)
    super.init()

    view.navigationDelegate = self
    window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
    window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
    window.ignoresMouseEvents = true
    window.isOpaque = true
    window.hasShadow = false
    window.backgroundColor = NSColor(calibratedRed: 0.031, green: 0.055, blue: 0.047, alpha: 1)
    window.isReleasedWhenClosed = false
    window.contentView = view
    // Hiding the agent, or another app's "Hide Others", must not take the water away.
    window.canHide = false
    window.setFrame(screen.frame, display: true)
    window.orderFrontRegardless()

    view.load(URLRequest(url: URL(string: "\(sceneScheme)://\(sceneHost)\(scenePage)")!))
  }

  /// Pulls the page's current population and writes it, then calls `done` exactly once. Used
  /// before any teardown — closing, a screen rebuild or quit — so the last seconds of age are
  /// never lost to a page that a rate-down stop message did not get to flush. The write is
  /// bounded: if the view is hung or already terminated and never answers within half a
  /// second, we give up rather than block a rebuild or a quit forever (the periodic and
  /// lifecycle saves have already captured the population; this flush is a best-effort final
  /// write). It never adds a polling loop.
  ///
  /// Two teardown races are closed here. (1) The save and the completion sit behind the same
  /// one-shot `Finish` claim: whichever of the WebKit callback or the half-second timeout
  /// fires first wins, and a *late* callback after a timeout can no longer save this view's
  /// stale snapshot over a newer tank that a rebuild opened in its place. (2) The page is
  /// stopped and snapshotted in the SAME evaluateJavaScript string — `habitatRate(0)` then
  /// `habitatSnapshot()` — so a teardown cannot interleave a rate-down with a snapshot; and
  /// this view's host `rate` is forced to zero first (no separate evaluate needed) so no
  /// later applyRate can resume a closing view mid-flush.
  func flushSnapshot(then done: @escaping () -> Void) {
    rate = 0            // host property only: applyRate must not resume a closing view
    inside = false
    guard loaded else { done(); return }
    let finish = Finish { done() }
    view.evaluateJavaScript(
      "typeof habitatRate === 'function' && habitatRate(0);\n"
        + "typeof habitatSnapshot === 'function' ? habitatSnapshot() : null;"
    ) { value, _ in
      // The timeout may have already claimed completion; a late callback must save nothing.
      guard !finish.isClaimed else { return }
      if let text = value as? String { TankStore.shared.save(self.tankId, text) }
      finish.call()
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { finish.call() }
  }

  /// Tear the window down. First flush this screen's latest population to disk, then
  /// release the view. The tankSave message handler is removed here so a stale save already
  /// queued by this page can never be delivered to the Swift side after teardown to
  /// overwrite a newer tank that a rebuild opened in its place. `done` fires once the
  /// snapshot is flushed and the teardown is complete — used to serialize a screen rebuild.
  func close(then done: @escaping () -> Void = {}) {
    flushSnapshot { [self] in
      self.teardown()
      done()
    }
  }

  private func teardown() {
    NotificationCenter.default.removeObserver(self)
    view.navigationDelegate = nil
    view.configuration.userContentController.removeScriptMessageHandler(forName: "tankSave")
    view.configuration.userContentController.removeScriptMessageHandler(forName: "report")
    view.configuration.userContentController.removeAllUserScripts()
    view.removeFromSuperview()
    window.contentView = nil
    window.orderOut(nil)
    window.close()
  }

  /// Send only state changes. didFinish resends once after navigation, so there is no
  /// need to cross the WebKit process boundary every second with an unchanged rate.
  @discardableResult
  func setRate(_ wanted: Int) -> Bool {
    guard wanted != rate else { return false }
    rate = wanted
    if rate == 0 && inside {
      if loaded { view.evaluateJavaScript("habitatPointerOut()") }
      inside = false
    }
    NSLog("desktop-habitats: \(rate) fps")
    send()
    return true
  }

  func setPower(_ onBattery: Bool) {
    guard battery != onBattery else { return }
    battery = onBattery
    send()
  }

  private func send() {
    guard loaded else { return }
    view.evaluateJavaScript(
      """
      typeof habitatPower === 'function' && habitatPower(\(battery ? "true" : "false"));
      typeof habitatRate === 'function' && habitatRate(\(rate));
      """)
  }

  /// A pinch of food on the water, asked for from the menu rather than by clicking. The
  /// window never takes a mouse event, so there is no cursor position to drop it at: the
  /// page picks its own spot on the surface. Nothing is sent while the scene is stopped,
  /// where the food would only pile up unseen until it started again.
  func feed() {
    guard loaded, rate > 0 else { return }
    view.evaluateJavaScript("typeof habitatFeed === 'function' && habitatFeed()")
  }

  /// A cursor position in this screen's coordinates, or nil when the cursor left it.
  func setPointer(_ point: NSPoint?) {
    guard loaded, rate > 0 else { return }
    guard let point else {
      if inside { view.evaluateJavaScript("habitatPointerOut()") }
      inside = false
      return
    }
    inside = true
    view.evaluateJavaScript(
      "habitatPointer(\(String(format: "%.1f", point.x)),\(String(format: "%.1f", point.y)))")
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    loaded = true
    send()
  }

  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    NSLog("desktop-habitats: the scene did not load: \(error.localizedDescription)")
  }

  /// What the page thinks it is doing, for the log.
  func probe() {
    view.evaluateJavaScript(
      """
      (() => {
        const canvas = document.querySelector('#scene');
        const context = canvas && canvas.getContext('webgl2');
        return JSON.stringify({
          pixels: canvas && [canvas.width, canvas.height],
          covered: !document.querySelector('#loading').hidden,
          webgl2: Boolean(context),
          gpu: context && context.getParameter(context.RENDERER),
          hidden: document.hidden,
          pointers: window.habitatPointerCount,
        });
      })()
      """
    ) { value, error in
      NSLog("desktop-habitats page state: \(value ?? error?.localizedDescription ?? "unreadable")")
    }
  }

  /// What this screen is showing right now. The agent has no window of its own to look
  /// at, so this is how it can be checked.
  func snapshot(to file: URL, then done: @escaping () -> Void) {
    view.takeSnapshot(with: nil) { image, _ in
      defer { done() }
      guard let image, let data = image.tiffRepresentation,
        let png = NSBitmapImageRep(data: data)?.representation(using: .png, properties: [:])
      else { return }
      try? png.write(to: file)
      NSLog("desktop-habitats: wrote \(file.path)")
    }
  }
}

final class Controller: NSObject, NSApplicationDelegate, NSMenuDelegate {
  static var shared: Controller?
  private var screens: [Wallpaper] = []
  private var root = Bundle.main.resourceURL!.appendingPathComponent("scene")
  private var awake = true
  private var layout: [CGRect] = []
  // The persistent physical identity of each screen, kept alongside its frame so a rebuild
  // is detected even when a panel is replaced in place at the very same frame.
  private var layoutIds: [String] = []
  // Serial rebuild/termination state: rebuilding, coalesced rebuildRequested and terminating
  // (see Lifecycle.swift). Screens are only ever created when it is not terminating.
  private let lifecycle = LifecycleCoordinator()
  // Screens still closing in the current transition, held strongly so a bounded async flush
  // never deallocates a view mid-save; cleared when the transition completes.
  private var closing: [Wallpaper] = []
  private var lastPoint = NSPoint(x: -1e4, y: -1e4)
  private var snapshots: DispatchSourceSignal?
  private var status: NSStatusItem?
  private let state = NSMenuItem()
  private let pause = NSMenuItem()
  private let feed = NSMenuItem()
  private var applied = 0
  private var pointerTimer: Timer?
  private var pointerRate = 0
  private var exposureTimer: Timer?
  /// The choice outlives a restart, so a paused tank is still paused after logging in.
  /// Until one has been made there is nothing under the key at all, which is what lets a
  /// machine that asks for less motion start still without overruling anybody who has
  /// since decided otherwise.
  private var stopped =
    UserDefaults.standard.object(forKey: "paused") as? Bool ?? reduceMotion
  private var lowPower: Bool { ProcessInfo.processInfo.isLowPowerModeEnabled }
  /// Reduce Motion is a durable choice about the whole machine, not a passing shortage
  /// like Low Power Mode, so it decides how the wallpaper starts and never more than that:
  /// somebody who installed an animated wallpaper is allowed to want it anyway.
  private static var reduceMotion: Bool {
    NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
  }
  private var reduceMotion: Bool { Controller.reduceMotion }

  func applicationDidFinishLaunching(_ note: Notification) {
    Controller.shared = self
    build()
    addMenu()

    let center = NotificationCenter.default
    center.addObserver(
      self, selector: #selector(screensChanged),
      name: NSApplication.didChangeScreenParametersNotification, object: nil)

    // Drawing while the display is off, asleep or locked would only cost power.
    let workspace = NSWorkspace.shared.notificationCenter
    for (name, value) in [
      (NSWorkspace.screensDidSleepNotification, false),
      (NSWorkspace.screensDidWakeNotification, true),
      (NSWorkspace.sessionDidResignActiveNotification, false),
      (NSWorkspace.sessionDidBecomeActiveNotification, true),
    ] {
      workspace.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        self?.awake = value
        self?.applyRate()
      }
    }
    let distributed = DistributedNotificationCenter.default()
    for (name, value) in [("com.apple.screenIsLocked", false), ("com.apple.screenIsUnlocked", true)]
    {
      distributed.addObserver(forName: .init(name), object: nil, queue: .main) { [weak self] _ in
        self?.awake = value
        self?.applyRate()
      }
    }

    // Low Power Mode holds the scene still, like any other reason not to draw.
    NotificationCenter.default.addObserver(
      forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main
    ) { [weak self] _ in self?.applyRate() }

    // Turning Reduce Motion on mid-session stops the water for the same reason it starts
    // stopped under it, unless the tank has already been asked for deliberately.
    workspace.addObserver(
      forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil,
      queue: .main
    ) { [weak self] _ in
      guard let self, UserDefaults.standard.object(forKey: "paused") == nil else { return }
      self.stopped = self.reduceMotion
      self.applyRate()
    }

    // Power changes adjust the scene's resolution and shadow budget. Both power
    // sources use 30 fps: this slow-moving background does not need 60.
    if let source = IOPSNotificationCreateRunLoopSource({ _ in
      DispatchQueue.main.async { Controller.shared?.applyRate() }
    }, nil)?.takeRetainedValue() {
      CFRunLoopAddSource(CFRunLoopGetMain(), source, .defaultMode)
    }

    // `kill -USR1` writes what the first screen is showing to /tmp/desktop-habitats.png.
    signal(SIGUSR1, SIG_IGN)
    snapshots = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
    snapshots?.setEventHandler { [weak self] in self?.snapshot() }
    snapshots?.resume()
  }

  /// Draws for a moment even if the desktop is covered, then saves the frame.
  private func snapshot() {
    guard let first = screens.first else { return }
    for screen in screens { screen.setRate(30) }
    DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
      first.probe()
      first.snapshot(to: URL(fileURLWithPath: "/tmp/desktop-habitats.png")) {
        self?.applyRate()
      }
    }
  }

  // Putting a full-screen window on a screen is itself a screen-parameter change, so the
  // arrangement is compared before anything is rebuilt.
  @objc private func screensChanged() {
    // Two signals decide whether to rebuild: the frame layout (a move, resize or add/remove
    // of a screen) and the persistent physical identity of each display (a panel replaced
    // in place can keep the very same frame, so matching on CGRect alone would miss the
    // swap and never rebuild). Comparing the UUIDs catches a replacement at the same frame.
    let frames = NSScreen.screens.map(\.frame)
    let ids = NSScreen.screens.map { TankStore.shared.identity(for: $0) }
    guard frames != layout || ids != layoutIds else { return }
    drive(lifecycle.screenChanged())
  }

  /// Initial launch: create every screen's window before any notification could rebuild.
  private func build() {
    layout = NSScreen.screens.map(\.frame)
    layoutIds = NSScreen.screens.map { TankStore.shared.identity(for: $0) }
    screens = NSScreen.screens.map { Wallpaper(screen: $0, root: root) }
    applyRate()
  }

  /// Apply one decision of the lifecycle state machine to the real world. Only this
  /// method is allowed to create screens (recreateScreens) or reply to AppKit; every path
  /// through the state machine funnels here, so the two can never be double-fired.
  private func drive(_ outcome: LifecycleOutcome) {
    switch outcome {
    case .none: break
    case .beginRebuild: startRebuild()
    case .rebuildClosingDone: recreateScreens()
    case .beginTermination: finishTermination()
    case .terminationDone: NSApp.reply(toApplicationShouldTerminate: true)
    }
  }

  /// One serialized rebuild. Every live screen moves into the closing list first so
  /// applyRate — which iterates `screens` — can never re-hasten a view that is going away;
  /// they are then closed one at a time, each bounded by its own flush. When the last flush
  /// lands, the state machine says whether to recreate from the latest snapshot, loop for a
  /// change that was coalesced mid-rebuild, or bail into termination (a quit that arrived
  /// while we were mid-flush).
  private func startRebuild() {
    layout = NSScreen.screens.map(\.frame)
    layoutIds = NSScreen.screens.map { TankStore.shared.identity(for: $0) }
    let closingNow = screens
    screens = []
    closing = closingNow       // hold the closing views strongly until every flush lands
    closeAll(closingNow) { [weak self] in
      guard let self else { return }
      self.closing = []
      self.drive(self.lifecycle.rebuildFinishedClosing())
    }
  }

  /// The rebuild's close phase is done and no termination interrupted it: make the windows
  /// from the *latest* screen snapshot (a panel could have been swapped mid-flush) and drop
  /// right back into ordinary power/rate behavior. Never runs once termination has begun.
  private func recreateScreens() {
    guard !lifecycle.terminating else { return }
    screens = NSScreen.screens.map { Wallpaper(screen: $0, root: root) }
    applyRate()
  }

  /// Closes screens one at a time, waiting for each snapshot flush to land before the next.
  private func closeAll(_ list: [Wallpaper], then done: @escaping () -> Void) {
    var remaining = list
    func step() {
      guard let head = remaining.first else { done(); return }
      remaining.removeFirst()
      head.close { step() }
    }
    step()
  }

  private var onBattery: Bool {
    guard let blob = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
      let kind = IOPSGetProvidingPowerSourceType(blob)?.takeRetainedValue() as String?
    else { return false }
    return kind == kIOPSBatteryPowerValue
  }

  /// Full speed while the wallpaper is in plain sight, a slow beat when windows leave only
  /// part of it showing, and nothing at all behind a full screen of work or a dark display.
  /// Power depends on the machine and display; it must be measured on the target Mac.
  func applyRate() {
    let battery = onBattery
    let full = 30
    let still = stopped || lowPower || !awake
    // Read the window list once for all displays, and never while deliberately still.
    let blockers = still ? [] : windowBlockers()
    applied = 0
    var changed = false
    for (index, screen) in screens.enumerated() {
      let showing = index < layout.count ? exposure(layout[index], blockers: blockers) : 1
      let rate = still || showing < 0.15 ? 0 : showing < 0.4 ? 20 : full
      screen.setPower(battery)
      if screen.setRate(rate) { changed = true }
      applied = max(applied, rate)
    }
    if changed { lastPoint = NSPoint(x: -1e4, y: -1e4) }
    updateTimers(pollExposure: !still)
  }

  private func updateTimers(pollExposure: Bool) {
    // Pointer sampling need not outrun the animation, nor wake a stopped wallpaper.
    let wanted = min(30, applied)
    if wanted != pointerRate {
      pointerTimer?.invalidate()
      pointerTimer = nil
      pointerRate = wanted
      if wanted > 0 {
        let timer = Timer.scheduledTimer(withTimeInterval: 1.0 / Double(wanted), repeats: true) { [weak self] _ in
          self?.trackPointer()
        }
        timer.tolerance = 0.003
        pointerTimer = timer
      }
    }
    if !pollExposure {
      exposureTimer?.invalidate()
      exposureTimer = nil
    } else if exposureTimer == nil {
      // Continue this low-frequency check while merely covered so uncovering resumes.
      let timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
        self?.applyRate()
      }
      timer.tolerance = 0.25
      exposureTimer = timer
    }
  }

  /// How much of a screen ordinary windows leave uncovered, from none to all of it.
  /// AppKit's own occlusion never reports this agent's windows as visible, hence the
  /// direct look at what is on screen.
  private func windowBlockers() -> [CGRect] {
    guard
      let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID)
        as? [[String: Any]]
    else { return [] }
    let me = ProcessInfo.processInfo.processIdentifier
    // Only ordinary app windows count. The menu bar, the Dock and other system layers
    // hold full-screen windows that are almost entirely transparent.
    return list.compactMap { info -> CGRect? in
      guard info[kCGWindowLayer as String] as? Int == 0,
        info[kCGWindowOwnerPID as String] as? Int32 != me,
        info[kCGWindowAlpha as String] as? Double ?? 0 > 0.95,
        let bounds = info[kCGWindowBounds as String] as? [String: CGFloat]
      else { return nil }
      return CGRect(dictionaryRepresentation: bounds as CFDictionary)
    }
  }

  private func exposure(_ frame: CGRect, blockers: [CGRect]) -> Double {
    guard !blockers.isEmpty else { return 1 }
    let flipped = CGRect(
      x: frame.minX, y: (NSScreen.screens.first?.frame.height ?? frame.maxY) - frame.maxY,
      width: frame.width, height: frame.height)
    let columns = 16, rows = 10
    var free = 0
    for column in 0..<columns {
      for row in 0..<rows {
        let point = CGPoint(
          x: flipped.minX + flipped.width * (Double(column) + 0.5) / Double(columns),
          y: flipped.minY + flipped.height * (Double(row) + 0.5) / Double(rows))
        if !blockers.contains(where: { $0.contains(point) }) { free += 1 }
      }
    }
    return Double(free) / Double(columns * rows)
  }

  // MARK: - The menu bar

  /// The agent's only visible piece: a fish in the menu bar that can stop the water.
  private func addMenu() {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    let symbol = NSImage(systemSymbolName: "fish", accessibilityDescription: "Desktop Habitats")
    symbol?.isTemplate = true
    item.button?.image = symbol
    if symbol == nil { item.button?.title = "Desktop Habitats" }
    item.button?.toolTip = "Desktop Habitats · Riverscape"

    let menu = NSMenu()
    menu.delegate = self
    // The items say for themselves when they are available; AppKit's own guess would
    // leave Pause enabled in Low Power Mode, where pressing it would do nothing.
    menu.autoenablesItems = false
    state.isEnabled = false
    menu.addItem(state)
    menu.addItem(.separator())
    feed.title = "Feed"
    feed.target = self
    feed.action = #selector(feedFish)
    menu.addItem(feed)
    pause.target = self
    pause.action = #selector(togglePause)
    menu.addItem(pause)
    menu.addItem(.separator())
    let leave = NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q")
    leave.target = self
    menu.addItem(leave)
    item.menu = menu
    status = item
    if item.button?.window == nil || !item.isVisible {
      NSLog("desktop-habitats: the menu bar item did not appear")
    }
  }

  /// Says what the wallpaper is doing, and why, whenever the menu is opened. Most of the
  /// reasons it holds still are deliberate, and unexplained stillness reads as a fault.
  func menuNeedsUpdate(_ menu: NSMenu) {
    state.title =
      lowPower
      ? "Still, for Low Power Mode"
      : stopped
        ? reduceMotion ? "Paused, for Reduce Motion" : "Paused"
        : !awake
          ? "Still, the screen is off"
          : applied == 0
            ? "Resting behind your windows"
            : "Running at \(applied) frames a second"
    pause.title = stopped ? "Resume" : "Pause"
    // In Low Power Mode nothing is going to draw, so the item would be a false promise.
    // Reduce Motion is not the same case: the machine can perfectly well draw, it has
    // merely been asked not to, and Resume is how somebody says they want this one anyway.
    pause.isEnabled = !lowPower
    // Food that nothing is going to draw would sit in still water until the tank started
    // again and then all arrive at once, so Feed says so rather than promising a feeding.
    feed.isEnabled = applied > 0
  }

  /// Every screen, because each one runs its own tank with its own fish rather than one
  /// scene stretched across them: feeding only the screen the menu bar happens to be on
  /// would leave the others watching an unfed aquarium.
  @objc private func feedFish() {
    for screen in screens { screen.feed() }
  }

  @objc private func togglePause() {
    stopped.toggle()
    UserDefaults.standard.set(stopped, forKey: "paused")
    applyRate()
  }

  /// Quitting goes through NSApp.terminate, which reaches applicationShouldTerminate below
  /// and flushes every tank's latest population before the process exits.
  @objc private func quit() {
    NSApp.terminate(nil)
  }

  // MARK: - Flushing every tank on the way out

  /// AppKit asks before terminating; we answer .terminateLater, settle every screen's
  /// latest population (each bounded by flushSnapshot), then reply true. This is what keeps
  /// a session that never reaches a pagehide save — a short run, or one closed the menu-bar
  /// way — from losing its ids and age. If a rebuild is mid-flight we wait for its active
  /// flush to land and route through the state machine rather than race it; once termination
  /// begins, no new screens are ever created, and the reply fires exactly once.
  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    drive(lifecycle.terminate())
    return .terminateLater
  }

  /// Termination was decided: stop and flush whichever screens remain, serially, then reply
  /// once. `screens` may already be empty if the quit arrived during a rebuild's close
  /// phase (those views were flushed by the rebuild); either way they are held strongly as
  /// `closing` until the last write lands.
  private func finishTermination() {
    let remaining = screens
    screens = []
    closing = remaining       // keep every view referenced until its flush completes
    flushAll(remaining) { [weak self] in
      guard let self else { return }
      self.closing = []
      self.drive(self.lifecycle.terminationFinished())
    }
  }

  /// Stops and snapshots screens one at a time (each bounded by flushSnapshot). The app is
  /// exiting, so no window teardown is needed — only the final population write.
  private func flushAll(_ list: [Wallpaper], then done: @escaping () -> Void) {
    var remaining = list
    func step() {
      guard let head = remaining.first else { done(); return }
      remaining.removeFirst()
      head.flushSnapshot { step() }
    }
    step()
  }

  /// The cursor belongs to the Finder, so its position is read rather than captured.
  private func trackPointer() {
    let point = NSEvent.mouseLocation
    guard abs(point.x - lastPoint.x) > 0.2 || abs(point.y - lastPoint.y) > 0.2 else { return }
    lastPoint = point
    for (index, screen) in NSScreen.screens.enumerated() where index < screens.count {
      let frame = screen.frame
      screens[index].setPointer(
        frame.contains(point)
          ? NSPoint(x: point.x - frame.minX, y: frame.maxY - point.y) : nil)
    }
  }
}

// The executable bootstrap (NSApplication setup + run loop) lives in main.swift so this
// file can be compiled together with the AppKit-free Lifecycle.swift helper for typecheck
// and tests; top-level code is only allowed in the file named main.swift.

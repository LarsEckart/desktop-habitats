// Pure AppKit-free helpers for the wallpaper's async teardown and rebuild.
//
// Wallpaper.swift talks to AppKit and WebKit; it cannot be exercised headless. The two
// helpers below are deliberately free of both (only Foundation), so a plain Swift
// executable can test the two genuinely subtle pieces of the host logic that the rest of
// the app cannot: the one-shot timeout gate that keeps a late WebKit callback from writing
// stale data, and the rebuild/terminate state machine that forbids creating screens while
// quitting and coalesces overlapping screen changes.
//
// Wallpaper.swift and the test executable compile this file directly; nothing here knows
// about NSApplication, WKWebView or NSScreen.

import Foundation

/// A completion that may be claimed only once, shared by the flush timeout and the
/// evaluateJavaScript callback so that whichever arrives first wins and the other is a
/// harmless no-op. This is what guarantees that after a flush times out, a late WebKit
/// callback can neither re-run the completion nor save a stale snapshot over a newer tank.
///
/// All access runs on the main queue in the app; the claim is still guarded with a lock so
/// the helper is safe even if a future caller fires it from a background queue.
final class Finish: @unchecked Sendable {
  private let lock = NSLock()
  private var claimed = false
  private let action: () -> Void

  init(_ action: @escaping () -> Void) { self.action = action }

  var isClaimed: Bool {
    lock.lock()
    let value = claimed
    lock.unlock()
    return value
  }

  /// Claim the completion. Runs `action` on the first claim only; any later call returns
  /// false and does nothing. Returns true for the winning caller.
  @discardableResult
  func call() -> Bool {
    lock.lock()
    if claimed { lock.unlock(); return false }
    claimed = true
    lock.unlock()
    action()
    return true
  }
}

/// Outcome of a lifecycle decision, telling the app which side effect to perform. The
/// state machine itself is pure; the controller maps each outcome onto real work (flushing
/// views, building screens, replying to AppKit).
enum LifecycleOutcome: Equatable {
  /// Nothing to do (already terminating, or a transition is already in flight).
  case none
  /// The app should start a rebuild: close the current screens serially, then recreate.
  case beginRebuild
  /// A rebuild has finished closing its old screens; the app should recreate from the
  /// latest NSScreen snapshot (and then call `rebuildClosed` result again if it loops).
  case rebuildClosingDone
  /// The app should flush/stop the remaining running screens and reply to AppKit. Once
  /// reached, no screens may ever be created.
  case beginTermination
  /// All screens are flushed; the app may reply to the terminate request.
  case terminationDone
}

/// A deterministic rebuild/termination state machine for the wallpaper controller.
///
/// It owns only three flags and the transitions between them; it never touches AppKit. The
/// controller drives it from screen-change notifications and the terminate request, and
/// callbacks it back when an async flush of views completes, so every meaningful ordering
/// (rebuild vs quit, two rebuilds racing) can be pinned down headlessly.
final class LifecycleCoordinator {
  private(set) var rebuilding = false
  private(set) var rebuildRequested = false
  private(set) var terminating = false

  /// A screen arrangement change was observed. Ordinarily this starts a rebuild; a change
  /// that arrives while a rebuild is already in flight is coalesced into a re-run when that
  /// rebuild finishes, so the two notifications never fire two overlapping builds.
  @discardableResult
  func screenChanged() -> LifecycleOutcome {
    if terminating { return .none }       // quitting: never start a rebuild
    if rebuilding { rebuildRequested = true; return .none }  // coalesce into the active one
    rebuilding = true
    return .beginRebuild
  }

  /// The rebuild has finished closing its old screens. If termination arrived mid-rebuild,
  /// the correct action is to finish terminating (never create screens). Otherwise either
  /// recreate from the latest snapshot (`.rebuildClosingDone`) or, if another change was
  /// coalesced, loop to close-and-recreate once more.
  @discardableResult
  func rebuildFinishedClosing() -> LifecycleOutcome {
    guard rebuilding else { return .none }
    if terminating {
      rebuilding = false
      return .beginTermination
    }
    rebuilding = false
    if rebuildRequested {
      rebuildRequested = false
      rebuilding = true                 // one queued change: go around once more
      return .beginRebuild
    }
    return .rebuildClosingDone
  }

  /// The app was asked to quit. If a rebuild is already closing views, we wait for its
  /// flush to land (its completion will see `terminating` and route to beginTermination)
  /// rather than racing it; otherwise terminate immediately.
  @discardableResult
  func terminate() -> LifecycleOutcome {
    if terminating { return .none }
    terminating = true
    return rebuilding ? .none : .beginTermination
  }

  /// Flipping `.beginTermination` into `.terminationDone`; idempotent.
  @discardableResult
  func terminationFinished() -> LifecycleOutcome {
    guard terminating else { return .none }
    return .terminationDone
  }
}

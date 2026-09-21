// Deterministic tests for the AppKit-free wallpaper lifecycle helpers (Lifecycle.swift),
// compiled and run by `npm test` against the same files the app compiles. Everything here
// is synchronous, so the ordering that is genuinely tricky in the real app — a late WebKit
// callback after a flush timeout, two racing rebuilds, a quit during a rebuild — can be
// pinned down without a Mac display or a browser.

import Foundation

var failures = 0

func check(_ condition: Bool, _ message: String) {
  if condition {
    print("ok: \(message)")
  } else {
    print("FAIL: \(message)")
    failures += 1
  }
}

func section(_ title: String) { print("\n== \(title) ==") }

// ---- Finish: the one-shot completion gate behind flushSnapshot --------------------
section("Finish one-shot gate")
var actions = 0
let early = Finish { actions += 1 }
check(early.isClaimed == false, "an unused Finish is unclaimed")
check(early.call() == true, "the first claim wins and runs the action")
check(actions == 1, "the action ran exactly once")
check(early.isClaimed == true, "a claimed Finish stays claimed")
check(early.call() == false, "a second claim is refused and does nothing")
check(actions == 1, "the action still ran exactly once")

// The exact wiring flushSnapshot relies on: the two async racers each call() once. Model it
// as (a) the JS callback winning, then a late timeout claiming; and (b) the natural order
// where a second caller — the late callback — must skip its save because the gate is taken.
section("One competition, one completion")
var completions = 0
let race = Finish { completions += 1 }
// Both racers try to claim. First wins, second is refused.
_ = race.call()
check(race.call() == false, "the second racer (timeout or callback) is refused")
check(completions == 1, "completion fired exactly once despite two callers")

// The save guard in the real callback is `guard !finish.isClaimed else { return }`. Here a
// late callback inspects the claimed gate and decides not to write, then would not re-claim.
let saveGate = Finish {}
_ = saveGate.call()          // e.g. the timeout claimed first
check(saveGate.isClaimed == true, "after the timeout, the gate is claimed (a late callback must not save)")
check(saveGate.call() == false, "even if the late callback calls it, nothing double-runs")

// ---- LifecycleCoordinator: rebuild coalescing and quit-during-rebuild -------------
section("Rebuild coalescing")
let life = LifecycleCoordinator()
check(life.screenChanged() == .beginRebuild, "a first screen change starts a rebuild")
check(life.rebuilding == true, "rebuilding is flagged while the close phase runs")

// A second change while closing is coalesced, not started twice.
check(life.screenChanged() == .none, "a second event during a rebuild is coalesced")
check(life.rebuildRequested == true, "the coalesced change is queued, not lost")

// The close phase completes with a queued change: the machine asks to rebuild once more.
check(life.rebuildFinishedClosing() == .beginRebuild, "completion with a queued change rebuilds again")
check(life.rebuilding == true, "still rebuilding for the queued change")
check(life.rebuildRequested == false, "the queued change was consumed")

// That second close phase finds nothing new to do: recreate from the latest snapshot.
check(life.rebuildFinishedClosing() == .rebuildClosingDone, "no queued change left: recreate screens")
check(life.rebuilding == false, "rebuilding clears once recreation is the answer")

section("Quit during an active rebuild")
let quitting = LifecycleCoordinator()
check(quitting.screenChanged() == .beginRebuild, "rebuild begins")
check(
  quitting.terminate() == .none,
  "a quit during a rebuild waits on the active flush, not immediately")
check(quitting.terminating == true, "terminating is flagged at the quit")
// The active rebuild's close phase then completes: never create screens, go terminate.
check(
  quitting.rebuildFinishedClosing() == .beginTermination,
  "completion during a quit routes to termination, not to creating screens")
check(quitting.rebuilding == false, "rebuilding cleared before termination")
check(quitting.terminationFinished() == .terminationDone, "termination reports done for the reply")

section("Plain quit (nothing rebuilding)")
let plain = LifecycleCoordinator()
check(plain.terminate() == .beginTermination, "a quiet quit starts termination immediately")
check(plain.terminating == true, "terminating flagged")
check(plain.screenChanged() == .none, "a screen change after the quit is ignored (never create screens)")
check(plain.rebuilding == false, "no rebuild is started once quitting")

section("A rebuild must not start after termination began")
let afterGoodbye = LifecycleCoordinator()
_ = afterGoodbye.terminate()
check(afterGoodbye.screenChanged() == .none, "notifications after a quit are refused before any rebuild")

section("Summary")
if failures == 0 {
  print("ALL LIFECYCLE TESTS PASSED")
} else {
  print("\(failures) LIFECYCLE TEST(S) FAILED")
  exit(1)
}

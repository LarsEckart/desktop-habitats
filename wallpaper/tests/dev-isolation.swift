import Foundation

@main
struct DevIsolationTests {
  static func main() {
    var failures = 0
    func check(_ condition: Bool, _ message: String) {
      if condition { print("ok: \(message)") }
      else { print("FAIL: \(message)"); failures += 1 }
    }

    let home = URL(fileURLWithPath: "/tmp/desktop-habitats-dev-test-home", isDirectory: true)
    let paths = DevPaths(home: home)
    check(paths.support.lastPathComponent == "Desktop Habitats Dev", "dev support directory is distinct")
    check(paths.support.path.contains("Desktop Habitats Dev"), "dev files stay under the dev support root")
    check(!paths.support.path.contains("/Desktop Habitats/tanks"), "dev support does not use production tank path")

    if let options = try? DevOptions(arguments: [
      "--windowed", "--diagnostics", "--verify", "--scenario", "hunt-hit",
      "--seed=42", "--run", "test-run", "--snapshot",
    ]) {
      check(options.mode == .windowed, "windowed is an explicit supported mode")
      check(options.diagnostics && options.verify, "verification enables the diagnostics gate")
      check(options.snapshot, "visual snapshot capture is opt-in")
      check(options.queryItems.contains { $0.0 == "diagnostics" && $0.1 == "1" }, "diagnostics query is dev-only")
      check(options.queryItems.contains { $0.0 == "verify" && $0.1 == "1" }, "verification query is dev-only")
      check(options.queryItems.contains { $0.0 == "scenario" && $0.1 == "hunt-hit" }, "scenario query is allow-listed")
      check(!options.queryItems.contains { $0.0 == "url" }, "arbitrary URL flags are not accepted")
    } else {
      check(false, "dev options parse")
    }

    check((try? DevOptions(arguments: ["--url=http://bad.example"])) == nil,
          "arbitrary URL injection is rejected")

    if failures == 0 { print("ALL DEV ISOLATION TESTS PASSED") }
    else { print("\(failures) DEV ISOLATION TEST(S) FAILED"); exit(1) }
  }
}

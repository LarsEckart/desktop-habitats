// Shared, AppKit-free policy and file helpers for the isolated development app.
//
// The production wallpaper has its own host and support directory. Keeping this policy in
// the dev target makes it possible to test the boundary without importing production code.

import Foundation

let devBundleIdentifier = "com.chaselean.desktop-habitats.dev"
let devApplicationName = "Desktop Habitats Dev"
let devSupportDirectoryName = "Desktop Habitats Dev"

struct DevPaths {
  let support: URL
  let exports: URL
  let requests: URL
  let tanks: URL
  let mappings: URL
  let pid: URL
  let log: URL

  init(home: URL = FileManager.default.homeDirectoryForCurrentUser) {
    support = home.appendingPathComponent("Library/Application Support", isDirectory: true)
      .appendingPathComponent(devSupportDirectoryName, isDirectory: true)
    exports = support.appendingPathComponent("exports", isDirectory: true)
    requests = support.appendingPathComponent("requests", isDirectory: true)
    tanks = support.appendingPathComponent("tanks", isDirectory: true)
    mappings = support.appendingPathComponent("displays.json")
    pid = support.appendingPathComponent("dev.pid")
    log = support.appendingPathComponent("dev.log")
  }

  func prepare() throws {
    for directory in [support, exports, requests, tanks] {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }
  }
}

enum DevJSON {
  static func write(_ object: Any, to url: URL) throws {
    guard JSONSerialization.isValidJSONObject(object) else {
      throw NSError(domain: "DesktopHabitatsDev", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "The development export was not valid JSON."
      ])
    }
    let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    let temporary = url.deletingLastPathComponent()
      .appendingPathComponent(".\(url.lastPathComponent).\(UUID().uuidString).tmp")
    try data.write(to: temporary, options: .atomic)
    if FileManager.default.fileExists(atPath: url.path) {
      _ = try FileManager.default.replaceItemAt(url, withItemAt: temporary)
    } else {
      try FileManager.default.moveItem(at: temporary, to: url)
    }
  }

  static func readObject(from url: URL) -> [String: Any]? {
    guard let data = try? Data(contentsOf: url),
      let object = try? JSONSerialization.jsonObject(with: data),
      let dictionary = object as? [String: Any]
    else { return nil }
    return dictionary
  }
}

final class DevOnce: @unchecked Sendable {
  private let lock = NSLock()
  private var claimed = false
  private let action: () -> Void

  init(_ action: @escaping () -> Void) { self.action = action }

  var isClaimed: Bool {
    lock.lock(); defer { lock.unlock() }
    return claimed
  }

  @discardableResult
  func call() -> Bool {
    lock.lock()
    guard !claimed else { lock.unlock(); return false }
    claimed = true
    lock.unlock()
    action()
    return true
  }
}

struct DevRequest {
  let id: String
  let requestedAt: String
  let file: URL

  init?(file: URL) {
    guard let object = DevJSON.readObject(from: file),
      let id = object["requestId"] as? String,
      let requestedAt = object["requestedAt"] as? String,
      !id.isEmpty, !requestedAt.isEmpty
    else { return nil }
    self.id = id
    self.requestedAt = requestedAt
    self.file = file
  }
}

struct DevOptions {
  enum Mode: Equatable { case windowed, desktop }

  var mode: Mode = .windowed
  var diagnostics = false
  var verify = false
  var snapshot = false
  var scenario: String?
  var seed = "42"
  var run = "dev"

  init(arguments: [String]) throws {
    var index = 0
    while index < arguments.count {
      let argument = arguments[index]
      switch argument {
      case "--desktop": mode = .desktop
      case "--windowed": mode = .windowed
      case "--diagnostics": diagnostics = true
      case "--snapshot": snapshot = true
      case "--verify":
        verify = true
        // Verification is intentionally coupled to diagnostics. The scene gate requires
        // both flags, and there is no useful dev mode that silently half-enables it.
        diagnostics = true
      case let value where value.hasPrefix("--scenario="):
        let token = String(value.dropFirst("--scenario=".count))
        guard Self.isSafeToken(token) else { throw Error.invalid("scenario") }
        scenario = token
      case "--scenario":
        index += 1
        guard index < arguments.count, Self.isSafeToken(arguments[index]) else {
          throw Error.invalid("scenario")
        }
        scenario = arguments[index]
      case let value where value.hasPrefix("--seed="):
        let token = String(value.dropFirst("--seed=".count))
        guard Int(token) != nil else { throw Error.invalid("seed") }
        seed = token
      case "--seed":
        index += 1
        guard index < arguments.count, Int(arguments[index]) != nil else {
          throw Error.invalid("seed")
        }
        seed = arguments[index]
      case let value where value.hasPrefix("--run="):
        let token = String(value.dropFirst("--run=".count))
        guard Self.isSafeToken(token) else { throw Error.invalid("run") }
        run = token
      case "--run":
        index += 1
        guard index < arguments.count, Self.isSafeToken(arguments[index]) else {
          throw Error.invalid("run")
        }
        run = arguments[index]
      default: throw Error.unknown(argument)
      }
      index += 1
    }
  }

  var modeName: String { mode == .desktop ? "desktop" : "windowed" }

  var queryItems: [(String, String)] {
    var items: [(String, String)] = []
    if diagnostics { items.append(("diagnostics", "1")) }
    if verify { items.append(("verify", "1")) }
    if let scenario { items.append(("scenario", scenario)) }
    if verify {
      items.append(("seed", seed))
      items.append(("run", run))
    }
    return items
  }

  static func isSafeToken(_ value: String) -> Bool {
    !value.isEmpty && value.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }
  }

  enum Error: Swift.Error, CustomStringConvertible {
    case unknown(String)
    case invalid(String)

    var description: String {
      switch self {
      case let .unknown(value): return "unknown option \(value)"
      case let .invalid(name): return "invalid \(name) value"
      }
    }
  }
}

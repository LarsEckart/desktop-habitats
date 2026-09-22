// Entry point for the separately built development app. It supplies only configuration to
// the production Controller; all display mapping, power policy, rebuild, and flush behavior
// remains the shared implementation in Wallpaper.swift.

import Cocoa

@main
struct DesktopHabitatsDevMain {
  static func main() {
    let options: DevOptions
    do {
      options = try DevOptions(arguments: Array(CommandLine.arguments.dropFirst()))
    } catch {
      fputs("Desktop Habitats Dev: \(error)\n", stderr)
      exit(64)
    }

    let paths = DevPaths()
    var configuration = NativeHostConfiguration()
    configuration.supportDirectoryName = devSupportDirectoryName
    configuration.scheme = "desktop-habitats-dev"
    configuration.windowMode = options.mode == .desktop ? .desktop : .windowed
    // Verification fixtures own their storage in the page. Do not inject the native bridge or
    // let the shared flush path write a scenario population into a normal dev tank.
    configuration.persistentTanks = !options.verify
    configuration.queryItems = options.queryItems.map { URLQueryItem(name: $0.0, value: $0.1) }
    configuration.development = true
    configuration.devSupport = paths.support
    configuration.devSnapshot = options.snapshot
    configuration.devMetadata = [
      "diagnostics": options.diagnostics,
      "verify": options.verify,
      "scenario": options.scenario ?? NSNull(),
      "seed": options.verify ? options.seed : NSNull(),
      "run": options.verify ? options.run : NSNull(),
    ]

    let application = NSApplication.shared
    let controller = Controller(configuration: configuration)
    application.delegate = controller
    application.run()
  }
}

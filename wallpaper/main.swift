// The executable entry point. Kept in a file named `main.swift` so the app can be compiled
// from more than one file: Swift only allows top-level code in a file called main.swift.
import Cocoa

let application = NSApplication.shared
let controller = Controller()
application.setActivationPolicy(.accessory)
application.delegate = controller
application.run()

import ExpoModulesCore
import Foundation

/// Keeps a notes folder the person picked (in iCloud Drive or another app) open across launches.
/// iOS lets the app into such a folder only for the session it was picked in, unless the app
/// saved a bookmark to it then and resolves that bookmark on the next launch.
public class VbFolderModule: Module {
  /// The folder whose access this module opened; closed when another one is opened.
  private var current: URL?

  public func definition() -> ModuleDefinition {
    Name("VbFolder")

    /// A bookmark for a folder just picked, while the picker's access is still open. Nil if iOS refuses.
    Function("bookmark") { (uri: String) -> String? in
      guard let url = URL(string: uri) else { return nil }
      return (try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil))?.base64EncodedString()
    }

    /// Opens a saved folder: its URL now (it may have been moved or renamed) and the bookmark to
    /// keep (a fresh one when iOS says the old one is stale). Nil when the folder is gone.
    Function("open") { (bookmark: String) -> [String: String]? in
      guard let data = Data(base64Encoded: bookmark) else { return nil }
      var stale = false
      guard let url = try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale),
            url.startAccessingSecurityScopedResource() else { return nil }
      self.current?.stopAccessingSecurityScopedResource()
      self.current = url
      var kept = bookmark
      if stale, let fresh = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
        kept = fresh.base64EncodedString()
      }
      return ["uri": url.absoluteString, "bookmark": kept]
    }

    /// Keeps a folder the app can fill again (the search model, which react-native-executorch
    /// downloads into Documents) out of iCloud backups, as Apple's storage rules ask, and out of
    /// sight in the Files app. False when it isn't there yet.
    Function("keepOutOfBackup") { (uri: String) -> Bool in
      guard var url = URL(string: uri), FileManager.default.fileExists(atPath: url.path) else { return false }
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      values.isHidden = true
      return (try? url.setResourceValues(values)) != nil
    }

    /// Asks iCloud to bring down files that are only in the cloud (they show as hidden
    /// `.name.icloud` placeholders until then). Returns how many it asked for.
    AsyncFunction("downloadFromCloud") { (uri: String) -> Int in
      guard let root = URL(string: uri) else { return 0 }
      let fm = FileManager.default
      let keys: [URLResourceKey] = [.isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey]
      guard let walker = fm.enumerator(at: root, includingPropertiesForKeys: keys, options: []) else { return 0 }
      var asked = 0
      while let url = walker.nextObject() as? URL {
        let name = url.lastPathComponent
        var target = url
        if name.hasPrefix(".") && name.hasSuffix(".icloud") {
          target = url.deletingLastPathComponent().appendingPathComponent(String(name.dropFirst().dropLast(".icloud".count)))
        } else {
          guard let values = try? url.resourceValues(forKeys: Set(keys)),
                values.isUbiquitousItem == true,
                let status = values.ubiquitousItemDownloadingStatus,
                status != .current else { continue }
        }
        if (try? fm.startDownloadingUbiquitousItem(at: target)) != nil { asked += 1 }
      }
      return asked
    }
  }
}

import Foundation

struct EditorSessionDraft: Codable, Equatable {
  static let currentVersion = 1

  let version: Int
  let videoID: String
  let savedAt: Date
  let canvas: EditorCanvas
  let project: EditorProjectDraft
}

enum EditorDraftStore {
  private static let encoder: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    return encoder
  }()

  private static let decoder: JSONDecoder = {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return decoder
  }()

  static func load(videoID: String) -> EditorSessionDraft? {
    guard let data = try? Data(contentsOf: fileURL(for: videoID)),
          let draft = try? decoder.decode(EditorSessionDraft.self, from: data),
          draft.version == EditorSessionDraft.currentVersion,
          draft.videoID == videoID
    else { return nil }
    return draft
  }

  static func save(videoID: String, canvas: EditorCanvas, project: EditorProjectDraft) throws {
    let directory = try draftsDirectory()
    let draft = EditorSessionDraft(
      version: EditorSessionDraft.currentVersion,
      videoID: videoID,
      savedAt: .now,
      canvas: canvas,
      project: project
    )
    try encoder.encode(draft).write(to: directory.appendingPathComponent(fileName(for: videoID)), options: .atomic)
  }

  static func remove(videoID: String) throws {
    let url = fileURL(for: videoID)
    if FileManager.default.fileExists(atPath: url.path) {
      try FileManager.default.removeItem(at: url)
    }
  }

  private static func draftsDirectory() throws -> URL {
    let base = try FileManager.default.url(
      for: .applicationSupportDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    )
    let directory = base.appendingPathComponent("VideoFlow/EditorDrafts", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }

  private static func fileURL(for videoID: String) -> URL {
    let base = (try? draftsDirectory()) ?? FileManager.default.temporaryDirectory
    return base.appendingPathComponent(fileName(for: videoID))
  }

  private static func fileName(for videoID: String) -> String {
    let encoded = Data(videoID.utf8).base64EncodedString()
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "=", with: "")
    return "\(encoded).json"
  }
}

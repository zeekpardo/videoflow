import Foundation

struct VideoSummary: Decodable, Identifiable, Hashable, Sendable {
  let id: String
  let title: String
  let durationMs: Double
  let mode: String
  let visibility: String
  let viewCount: Double
  let transcriptStatus: String
  let createdAt: Double
  let thumbnailURL: URL?

  enum CodingKeys: String, CodingKey {
    case id = "_id"
    case title, durationMs, mode, visibility, viewCount, transcriptStatus, createdAt
    case thumbnailURL = "thumbnailUrl"
  }

  var durationLabel: String {
    let total = max(0, Int(durationMs / 1_000))
    return String(format: "%d:%02d", total / 60, total % 60)
  }

  var createdDate: Date { Date(timeIntervalSince1970: createdAt / 1_000) }
}

struct ReviewRequestSummary: Decodable, Identifiable, Hashable, Sendable {
  let id: String
  let videoId: String
  let videoTitle: String
  let recipientName: String
  let recipientEmail: String
  let message: String?
  let dueAt: Double?
  let status: String
  let responseName: String?
  let responseNote: String?
  let respondedAt: Double?
  let canceledAt: Double?
  let lastRemindedAt: Double?
  let reminderCount: Double?
  let createdAt: Double
  let token: String?
  let linkStatus: String

  enum CodingKeys: String, CodingKey {
    case id = "_id"
    case videoId, videoTitle, recipientName, recipientEmail, message, dueAt, status
    case responseName, responseNote, respondedAt, canceledAt, lastRemindedAt, reminderCount, createdAt, token, linkStatus
  }

  var dueDate: Date? { dueAt.map { Date(timeIntervalSince1970: $0 / 1_000) } }
  var createdAtDate: Date { Date(timeIntervalSince1970: createdAt / 1_000) }
}

struct VideoPlayback: Decodable, Sendable {
  struct FinishedRendition: Decodable, Sendable {
    let current: Bool
    let url: URL?
  }

  let url: URL
  let finishedRendition: FinishedRendition?

  var preferredURL: URL { finishedRendition?.current == true ? finishedRendition?.url ?? url : url }
}

struct UploadGrant: Decodable, Sendable {
  let key: String
  let url: URL
}

struct CreatedVideo: Decodable, Sendable {
  let videoId: String
}

struct CreatedReviewRequest: Decodable, Sendable {
  let reviewRequestId: String
  let shareLinkId: String
  let token: String
}

struct CapturedVideo: Identifiable, Hashable, Sendable {
  let id = UUID()
  let url: URL
  let durationMs: Double
  let width: Double?
  let height: Double?
  let mimeType: String
  let sizeBytes: Int
}

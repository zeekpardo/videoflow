import Combine
import ConvexMobile
import Foundation

@MainActor
protocol VideoFlowServicing {
  func videosPublisher() -> AnyPublisher<[VideoSummary], ClientError>
  func reviewsPublisher() -> AnyPublisher<[ReviewRequestSummary], ClientError>
  func videoPublisher(videoId: String) -> AnyPublisher<VideoPlayback, ClientError>
  func upload(video: CapturedVideo, title: String) async throws -> CreatedVideo
  func createReviewRequest(
    videoId: String,
    recipientName: String,
    recipientEmail: String,
    message: String?,
    dueAt: Date?
  ) async throws -> CreatedReviewRequest
  func remindReviewRequest(reviewRequestId: String) async throws
  func cancelReviewRequest(reviewRequestId: String) async throws
}

@MainActor
final class ConvexVideoFlowService: VideoFlowServicing {
  private let client: ConvexClientWithAuth<String>

  init(client: ConvexClientWithAuth<String>) {
    self.client = client
  }

  func videosPublisher() -> AnyPublisher<[VideoSummary], ClientError> {
    client.subscribe(to: "videos:list", yielding: [VideoSummary].self)
  }

  func reviewsPublisher() -> AnyPublisher<[ReviewRequestSummary], ClientError> {
    client.subscribe(to: "videoFlowV2:workspaceReviewRequests", yielding: [ReviewRequestSummary].self)
  }

  func videoPublisher(videoId: String) -> AnyPublisher<VideoPlayback, ClientError> {
    client.subscribe(to: "videos:get", with: ["videoId": videoId], yielding: VideoPlayback.self)
  }

  func upload(video: CapturedVideo, title: String) async throws -> CreatedVideo {
    let grant: UploadGrant = try await client.mutation("r2:generateUploadUrl")
    var request = URLRequest(url: grant.url)
    request.httpMethod = "PUT"
    request.setValue(video.mimeType, forHTTPHeaderField: "Content-Type")
    let (_, response) = try await URLSession.shared.upload(for: request, fromFile: video.url)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      throw URLError(.badServerResponse)
    }
    let args: [String: ConvexEncodable?] = [
      "title": title.trimmingCharacters(in: .whitespacesAndNewlines),
      "storageId": grant.key,
      "durationMs": video.durationMs,
      "width": video.width,
      "height": video.height,
      "mode": "camera",
      "mimeType": video.mimeType,
      "sizeBytes": video.sizeBytes,
    ]
    return try await client.action("videoActions:create", with: args)
  }

  func createReviewRequest(
    videoId: String,
    recipientName: String,
    recipientEmail: String,
    message: String?,
    dueAt: Date?
  ) async throws -> CreatedReviewRequest {
    let args: [String: ConvexEncodable?] = [
      "videoId": videoId,
      "recipientName": recipientName,
      "recipientEmail": recipientEmail,
      "message": message?.trimmingCharacters(in: .whitespacesAndNewlines),
      "dueAt": dueAt.map { $0.timeIntervalSince1970 * 1_000 },
    ]
    return try await client.mutation("videoFlowV2:createReviewRequest", with: args)
  }

  func remindReviewRequest(reviewRequestId: String) async throws {
    let _: Bool = try await client.mutation(
      "videoFlowV2:remindReviewRequest",
      with: ["reviewRequestId": reviewRequestId]
    )
  }

  func cancelReviewRequest(reviewRequestId: String) async throws {
    let _: Bool = try await client.mutation(
      "videoFlowV2:cancelReviewRequest",
      with: ["reviewRequestId": reviewRequestId]
    )
  }
}

@MainActor
final class PreviewVideoFlowService: VideoFlowServicing {
  private let sampleVideos: [VideoSummary] = {
    let now = Date.now.timeIntervalSince1970 * 1_000
    return [
      VideoSummary(
        id: "sample-launch", title: "Summer launch — final creative walkthrough", durationMs: 52_208, mode: "screen",
        visibility: "private", viewCount: 48, transcriptStatus: "ready", createdAt: now - 3_600_000,
        thumbnailURL: nil
      ),
      VideoSummary(
        id: "sample-mobile", title: "Mobile onboarding notes", durationMs: 52_208, mode: "camera",
        visibility: "private", viewCount: 17, transcriptStatus: "ready", createdAt: now - 86_400_000,
        thumbnailURL: nil
      ),
      VideoSummary(
        id: "sample-campaign", title: "Q3 campaign cut v4", durationMs: 52_208, mode: "screen",
        visibility: "private", viewCount: 31, transcriptStatus: "ready", createdAt: now - 172_800_000,
        thumbnailURL: nil
      ),
      VideoSummary(
        id: "sample-standup", title: "Design standup — Tuesday", durationMs: 52_208, mode: "camera",
        visibility: "private", viewCount: 9, transcriptStatus: "processing", createdAt: now - 259_200_000,
        thumbnailURL: nil
      ),
    ]
  }()

  private let sampleReviews: [ReviewRequestSummary] = {
    let now = Date.now.timeIntervalSince1970 * 1_000
    return [
      ReviewRequestSummary(
        id: "review-pending", videoId: "sample-launch", videoTitle: "Summer launch — final creative walkthrough",
        recipientName: "Maya Chen", recipientEmail: "maya@example.com", message: "Please check the new ending.",
        dueAt: now + 86_400_000, status: "pending", responseName: nil, responseNote: nil, respondedAt: nil,
        canceledAt: nil, lastRemindedAt: nil, reminderCount: nil,
        createdAt: now - 3_600_000, token: "preview-pending", linkStatus: "active"
      ),
      ReviewRequestSummary(
        id: "review-approved", videoId: "sample-campaign", videoTitle: "Q3 campaign cut v4",
        recipientName: "Owen Brooks", recipientEmail: "owen@example.com", message: nil,
        dueAt: now + 172_800_000, status: "approved", responseName: "Owen Brooks",
        responseNote: "The pacing feels great now. Approved for publishing.", respondedAt: now - 7_200_000,
        canceledAt: nil, lastRemindedAt: nil, reminderCount: nil,
        createdAt: now - 172_800_000, token: "preview-approved", linkStatus: "active"
      ),
      ReviewRequestSummary(
        id: "review-changes", videoId: "sample-mobile", videoTitle: "Mobile onboarding notes",
        recipientName: "Leah Park", recipientEmail: "leah@example.com", message: "Focus on the first-run experience.",
        dueAt: now + 259_200_000, status: "changes_requested", responseName: "Leah Park",
        responseNote: "Could we slow down the permissions section and add one more example?", respondedAt: now - 43_200_000,
        canceledAt: nil, lastRemindedAt: nil, reminderCount: nil,
        createdAt: now - 259_200_000, token: "preview-changes", linkStatus: "active"
      ),
    ]
  }()

  func videosPublisher() -> AnyPublisher<[VideoSummary], ClientError> {
    Just(sampleVideos).setFailureType(to: ClientError.self).eraseToAnyPublisher()
  }

  func reviewsPublisher() -> AnyPublisher<[ReviewRequestSummary], ClientError> {
    Just(sampleReviews).setFailureType(to: ClientError.self).eraseToAnyPublisher()
  }

  func videoPublisher(videoId: String) -> AnyPublisher<VideoPlayback, ClientError> {
    Just(VideoPlayback(url: URL(string: "https://media.w3.org/2010/05/sintel/trailer.mp4")!, finishedRendition: nil))
      .setFailureType(to: ClientError.self)
      .eraseToAnyPublisher()
  }

  func upload(video: CapturedVideo, title: String) async throws -> CreatedVideo {
    CreatedVideo(videoId: "preview-upload")
  }

  func createReviewRequest(
    videoId: String,
    recipientName: String,
    recipientEmail: String,
    message: String?,
    dueAt: Date?
  ) async throws -> CreatedReviewRequest {
    CreatedReviewRequest(reviewRequestId: "preview-review", shareLinkId: "preview-link", token: "preview")
  }

  func remindReviewRequest(reviewRequestId: String) async throws {}

  func cancelReviewRequest(reviewRequestId: String) async throws {}
}

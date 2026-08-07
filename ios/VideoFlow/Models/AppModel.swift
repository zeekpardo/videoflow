import Combine
import ConvexMobile
import Foundation
import Observation

@MainActor
@Observable
final class AppModel {
  var videos: [VideoSummary] = []
  var reviews: [ReviewRequestSummary] = []
  var isLoading = true
  var isUploading = false
  var errorMessage: String?

  @ObservationIgnored private let service: any VideoFlowServicing
  @ObservationIgnored private var subscriptions = Set<AnyCancellable>()

  init(service: any VideoFlowServicing) {
    self.service = service
  }

  func start() {
    guard subscriptions.isEmpty else { return }
    service.videosPublisher()
      .receive(on: DispatchQueue.main)
      .sink(receiveCompletion: handleCompletion) { [weak self] videos in
        self?.videos = videos
        self?.isLoading = false
      }
      .store(in: &subscriptions)
    service.reviewsPublisher()
      .receive(on: DispatchQueue.main)
      .sink(receiveCompletion: handleCompletion) { [weak self] reviews in self?.reviews = reviews }
      .store(in: &subscriptions)
  }

  private func handleCompletion(_ completion: Subscribers.Completion<ClientError>) {
    if case let .failure(error) = completion {
      errorMessage = error.localizedDescription
      isLoading = false
    }
  }

  func upload(_ video: CapturedVideo, title: String) async -> Bool {
    isUploading = true
    errorMessage = nil
    defer { isUploading = false }
    do {
      _ = try await service.upload(video: video, title: title)
      return true
    } catch is CancellationError {
      return false
    } catch {
      errorMessage = error.localizedDescription
      return false
    }
  }

  func createReview(
    for video: VideoSummary,
    recipientName: String,
    recipientEmail: String,
    message: String?,
    dueAt: Date?
  ) async -> Bool {
    errorMessage = nil
    do {
      _ = try await service.createReviewRequest(
        videoId: video.id,
        recipientName: recipientName,
        recipientEmail: recipientEmail,
        message: message,
        dueAt: dueAt
      )
      return true
    } catch is CancellationError {
      return false
    } catch {
      errorMessage = error.localizedDescription
      return false
    }
  }

  func remindReview(_ review: ReviewRequestSummary) async -> Bool {
    errorMessage = nil
    do {
      try await service.remindReviewRequest(reviewRequestId: review.id)
      return true
    } catch is CancellationError {
      return false
    } catch {
      errorMessage = error.localizedDescription
      return false
    }
  }

  func cancelReview(_ review: ReviewRequestSummary) async -> Bool {
    errorMessage = nil
    do {
      try await service.cancelReviewRequest(reviewRequestId: review.id)
      return true
    } catch is CancellationError {
      return false
    } catch {
      errorMessage = error.localizedDescription
      return false
    }
  }

  func playbackModel(for videoId: String) -> VideoPlaybackModel {
    VideoPlaybackModel(publisher: service.videoPublisher(videoId: videoId))
  }
}

@MainActor
@Observable
final class VideoPlaybackModel {
  var playback: VideoPlayback?
  var errorMessage: String?
  @ObservationIgnored private var subscription: AnyCancellable?

  init(publisher: AnyPublisher<VideoPlayback, ClientError>) {
    subscription = publisher
      .receive(on: DispatchQueue.main)
      .sink { [weak self] completion in
        if case let .failure(error) = completion { self?.errorMessage = error.localizedDescription }
      } receiveValue: { [weak self] playback in
        self?.playback = playback
      }
  }
}

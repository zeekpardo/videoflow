import AVFoundation
import CoreGraphics
import Foundation
import Observation

@MainActor
@Observable
final class EditorPlaybackController {
  @ObservationIgnored let player: AVPlayer
  @ObservationIgnored private let sourceURL: URL
  @ObservationIgnored private var timeObserver: Any?
  @ObservationIgnored private var compositionResult: EditorCompositionResult?
  @ObservationIgnored private var compositionGeneration = 0
  @ObservationIgnored private var editableSourceURL: URL?
  @ObservationIgnored private var sourceResolutionTask: Task<URL, Error>?

  var currentTime: Double = 0
  var duration: Double
  var isPlaying = false
  var trimStart: Double = 0
  var trimEnd: Double
  var sourceAspectRatio: Double = 16 / 9
  var thumbnails: [CGImage] = []
  var isPreparing = true
  var isRebuilding = false
  var isExporting = false
  var errorMessage: String?

  init(url: URL, fallbackDuration: Double) {
    sourceURL = url
    let safeDuration = max(0.25, fallbackDuration)
    duration = safeDuration
    trimEnd = safeDuration
    player = AVPlayer(url: url)
    player.volume = 1
    installTimeObserver()
    Task { await prepare() }
  }

  func togglePlayback() {
    if isPlaying {
      pause()
      return
    }
    if currentTime >= trimEnd - 0.05 {
      seek(to: trimStart)
    }
    player.play()
    isPlaying = true
  }

  func pause() {
    player.pause()
    isPlaying = false
  }

  func seek(to seconds: Double) {
    let target = min(max(seconds, trimStart), trimEnd)
    currentTime = target
    player.seek(
      to: CMTime(seconds: target, preferredTimescale: 600),
      toleranceBefore: .zero,
      toleranceAfter: .zero
    )
  }

  func setTrimStart(_ seconds: Double) {
    trimStart = min(max(0, seconds), trimEnd - 0.25)
    if currentTime < trimStart { seek(to: trimStart) }
  }

  func setTrimEnd(_ seconds: Double) {
    trimEnd = max(min(duration, seconds), trimStart + 0.25)
    if currentTime > trimEnd { seek(to: trimEnd) }
  }

  func apply(
    clips: [EditorClipSegment],
    transitions: [UUID: EditorTransitionStyle],
    includesAudio: Bool,
    canvasRatio: Double,
    titleText: String?,
    captionText: String?
  ) async {
    compositionGeneration &+= 1
    let generation = compositionGeneration
    let resumeTime = min(currentTime, clips.reduce(0) { $0 + $1.timelineDuration })
    let resumePlayback = isPlaying
    isRebuilding = true

    do {
      let editableSourceURL = try await resolveEditableSourceURL()
      let result = try await EditorCompositionEngine.build(
        sourceURL: editableSourceURL,
        clips: clips,
        transitions: transitions,
        includesAudio: includesAudio,
        canvasRatio: canvasRatio,
        titleText: titleText,
        captionText: captionText
      )
      guard generation == compositionGeneration else { return }

      pause()
      let item = AVPlayerItem(asset: result.composition)
      item.audioMix = result.audioMix
      item.videoComposition = result.videoComposition
      compositionResult = result
      player.replaceCurrentItem(with: item)
      duration = result.duration
      trimStart = 0
      trimEnd = result.duration
      seek(to: min(resumeTime, result.duration))
      errorMessage = nil
      if resumePlayback { togglePlayback() }
    } catch is CancellationError {
      // A newer composition superseded this build.
    } catch {
      guard generation == compositionGeneration else { return }
      errorMessage = error.localizedDescription
    }

    if generation == compositionGeneration {
      isRebuilding = false
    }
  }

  func exportCurrentEdit(title: String) async throws -> URL {
    guard let compositionResult else {
      throw EditorCompositionError.exportUnavailable
    }

    isExporting = true
    defer { isExporting = false }
    let safeTitle = title
      .components(separatedBy: CharacterSet.alphanumerics.inverted)
      .filter { !$0.isEmpty }
      .prefix(5)
      .joined(separator: "-")
    let fileName = "\(safeTitle.isEmpty ? "VideoFlow" : safeTitle)-\(UUID().uuidString.prefix(8)).mp4"
    let outputURL = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
    try await EditorCompositionEngine.export(compositionResult, to: outputURL)
    return outputURL
  }

  func stop() {
    pause()
    sourceResolutionTask?.cancel()
    sourceResolutionTask = nil
    if let editableSourceURL, editableSourceURL != sourceURL {
      try? FileManager.default.removeItem(at: editableSourceURL)
      self.editableSourceURL = nil
    }
    if let timeObserver {
      player.removeTimeObserver(timeObserver)
      self.timeObserver = nil
    }
  }

  private func installTimeObserver() {
    timeObserver = player.addPeriodicTimeObserver(
      forInterval: CMTime(seconds: 1 / 30, preferredTimescale: 600),
      queue: .main
    ) { [weak self] time in
      Task { @MainActor in
        guard let self else { return }
        let seconds = time.seconds
        guard seconds.isFinite else { return }
        self.currentTime = seconds
        self.isPlaying = self.player.rate != 0
        if seconds >= self.trimEnd {
          self.pause()
          self.seek(to: self.trimStart)
        }
      }
    }
  }

  private func prepare() async {
    do {
      let editableSourceURL = try await resolveEditableSourceURL()
      let asset = AVURLAsset(url: editableSourceURL)
      if let videoTrack = try await asset.loadTracks(withMediaType: .video).first {
        let naturalSize = try await videoTrack.load(.naturalSize)
        let transform = try await videoTrack.load(.preferredTransform)
        let transformedSize = naturalSize.applying(transform)
        let width = abs(transformedSize.width)
        let height = abs(transformedSize.height)
        if width > 0, height > 0 {
          sourceAspectRatio = Double(width / height)
        }
      }
      let loadedDuration = try await asset.load(.duration).seconds
      if loadedDuration.isFinite, loadedDuration > 0, compositionResult == nil {
        duration = loadedDuration
        trimEnd = loadedDuration
      }
      thumbnails = await generateThumbnails(from: asset, count: 10)
    } catch {
      errorMessage = error.localizedDescription
    }
    isPreparing = false
  }

  private func resolveEditableSourceURL() async throws -> URL {
    if let editableSourceURL { return editableSourceURL }
    if sourceURL.isFileURL {
      editableSourceURL = sourceURL
      return sourceURL
    }
    if let sourceResolutionTask {
      return try await sourceResolutionTask.value
    }

    let remoteURL = sourceURL
    let task = Task<URL, Error> {
      let (downloadedURL, response) = try await URLSession.shared.download(from: remoteURL)
      guard let httpResponse = response as? HTTPURLResponse,
            (200..<300).contains(httpResponse.statusCode)
      else {
        throw URLError(.badServerResponse)
      }
      let pathExtension = remoteURL.pathExtension.isEmpty ? "mp4" : remoteURL.pathExtension
      let destination = FileManager.default.temporaryDirectory
        .appendingPathComponent("VideoFlow-Editor-\(UUID().uuidString)")
        .appendingPathExtension(pathExtension)
      try FileManager.default.moveItem(at: downloadedURL, to: destination)
      return destination
    }
    sourceResolutionTask = task
    do {
      let localURL = try await task.value
      editableSourceURL = localURL
      sourceResolutionTask = nil
      return localURL
    } catch {
      sourceResolutionTask = nil
      throw error
    }
  }

  private func generateThumbnails(from asset: AVAsset, count: Int) async -> [CGImage] {
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: 240, height: 135)
    generator.requestedTimeToleranceBefore = CMTime(seconds: 0.15, preferredTimescale: 600)
    generator.requestedTimeToleranceAfter = CMTime(seconds: 0.15, preferredTimescale: 600)

    var images: [CGImage] = []
    for index in 0..<count {
      let fraction = Double(index) / Double(max(1, count - 1))
      let time = CMTime(seconds: duration * fraction, preferredTimescale: 600)
      if let result = try? await generator.image(at: time) {
        images.append(result.image)
      }
    }
    return images
  }
}

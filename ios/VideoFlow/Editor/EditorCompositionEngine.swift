import AVFoundation
import CoreGraphics
import Foundation
import QuartzCore

struct EditorCompositionResult {
  let composition: AVMutableComposition
  let audioMix: AVAudioMix?
  let videoComposition: AVVideoComposition
  let duration: Double
}

enum EditorCompositionError: LocalizedError {
  case missingVideoTrack
  case emptyEdit
  case exportUnavailable
  case exportFailed(String)

  var errorDescription: String? {
    switch self {
    case .missingVideoTrack:
      "The source video does not contain a readable video track."
    case .emptyEdit:
      "The edit does not contain any playable clips."
    case .exportUnavailable:
      "VideoFlow could not create an export session for this edit."
    case let .exportFailed(message):
      "The video export failed: \(message)"
    }
  }
}

enum EditorCompositionEngine {
  private struct PlacedClip {
    let clip: EditorClipSegment
    let videoTrack: AVMutableCompositionTrack
    let audioTrack: AVMutableCompositionTrack?
    let start: CMTime
    let duration: CMTime
    let transitionDuration: CMTime
    let transitionStyle: EditorTransitionStyle

    var end: CMTime { start + duration }
  }

  private final class ExportSessionBox: @unchecked Sendable {
    let session: AVAssetExportSession
    init(_ session: AVAssetExportSession) { self.session = session }
  }

  static func build(
    sourceURL: URL,
    clips: [EditorClipSegment],
    transitions: [UUID: EditorTransitionStyle],
    includesAudio: Bool,
    canvasRatio: Double,
    titleText: String?,
    captionText: String?
  ) async throws -> EditorCompositionResult {
    guard !clips.isEmpty else { throw EditorCompositionError.emptyEdit }

    let asset = AVURLAsset(url: sourceURL)
    guard let sourceVideoTrack = try await asset.loadTracks(withMediaType: .video).first else {
      throw EditorCompositionError.missingVideoTrack
    }
    let sourceAudioTrack = try await asset.loadTracks(withMediaType: .audio).first
    let sourceTransform = try await sourceVideoTrack.load(.preferredTransform)
    let naturalSize = try await sourceVideoTrack.load(.naturalSize)
    let nominalFrameRate = try await sourceVideoTrack.load(.nominalFrameRate)

    let composition = AVMutableComposition()
    let videoTracks = (0..<2).compactMap { _ in
      composition.addMutableTrack(
        withMediaType: .video,
        preferredTrackID: kCMPersistentTrackID_Invalid
      )
    }
    guard videoTracks.count == 2 else {
      throw EditorCompositionError.missingVideoTrack
    }
    videoTracks.forEach { $0.preferredTransform = .identity }

    let audioTracks: [AVMutableCompositionTrack]
    if sourceAudioTrack != nil {
      audioTracks = (0..<2).compactMap { _ in
        composition.addMutableTrack(
          withMediaType: .audio,
          preferredTrackID: kCMPersistentTrackID_Invalid
        )
      }
    } else {
      audioTracks = []
    }
    let audioParameters = audioTracks.map {
      AVMutableAudioMixInputParameters(track: $0)
    }

    var cursor = CMTime.zero
    var placedClips: [PlacedClip] = []
    for (index, clip) in clips.enumerated() {
      let transitionStyle = index == 0 ? .cut : transitions[clip.id] ?? .cut
      let transitionSeconds = index == 0 ? 0 : EditorTransitionTiming.duration(
        style: transitionStyle,
        outgoingDuration: clips[index - 1].timelineDuration,
        incomingDuration: clip.timelineDuration
      )
      let transitionDuration = CMTime(seconds: transitionSeconds, preferredTimescale: 600)
      let start = cursor - transitionDuration
      let trackIndex = index % 2
      let videoTrack = videoTracks[trackIndex]
      let audioTrack = audioTracks.indices.contains(trackIndex) ? audioTracks[trackIndex] : nil
      let sourceRange = CMTimeRange(
        start: CMTime(seconds: clip.sourceStart, preferredTimescale: 600),
        duration: CMTime(seconds: clip.sourceDuration, preferredTimescale: 600)
      )
      try videoTrack.insertTimeRange(sourceRange, of: sourceVideoTrack, at: start)

      if let sourceAudioTrack, let audioTrack {
        try audioTrack.insertTimeRange(sourceRange, of: sourceAudioTrack, at: start)
      }

      let insertedRange = CMTimeRange(start: start, duration: sourceRange.duration)
      let scaledDuration = CMTime(
        seconds: clip.timelineDuration,
        preferredTimescale: 600
      )
      if abs(clip.playbackRate - 1) > 0.001 {
        videoTrack.scaleTimeRange(insertedRange, toDuration: scaledDuration)
        audioTrack?.scaleTimeRange(insertedRange, toDuration: scaledDuration)
      }

      if audioParameters.indices.contains(trackIndex) {
        audioParameters[trackIndex].setVolume(
          includesAudio ? Float(clip.volume) : 0,
          at: start
        )
      }
      placedClips.append(PlacedClip(
        clip: clip,
        videoTrack: videoTrack,
        audioTrack: audioTrack,
        start: start,
        duration: scaledDuration,
        transitionDuration: transitionDuration,
        transitionStyle: transitionStyle
      ))
      cursor = start + scaledDuration
    }

    guard cursor.seconds.isFinite, cursor.seconds > 0 else {
      throw EditorCompositionError.emptyEdit
    }

    if includesAudio {
      for index in placedClips.indices.dropFirst() {
        let incoming = placedClips[index]
        guard incoming.transitionDuration > .zero else { continue }
        let outgoing = placedClips[index - 1]
        let transitionRange = CMTimeRange(
          start: incoming.start,
          duration: incoming.transitionDuration
        )
        audioParameters[(index - 1) % 2].setVolumeRamp(
          fromStartVolume: Float(outgoing.clip.volume),
          toEndVolume: 0,
          timeRange: transitionRange
        )
        audioParameters[index % 2].setVolumeRamp(
          fromStartVolume: 0,
          toEndVolume: Float(incoming.clip.volume),
          timeRange: transitionRange
        )
      }
    }

    let audioMix: AVAudioMix?
    if !audioParameters.isEmpty {
      let mix = AVMutableAudioMix()
      mix.inputParameters = audioParameters
      audioMix = mix
    } else {
      audioMix = nil
    }

    let videoComposition = makeVideoComposition(
      placedClips: placedClips,
      sourceSize: naturalSize,
      sourceTransform: sourceTransform,
      duration: cursor,
      canvasRatio: canvasRatio,
      nominalFrameRate: nominalFrameRate,
      titleText: titleText,
      captionText: captionText
    )

    return EditorCompositionResult(
      composition: composition,
      audioMix: audioMix,
      videoComposition: videoComposition,
      duration: cursor.seconds
    )
  }

  static func export(
    _ result: EditorCompositionResult,
    to outputURL: URL
  ) async throws {
    guard let session = AVAssetExportSession(
      asset: result.composition,
      presetName: AVAssetExportPresetHighestQuality
    ) else {
      throw EditorCompositionError.exportUnavailable
    }

    session.audioMix = result.audioMix
    session.videoComposition = result.videoComposition
    session.outputURL = outputURL
    session.shouldOptimizeForNetworkUse = true
    if session.supportedFileTypes.contains(.mp4) {
      session.outputFileType = .mp4
    } else if session.supportedFileTypes.contains(.mov) {
      session.outputFileType = .mov
    } else {
      throw EditorCompositionError.exportUnavailable
    }

    let box = ExportSessionBox(session)
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      box.session.exportAsynchronously {
        switch box.session.status {
        case .completed:
          continuation.resume()
        case .failed:
          continuation.resume(throwing: EditorCompositionError.exportFailed(
            box.session.error?.localizedDescription ?? "Unknown export error"
          ))
        case .cancelled:
          continuation.resume(throwing: CancellationError())
        default:
          continuation.resume(throwing: EditorCompositionError.exportFailed(
            box.session.error?.localizedDescription ?? "Export stopped unexpectedly"
          ))
        }
      }
    }
  }

  private static func makeVideoComposition(
    placedClips: [PlacedClip],
    sourceSize: CGSize,
    sourceTransform: CGAffineTransform,
    duration: CMTime,
    canvasRatio: Double,
    nominalFrameRate: Float,
    titleText: String?,
    captionText: String?
  ) -> AVMutableVideoComposition {
    let transformedRect = CGRect(origin: .zero, size: sourceSize).applying(sourceTransform)
    let orientedSize = CGSize(
      width: abs(transformedRect.width),
      height: abs(transformedRect.height)
    )
    let safeRatio = max(0.2, canvasRatio)
    let longEdge = max(orientedSize.width, orientedSize.height)
    let rawRenderSize: CGSize
    if safeRatio >= 1 {
      rawRenderSize = CGSize(width: longEdge, height: longEdge / safeRatio)
    } else {
      rawRenderSize = CGSize(width: longEdge * safeRatio, height: longEdge)
    }
    let renderSize = CGSize(
      width: max(2, (rawRenderSize.width / 2).rounded() * 2),
      height: max(2, (rawRenderSize.height / 2).rounded() * 2)
    )

    let normalize = CGAffineTransform(
      translationX: -transformedRect.minX,
      y: -transformedRect.minY
    )
    let scale = min(
      renderSize.width / max(1, orientedSize.width),
      renderSize.height / max(1, orientedSize.height)
    )
    let fittedSize = CGSize(width: orientedSize.width * scale, height: orientedSize.height * scale)
    let center = CGAffineTransform(
      translationX: (renderSize.width - fittedSize.width) / 2,
      y: (renderSize.height - fittedSize.height) / 2
    )
    let finalTransform = sourceTransform
      .concatenating(normalize)
      .concatenating(CGAffineTransform(scaleX: scale, y: scale))
      .concatenating(center)

    var instructions: [AVMutableVideoCompositionInstruction] = []
    for index in placedClips.indices {
      let placed = placedClips[index]
      let incomingDuration = placed.transitionDuration
      let outgoingDuration = index + 1 < placedClips.count
        ? placedClips[index + 1].transitionDuration
        : .zero
      let passStart = placed.start + incomingDuration
      let passDuration = placed.duration - incomingDuration - outgoingDuration
      if passDuration > .zero {
        let passInstruction = AVMutableVideoCompositionInstruction()
        passInstruction.timeRange = CMTimeRange(start: passStart, duration: passDuration)
        passInstruction.backgroundColor = CGColor(gray: 0, alpha: 1)
        let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: placed.videoTrack)
        layer.setTransform(finalTransform, at: passStart)
        passInstruction.layerInstructions = [layer]
        instructions.append(passInstruction)
      }

      guard index > 0, incomingDuration > .zero else { continue }
      let outgoing = placedClips[index - 1]
      let transitionRange = CMTimeRange(start: placed.start, duration: incomingDuration)
      let transitionInstruction = AVMutableVideoCompositionInstruction()
      transitionInstruction.timeRange = transitionRange
      transitionInstruction.backgroundColor = CGColor(gray: 0, alpha: 1)
      let outgoingLayer = AVMutableVideoCompositionLayerInstruction(assetTrack: outgoing.videoTrack)
      let incomingLayer = AVMutableVideoCompositionLayerInstruction(assetTrack: placed.videoTrack)
      configureTransition(
        style: placed.transitionStyle,
        outgoing: outgoingLayer,
        incoming: incomingLayer,
        baseTransform: finalTransform,
        renderSize: renderSize,
        timeRange: transitionRange
      )
      transitionInstruction.layerInstructions = [incomingLayer, outgoingLayer]
      instructions.append(transitionInstruction)
    }

    let videoComposition = AVMutableVideoComposition()
    videoComposition.renderSize = renderSize
    let framesPerSecond = nominalFrameRate > 0 ? min(60, nominalFrameRate) : 30
    videoComposition.frameDuration = CMTime(
      value: 1,
      timescale: CMTimeScale(max(1, Int32(framesPerSecond.rounded())))
    )
    videoComposition.instructions = instructions.sorted {
      CMTimeCompare($0.timeRange.start, $1.timeRange.start) < 0
    }

    if titleText != nil || captionText != nil {
      let parentLayer = CALayer()
      parentLayer.frame = CGRect(origin: .zero, size: renderSize)
      let videoLayer = CALayer()
      videoLayer.frame = parentLayer.bounds
      parentLayer.addSublayer(videoLayer)

      if let titleText {
        parentLayer.addSublayer(makeTextLayer(
          text: titleText,
          frame: CGRect(
            x: renderSize.width * 0.08,
            y: renderSize.height * 0.78,
            width: renderSize.width * 0.84,
            height: renderSize.height * 0.14
          ),
          fontSize: renderSize.height * 0.043,
          alignment: .left,
          backgroundOpacity: 0.62
        ))
      }

      if let captionText {
        parentLayer.addSublayer(makeTextLayer(
          text: captionText,
          frame: CGRect(
            x: renderSize.width * 0.09,
            y: renderSize.height * 0.08,
            width: renderSize.width * 0.82,
            height: renderSize.height * 0.13
          ),
          fontSize: renderSize.height * 0.038,
          alignment: .center,
          backgroundOpacity: 0.78
        ))
      }

      videoComposition.animationTool = AVVideoCompositionCoreAnimationTool(
        postProcessingAsVideoLayer: videoLayer,
        in: parentLayer
      )
    }

    return videoComposition
  }

  private static func configureTransition(
    style: EditorTransitionStyle,
    outgoing: AVMutableVideoCompositionLayerInstruction,
    incoming: AVMutableVideoCompositionLayerInstruction,
    baseTransform: CGAffineTransform,
    renderSize: CGSize,
    timeRange: CMTimeRange
  ) {
    outgoing.setTransform(baseTransform, at: timeRange.start)
    incoming.setTransform(baseTransform, at: timeRange.start)

    switch style {
    case .cut:
      break
    case .dissolve:
      outgoing.setOpacityRamp(fromStartOpacity: 1, toEndOpacity: 0, timeRange: timeRange)
      incoming.setOpacityRamp(fromStartOpacity: 0, toEndOpacity: 1, timeRange: timeRange)
    case .slide:
      let incomingStart = baseTransform.concatenating(
        CGAffineTransform(translationX: renderSize.width, y: 0)
      )
      let outgoingEnd = baseTransform.concatenating(
        CGAffineTransform(translationX: -renderSize.width, y: 0)
      )
      incoming.setTransformRamp(
        fromStart: incomingStart,
        toEnd: baseTransform,
        timeRange: timeRange
      )
      outgoing.setTransformRamp(
        fromStart: baseTransform,
        toEnd: outgoingEnd,
        timeRange: timeRange
      )
    case .fade:
      let half = CMTimeMultiplyByFloat64(timeRange.duration, multiplier: 0.5)
      let firstHalf = CMTimeRange(start: timeRange.start, duration: half)
      let secondHalf = CMTimeRange(start: timeRange.start + half, duration: timeRange.duration - half)
      outgoing.setOpacityRamp(fromStartOpacity: 1, toEndOpacity: 0, timeRange: firstHalf)
      outgoing.setOpacity(0, at: secondHalf.start)
      incoming.setOpacity(0, at: timeRange.start)
      incoming.setOpacityRamp(fromStartOpacity: 0, toEndOpacity: 1, timeRange: secondHalf)
    }
  }

  private static func makeTextLayer(
    text: String,
    frame: CGRect,
    fontSize: CGFloat,
    alignment: CATextLayerAlignmentMode,
    backgroundOpacity: Float
  ) -> CALayer {
    let background = CALayer()
    background.frame = frame
    background.backgroundColor = CGColor(gray: 0.04, alpha: CGFloat(backgroundOpacity))
    background.cornerRadius = max(8, frame.height * 0.14)

    let textLayer = CATextLayer()
    textLayer.string = text
    textLayer.frame = background.bounds.insetBy(dx: frame.width * 0.035, dy: frame.height * 0.18)
    textLayer.fontSize = fontSize
    textLayer.foregroundColor = CGColor(gray: 1, alpha: 1)
    textLayer.alignmentMode = alignment
    textLayer.contentsScale = 2
    textLayer.isWrapped = true
    background.addSublayer(textLayer)
    return background
  }
}

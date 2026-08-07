import Foundation
import Observation
import SwiftUI

enum EditorPrimaryTool: String, CaseIterable, Identifiable {
  case edit = "Edit"
  case audio = "Audio"
  case text = "Text"
  case overlay = "Overlay"
  case captions = "Captions"
  case canvas = "Canvas"

  static let allCases: [EditorPrimaryTool] = [
    .edit, .audio, .text, .captions, .canvas,
  ]

  var id: String { rawValue }

  var symbol: String {
    switch self {
    case .edit: "slider.horizontal.3"
    case .audio: "waveform"
    case .text: "textformat"
    case .overlay: "square.on.square"
    case .captions: "captions.bubble"
    case .canvas: "rectangle.inset.filled"
    }
  }
}

enum EditorClipAction: String, CaseIterable, Identifiable {
  case split = "Split"
  case trim = "Trim"
  case speed = "Speed"
  case volume = "Volume"
  case duplicate = "Duplicate"
  case delete = "Delete"

  var id: String { rawValue }

  var symbol: String {
    switch self {
    case .split: "scissors"
    case .trim: "timeline.selection"
    case .speed: "speedometer"
    case .volume: "speaker.wave.2"
    case .duplicate: "plus.square.on.square"
    case .delete: "trash"
    }
  }
}

enum EditorCanvas: String, CaseIterable, Identifiable, Codable {
  case original = "Original"
  case landscape = "16:9"
  case square = "1:1"
  case portrait = "4:5"
  case vertical = "9:16"

  var id: String { rawValue }

  var ratio: CGFloat {
    switch self {
    case .original, .landscape: 16 / 9
    case .square: 1
    case .portrait: 4 / 5
    case .vertical: 9 / 16
    }
  }
}

enum EditorTransitionStyle: String, CaseIterable, Identifiable, Equatable, Codable {
  case cut = "Cut"
  case dissolve = "Dissolve"
  case slide = "Slide"
  case fade = "Fade"

  var id: String { rawValue }

  var symbol: String {
    switch self {
    case .cut: "bowtie"
    case .dissolve: "circle.lefthalf.filled"
    case .slide: "rectangle.split.2x1"
    case .fade: "circle.dotted"
    }
  }
}

enum EditorTransitionTiming {
  static let preferredDuration = 0.35

  static func duration(
    style: EditorTransitionStyle,
    outgoingDuration: Double,
    incomingDuration: Double
  ) -> Double {
    guard style != .cut else { return 0 }
    return min(
      preferredDuration,
      outgoingDuration * 0.45,
      incomingDuration * 0.45
    )
  }
}

struct EditorClipSegment: Identifiable, Equatable, Codable {
  let id: UUID
  var sourceStart: Double
  var sourceEnd: Double
  var playbackRate: Double
  var volume: Double
  var label: String
  var visualPhase: Int

  init(
    id: UUID = UUID(),
    sourceStart: Double,
    sourceEnd: Double,
    playbackRate: Double = 1,
    volume: Double = 1,
    label: String,
    visualPhase: Int = 0
  ) {
    self.id = id
    self.sourceStart = sourceStart
    self.sourceEnd = sourceEnd
    self.playbackRate = playbackRate
    self.volume = volume
    self.label = label
    self.visualPhase = visualPhase
  }

  var sourceDuration: Double { max(0, sourceEnd - sourceStart) }
  var timelineDuration: Double { sourceDuration / max(0.25, playbackRate) }
}

struct EditorProjectDraft: Codable, Equatable {
  static let currentVersion = 1

  let version: Int
  let sourceDuration: Double
  let clips: [EditorClipSegment]
  let selectedClipID: UUID?
  let hasAudio: Bool
  let hasTitle: Bool
  let hasOverlay: Bool
  let hasCaptions: Bool
  let titleText: String
  let captionText: String
  let transitions: [UUID: EditorTransitionStyle]
}

@MainActor
@Observable
final class EditorProjectModel {
  private struct Snapshot: Equatable {
    var clips: [EditorClipSegment]
    var selectedClipID: UUID?
    var hasAudio: Bool
    var hasTitle: Bool
    var hasOverlay: Bool
    var hasCaptions: Bool
    var titleText: String
    var captionText: String
    var transitions: [UUID: EditorTransitionStyle]
  }

  var clips: [EditorClipSegment]
  var selectedClipID: UUID?
  var hasAudio = true
  var hasTitle = false
  var hasOverlay = false
  var hasCaptions = false
  var titleText = "VideoFlow"
  var captionText = "Meet the faster review flow for teams."
  var transitions: [UUID: EditorTransitionStyle] = [:]
  private(set) var renderRevision = 0

  private var undoStack: [Snapshot] = []
  private var redoStack: [Snapshot] = []
  private var interactiveSnapshot: Snapshot?
  private let maximumSourceDuration: Double

  init(duration: Double, draft: EditorProjectDraft? = nil) {
    let sourceDuration = max(0.25, duration)
    maximumSourceDuration = sourceDuration
    if let draft,
       draft.version == EditorProjectDraft.currentVersion,
       abs(draft.sourceDuration - sourceDuration) < 1,
       !draft.clips.isEmpty,
       draft.clips.allSatisfy({ $0.sourceStart >= 0 && $0.sourceEnd <= sourceDuration + 0.01 && $0.sourceEnd - $0.sourceStart >= 0.25 })
    {
      clips = draft.clips
      selectedClipID = draft.clips.contains(where: { $0.id == draft.selectedClipID }) ? draft.selectedClipID : draft.clips.first?.id
      hasAudio = draft.hasAudio
      hasTitle = draft.hasTitle
      hasOverlay = draft.hasOverlay
      hasCaptions = draft.hasCaptions
      titleText = draft.titleText
      captionText = draft.captionText
      transitions = draft.transitions.filter { element in
        draft.clips.contains(where: { $0.id == element.key })
      }
      return
    }
    let clip = EditorClipSegment(
      sourceStart: 0,
      sourceEnd: sourceDuration,
      label: "Main clip"
    )
    clips = [clip]
    selectedClipID = clip.id
  }

  var canUndo: Bool { !undoStack.isEmpty }
  var canRedo: Bool { !redoStack.isEmpty }

  var draft: EditorProjectDraft {
    EditorProjectDraft(
      version: EditorProjectDraft.currentVersion,
      sourceDuration: maximumSourceDuration,
      clips: clips,
      selectedClipID: selectedClipID,
      hasAudio: hasAudio,
      hasTitle: hasTitle,
      hasOverlay: hasOverlay,
      hasCaptions: hasCaptions,
      titleText: titleText,
      captionText: captionText,
      transitions: transitions
    )
  }

  var selectedClip: EditorClipSegment? {
    clips.first { $0.id == selectedClipID }
  }

  var timelineDuration: Double {
    guard let last = clips.last else { return 0 }
    return timelineStart(for: last.id) + last.timelineDuration
  }

  var selectedSpeed: Double { selectedClip?.playbackRate ?? 1 }
  var selectedVolume: Double { selectedClip?.volume ?? 1 }

  func timelineStart(for clipID: UUID) -> Double {
    var cursor = 0.0
    for (index, clip) in clips.enumerated() {
      if index > 0 {
        cursor -= transitionDuration(before: clip.id)
      }
      if clip.id == clipID { return cursor }
      cursor += clip.timelineDuration
    }
    return cursor
  }

  func select(_ clipID: UUID?) {
    selectedClipID = clipID
  }

  func selectClip(at time: Double) {
    selectedClipID = clipIndex(at: time).map { clips[$0].id }
  }

  func split(at time: Double) {
    guard let index = clips.firstIndex(where: { $0.id == selectedClipID }) else { return }
    let original = clips[index]
    let localTimelineTime = time - timelineStart(for: original.id)
    let sourceSplit = original.sourceStart + localTimelineTime * original.playbackRate
    guard sourceSplit > original.sourceStart + 0.25,
          sourceSplit < original.sourceEnd - 0.25
    else { return }

    checkpoint()
    let left = EditorClipSegment(
      id: original.id,
      sourceStart: original.sourceStart,
      sourceEnd: sourceSplit,
      playbackRate: original.playbackRate,
      volume: original.volume,
      label: original.label,
      visualPhase: original.visualPhase
    )
    let right = EditorClipSegment(
      sourceStart: sourceSplit,
      sourceEnd: original.sourceEnd,
      playbackRate: original.playbackRate,
      volume: original.volume,
      label: "\(original.label) \(clips.count + 1)",
      visualPhase: original.visualPhase + 1
    )
    clips.replaceSubrange(index...index, with: [left, right])
    transitions[right.id] = .cut
    selectedClipID = right.id
    markRenderChanged()
  }

  func duplicateSelected() {
    guard let index = clips.firstIndex(where: { $0.id == selectedClipID }) else { return }
    checkpoint()
    let source = clips[index]
    let copy = EditorClipSegment(
      sourceStart: source.sourceStart,
      sourceEnd: source.sourceEnd,
      playbackRate: source.playbackRate,
      volume: source.volume,
      label: "\(source.label) copy",
      visualPhase: source.visualPhase + 1
    )
    clips.insert(copy, at: index + 1)
    transitions[copy.id] = .cut
    selectedClipID = copy.id
    markRenderChanged()
  }

  func deleteSelected() {
    guard clips.count > 1,
          let index = clips.firstIndex(where: { $0.id == selectedClipID })
    else { return }

    checkpoint()
    let removed = clips.remove(at: index)
    transitions.removeValue(forKey: removed.id)
    if index == 0, let firstClip = clips.first {
      transitions.removeValue(forKey: firstClip.id)
    }
    selectedClipID = clips[min(index, clips.count - 1)].id
    markRenderChanged()
  }

  func transitionStyle(before clipID: UUID) -> EditorTransitionStyle {
    transitions[clipID] ?? .cut
  }

  func transitionDuration(before clipID: UUID) -> Double {
    guard let index = clips.firstIndex(where: { $0.id == clipID }), index > 0 else { return 0 }
    return EditorTransitionTiming.duration(
      style: transitionStyle(before: clipID),
      outgoingDuration: clips[index - 1].timelineDuration,
      incomingDuration: clips[index].timelineDuration
    )
  }

  func setTransitionStyle(_ style: EditorTransitionStyle, before clipID: UUID) {
    guard transitions[clipID] != style else { return }
    checkpoint()
    transitions[clipID] = style
    markRenderChanged()
  }

  func beginInteractiveEdit() {
    if interactiveSnapshot == nil {
      interactiveSnapshot = snapshot
    }
  }

  func endInteractiveEdit() {
    guard let before = interactiveSnapshot else { return }
    interactiveSnapshot = nil
    if before != snapshot {
      undoStack.append(before)
      redoStack.removeAll()
      markRenderChanged()
    }
  }

  func setSelectedStart(_ time: Double) {
    guard let index = clips.firstIndex(where: { $0.id == selectedClipID }) else { return }
    clips[index].sourceStart = min(max(0, time), clips[index].sourceEnd - 0.25)
  }

  func setSelectedEnd(_ time: Double) {
    guard let index = clips.firstIndex(where: { $0.id == selectedClipID }) else { return }
    clips[index].sourceEnd = min(
      maximumSourceDuration,
      max(time, clips[index].sourceStart + 0.25)
    )
  }

  func setSelectedSpeed(_ value: Double) {
    guard let index = clips.firstIndex(where: { $0.id == selectedClipID }) else { return }
    clips[index].playbackRate = min(max(0.25, value), 4)
  }

  func setSelectedVolume(_ value: Double) {
    guard let index = clips.firstIndex(where: { $0.id == selectedClipID }) else { return }
    clips[index].volume = min(max(0, value), 1)
  }

  func setTitleText(_ value: String) {
    guard titleText != value else { return }
    titleText = value
    markRenderChanged()
  }

  func setCaptionText(_ value: String) {
    guard captionText != value else { return }
    captionText = value
    markRenderChanged()
  }

  func toggleAudio() {
    checkpoint()
    hasAudio.toggle()
    markRenderChanged()
  }

  func toggleTitle() {
    checkpoint()
    hasTitle.toggle()
    markRenderChanged()
  }

  func toggleOverlay() {
    checkpoint()
    hasOverlay.toggle()
    markRenderChanged()
  }

  func toggleCaptions() {
    checkpoint()
    hasCaptions.toggle()
    markRenderChanged()
  }

  func undo() {
    guard let previous = undoStack.popLast() else { return }
    redoStack.append(snapshot)
    restore(previous)
    markRenderChanged()
  }

  func redo() {
    guard let next = redoStack.popLast() else { return }
    undoStack.append(snapshot)
    restore(next)
    markRenderChanged()
  }

  private func clipIndex(at time: Double) -> Int? {
    guard !clips.isEmpty else { return nil }
    let clamped = min(max(0, time), timelineDuration)
    for index in clips.indices.reversed() {
      let clip = clips[index]
      let start = timelineStart(for: clip.id)
      let end = start + clip.timelineDuration
      if clamped >= start && (clamped < end || index == clips.count - 1) {
        return index
      }
    }
    return clips.indices.last
  }

  private func markRenderChanged() {
    renderRevision &+= 1
  }

  private var snapshot: Snapshot {
    Snapshot(
      clips: clips,
      selectedClipID: selectedClipID,
      hasAudio: hasAudio,
      hasTitle: hasTitle,
      hasOverlay: hasOverlay,
      hasCaptions: hasCaptions,
      titleText: titleText,
      captionText: captionText,
      transitions: transitions
    )
  }

  private func checkpoint() {
    undoStack.append(snapshot)
    redoStack.removeAll()
  }

  private func restore(_ snapshot: Snapshot) {
    clips = snapshot.clips
    selectedClipID = snapshot.selectedClipID
    hasAudio = snapshot.hasAudio
    hasTitle = snapshot.hasTitle
    hasOverlay = snapshot.hasOverlay
    hasCaptions = snapshot.hasCaptions
    titleText = snapshot.titleText
    captionText = snapshot.captionText
    transitions = snapshot.transitions
  }
}

import AVFoundation
import SwiftUI
import UIKit

private enum EditorToolShelfLevel {
  case primary
  case clip
}

struct NativeVideoEditorView: View {
  @Environment(\.dismiss) private var dismiss
  let video: VideoSummary
  @State private var playback: EditorPlaybackController
  @State private var project: EditorProjectModel
  @State private var selectedTool: EditorPrimaryTool = .edit
  @State private var selectedAction: EditorClipAction = .trim
  @State private var canvas: EditorCanvas = .original
  @State private var toolShelfLevel: EditorToolShelfLevel = .clip
  @State private var showExportSettings = false
  @State private var draftStatus: String

  private var auxiliaryTrackCount: Int {
    [project.hasTitle, project.hasOverlay, project.hasCaptions].filter { $0 }.count
  }

  private var effectiveCanvasRatio: CGFloat {
    canvas == .original ? CGFloat(playback.sourceAspectRatio) : canvas.ratio
  }

  private var canvasLabel: String {
    guard canvas == .original else { return canvas.rawValue }
    if effectiveCanvasRatio < 0.75 { return "Original · 9:16" }
    if effectiveCanvasRatio < 1.15 { return "Original · 1:1" }
    return "Original · 16:9"
  }

  private var showsContextPanel: Bool {
    guard selectedTool == .edit else { return true }
    return selectedAction == .speed || selectedAction == .volume
  }

  init(video: VideoSummary, sourceURL: URL) {
    self.video = video
    let duration = max(0.25, video.durationMs / 1_000)
    let savedDraft = EditorDraftStore.load(videoID: video.id)
    _playback = State(initialValue: EditorPlaybackController(
      url: sourceURL,
      fallbackDuration: duration
    ))
    _project = State(initialValue: EditorProjectModel(duration: duration, draft: savedDraft?.project))
    _canvas = State(initialValue: savedDraft?.canvas ?? .original)
    _draftStatus = State(initialValue: savedDraft == nil ? "Autosave on" : "Draft restored")
  }

  var body: some View {
    GeometryReader { geometry in
      let layout = VerticalEditorLayout(
        availableHeight: geometry.size.height,
        canvasRatio: effectiveCanvasRatio,
        auxiliaryTrackCount: auxiliaryTrackCount,
        showsInspector: showsContextPanel
      )

      VStack(spacing: 0) {
        EditorTopBar(
          title: video.title,
          subtitle: draftStatus,
          canUndo: project.canUndo,
          canRedo: project.canRedo,
          close: close,
          undo: project.undo,
          redo: project.redo,
          export: { showExportSettings = true }
        )
        .fixedSize(horizontal: false, vertical: true)

        EditorPreview(
          player: playback.player,
          canvasRatio: effectiveCanvasRatio,
          canvasLabel: canvasLabel,
          isRebuilding: playback.isRebuilding,
          errorMessage: playback.errorMessage
        )
          .frame(height: layout.previewHeight)
          .padding(.horizontal, 12)
          .overlay(alignment: .bottom) {
            EditorTransport(playback: playback, project: project)
              .padding(.horizontal, 12)
              .frame(height: 38)
              .background(.black.opacity(0.64), in: Capsule())
              .padding(.horizontal, 12)
              .padding(.bottom, 8)
          }

        EditorTimelineView(
          playback: playback,
          project: project,
          workspaceHeight: layout.timelineHeight
        )
          .frame(height: layout.timelineHeight)
          .padding(.horizontal, 12)
          .padding(.top, 7)

        if showsContextPanel {
          EditorContextPanel(
            selectedTool: selectedTool,
            selectedAction: selectedAction,
            playback: playback,
            project: project,
            canvas: $canvas
          )
          .frame(height: layout.inspectorHeight)
          .padding(.horizontal, 12)
          .padding(.top, 7)
        }

        EditorToolShelf(
          level: $toolShelfLevel,
          selectedTool: $selectedTool,
          selectedAction: $selectedAction,
          split: splitAtPlayhead,
          duplicate: project.duplicateSelected,
          delete: project.deleteSelected
        )
      }

    }
    .background(Color(red: 7 / 255, green: 9 / 255, blue: 15 / 255).ignoresSafeArea())
    .foregroundStyle(.white)
    .navigationBarBackButtonHidden()
    .toolbar(.hidden, for: .navigationBar)
    .toolbar(.hidden, for: .tabBar)
    .sheet(isPresented: $showExportSettings) {
      EditorExportSheet(
        title: video.title,
        duration: playback.duration,
        canvasLabel: canvasLabel,
        render: { try await playback.exportCurrentEdit(title: video.title) }
      )
      .presentationDetents([.medium])
      .presentationDragIndicator(.visible)
    }
    .task(id: "\(project.renderRevision)-\(canvas.rawValue)-\(effectiveCanvasRatio)") {
      await playback.apply(
        clips: project.clips,
        transitions: project.transitions,
        includesAudio: project.hasAudio,
        canvasRatio: Double(effectiveCanvasRatio),
        titleText: project.hasTitle && !project.titleText.isEmpty ? project.titleText : nil,
        captionText: project.hasCaptions && !project.captionText.isEmpty ? project.captionText : nil
      )
    }
    .task(id: "draft-\(project.renderRevision)-\(canvas.rawValue)") {
      draftStatus = "Saving…"
      do {
        try await Task.sleep(for: .milliseconds(450))
        try Task.checkCancellation()
        try EditorDraftStore.save(videoID: video.id, canvas: canvas, project: project.draft)
        draftStatus = "Saved locally"
      } catch is CancellationError {
        return
      } catch {
        draftStatus = "Autosave unavailable"
      }
    }
    .onDisappear {
      try? EditorDraftStore.save(videoID: video.id, canvas: canvas, project: project.draft)
      playback.stop()
    }
  }

  private func close() {
    playback.stop()
    dismiss()
  }

  private func splitAtPlayhead() {
    project.split(at: playback.currentTime)
  }
}

private struct VerticalEditorLayout {
  let availableHeight: CGFloat
  let canvasRatio: CGFloat
  let auxiliaryTrackCount: Int
  let showsInspector: Bool

  var previewHeight: CGFloat {
    let verticalBase = min(max(availableHeight * 0.5, 300), 350)
    let squareBase = min(max(availableHeight * 0.4, 255), 300)
    let wideBase = min(max(availableHeight * 0.29, 205), 235)
    let base: CGFloat
    if canvasRatio < 0.8 {
      base = verticalBase
    } else if canvasRatio < 1.2 {
      base = squareBase
    } else {
      base = wideBase
    }
    return max(228, base - CGFloat(auxiliaryTrackCount) * 24)
  }

  var inspectorHeight: CGFloat {
    guard showsInspector else { return 0 }
    return availableHeight < 700 ? 82 : 92
  }

  var timelineHeight: CGFloat {
    let topBarHeight: CGFloat = 50
    let toolShelfHeight: CGFloat = 56
    let verticalSpacing: CGFloat = showsInspector ? 14 : 7
    return max(
      116,
      availableHeight - previewHeight - inspectorHeight - topBarHeight - toolShelfHeight - verticalSpacing
    )
  }
}

private struct EditorTopBar: View {
  let title: String
  let subtitle: String
  let canUndo: Bool
  let canRedo: Bool
  let close: () -> Void
  let undo: () -> Void
  let redo: () -> Void
  let export: () -> Void

  var body: some View {
    HStack(spacing: 9) {
      EditorCircleButton(symbol: "xmark", label: "Close editor", action: close)

      VStack(alignment: .leading, spacing: 1) {
        Text(title)
          .font(.subheadline.weight(.medium))
          .lineLimit(1)
        Text(subtitle)
          .font(.caption2)
          .foregroundStyle(.white.opacity(0.4))
      }

      Spacer(minLength: 4)

      EditorCircleButton(symbol: "arrow.uturn.backward", label: "Undo", action: undo)
        .disabled(!canUndo)
        .opacity(canUndo ? 1 : 0.32)
      EditorCircleButton(symbol: "arrow.uturn.forward", label: "Redo", action: redo)
        .disabled(!canRedo)
        .opacity(canRedo ? 1 : 0.32)

      Button(action: export) {
        HStack(spacing: 5) {
          Image(systemName: "arrow.up.right")
          Text("Export")
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(.white)
        .padding(.horizontal, 11)
        .frame(height: 34)
        .background(VFTheme.purple, in: Capsule())
      }
      .buttonStyle(.plain)
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
  }
}

private struct EditorCircleButton: View {
  let symbol: String
  let label: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Image(systemName: symbol)
        .font(.caption.weight(.bold))
        .frame(width: 32, height: 32)
        .background(.white.opacity(0.08), in: Circle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(label)
  }
}

private struct EditorPreview: View {
  let player: AVPlayer
  let canvasRatio: CGFloat
  let canvasLabel: String
  let isRebuilding: Bool
  let errorMessage: String?

  var body: some View {
    ZStack {
      Color.black
      ZStack {
        VFTheme.heroGradient.opacity(0.26)
        VStack(spacing: 7) {
          Image(systemName: "waveform")
            .font(.title2.weight(.light))
          Text("VideoFlow preview")
            .font(.caption2.weight(.semibold))
        }
        .foregroundStyle(.white.opacity(0.24))

        EditorPlayerSurface(player: player)

        if isRebuilding {
          ProgressView()
            .tint(.white)
            .padding(10)
            .background(.black.opacity(0.62), in: Circle())
        }

        if let errorMessage {
          Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
            .font(.caption2)
            .foregroundStyle(.white)
            .lineLimit(3)
            .padding(9)
            .background(.red.opacity(0.82), in: RoundedRectangle(cornerRadius: 8))
            .padding(12)
        }
      }
      .aspectRatio(canvasRatio, contentMode: .fit)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay(alignment: .topTrailing) {
          Text(canvasLabel)
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(.white.opacity(0.75))
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background(.black.opacity(0.54), in: Capsule())
            .padding(7)
        }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(.white.opacity(0.09)))
  }
}

private struct EditorTransport: View {
  @Bindable var playback: EditorPlaybackController
  @Bindable var project: EditorProjectModel

  var body: some View {
    HStack(spacing: 18) {
      Text(editorTime(playback.currentTime))
        .font(.caption.monospacedDigit().weight(.semibold))
        .foregroundStyle(.white.opacity(0.62))
        .frame(width: 42, alignment: .leading)

      Spacer()

      Button {
        seekToAdjacentClip(forward: false)
      } label: {
        Image(systemName: "backward.end.fill")
      }
      .accessibilityLabel("Previous edit")

      Button(action: playback.togglePlayback) {
        Image(systemName: playback.isPlaying ? "pause.fill" : "play.fill")
          .font(.headline)
          .frame(width: 42, height: 32)
          .background(.white.opacity(0.11), in: Capsule())
      }
      .accessibilityLabel(playback.isPlaying ? "Pause" : "Play")

      Button {
        seekToAdjacentClip(forward: true)
      } label: {
        Image(systemName: "forward.end.fill")
      }
      .accessibilityLabel("Next edit")

      Spacer()

      Text(editorTime(playback.duration))
        .font(.caption.monospacedDigit().weight(.semibold))
        .foregroundStyle(.white.opacity(0.62))
        .frame(width: 42, alignment: .trailing)
    }
    .font(.subheadline)
    .buttonStyle(.plain)
  }

  private func seekToAdjacentClip(forward: Bool) {
    let boundaries = project.clips
      .flatMap { [$0.sourceStart, $0.sourceEnd] }
      .sorted()
    let target: Double?
    if forward {
      target = boundaries.first { $0 > playback.currentTime + 0.05 }
    } else {
      target = boundaries.reversed().first { $0 < playback.currentTime - 0.05 }
    }
    playback.seek(to: target ?? (forward ? playback.trimEnd : playback.trimStart))
    project.selectClip(at: playback.currentTime)
  }
}

private struct EditorContextPanel: View {
  let selectedTool: EditorPrimaryTool
  let selectedAction: EditorClipAction
  @Bindable var playback: EditorPlaybackController
  @Bindable var project: EditorProjectModel
  @Binding var canvas: EditorCanvas

  var body: some View {
    Group {
      switch selectedTool {
      case .edit:
        ClipInspector(
          action: selectedAction,
          playback: playback,
          project: project
        )
      case .audio:
        TrackTogglePanel(
          title: "Original audio",
          detail: project.hasAudio ? "Included in playback and export" : "Muted in playback and export",
          symbol: project.hasAudio ? "waveform" : "speaker.slash",
          isEnabled: project.hasAudio,
          actionLabel: project.hasAudio ? "Mute" : "Restore",
          action: project.toggleAudio
        )
      case .text:
        EditableTextLayerPanel(
          title: "Title",
          placeholder: "Enter title",
          symbol: "textformat",
          isEnabled: project.hasTitle,
          text: Binding(get: { project.titleText }, set: project.setTitleText),
          actionLabel: project.hasTitle ? "Remove" : "Add title",
          action: project.toggleTitle,
          editingChanged: interactiveEditingChanged
        )
      case .overlay:
        TrackTogglePanel(
          title: "Picture in picture",
          detail: project.hasOverlay ? "Overlay track ready to position" : "Add a visual layer above the main clip",
          symbol: "square.on.square",
          isEnabled: project.hasOverlay,
          actionLabel: project.hasOverlay ? "Remove" : "Add overlay",
          action: project.toggleOverlay
        )
      case .captions:
        EditableTextLayerPanel(
          title: "Caption",
          placeholder: "Enter caption",
          symbol: "captions.bubble",
          isEnabled: project.hasCaptions,
          text: Binding(get: { project.captionText }, set: project.setCaptionText),
          actionLabel: project.hasCaptions ? "Remove" : "Add draft",
          action: project.toggleCaptions,
          editingChanged: interactiveEditingChanged
        )
      case .canvas:
        CanvasInspector(selection: $canvas)
      }
    }
    .padding(11)
    .background(.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 11).stroke(.white.opacity(0.07)))
  }

  private func interactiveEditingChanged(_ isEditing: Bool) {
    if isEditing {
      project.beginInteractiveEdit()
    } else {
      project.endInteractiveEdit()
    }
  }
}

private struct ClipInspector: View {
  let action: EditorClipAction
  @Bindable var playback: EditorPlaybackController
  @Bindable var project: EditorProjectModel

  var body: some View {
    switch action {
    case .split:
      ActionExplanation(
        title: "Split at \(editorTime(playback.currentTime))",
        detail: "Park the playhead, then tap Split again to cut the selected clip.",
        symbol: "scissors"
      )
    case .trim:
      ClipTrimInspector(project: project)
    case .speed:
      ValueInspector(
        title: "Clip speed",
        value: Binding(get: { project.selectedSpeed }, set: project.setSelectedSpeed),
        range: 0.25...4,
        step: 0.25,
        valueLabel: String(format: "%.2gx", project.selectedSpeed),
        leadingSymbol: "tortoise",
        trailingSymbol: "hare",
        editingChanged: interactiveEditingChanged
      )
    case .volume:
      ValueInspector(
        title: "Clip volume",
        value: Binding(get: { project.selectedVolume }, set: project.setSelectedVolume),
        range: 0...1,
        step: 0.05,
        valueLabel: "\(Int(project.selectedVolume * 100))%",
        leadingSymbol: "speaker.slash",
        trailingSymbol: "speaker.wave.3",
        editingChanged: interactiveEditingChanged
      )
    case .duplicate:
      ActionExplanation(
        title: "Duplicate selected clip",
        detail: "Creates a second visual segment in the preview draft.",
        symbol: "plus.square.on.square"
      )
    case .delete:
      ActionExplanation(
        title: "Delete selected clip",
        detail: project.clips.count > 1 ? "Tap Delete again to remove it. Undo stays available." : "Split the clip before deleting a segment.",
        symbol: "trash"
      )
    }
  }

  private func interactiveEditingChanged(_ isEditing: Bool) {
    if isEditing {
      project.beginInteractiveEdit()
    } else {
      project.endInteractiveEdit()
    }
  }
}

private struct ClipTrimInspector: View {
  @Bindable var project: EditorProjectModel

  var body: some View {
    if let clip = project.selectedClip {
      HStack(spacing: 12) {
        Image(systemName: "hand.draw")
          .font(.title3)
          .foregroundStyle(VFTheme.amber)
          .frame(width: 38, height: 38)
          .background(VFTheme.amber.opacity(0.12), in: RoundedRectangle(cornerRadius: 9))
        VStack(alignment: .leading, spacing: 3) {
          Text("Trim on the timeline")
            .font(.caption.weight(.medium))
          Text("Drag either amber edge. Pinch the timeline for frame-level control.")
            .font(.caption2)
            .foregroundStyle(.white.opacity(0.48))
            .lineLimit(2)
        }
        Spacer()
        Text(editorTime(clip.timelineDuration))
          .font(.caption.monospacedDigit().weight(.medium))
          .foregroundStyle(VFTheme.amber)
      }
    } else {
      ActionExplanation(
        title: "Select a clip",
        detail: "Tap or scrub to a clip in the timeline to edit its source range.",
        symbol: "hand.tap"
      )
    }
  }
}

private struct ActionExplanation: View {
  let title: String
  let detail: String
  let symbol: String

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: symbol)
        .font(.title3)
        .foregroundStyle(VFTheme.amber)
        .frame(width: 38, height: 38)
        .background(VFTheme.amber.opacity(0.12), in: RoundedRectangle(cornerRadius: 9))
      VStack(alignment: .leading, spacing: 3) {
        Text(title).font(.caption.weight(.medium))
        Text(detail)
          .font(.caption2)
          .foregroundStyle(.white.opacity(0.48))
          .lineLimit(2)
      }
      Spacer()
    }
  }
}

private struct TrackTogglePanel: View {
  let title: String
  let detail: String
  let symbol: String
  let isEnabled: Bool
  let actionLabel: String
  let action: () -> Void

  var body: some View {
    HStack(spacing: 11) {
      Image(systemName: symbol)
        .font(.headline)
        .foregroundStyle(isEnabled ? VFTheme.purple : .white.opacity(0.48))
        .frame(width: 38, height: 38)
        .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 9))
      VStack(alignment: .leading, spacing: 3) {
        Text(title).font(.caption.weight(.medium))
        Text(detail)
          .font(.caption2)
          .foregroundStyle(.white.opacity(0.48))
          .lineLimit(2)
      }
      Spacer()
      Button(actionLabel, action: action)
        .font(.caption2.weight(.medium))
        .buttonStyle(.bordered)
        .tint(isEnabled ? .white.opacity(0.42) : VFTheme.purple)
    }
  }
}

private struct EditableTextLayerPanel: View {
  let title: String
  let placeholder: String
  let symbol: String
  let isEnabled: Bool
  @Binding var text: String
  let actionLabel: String
  let action: () -> Void
  let editingChanged: (Bool) -> Void

  var body: some View {
    HStack(spacing: 11) {
      Image(systemName: symbol)
        .font(.headline)
        .foregroundStyle(isEnabled ? VFTheme.purple : .white.opacity(0.48))
        .frame(width: 38, height: 38)
        .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 9))
      VStack(alignment: .leading, spacing: 4) {
        Text(title).font(.caption.weight(.medium))
        if isEnabled {
          TextField(
            placeholder,
            text: $text,
            onEditingChanged: editingChanged
          )
          .font(.caption)
          .textFieldStyle(.plain)
          .padding(.horizontal, 8)
          .frame(height: 28)
          .background(.black.opacity(0.22), in: RoundedRectangle(cornerRadius: 6))
        } else {
          Text("Add an editable layer to playback and export")
            .font(.caption2)
            .foregroundStyle(.white.opacity(0.48))
        }
      }
      Spacer(minLength: 4)
      Button(actionLabel, action: action)
        .font(.caption2.weight(.medium))
        .buttonStyle(.bordered)
        .tint(isEnabled ? .white.opacity(0.42) : VFTheme.purple)
    }
  }
}

private struct ValueInspector: View {
  let title: String
  @Binding var value: Double
  let range: ClosedRange<Double>
  let step: Double
  let valueLabel: String
  let leadingSymbol: String
  let trailingSymbol: String
  let editingChanged: (Bool) -> Void

  var body: some View {
    VStack(spacing: 12) {
      HStack {
        Text(title).font(.caption.weight(.medium))
        Spacer()
        Text(valueLabel)
          .font(.caption.monospacedDigit().weight(.medium))
          .foregroundStyle(VFTheme.purple)
      }
      HStack(spacing: 10) {
        Image(systemName: leadingSymbol).frame(width: 18)
        Slider(
          value: $value,
          in: range,
          step: step,
          onEditingChanged: editingChanged
        )
        .tint(VFTheme.purple)
        Image(systemName: trailingSymbol).frame(width: 18)
      }
      .foregroundStyle(.white.opacity(0.52))
    }
  }
}

private struct CanvasInspector: View {
  @Binding var selection: EditorCanvas

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text("Canvas").font(.caption.weight(.medium))
        Spacer()
        Text(selection.rawValue)
          .font(.caption2.weight(.medium))
          .foregroundStyle(VFTheme.purple)
      }
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 7) {
          ForEach(EditorCanvas.allCases) { preset in
            Button {
              selection = preset
            } label: {
              Text(preset.rawValue)
                .font(.caption2.weight(.medium))
                .padding(.horizontal, 11)
                .frame(height: 31)
                .background(
                  selection == preset ? VFTheme.purple : .white.opacity(0.07),
                  in: Capsule()
                )
            }
            .buttonStyle(.plain)
          }
        }
      }
    }
  }
}

private struct EditorToolShelf: View {
  @Binding var level: EditorToolShelfLevel
  @Binding var selectedTool: EditorPrimaryTool
  @Binding var selectedAction: EditorClipAction
  let split: () -> Void
  let duplicate: () -> Void
  let delete: () -> Void

  var body: some View {
    Group {
      if level == .clip {
        EditorClipActionRail(
          selection: $selectedAction,
          showPrimaryTools: showPrimaryTools,
          split: split,
          duplicate: duplicate,
          delete: delete
        )
      } else {
        EditorPrimaryToolRail(selection: $selectedTool, openClipTools: openClipTools)
      }
    }
  }

  private func showPrimaryTools() {
    level = .primary
  }

  private func openClipTools() {
    level = .clip
    selectedTool = .edit
  }
}

private struct EditorClipActionRail: View {
  @Binding var selection: EditorClipAction
  let showPrimaryTools: () -> Void
  let split: () -> Void
  let duplicate: () -> Void
  let delete: () -> Void

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 5) {
        Button(action: showPrimaryTools) {
          VStack(spacing: 4) {
            Image(systemName: "chevron.left")
              .font(.system(size: 14, weight: .semibold))
            Text("Tools")
              .font(.system(size: 9, weight: .medium))
          }
          .foregroundStyle(.white.opacity(0.62))
          .frame(width: 54, height: 48)
        }
        .buttonStyle(.plain)

        ForEach(EditorClipAction.allCases) { action in
          Button {
            switch action {
            case .split, .duplicate, .delete:
              perform(action)
            case .trim, .speed, .volume:
              selection = action
            }
          } label: {
            VStack(spacing: 4) {
              Image(systemName: action.symbol)
                .font(.system(size: 15, weight: .medium))
              Text(action.rawValue)
                .font(.system(size: 9, weight: .medium))
            }
            .foregroundStyle(
              action == .delete
                ? Color.red.opacity(selection == action ? 1 : 0.72)
                : (selection == action ? VFTheme.amber : .white.opacity(0.56))
            )
            .frame(width: 58, height: 48)
            .background(
              selection == action ? .white.opacity(0.075) : .clear,
              in: RoundedRectangle(cornerRadius: 8)
            )
          }
          .buttonStyle(.plain)
        }
      }
      .padding(.horizontal, 9)
    }
    .frame(height: 52)
    .background(Color(red: 11 / 255, green: 14 / 255, blue: 23 / 255))
  }

  private func perform(_ action: EditorClipAction) {
    switch action {
    case .split: split()
    case .duplicate: duplicate()
    case .delete: delete()
    case .trim, .speed, .volume: break
    }
  }
}

private struct EditorPrimaryToolRail: View {
  @Binding var selection: EditorPrimaryTool
  let openClipTools: () -> Void

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 2) {
        ForEach(EditorPrimaryTool.allCases) { tool in
          Button {
            selection = tool
            if tool == .edit { openClipTools() }
          } label: {
            VStack(spacing: 4) {
              Image(systemName: tool.symbol)
                .font(.system(size: 16, weight: .medium))
              Text(tool.rawValue)
                .font(.system(size: 9, weight: .medium))
            }
            .foregroundStyle(selection == tool ? VFTheme.purple : .white.opacity(0.52))
            .frame(width: 66, height: 52)
            .background(
              selection == tool ? VFTheme.purple.opacity(0.1) : .clear,
              in: RoundedRectangle(cornerRadius: 9)
            )
          }
          .buttonStyle(.plain)
        }
      }
      .padding(.horizontal, 7)
    }
    .frame(height: 56)
    .background(Color(red: 14 / 255, green: 17 / 255, blue: 28 / 255))
    .overlay(alignment: .top) { Divider().overlay(.white.opacity(0.08)) }
  }
}

private struct EditorExportSheet: View {
  @Environment(\.dismiss) private var dismiss
  let title: String
  let duration: Double
  let canvasLabel: String
  let render: () async throws -> URL
  @State private var exportedURL: URL?
  @State private var isRendering = false
  @State private var errorMessage: String?

  var body: some View {
    NavigationStack {
      VStack(spacing: 16) {
        HStack {
          ExportStat(label: "Canvas", value: canvasLabel)
          ExportStat(label: "Length", value: editorTime(duration))
          ExportStat(label: "Format", value: "H.264")
        }

        HStack(spacing: 10) {
          Image(systemName: exportedURL == nil ? "film.stack" : "checkmark.circle.fill")
            .foregroundStyle(exportedURL == nil ? VFTheme.amber : .green)
          Text(exportedURL == nil
            ? "VideoFlow will render the current cuts, timing, audio, canvas, title, and captions."
            : "Your edited video is ready to save or share.")
            .font(.caption)
            .foregroundStyle(.secondary)
          Spacer()
        }
        .padding(12)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))

        if let exportedURL {
          ShareLink(item: exportedURL) {
            Label("Share edited video", systemImage: "square.and.arrow.up")
              .frame(maxWidth: .infinity)
          }
          .buttonStyle(.borderedProminent)
          .tint(VFTheme.purple)
        } else {
          Button(action: startRender) {
            HStack(spacing: 8) {
              if isRendering { ProgressView().tint(.white) }
              Text(isRendering ? "Rendering…" : "Render video")
            }
            .frame(maxWidth: .infinity)
          }
          .buttonStyle(.borderedProminent)
          .tint(VFTheme.purple)
          .disabled(isRendering)
        }

        if let errorMessage {
          Text(errorMessage)
            .font(.caption)
            .foregroundStyle(.red)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
      }
      .padding()
      .navigationTitle("Export \(title)")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }
        }
      }
    }
  }

  private func startRender() {
    guard !isRendering else { return }
    isRendering = true
    errorMessage = nil
    Task {
      do {
        exportedURL = try await render()
      } catch {
        errorMessage = error.localizedDescription
      }
      isRendering = false
    }
  }
}

private struct ExportStat: View {
  let label: String
  let value: String

  var body: some View {
    VStack(spacing: 3) {
      Text(value).font(.subheadline.weight(.semibold))
      Text(label).font(.caption2).foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity)
  }
}

private struct EditorPlayerSurface: UIViewRepresentable {
  let player: AVPlayer

  func makeUIView(context: Context) -> PlayerLayerView {
    let view = PlayerLayerView()
    view.playerLayer.player = player
    view.playerLayer.videoGravity = .resizeAspect
    return view
  }

  func updateUIView(_ uiView: PlayerLayerView, context: Context) {
    uiView.playerLayer.player = player
  }
}

private final class PlayerLayerView: UIView {
  override class var layerClass: AnyClass { AVPlayerLayer.self }
  var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
}

import SwiftUI

struct EditorTimelineView: View {
  @Bindable var playback: EditorPlaybackController
  @Bindable var project: EditorProjectModel
  let workspaceHeight: CGFloat
  @State private var dragStartTime: Double?
  @State private var pixelsPerSecond: CGFloat = 8
  @State private var pinchStartPixelsPerSecond: CGFloat?
  @State private var measuredViewportWidth: CGFloat = 0
  @State private var isScrubbing = false
  @State private var snappedTime: Double?
  @State private var snapFeedbackTrigger = 0

  var body: some View {
    VStack(spacing: 8) {
      HStack(spacing: 7) {
        Label("Timeline", systemImage: "rectangle.split.3x1")
          .font(.caption.weight(.semibold))
          .foregroundStyle(.white.opacity(0.62))
        Spacer()
        TimelineMarkerButton(time: min(42, project.timelineDuration), color: VFTheme.purple) {
          seekToMarker(min(42, project.timelineDuration))
        }
        TimelineMarkerButton(time: min(98, project.timelineDuration), color: VFTheme.amber) {
          seekToMarker(min(98, project.timelineDuration))
        }
        Button(action: fitTimeline) {
          Image(systemName: "arrow.down.right.and.arrow.up.left")
            .font(.system(size: 10, weight: .semibold))
            .frame(width: 24, height: 24)
            .background(.white.opacity(0.06), in: Circle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(.white.opacity(0.55))
        .accessibilityLabel("Fit timeline")
        Text("\(editorTime(playback.currentTime)) / \(editorTime(project.timelineDuration))")
          .font(.caption2.monospacedDigit().weight(.medium))
          .foregroundStyle(.white.opacity(0.48))
      }

      GeometryReader { geometry in
        let viewportWidth = geometry.size.width
        let duration = max(0.25, project.timelineDuration)
        let contentWidth = max(viewportWidth * 1.5, CGFloat(duration) * pixelsPerSecond)
        let centerX = viewportWidth / 2
        let timelineOffset = centerX - CGFloat(playback.currentTime / duration) * contentWidth

        ZStack(alignment: .topLeading) {
          Color(red: 12 / 255, green: 15 / 255, blue: 25 / 255)

          VStack(spacing: 5) {
            EditorTimeRuler(duration: duration, width: contentWidth)
              .frame(height: 14)

            EditorVideoTrack(
              project: project,
              thumbnails: playback.thumbnails,
              duration: duration,
              width: contentWidth
            )
            .frame(height: 46)

            if project.hasOverlay {
              EditorTrackChip(
                title: "Overlay",
                symbol: "square.on.square",
                color: .cyan,
                width: contentWidth * 0.42
              )
            }

            if project.hasTitle {
              EditorTrackChip(
                title: "Launch title",
                symbol: "textformat",
                color: VFTheme.amber,
                width: contentWidth * 0.34
              )
            }

            if project.hasCaptions {
              EditorCaptionTrack(width: contentWidth)
            }

            if project.hasAudio {
              EditorAudioTrack(width: contentWidth)
            }
          }
          .frame(width: contentWidth, alignment: .leading)
          .offset(x: timelineOffset)
          .frame(maxWidth: .infinity, alignment: .leading)

          if showsQuickAddLanes {
            TimelineQuickAddLanes(project: project)
              .padding(8)
              .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
          }

          VStack(spacing: 0) {
            Image(systemName: "arrowtriangle.down.fill")
              .font(.system(size: 8))
              .foregroundStyle(snappedTime == nil ? .white : VFTheme.amber)
            Rectangle()
              .fill(snappedTime == nil ? .white : VFTheme.amber)
              .frame(width: 2)
              .shadow(color: .black.opacity(0.65), radius: 2)
          }
          .frame(maxHeight: .infinity)
          .position(x: centerX, y: geometry.size.height / 2)

          if isScrubbing {
            ScrubTimecode(
              time: playback.currentTime,
              isSnapped: snappedTime != nil
            )
            .position(x: centerX, y: 17)
          }
        }
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
          RoundedRectangle(cornerRadius: 10, style: .continuous)
            .stroke(.white.opacity(0.08))
        )
        .contentShape(Rectangle())
        .gesture(
          DragGesture(minimumDistance: 0)
            .onChanged { value in
              if dragStartTime == nil {
                dragStartTime = playback.currentTime
              }
              guard let dragStartTime else { return }
              isScrubbing = true
              let secondsDelta = Double(value.translation.width / contentWidth) * duration
              let rawTarget = dragStartTime - secondsDelta
              let target = snapTarget(
                for: rawTarget,
                duration: duration,
                contentWidth: contentWidth
              )
              playback.seek(to: target)
              project.selectClip(at: playback.currentTime)
            }
            .onEnded { value in
              if abs(value.translation.width) < 4 {
                let secondsFromCenter = Double((value.location.x - centerX) / contentWidth) * duration
                let target = snapTarget(
                  for: playback.currentTime + secondsFromCenter,
                  duration: duration,
                  contentWidth: contentWidth
                )
                playback.seek(to: target)
                project.selectClip(at: playback.currentTime)
              }
              dragStartTime = nil
              isScrubbing = false
              snappedTime = nil
            }
        )
        .simultaneousGesture(
          MagnifyGesture()
            .onChanged { value in
              if pinchStartPixelsPerSecond == nil {
                pinchStartPixelsPerSecond = pixelsPerSecond
              }
              let origin = pinchStartPixelsPerSecond ?? pixelsPerSecond
              let fitScale = max(0.1, measuredViewportWidth / CGFloat(duration))
              pixelsPerSecond = min(max(fitScale, origin * value.magnification), 64)
            }
            .onEnded { _ in pinchStartPixelsPerSecond = nil }
        )
        .onAppear {
          if measuredViewportWidth == 0 {
            measuredViewportWidth = geometry.size.width
          }
        }
        .onChange(of: geometry.size.width) { _, newWidth in
          measuredViewportWidth = newWidth
        }
      }
      .frame(height: max(contentTrackHeight, workspaceHeight - 26))
    }
    .sensoryFeedback(.selection, trigger: snapFeedbackTrigger)
  }

  private var contentTrackHeight: CGFloat {
    65
      + (project.hasOverlay ? 27 : 0)
      + (project.hasTitle ? 27 : 0)
      + (project.hasCaptions ? 27 : 0)
      + (project.hasAudio ? 29 : 0)
  }

  private var showsQuickAddLanes: Bool {
    workspaceHeight - contentTrackHeight > 78
  }

  private func seekToMarker(_ time: Double) {
    playback.seek(to: time)
    project.selectClip(at: time)
  }

  private func fitTimeline() {
    guard project.timelineDuration > 0, measuredViewportWidth > 0 else { return }
    pixelsPerSecond = max(0.1, measuredViewportWidth / CGFloat(project.timelineDuration))
  }

  private func snapTarget(
    for rawTime: Double,
    duration: Double,
    contentWidth: CGFloat
  ) -> Double {
    let clamped = min(max(0, rawTime), duration)
    let clipEdges = project.clips.flatMap { clip in
      let start = project.timelineStart(for: clip.id)
      return [start, start + clip.timelineDuration]
    }
    let candidates = clipEdges + [0, duration, min(42, duration), min(98, duration)]
    let tolerance = max(0.04, min(0.32, Double(9 / contentWidth) * duration))
    guard let nearest = candidates.min(by: {
      abs($0 - clamped) < abs($1 - clamped)
    }), abs(nearest - clamped) <= tolerance else {
      snappedTime = nil
      return clamped
    }

    if snappedTime != nearest {
      snapFeedbackTrigger += 1
    }
    snappedTime = nearest
    return nearest
  }
}

private struct ScrubTimecode: View {
  let time: Double
  let isSnapped: Bool

  var body: some View {
    HStack(spacing: 4) {
      if isSnapped {
        Image(systemName: "magnet.fill")
          .font(.system(size: 8, weight: .bold))
      }
      Text(editorPreciseTime(time))
        .font(.system(size: 10, weight: .semibold, design: .monospaced))
    }
    .foregroundStyle(isSnapped ? VFTheme.amber : .white)
    .padding(.horizontal, 7)
    .frame(height: 22)
    .background(.black.opacity(0.82), in: Capsule())
    .overlay(Capsule().stroke(.white.opacity(0.12)))
  }
}

private struct TimelineQuickAddLanes: View {
  @Bindable var project: EditorProjectModel

  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      Text("Add to timeline")
        .font(.system(size: 9, weight: .medium))
        .foregroundStyle(.white.opacity(0.35))
      HStack(spacing: 6) {
        if !project.hasTitle {
          TimelineAddButton(title: "Text", symbol: "textformat", action: project.toggleTitle)
        }
        if !project.hasCaptions {
          TimelineAddButton(title: "Captions", symbol: "captions.bubble", action: project.toggleCaptions)
        }
      }
    }
  }
}

private struct TimelineAddButton: View {
  let title: String
  let symbol: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Label(title, systemImage: symbol)
        .font(.system(size: 9, weight: .medium))
        .foregroundStyle(.white.opacity(0.62))
        .padding(.horizontal, 8)
        .frame(height: 27)
        .background(.white.opacity(0.06), in: Capsule())
        .overlay(Capsule().stroke(.white.opacity(0.08)))
    }
    .buttonStyle(.plain)
  }
}

private struct TimelineMarkerButton: View {
  let time: Double
  let color: Color
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 3) {
        Circle().fill(color).frame(width: 5, height: 5)
        Text(editorTime(time))
          .font(.system(size: 8, weight: .medium, design: .monospaced))
      }
      .foregroundStyle(.white.opacity(0.5))
    }
    .buttonStyle(.plain)
    .accessibilityLabel("Review marker at \(editorTime(time))")
  }
}

private struct EditorTimeRuler: View {
  let duration: Double
  let width: CGFloat

  var body: some View {
    ZStack(alignment: .leading) {
      Rectangle().fill(.clear)
      ForEach(Array(stride(from: 0, through: duration, by: rulerStep)), id: \.self) { second in
        let x = width * second / duration
        VStack(alignment: .leading, spacing: 1) {
          Text(editorTime(second))
            .font(.system(size: 8, weight: .medium, design: .monospaced))
          Rectangle().frame(width: 1, height: 4)
        }
        .foregroundStyle(.white.opacity(0.32))
        .offset(x: x)
      }
    }
  }

  private var rulerStep: Double {
    if duration > 180 { return 30 }
    if duration > 60 { return 10 }
    return 5
  }
}

private struct EditorVideoTrack: View {
  @Bindable var project: EditorProjectModel
  let thumbnails: [CGImage]
  let duration: Double
  let width: CGFloat

  var body: some View {
    ZStack(alignment: .leading) {
      ForEach(Array(project.clips.enumerated()), id: \.element.id) { index, clip in
        let x = width * project.timelineStart(for: clip.id) / duration
        let clipWidth = max(12, width * clip.timelineDuration / duration)

        TimelineClipView(
          clip: clip,
          index: index,
          thumbnails: thumbnails,
          isSelected: clip.id == project.selectedClipID,
          sourceSecondsPerPoint: duration / Double(width) * clip.playbackRate,
          beginTrim: { beginTrim(clip.id) },
          setTrimStart: project.setSelectedStart,
          setTrimEnd: project.setSelectedEnd,
          endTrim: project.endInteractiveEdit
        )
        .frame(width: clipWidth)
        .offset(x: x)

        if index > 0 {
          EditorTransitionMenu(
            style: project.transitionStyle(before: clip.id),
            select: { project.setTransitionStyle($0, before: clip.id) }
          )
            .offset(x: x - 9, y: 14)
        }
      }
    }
    .frame(width: width, alignment: .leading)
  }

  private func beginTrim(_ clipID: UUID) {
    project.select(clipID)
    project.beginInteractiveEdit()
  }
}

private struct TimelineClipView: View {
  let clip: EditorClipSegment
  let index: Int
  let thumbnails: [CGImage]
  let isSelected: Bool
  let sourceSecondsPerPoint: Double
  let beginTrim: () -> Void
  let setTrimStart: (Double) -> Void
  let setTrimEnd: (Double) -> Void
  let endTrim: () -> Void
  @State private var leadingTrimOrigin: Double?
  @State private var trailingTrimOrigin: Double?

  var body: some View {
    ZStack {
      TimelineFrames(images: thumbnails, phase: clip.visualPhase)
      LinearGradient(
        colors: [.clear, .black.opacity(0.32)],
        startPoint: .top,
        endPoint: .bottom
      )
      VStack {
        Spacer()
        HStack {
          Text(index == 0 ? "Main video" : "Clip \(index + 1)")
            .font(.system(size: 8, weight: .semibold))
            .lineLimit(1)
          Spacer()
          Text(editorTime(clip.timelineDuration))
            .font(.system(size: 8, design: .monospaced))
        }
        .foregroundStyle(.white.opacity(0.9))
        .padding(.horizontal, 5)
        .padding(.bottom, 4)
      }
    }
    .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 5, style: .continuous)
        .stroke(isSelected ? VFTheme.amber : .white.opacity(0.12), lineWidth: isSelected ? 3 : 1)
    )
    .overlay(alignment: .leading) {
      if isSelected {
        EditorClipHandle()
          .frame(width: 24)
          .contentShape(Rectangle())
          .highPriorityGesture(leadingTrimGesture)
          .accessibilityLabel("Trim clip start")
          .accessibilityValue(editorTime(clip.sourceStart))
          .accessibilityAdjustableAction(adjustLeadingEdge)
      }
    }
    .overlay(alignment: .trailing) {
      if isSelected {
        EditorClipHandle()
          .frame(width: 24)
          .contentShape(Rectangle())
          .highPriorityGesture(trailingTrimGesture)
          .accessibilityLabel("Trim clip end")
          .accessibilityValue(editorTime(clip.sourceEnd))
          .accessibilityAdjustableAction(adjustTrailingEdge)
      }
    }
  }

  private var leadingTrimGesture: some Gesture {
    DragGesture(minimumDistance: 0)
      .onChanged { value in
        if leadingTrimOrigin == nil {
          leadingTrimOrigin = clip.sourceStart
          beginTrim()
        }
        let origin = leadingTrimOrigin ?? clip.sourceStart
        setTrimStart(origin + Double(value.translation.width) * sourceSecondsPerPoint)
      }
      .onEnded { _ in
        leadingTrimOrigin = nil
        endTrim()
      }
  }

  private var trailingTrimGesture: some Gesture {
    DragGesture(minimumDistance: 0)
      .onChanged { value in
        if trailingTrimOrigin == nil {
          trailingTrimOrigin = clip.sourceEnd
          beginTrim()
        }
        let origin = trailingTrimOrigin ?? clip.sourceEnd
        setTrimEnd(origin + Double(value.translation.width) * sourceSecondsPerPoint)
      }
      .onEnded { _ in
        trailingTrimOrigin = nil
        endTrim()
      }
  }

  private func adjustLeadingEdge(_ direction: AccessibilityAdjustmentDirection) {
    beginTrim()
    switch direction {
    case .increment: setTrimStart(clip.sourceStart + 0.1)
    case .decrement: setTrimStart(clip.sourceStart - 0.1)
    @unknown default: break
    }
    endTrim()
  }

  private func adjustTrailingEdge(_ direction: AccessibilityAdjustmentDirection) {
    beginTrim()
    switch direction {
    case .increment: setTrimEnd(clip.sourceEnd + 0.1)
    case .decrement: setTrimEnd(clip.sourceEnd - 0.1)
    @unknown default: break
    }
    endTrim()
  }
}

private struct TimelineFrames: View {
  let images: [CGImage]
  let phase: Int

  var body: some View {
    HStack(spacing: 1) {
      ForEach(0..<12, id: \.self) { index in
        Group {
          if !images.isEmpty {
            Image(decorative: images[(index + phase) % images.count], scale: 1)
              .resizable()
              .scaledToFill()
          } else {
            VFTheme.heroGradient
              .hueRotation(.degrees(Double((index + phase) % 4) * 5))
              .overlay(
                Image(systemName: "waveform")
                  .font(.caption2)
                  .foregroundStyle(.white.opacity(0.26))
              )
          }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
      }
    }
  }
}

private struct EditorClipHandle: View {
  var body: some View {
    Capsule()
      .fill(VFTheme.amber)
      .frame(width: 8)
      .overlay(Capsule().fill(.black.opacity(0.55)).frame(width: 2, height: 18))
  }
}

private struct EditorTransitionMenu: View {
  let style: EditorTransitionStyle
  let select: (EditorTransitionStyle) -> Void

  var body: some View {
    Menu {
      ForEach(EditorTransitionStyle.allCases) { transition in
        Button {
          select(transition)
        } label: {
          Label(transition.rawValue, systemImage: transition.symbol)
        }
      }
    } label: {
      Image(systemName: style.symbol)
        .font(.system(size: 9, weight: .bold))
        .foregroundStyle(style == .cut ? .white.opacity(0.86) : VFTheme.amber)
        .frame(width: 22, height: 22)
        .background(
          Color(red: 32 / 255, green: 36 / 255, blue: 50 / 255),
          in: RoundedRectangle(cornerRadius: 5)
        )
        .overlay(RoundedRectangle(cornerRadius: 5).stroke(.white.opacity(0.16)))
    }
    .accessibilityLabel("Transition: \(style.rawValue)")
  }
}

private struct EditorTrackChip: View {
  let title: String
  let symbol: String
  let color: Color
  let width: CGFloat

  var body: some View {
    HStack(spacing: 5) {
      Image(systemName: symbol).font(.system(size: 9, weight: .bold))
      Text(title).font(.system(size: 9, weight: .semibold))
      Spacer()
    }
    .padding(.horizontal, 7)
    .foregroundStyle(.white.opacity(0.9))
    .frame(width: width, height: 26)
    .background(color.opacity(0.36), in: RoundedRectangle(cornerRadius: 5))
    .overlay(RoundedRectangle(cornerRadius: 5).stroke(color.opacity(0.8)))
  }
}

private struct EditorCaptionTrack: View {
  let width: CGFloat

  var body: some View {
    HStack(spacing: 3) {
      ForEach(["Meet", "the faster", "review flow", "for teams"], id: \.self) { phrase in
        Text(phrase)
          .font(.system(size: 8, weight: .semibold))
          .lineLimit(1)
          .padding(.horizontal, 6)
          .frame(maxWidth: .infinity, minHeight: 26)
          .background(VFTheme.purple.opacity(0.34), in: RoundedRectangle(cornerRadius: 5))
          .overlay(RoundedRectangle(cornerRadius: 5).stroke(VFTheme.purple.opacity(0.72)))
      }
    }
    .frame(width: width)
  }
}

private struct EditorAudioTrack: View {
  let width: CGFloat

  var body: some View {
    HStack(spacing: 2) {
      ForEach(0..<72, id: \.self) { index in
        Capsule()
          .fill(Color.green.opacity(0.62))
          .frame(width: 2, height: CGFloat(5 + ((index * 17) % 19)))
      }
    }
    .frame(width: width, height: 24, alignment: .leading)
    .padding(.horizontal, 6)
    .background(Color.green.opacity(0.12), in: RoundedRectangle(cornerRadius: 5))
    .overlay(RoundedRectangle(cornerRadius: 5).stroke(Color.green.opacity(0.38)))
  }
}

func editorTime(_ seconds: Double) -> String {
  guard seconds.isFinite else { return "0:00" }
  let total = max(0, Int(seconds.rounded(.down)))
  return String(format: "%d:%02d", total / 60, total % 60)
}

func editorPreciseTime(_ seconds: Double) -> String {
  guard seconds.isFinite else { return "0:00.00" }
  let clamped = max(0, seconds)
  let minutes = Int(clamped) / 60
  let remaining = clamped - Double(minutes * 60)
  return String(format: "%d:%05.2f", minutes, remaining)
}

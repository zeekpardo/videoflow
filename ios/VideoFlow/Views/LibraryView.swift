import AVKit
import ClerkKitUI
import SwiftUI

private enum VideoScope: String, CaseIterable, Identifiable {
  case all = "All"
  case camera = "Camera"
  case screen = "Screen"

  var id: String { rawValue }
  var symbol: String {
    switch self {
    case .all: "rectangle.stack"
    case .camera: "video"
    case .screen: "rectangle.on.rectangle"
    }
  }

  func includes(_ video: VideoSummary) -> Bool {
    switch self {
    case .all: true
    case .camera: video.mode == "camera"
    case .screen: video.mode == "screen"
    }
  }
}

private enum VideoSort: String, CaseIterable, Identifiable {
  case newest = "Newest"
  case mostViewed = "Most viewed"
  case longest = "Longest"

  var id: String { rawValue }
}

struct LibraryView: View {
  let model: AppModel
  var showsAccountButton = true
  @State private var searchText = ""
  @State private var scope: VideoScope = .all
  @State private var sort: VideoSort = .newest
  @State private var reviewDraft: ReviewDraft?

  private var visibleVideos: [VideoSummary] {
    model.videos
      .filter(scope.includes)
      .filter { searchText.isEmpty || $0.title.localizedCaseInsensitiveContains(searchText) }
      .sorted { first, second in
        switch sort {
        case .newest: first.createdAt > second.createdAt
        case .mostViewed: first.viewCount > second.viewCount
        case .longest: first.durationMs > second.durationMs
        }
      }
  }

  var body: some View {
    NavigationStack {
      Group {
        if model.isLoading && model.videos.isEmpty {
          ProgressView("Loading videos…")
        } else if model.videos.isEmpty {
          ContentUnavailableView(
            "No videos",
            systemImage: "video.badge.plus",
            description: Text("Record a video from the Record tab.")
          )
        } else {
          List {
            Section {
              VFPageHeader(
                title: "Library",
                subtitle: "Recordings, transcripts, and share links."
              )
              .listRowBackground(Color.clear)
              .listRowInsets(.init(top: 8, leading: 2, bottom: 10, trailing: 2))
            }

            Section {
              VideoScopeBar(selection: $scope)
                .listRowBackground(Color.clear)
                .listRowInsets(.init(top: 2, leading: 0, bottom: 4, trailing: 0))
            }

            if let latest = visibleVideos.first {
              Section("Latest") {
                NavigationLink(value: latest) {
                  FeaturedVideoRow(video: latest, reviewStatus: reviewStatus(for: latest))
                }
                .contextMenu { reviewAction(for: latest) }
              }
            }

            if visibleVideos.count > 1 {
              Section("Recent") {
                ForEach(visibleVideos.dropFirst()) { video in
                  NavigationLink(value: video) {
                    VideoRow(video: video, reviewStatus: reviewStatus(for: video))
                  }
                  .contextMenu { reviewAction(for: video) }
                }
              }
            }

            if visibleVideos.isEmpty {
              ContentUnavailableView.search(text: searchText.isEmpty ? scope.rawValue : searchText)
                .listRowBackground(Color.clear)
            }
          }
          .listStyle(.insetGrouped)
          .scrollContentBackground(.hidden)
          .background(VFTheme.canvas)
          .searchable(text: $searchText, prompt: "Search videos")
        }
      }
      .navigationTitle("")
      .navigationBarTitleDisplayMode(.inline)
      .navigationDestination(for: VideoSummary.self) { video in
        VideoDetailView(video: video, model: model)
      }
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          VFWordmark(compact: true)
        }
        ToolbarItem(placement: .topBarTrailing) {
          Menu {
            Picker("Sort", selection: $sort) {
              ForEach(VideoSort.allCases) { option in
                Text(option.rawValue).tag(option)
              }
            }
          } label: {
            Label("Sort videos", systemImage: "arrow.up.arrow.down")
          }
        }
        if showsAccountButton {
          ToolbarItem(placement: .topBarTrailing) { UserButton() }
        }
      }
      .sheet(item: $reviewDraft) { draft in
        ReviewRequestForm(video: draft.video, model: model)
      }
    }
  }

  @ViewBuilder
  private func reviewAction(for video: VideoSummary) -> some View {
    Button {
      reviewDraft = ReviewDraft(video: video)
    } label: {
      Label("Request Review", systemImage: "paperplane")
    }
  }

  private func reviewStatus(for video: VideoSummary) -> String? {
    let statuses = model.reviews.filter { $0.videoId == video.id }.map(\.status)
    if statuses.contains("changes_requested") { return "changes_requested" }
    if statuses.contains("pending") { return "pending" }
    if statuses.contains("approved") { return "approved" }
    return nil
  }
}

private struct VideoScopeBar: View {
  @Binding var selection: VideoScope

  var body: some View {
    if #available(iOS 26.0, *) {
      GlassEffectContainer(spacing: 8) {
        HStack(spacing: 8) {
          ForEach(VideoScope.allCases) { option in
            Button { selection = option } label: {
              Label(option.rawValue, systemImage: option.symbol)
                .font(.caption.weight(.semibold))
                .foregroundStyle(selection == option ? VFTheme.purple : VFTheme.mutedInk)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .glassEffect(
              .regular.tint(selection == option ? VFTheme.accent : nil).interactive(),
              in: .capsule
            )
          }
        }
      }
    } else {
      HStack(spacing: 8) {
        ForEach(VideoScope.allCases) { option in
          Button { selection = option } label: {
              Label(option.rawValue, systemImage: option.symbol)
                .font(.caption.weight(.semibold))
                .foregroundStyle(selection == option ? VFTheme.purple : VFTheme.mutedInk)
              .frame(maxWidth: .infinity)
              .padding(.vertical, 10)
              .background(selection == option ? VFTheme.accent : Color.white, in: Capsule())
              .overlay(Capsule().stroke(VFTheme.border))
          }
          .buttonStyle(.plain)
        }
      }
    }
  }
}

private struct FeaturedVideoRow: View {
  let video: VideoSummary
  let reviewStatus: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      VideoArtwork(video: video)
        .aspectRatio(16 / 9, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(alignment: .center) {
          Image(systemName: "play.fill")
            .font(.headline)
            .foregroundStyle(.white)
            .frame(width: 42, height: 42)
            .background(.black.opacity(0.58), in: Circle())
        }
        .overlay(alignment: .bottomTrailing) { DurationBadge(value: video.durationLabel) }

      HStack(alignment: .firstTextBaseline) {
        Text(video.title)
          .font(.headline)
          .foregroundStyle(.primary)
          .lineLimit(2)
        Spacer(minLength: 8)
        if let reviewStatus { CompactReviewBadge(status: reviewStatus) }
      }

      HStack(spacing: 12) {
        Label("\(Int(video.viewCount)) views", systemImage: "eye")
        Label(video.mode.capitalized, systemImage: video.mode == "screen" ? "rectangle.on.rectangle" : "video")
        Text(video.createdDate, format: .relative(presentation: .named))
      }
      .font(.caption)
      .foregroundStyle(.secondary)
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .combine)
    .accessibilityLabel("Play \(video.title), \(video.durationLabel)")
  }
}

struct VideoArtwork: View {
  let video: VideoSummary

  var body: some View {
    AsyncImage(url: video.thumbnailURL) { phase in
      if case let .success(image) = phase {
        image.resizable().scaledToFill()
      } else {
        ZStack {
          VFTheme.heroGradient
          Image(systemName: video.mode == "screen" ? "rectangle.on.rectangle" : "video.fill")
            .font(.system(size: 42, weight: .regular))
            .foregroundStyle(.white.opacity(0.82))
        }
      }
    }
    .clipped()
  }
}

private struct VideoRow: View {
  let video: VideoSummary
  let reviewStatus: String?

  var body: some View {
    HStack(spacing: 12) {
      VideoArtwork(video: video)
        .frame(width: 104, height: 62)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(alignment: .bottomTrailing) { DurationBadge(value: video.durationLabel) }

      VStack(alignment: .leading, spacing: 5) {
        Text(video.title)
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(.primary)
          .lineLimit(2)
        HStack(spacing: 7) {
          Text("\(Int(video.viewCount)) views")
          Text("·")
          Text(video.createdDate.formatted(date: .abbreviated, time: .omitted))
          if video.transcriptStatus != "ready" {
            Image(systemName: "text.badge.clock")
              .accessibilityLabel("Transcript processing")
          }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        if let reviewStatus { CompactReviewBadge(status: reviewStatus) }
      }
    }
    .padding(.vertical, 3)
    .contentShape(Rectangle())
  }
}

private struct DurationBadge: View {
  let value: String

  var body: some View {
    Text(value)
      .font(.caption2.monospacedDigit().bold())
      .foregroundStyle(.white)
      .padding(.horizontal, 4)
      .padding(.vertical, 2)
      .background(.black.opacity(0.68), in: RoundedRectangle(cornerRadius: 4))
      .padding(5)
  }
}

private struct CompactReviewBadge: View {
  let status: String

  private var presentation: (String, Color) {
    switch status {
    case "approved": ("Approved", VFTheme.mint)
    case "changes_requested": ("Changes requested", VFTheme.coral)
    default: ("Awaiting review", VFTheme.purple)
    }
  }

  var body: some View {
    Label(presentation.0, systemImage: status == "approved" ? "checkmark.circle.fill" : "bubble.left.fill")
      .font(.caption2.weight(.semibold))
      .foregroundStyle(presentation.1)
      .lineLimit(1)
      .padding(.horizontal, 7)
      .padding(.vertical, 4)
      .background(presentation.1.opacity(0.09), in: Capsule())
  }
}

private struct ReviewDraft: Identifiable {
  let id = UUID()
  let video: VideoSummary
}

struct VideoDetailView: View {
  let video: VideoSummary
  let model: AppModel
  @State private var playback: VideoPlaybackModel
  @State private var reviewDraft: ReviewDraft?

  private var reviews: [ReviewRequestSummary] { model.reviews.filter { $0.videoId == video.id } }

  init(video: VideoSummary, model: AppModel) {
    self.video = video
    self.model = model
    _playback = State(initialValue: model.playbackModel(for: video.id))
  }

  var body: some View {
    ZStack {
      VFTheme.canvas.ignoresSafeArea()
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          Group {
            if let source = playback.playback?.preferredURL {
              VideoPlayer(player: AVPlayer(url: source))
            } else if let error = playback.errorMessage {
              ContentUnavailableView("Playback unavailable", systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
              ZStack {
                VideoArtwork(video: video)
                ProgressView().tint(.white)
              }
            }
          }
          .aspectRatio(16 / 9, contentMode: .fit)
          .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

          Text(video.title).font(.title3.weight(.semibold))

          if let source = playback.playback?.preferredURL {
            NavigationLink {
              NativeVideoEditorView(video: video, sourceURL: source)
            } label: {
              Label("Open Video Editor", systemImage: "slider.horizontal.3")
            }
            .buttonStyle(VFPrimaryButtonStyle())
          }

          HStack(spacing: 16) {
            Label(video.durationLabel, systemImage: "clock")
            Label("\(Int(video.viewCount)) views", systemImage: "eye")
            Label(video.visibility.capitalized, systemImage: "lock")
          }
          .font(.caption)
          .foregroundStyle(.secondary)

          HStack {
            Label(video.mode.capitalized, systemImage: video.mode == "screen" ? "rectangle.on.rectangle" : "video")
            Spacer()
            Label(video.transcriptStatus.capitalized, systemImage: video.transcriptStatus == "ready" ? "text.badge.checkmark" : "text.badge.clock")
          }
          .font(.subheadline)
          .padding(14)
          .vfCard()

          if !reviews.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
              Text("Review activity").font(.subheadline.weight(.semibold))
              ForEach(reviews) { review in
                HStack {
                  VStack(alignment: .leading, spacing: 3) {
                    Text(review.recipientName).font(.subheadline.weight(.semibold))
                    Text(review.dueDate?.formatted(date: .abbreviated, time: .omitted) ?? "No due date")
                      .font(.caption).foregroundStyle(.secondary)
                  }
                  Spacer()
                  CompactReviewBadge(status: review.status)
                }
              }
            }
            .padding(14)
            .vfCard()
          }

          VStack(alignment: .leading, spacing: 10) {
            Text("Request feedback").font(.subheadline.weight(.semibold))
            Text("Send a private link. The reviewer does not need a VideoFlow account.")
              .font(.footnote).foregroundStyle(.secondary)
            Button { reviewDraft = ReviewDraft(video: video) } label: {
              Label("Request Review", systemImage: "paperplane.fill")
            }
            .buttonStyle(VFPrimaryButtonStyle())
          }
        }
        .padding(16)
      }
    }
    .navigationTitle("Video")
    .navigationBarTitleDisplayMode(.inline)
    .sheet(item: $reviewDraft) { draft in
      ReviewRequestForm(video: draft.video, model: model)
    }
  }
}

private struct ReviewRequestForm: View {
  let video: VideoSummary
  let model: AppModel
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var email = ""
  @State private var message = ""
  @State private var hasDueDate = false
  @State private var dueDate = Date.now.addingTimeInterval(3 * 86_400)
  @State private var isSubmitting = false

  var body: some View {
    NavigationStack {
      Form {
        Section { LabeledContent("Video", value: video.title) }
        Section("Reviewer") {
          TextField("Name", text: $name).textContentType(.name)
          TextField("Email", text: $email)
            .textContentType(.emailAddress)
            .textInputAutocapitalization(.never)
            .keyboardType(.emailAddress)
        }
        Section("Request") {
          TextField("Message (optional)", text: $message, axis: .vertical).lineLimit(3...6)
          Toggle("Set a due date", isOn: $hasDueDate)
          if hasDueDate {
            DatePicker("Due", selection: $dueDate, in: Date.now..., displayedComponents: [.date, .hourAndMinute])
          }
        }
      }
      .navigationTitle("Request Review")
      .navigationBarTitleDisplayMode(.inline)
      .tint(VFTheme.purple)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Send") {
            isSubmitting = true
            Task {
              let sent = await model.createReview(
                for: video,
                recipientName: name,
                recipientEmail: email,
                message: message.isEmpty ? nil : message,
                dueAt: hasDueDate ? dueDate : nil
              )
              isSubmitting = false
              if sent { dismiss() }
            }
          }
          .disabled(isSubmitting || name.trimmingCharacters(in: .whitespaces).isEmpty || !email.contains("@"))
        }
      }
      .overlay { if isSubmitting { ProgressView().controlSize(.large) } }
      .interactiveDismissDisabled(isSubmitting)
    }
  }
}

#Preview {
  LibraryView(model: AppModel(service: PreviewVideoFlowService()))
}

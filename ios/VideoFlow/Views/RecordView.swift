import AVFoundation
import ClerkKitUI
import CoreTransferable
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

private enum RecorderSheet: String, Identifiable {
  case camera
  var id: String { rawValue }
}

private enum RecordingQuality: String, CaseIterable, Identifiable {
  case high = "High"
  case balanced = "Balanced"

  var id: String { rawValue }
  var detail: String { self == .high ? "Best quality" : "Smaller file" }
  var symbol: String { self == .high ? "sparkles.tv" : "arrow.down.right.and.arrow.up.left" }
  var pickerQuality: UIImagePickerController.QualityType { self == .high ? .typeHigh : .typeMedium }
}

struct RecordView: View {
  let model: AppModel
  var showsAccountButton = true
  let onUploaded: () -> Void
  @State private var recorderSheet: RecorderSheet?
  @State private var capturedVideo: CapturedVideo?
  @State private var title = ""
  @State private var quality: RecordingQuality = .high
  @State private var selectedImport: PhotosPickerItem?
  @State private var isImporting = false

  private var cameraAvailable: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }

  var body: some View {
    NavigationStack {
      ZStack {
        VFTheme.canvas.ignoresSafeArea()
        ScrollView {
          VStack(spacing: 20) {
            VFPageHeader(
              title: "New recording",
              subtitle: "Capture, review, then upload."
            )

            HStack {
              Label("Up to 1080p · 30 fps", systemImage: "checkmark.seal.fill")
                .font(.caption.weight(.medium))
                .foregroundStyle(VFTheme.mutedInk)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .vfCard(cornerRadius: 20)
              Spacer()
            }

            recorderStage

            if let capturedVideo {
              capturedCard(capturedVideo)
            } else {
              captureGuide
            }
          }
          .padding(.horizontal, 16)
          .padding(.top, 8)
          .padding(.bottom, 30)
        }
        .scrollIndicators(.hidden)
      }
      .navigationTitle("")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          VFWordmark(compact: true)
        }
        if showsAccountButton {
          ToolbarItem(placement: .topBarTrailing) { UserButton() }
        }
      }
      .fullScreenCover(item: $recorderSheet) { _ in
        CameraCaptureView(quality: quality.pickerQuality) { result in
          recorderSheet = nil
          if case let .success(video) = result {
            capturedVideo = video
            if title.isEmpty { title = "iPhone recording" }
          } else if case let .failure(error) = result, !(error is CancellationError) {
            model.errorMessage = error.localizedDescription
          }
        }
        .ignoresSafeArea()
      }
      .interactiveDismissDisabled(model.isUploading)
      .onChange(of: selectedImport) { _, item in
        guard let item else { return }
        Task { await importVideo(item) }
      }
    }
  }

  private var recorderStage: some View {
    VStack(spacing: 16) {
      VStack(spacing: 12) {
        Image(systemName: capturedVideo == nil ? "video.fill" : "checkmark.circle.fill")
          .font(.system(size: 44, weight: .medium))
          .foregroundStyle(.white)
        Text(capturedVideo == nil ? "Record a video" : "Recording complete")
          .font(.title3.bold())
          .foregroundStyle(.white)
        Text(capturedVideo == nil ? "Camera and microphone" : "Ready to upload")
          .font(.subheadline)
          .foregroundStyle(.white.opacity(0.65))
      }
      .frame(maxWidth: .infinity, minHeight: 238)
      .background(VFTheme.ink, in: RoundedRectangle(cornerRadius: 16, style: .continuous))

      RecordingQualityControl(selection: $quality)

      HStack(spacing: 10) {
        Button {
          recorderSheet = .camera
        } label: {
          Label(capturedVideo == nil ? "Record" : "Record Again", systemImage: "record.circle")
        }
        .buttonStyle(VFPrimaryButtonStyle())
        .disabled(!cameraAvailable || isImporting)
        .opacity(cameraAvailable ? 1 : 0.55)

        PhotosPicker(selection: $selectedImport, matching: .videos) {
          Label(isImporting ? "Importing…" : "Import", systemImage: "photo.on.rectangle.angled")
            .font(.subheadline.weight(.semibold))
            .frame(maxWidth: .infinity)
            .frame(height: 48)
        }
        .buttonStyle(.bordered)
        .tint(VFTheme.purple)
        .disabled(isImporting || model.isUploading)
      }

      if !cameraAvailable {
        Label("Camera recording requires a physical iPhone", systemImage: "iphone")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
    .padding(14)
    .background(VFTheme.recordingSurface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(VFTheme.border))
    .shadow(color: VFTheme.ink.opacity(0.07), radius: 20, y: 10)
  }

  private var captureGuide: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("Before you record")
        .font(.headline)
        .padding(.bottom, 8)
      RecordInfoRow(icon: "clock", text: "Recordings can be up to 15 minutes")
      Divider().padding(.leading, 34)
      RecordInfoRow(icon: "lock", text: "Videos stay private until you share them")
      Divider().padding(.leading, 34)
      RecordInfoRow(icon: "icloud.and.arrow.up", text: "Nothing uploads until you confirm")
    }
    .padding(16)
    .vfCard()
  }

  private func capturedCard(_ video: CapturedVideo) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack {
        Label("Video ready", systemImage: "checkmark.circle.fill")
          .font(.headline)
          .foregroundStyle(VFTheme.mint)
        Spacer()
        Text(durationLabel(video.durationMs))
          .font(.caption.monospacedDigit().bold())
          .foregroundStyle(VFTheme.mutedInk)
      }

      TextField("Give your video a title", text: $title)
        .textInputAutocapitalization(.sentences)
        .font(.headline)
        .padding(14)
        .background(VFTheme.canvas, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

      HStack {
        Label(ByteCountFormatter.string(fromByteCount: Int64(video.sizeBytes), countStyle: .file), systemImage: "internaldrive")
        Spacer()
        Label("Private", systemImage: "lock.fill")
      }
      .font(.caption)
      .foregroundStyle(VFTheme.mutedInk)

      Button {
        Task {
          if await model.upload(video, title: title.isEmpty ? "iPhone recording" : title) {
            capturedVideo = nil
            title = ""
            onUploaded()
          }
        }
      } label: {
        Label(model.isUploading ? "Uploading…" : "Upload to VideoFlow", systemImage: model.isUploading ? "arrow.up.circle" : "icloud.and.arrow.up.fill")
      }
      .buttonStyle(VFPrimaryButtonStyle())
      .disabled(model.isUploading)
    }
    .padding(18)
    .vfCard()
  }

  private func durationLabel(_ milliseconds: Double) -> String {
    let seconds = Int(milliseconds / 1_000)
    return String(format: "%d:%02d", seconds / 60, seconds % 60)
  }

  private func importVideo(_ item: PhotosPickerItem) async {
    isImporting = true
    defer {
      isImporting = false
      selectedImport = nil
    }
    do {
      guard let imported = try await item.loadTransferable(type: ImportedVideoFile.self) else {
        throw URLError(.cannotDecodeContentData)
      }
      capturedVideo = try await CapturedVideoFactory.make(from: imported.url)
      if title.isEmpty { title = "Imported video" }
    } catch is CancellationError {
      return
    } catch {
      model.errorMessage = error.localizedDescription
    }
  }
}

private struct ImportedVideoFile: Transferable {
  let url: URL

  static var transferRepresentation: some TransferRepresentation {
    FileRepresentation(contentType: .movie) { video in
      SentTransferredFile(video.url)
    } importing: { received in
      let pathExtension = received.file.pathExtension.isEmpty ? "mov" : received.file.pathExtension
      let destination = FileManager.default.temporaryDirectory
        .appendingPathComponent("VideoFlow-Import-\(UUID().uuidString)")
        .appendingPathExtension(pathExtension)
      if FileManager.default.fileExists(atPath: destination.path) {
        try FileManager.default.removeItem(at: destination)
      }
      try FileManager.default.copyItem(at: received.file, to: destination)
      return Self(url: destination)
    }
  }
}

private enum CapturedVideoFactory {
  static func make(from url: URL) async throws -> CapturedVideo {
    let asset = AVURLAsset(url: url)
    let duration = try await asset.load(.duration)
    let track = try await asset.loadTracks(withMediaType: .video).first
    let dimensions: CGSize?
    if let track {
      let size = try await track.load(.naturalSize)
      let transform = try await track.load(.preferredTransform)
      let transformed = size.applying(transform)
      dimensions = CGSize(width: abs(transformed.width), height: abs(transformed.height))
    } else {
      dimensions = nil
    }
    let values = try url.resourceValues(forKeys: [.fileSizeKey])
    let mimeType = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
      ?? (url.pathExtension.lowercased() == "mp4" ? "video/mp4" : "video/quicktime")
    return CapturedVideo(
      url: url,
      durationMs: duration.seconds * 1_000,
      width: dimensions.map { Double(abs($0.width)) },
      height: dimensions.map { Double(abs($0.height)) },
      mimeType: mimeType,
      sizeBytes: values.fileSize ?? 0
    )
  }
}

private struct RecordInfoRow: View {
  let icon: String
  let text: String

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: icon)
        .foregroundStyle(VFTheme.purple)
        .frame(width: 22)
      Text(text)
        .font(.subheadline)
        .foregroundStyle(.primary)
      Spacer()
    }
    .padding(.vertical, 10)
  }
}

private struct RecordingQualityControl: View {
  @Binding var selection: RecordingQuality

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Recording quality")
        .font(.caption.weight(.semibold))
        .foregroundStyle(.secondary)

      if #available(iOS 26.0, *) {
        GlassEffectContainer(spacing: 8) {
          HStack(spacing: 8) {
            ForEach(RecordingQuality.allCases) { option in
              qualityButton(option, usesGlass: true)
            }
          }
        }
      } else {
        HStack(spacing: 8) {
          ForEach(RecordingQuality.allCases) { option in
            qualityButton(option, usesGlass: false)
          }
        }
      }
    }
  }

  @ViewBuilder
  private func qualityButton(_ option: RecordingQuality, usesGlass: Bool) -> some View {
    Button { selection = option } label: {
      HStack(spacing: 8) {
        Image(systemName: option.symbol)
        VStack(alignment: .leading, spacing: 1) {
          Text(option.rawValue).font(.subheadline.weight(.semibold))
          Text(option.detail).font(.caption2).opacity(0.72)
        }
        Spacer(minLength: 0)
        if selection == option { Image(systemName: "checkmark.circle.fill") }
      }
      .foregroundStyle(selection == option ? VFTheme.purple : VFTheme.mutedInk)
      .padding(.horizontal, 12)
      .padding(.vertical, 10)
      .frame(maxWidth: .infinity)
    }
    .buttonStyle(.plain)
    .modifier(RecordingQualitySurface(selected: selection == option, usesGlass: usesGlass))
  }
}

private struct RecordingQualitySurface: ViewModifier {
  let selected: Bool
  let usesGlass: Bool

  @ViewBuilder
  func body(content: Content) -> some View {
    if #available(iOS 26.0, *), usesGlass {
      content.glassEffect(
        .regular.tint(selected ? VFTheme.accent : nil).interactive(),
        in: .rect(cornerRadius: 12)
      )
    } else {
      content
        .background(selected ? VFTheme.accent : Color.white, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(VFTheme.border))
    }
  }
}

struct CameraCaptureView: UIViewControllerRepresentable {
  let quality: UIImagePickerController.QualityType
  let completion: @MainActor (Result<CapturedVideo, Error>) -> Void

  func makeCoordinator() -> Coordinator { Coordinator(completion: completion) }

  func makeUIViewController(context: Context) -> UIImagePickerController {
    let picker = UIImagePickerController()
    picker.sourceType = .camera
    picker.mediaTypes = [UTType.movie.identifier]
    picker.cameraCaptureMode = .video
    picker.videoQuality = quality
    picker.videoMaximumDuration = 15 * 60
    picker.delegate = context.coordinator
    return picker
  }

  func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {
    uiViewController.videoQuality = quality
  }

  final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    let completion: @MainActor (Result<CapturedVideo, Error>) -> Void

    init(completion: @escaping @MainActor (Result<CapturedVideo, Error>) -> Void) {
      self.completion = completion
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
      Task { @MainActor in completion(.failure(CancellationError())) }
    }

    func imagePickerController(
      _ picker: UIImagePickerController,
      didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
    ) {
      guard let url = info[.mediaURL] as? URL else {
        Task { @MainActor in completion(.failure(URLError(.fileDoesNotExist))) }
        return
      }
      Task {
        do {
          completion(.success(try await CapturedVideoFactory.make(from: url)))
        } catch {
          completion(.failure(error))
        }
      }
    }
  }
}

#Preview {
  RecordView(model: AppModel(service: PreviewVideoFlowService()), onUploaded: {})
}

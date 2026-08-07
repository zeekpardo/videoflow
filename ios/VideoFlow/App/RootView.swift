import ClerkKitUI
import ConvexMobile
import SwiftUI

private enum AuthenticationSheet: String, Identifiable {
  case signIn
  var id: String { rawValue }
}

struct RootView: View {
  let configured: Bool
  let model: AppModel
  let auth: AuthSessionModel
  let showsAccountButton: Bool
  @State private var authenticationSheet: AuthenticationSheet?

  var body: some View {
    Group {
      if !configured {
        ContentUnavailableView {
          Label("Configure VideoFlow", systemImage: "gearshape.fill")
        } description: {
          Text("Copy Config/VideoFlow.local.xcconfig.example to VideoFlow.local.xcconfig, add the public Clerk and Convex client values, then rebuild.")
        }
      } else {
        switch auth.state {
        case .loading:
          ProgressView("Connecting securely…")
        case .unauthenticated:
          signedOutView
        case .authenticated:
          AppShell(model: model, showsAccountButton: showsAccountButton)
        }
      }
    }
    .sheet(item: $authenticationSheet) { _ in AuthView() }
  }

  private var signedOutView: some View {
    ZStack {
      VFTheme.canvas.ignoresSafeArea()
      Circle()
        .fill(VFTheme.violet.opacity(0.18))
        .frame(width: 330, height: 330)
        .blur(radius: 2)
        .offset(x: 170, y: -330)
      VStack(spacing: 28) {
        VFBrandMark(size: 74)
        VStack(spacing: 10) {
          Text("VideoFlow")
            .font(.system(size: 36, weight: .semibold, design: .rounded))
            .foregroundStyle(VFTheme.ink)
          Text("Capture the idea.\nMove the work forward.")
            .font(.subheadline)
            .foregroundStyle(VFTheme.mutedInk)
            .multilineTextAlignment(.center)
        }
        Button { authenticationSheet = .signIn } label: {
          HStack {
            Text("Continue to workspace")
            Spacer()
            Image(systemName: "arrow.right")
          }
        }
        .buttonStyle(VFPrimaryButtonStyle())
      }
      .padding(32)
    }
  }
}

private enum AppTab: Hashable {
  case library, record, reviews
}

struct AppShell: View {
  let model: AppModel
  var showsAccountButton = true
  @State private var selectedTab: AppTab = .library

  var body: some View {
    TabView(selection: $selectedTab) {
      LibraryView(model: model, showsAccountButton: showsAccountButton)
        .tabItem { Label("Library", systemImage: "rectangle.stack.fill") }
        .tag(AppTab.library)
      RecordView(model: model, showsAccountButton: showsAccountButton, onUploaded: { selectedTab = .library })
        .tabItem { Label("Record", systemImage: "video.fill") }
        .tag(AppTab.record)
      ReviewsView(model: model, showsAccountButton: showsAccountButton)
        .tabItem { Label("Reviews", systemImage: "checkmark.bubble.fill") }
        .tag(AppTab.reviews)
    }
    .tint(VFTheme.purple)
    .task { model.start() }
    .alert("VideoFlow couldn’t finish that", isPresented: Binding(
      get: { model.errorMessage != nil },
      set: { if !$0 { model.errorMessage = nil } }
    )) {
      Button("OK", role: .cancel) { model.errorMessage = nil }
    } message: {
      Text(model.errorMessage ?? "Please try again.")
    }
  }
}

#Preview("Signed in shell") {
  AppShell(model: AppModel(service: PreviewVideoFlowService()))
}

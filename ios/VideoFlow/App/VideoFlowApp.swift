import ClerkConvex
import ClerkKit
import ClerkKitUI
import Combine
import ConvexMobile
import Observation
import SwiftUI

struct AppConfiguration {
  let convexURL: String
  let clerkPublishableKey: String

  static let current = AppConfiguration(
    convexURL: Bundle.main.object(forInfoDictionaryKey: "VIDEOFLOW_CONVEX_URL") as? String ?? "",
    clerkPublishableKey: Bundle.main.object(forInfoDictionaryKey: "VIDEOFLOW_CLERK_PUBLISHABLE_KEY") as? String ?? ""
  )

  var isReady: Bool {
    convexURL.hasPrefix("https://") && convexURL.contains(".convex.cloud")
      && clerkPublishableKey.hasPrefix("pk_") && !clerkPublishableKey.contains("replace_me")
  }
}

@MainActor
@Observable
final class AuthSessionModel {
  var state: AuthState<String> = .loading
  @ObservationIgnored private var subscription: AnyCancellable?

  init(client: ConvexClientWithAuth<String>?) {
    guard let client else {
      state = .unauthenticated
      return
    }
    subscription = client.authState
      .replaceError(with: .unauthenticated)
      .receive(on: DispatchQueue.main)
      .sink { [weak self] state in self?.state = state }
  }
}

@main
struct VideoFlowApp: App {
  private let configuration: AppConfiguration
  private let previewMode: Bool
  @State private var model: AppModel
  @State private var auth: AuthSessionModel

  @MainActor
  init() {
    let configuration = AppConfiguration.current
    let previewMode = ProcessInfo.processInfo.arguments.contains("-previewMode")
    self.configuration = configuration
    self.previewMode = previewMode
    if previewMode {
      let auth = AuthSessionModel(client: nil)
      auth.state = .authenticated("preview-user")
      _model = State(initialValue: AppModel(service: PreviewVideoFlowService()))
      _auth = State(initialValue: auth)
    } else if configuration.isReady {
      Clerk.configure(publishableKey: configuration.clerkPublishableKey)
      let client = ConvexClientWithAuth(
        deploymentUrl: configuration.convexURL,
        authProvider: ClerkConvexAuthProvider()
      )
      _model = State(initialValue: AppModel(service: ConvexVideoFlowService(client: client)))
      _auth = State(initialValue: AuthSessionModel(client: client))
    } else {
      _model = State(initialValue: AppModel(service: PreviewVideoFlowService()))
      _auth = State(initialValue: AuthSessionModel(client: nil))
    }
  }

  var body: some Scene {
    WindowGroup {
      if previewMode {
        RootView(configured: true, model: model, auth: auth, showsAccountButton: false)
      } else if configuration.isReady {
        RootView(configured: configuration.isReady, model: model, auth: auth, showsAccountButton: true)
          .environment(Clerk.shared)
          .prefetchClerkImages()
      } else {
        RootView(configured: false, model: model, auth: auth, showsAccountButton: false)
      }
    }
  }
}

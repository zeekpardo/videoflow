package com.videoflow.android

import android.app.Application
import com.clerk.api.Clerk
import com.clerk.api.ClerkConfigurationOptions
import com.clerk.convex.createClerkConvexClient
import com.videoflow.android.data.VideoFlowRepository

class VideoFlowApplication : Application() {
  val isProductionConfigured: Boolean
    get() = BuildConfig.VIDEOFLOW_CONVEX_URL.isNotBlank() && BuildConfig.VIDEOFLOW_CLERK_PUBLISHABLE_KEY.isNotBlank()

  var repository: VideoFlowRepository? = null
    private set

  override fun onCreate() {
    super.onCreate()
    if (!isProductionConfigured) return

    Clerk.initialize(
      context = this,
      publishableKey = BuildConfig.VIDEOFLOW_CLERK_PUBLISHABLE_KEY,
      options = ClerkConfigurationOptions(enableDebugMode = BuildConfig.DEBUG),
    )
    repository = VideoFlowRepository(
      context = this,
      convex = createClerkConvexClient(
        deploymentUrl = BuildConfig.VIDEOFLOW_CONVEX_URL,
        context = applicationContext,
      ),
    )
  }
}

package com.videoflow.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.clerk.ui.auth.AuthView
import com.videoflow.android.editor.VideoEditorScreen
import com.videoflow.android.model.VideoSummary
import com.videoflow.android.ui.VideoFlowTheme
import com.videoflow.android.ui.screens.HomeScreen
import com.videoflow.android.ui.screens.VideoDetailScreen

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
    setContent {
      VideoFlowTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
          val model: VideoFlowViewModel = viewModel()
          val authState by model.authState.collectAsStateWithLifecycle()
          when (authState) {
            VideoFlowAuthState.Loading -> LoadingScreen()
            VideoFlowAuthState.SignedOut -> AuthView()
            VideoFlowAuthState.Preview, VideoFlowAuthState.SignedIn -> VideoFlowApp(model)
          }
        }
      }
    }
  }
}

private enum class Route { Home, Detail, Editor }

@Composable
private fun VideoFlowApp(model: VideoFlowViewModel) {
  val videos by model.videos.collectAsStateWithLifecycle()
  val reviews by model.reviews.collectAsStateWithLifecycle()
  val sourceUrl by model.selectedSourceUrl.collectAsStateWithLifecycle()
  val isUploading by model.isUploading.collectAsStateWithLifecycle()
  val uploadMessage by model.uploadMessage.collectAsStateWithLifecycle()
  var route by rememberSaveable { mutableStateOf(Route.Home) }
  var selectedVideoId by rememberSaveable { mutableStateOf<String?>(null) }
  val selectedVideo: VideoSummary? = videos.firstOrNull { it.id == selectedVideoId }

  if (selectedVideo == null && route != Route.Home) route = Route.Home

  when (route) {
    Route.Home -> HomeScreen(
      videos = videos,
      reviews = reviews,
      isUploading = isUploading,
      uploadMessage = uploadMessage,
      uploadVideo = model::upload,
      openVideo = {
        selectedVideoId = it.id
        model.loadPlayback(it.id)
        route = Route.Detail
      },
    )
    Route.Detail -> selectedVideo?.let { video ->
      VideoDetailScreen(
        video = video,
        sourceUrl = sourceUrl,
        back = { route = Route.Home },
        openEditor = { if (sourceUrl != null) route = Route.Editor },
      )
    }
    Route.Editor -> if (selectedVideo != null && sourceUrl != null) {
      VideoEditorScreen(
        video = selectedVideo,
        sourceUrl = sourceUrl!!,
        close = { route = Route.Detail },
      )
    }
  }
}

@Composable
private fun LoadingScreen() {
  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
      CircularProgressIndicator()
      Text("Opening VideoFlow…", style = MaterialTheme.typography.bodyMedium)
    }
  }
}

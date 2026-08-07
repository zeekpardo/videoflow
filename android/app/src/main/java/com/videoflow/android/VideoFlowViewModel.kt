package com.videoflow.android

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.videoflow.android.data.RemoteReview
import com.videoflow.android.data.RemoteVideo
import com.videoflow.android.data.VideoFlowRepository
import com.videoflow.android.model.PreviewData
import com.videoflow.android.model.ReviewSummary
import com.videoflow.android.model.VideoSummary
import dev.convex.android.AuthState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

enum class VideoFlowAuthState { Preview, Loading, SignedOut, SignedIn }

class VideoFlowViewModel(application: Application) : AndroidViewModel(application) {
  private val app = application as VideoFlowApplication
  private val repository: VideoFlowRepository? = app.repository

  val authState: StateFlow<VideoFlowAuthState> = repository?.authState
    ?.map {
      when (it) {
        is AuthState.Authenticated -> VideoFlowAuthState.SignedIn
        is AuthState.AuthLoading -> VideoFlowAuthState.Loading
        is AuthState.Unauthenticated -> VideoFlowAuthState.SignedOut
      }
    }
    ?.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), VideoFlowAuthState.Loading)
    ?: MutableStateFlow(VideoFlowAuthState.Preview)

  val videos: StateFlow<List<VideoSummary>> = repository?.videos()
    ?.map { result -> result.getOrThrow().map { it.asSummary() } }
    ?.catch { errorMessage.value = it.message ?: "Could not load videos"; emit(emptyList()) }
    ?.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    ?: MutableStateFlow(PreviewData.videos)

  val reviews: StateFlow<List<ReviewSummary>> = repository?.reviews()
    ?.map { result -> result.getOrThrow().map { it.asSummary() } }
    ?.catch { errorMessage.value = it.message ?: "Could not load reviews"; emit(emptyList()) }
    ?.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    ?: MutableStateFlow(PreviewData.reviews)

  val selectedSourceUrl = MutableStateFlow<String?>(if (repository == null) PreviewData.sourceUrl else null)
  val isUploading = MutableStateFlow(false)
  val uploadMessage = MutableStateFlow<String?>(null)
  val errorMessage = MutableStateFlow<String?>(null)

  fun loadPlayback(videoId: String) {
    if (repository == null) {
      selectedSourceUrl.value = PreviewData.sourceUrl
      return
    }
    selectedSourceUrl.value = null
    viewModelScope.launch {
      runCatching { repository.playback(videoId).preferredUrl }
        .onSuccess { selectedSourceUrl.value = it }
        .onFailure { errorMessage.value = it.message ?: "Could not load this video" }
    }
  }

  fun upload(uri: Uri, title: String) {
    val connected = repository ?: return
    if (isUploading.value) return
    viewModelScope.launch {
      isUploading.value = true
      uploadMessage.value = null
      runCatching { connected.upload(uri, title) }
        .onSuccess { uploadMessage.value = "Uploaded to your VideoFlow library" }
        .onFailure { errorMessage.value = it.message ?: "Upload failed" }
      isUploading.value = false
    }
  }

  private fun RemoteVideo.asSummary() = VideoSummary(
    id = id,
    title = title,
    durationMs = durationMs.toLong(),
    mode = mode.replaceFirstChar(Char::uppercase),
    views = viewCount.toInt(),
    status = when {
      finishedRenditionStatus == "processing" -> "Rendering"
      transcriptStatus == "pending" || transcriptStatus == "processing" -> "Processing"
      else -> visibility.replaceFirstChar(Char::uppercase)
    },
    age = relativeDay(createdAt.toLong()),
  )

  private fun RemoteReview.asSummary() = ReviewSummary(
    id = id,
    videoId = videoId,
    videoTitle = videoTitle,
    reviewer = recipientName,
    status = when (status) {
      "approved" -> "Approved"
      "changes_requested" -> "Changes requested"
      "canceled" -> "Canceled"
      else -> "Waiting"
    },
    note = responseNote ?: message ?: "Awaiting feedback",
    due = dueAt?.let { relativeDay(it.toLong()) } ?: "No due date",
  )

  private fun relativeDay(milliseconds: Long): String {
    val localDate = Instant.ofEpochMilli(milliseconds).atZone(ZoneId.systemDefault()).toLocalDate()
    val today = java.time.LocalDate.now()
    return when (localDate) {
      today -> "Today"
      today.minusDays(1) -> "Yesterday"
      else -> localDate.format(DateTimeFormatter.ofPattern("MMM d"))
    }
  }
}

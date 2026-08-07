package com.videoflow.android.data

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import dev.convex.android.AuthState
import dev.convex.android.ConvexClientWithAuth
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

class VideoFlowRepository(
  private val context: Context,
  private val convex: ConvexClientWithAuth<String>,
) {
  val authState: StateFlow<AuthState<String>> = convex.authState

  fun videos(): Flow<Result<List<RemoteVideo>>> = convex.subscribe("videos:list")

  fun reviews(): Flow<Result<List<RemoteReview>>> =
    convex.subscribe("videoFlowV2:workspaceReviewRequests")

  suspend fun playback(videoId: String): RemoteVideoDetail = withContext(Dispatchers.IO) {
    convex.subscribe<RemoteVideoDetail>("videos:get", mapOf("videoId" to videoId)).first().getOrThrow()
  }

  suspend fun upload(uri: Uri, title: String): CreatedVideo = withContext(Dispatchers.IO) {
    val source = copyToUploadCache(uri)
    try {
      val metadata = readMetadata(source)
      val grant = convex.mutation<UploadGrant>("r2:generateUploadUrl", emptyMap())
      uploadFile(grant, source, metadata.mimeType)
      val args = mutableMapOf<String, Any>(
        "title" to title.trim().take(200).ifBlank { "Android video" },
        "storageId" to grant.key,
        "durationMs" to metadata.durationMs,
        "mode" to "camera",
        "mimeType" to metadata.mimeType,
        "sizeBytes" to source.length(),
      )
      metadata.width?.let { args["width"] = it }
      metadata.height?.let { args["height"] = it }
      convex.action<CreatedVideo>(
        "videoActions:create",
        args,
      )
    } finally {
      source.delete()
    }
  }

  private fun copyToUploadCache(uri: Uri): File {
    val mimeType = context.contentResolver.getType(uri) ?: "video/mp4"
    val suffix = if (mimeType.contains("quicktime")) ".mov" else ".mp4"
    val file = File.createTempFile("videoflow-upload-", suffix, context.cacheDir)
    context.contentResolver.openInputStream(uri).use { input ->
      requireNotNull(input) { "The selected video could not be opened" }
      file.outputStream().use(input::copyTo)
    }
    require(file.length() > 0) { "The selected video is empty" }
    return file
  }

  private fun readMetadata(file: File): UploadMetadata {
    val retriever = MediaMetadataRetriever()
    return try {
      retriever.setDataSource(file.absolutePath)
      UploadMetadata(
        durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull() ?: 1.0,
        width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toDoubleOrNull(),
        height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toDoubleOrNull(),
        mimeType = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_MIMETYPE) ?: "video/mp4",
      )
    } finally {
      retriever.release()
    }
  }

  private fun uploadFile(grant: UploadGrant, file: File, mimeType: String) {
    val connection = URL(grant.url).openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "PUT"
      connection.doOutput = true
      connection.setRequestProperty("Content-Type", mimeType)
      connection.setFixedLengthStreamingMode(file.length())
      file.inputStream().use { input -> connection.outputStream.use(input::copyTo) }
      if (connection.responseCode !in 200..299) {
        throw IllegalStateException("Upload failed (${connection.responseCode})")
      }
    } finally {
      connection.disconnect()
    }
  }
}

private data class UploadMetadata(
  val durationMs: Double,
  val width: Double?,
  val height: Double?,
  val mimeType: String,
)

@Serializable
data class RemoteVideo(
  @SerialName("_id") val id: String,
  val title: String,
  val durationMs: Double,
  val mode: String,
  val visibility: String,
  val viewCount: Double,
  val transcriptStatus: String,
  val finishedRenditionStatus: String? = null,
  val finishedRenditionCurrent: Boolean = false,
  val createdAt: Double,
  val thumbnailUrl: String? = null,
)

@Serializable
data class RemoteReview(
  @SerialName("_id") val id: String,
  val videoId: String,
  val videoTitle: String,
  val recipientName: String,
  val recipientEmail: String,
  val message: String? = null,
  val dueAt: Double? = null,
  val status: String,
  val responseNote: String? = null,
  val respondedAt: Double? = null,
  val canceledAt: Double? = null,
  val lastRemindedAt: Double? = null,
  val reminderCount: Double? = null,
  val createdAt: Double,
  val linkStatus: String,
)

@Serializable
data class RemoteVideoDetail(
  @SerialName("_id") val id: String,
  val url: String,
  val finishedRendition: RemoteRendition? = null,
) {
  val preferredUrl: String
    get() = finishedRendition?.takeIf { it.current }?.url ?: url
}

@Serializable
data class RemoteRendition(val current: Boolean = false, val url: String? = null)

@Serializable
private data class UploadGrant(val key: String, val url: String)

@Serializable
data class CreatedVideo(val videoId: String)

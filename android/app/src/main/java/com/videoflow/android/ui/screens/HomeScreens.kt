package com.videoflow.android.ui.screens

import android.net.Uri
import android.view.ViewGroup
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.FiberManualRecord
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.NotificationsNone
import androidx.compose.material.icons.filled.PeopleAlt
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.FileProvider
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.videoflow.android.model.ReviewSummary
import com.videoflow.android.model.VideoSummary
import com.videoflow.android.model.formatDuration
import com.videoflow.android.ui.VFAmber
import com.videoflow.android.ui.VFBackground
import com.videoflow.android.ui.VFGreen
import com.videoflow.android.ui.VFLine
import com.videoflow.android.ui.VFPurple
import com.videoflow.android.ui.VFSurface
import java.io.File

private enum class HomeTab(val label: String) { Library("Library"), Record("Record"), Reviews("Reviews") }

@Composable
fun HomeScreen(
  videos: List<VideoSummary>,
  reviews: List<ReviewSummary>,
  isUploading: Boolean,
  uploadMessage: String?,
  uploadVideo: (Uri, String) -> Unit,
  openVideo: (VideoSummary) -> Unit,
) {
  var selectedTab by rememberSaveable { mutableIntStateOf(0) }
  val tabs = HomeTab.entries

  Scaffold(
    containerColor = VFBackground,
    bottomBar = {
      NavigationBar(containerColor = VFSurface, modifier = Modifier.navigationBarsPadding()) {
        tabs.forEachIndexed { index, tab ->
          NavigationBarItem(
            selected = selectedTab == index,
            onClick = { selectedTab = index },
            icon = {
              Icon(
                when (tab) {
                  HomeTab.Library -> Icons.Default.VideoLibrary
                  HomeTab.Record -> Icons.Default.FiberManualRecord
                  HomeTab.Reviews -> Icons.Default.PeopleAlt
                },
                contentDescription = null,
              )
            },
            label = { Text(tab.label) },
          )
        }
      }
    },
  ) { padding ->
    when (tabs[selectedTab]) {
      HomeTab.Library -> LibraryScreen(videos, openVideo, Modifier.padding(padding))
      HomeTab.Record -> RecordScreen(isUploading, uploadMessage, uploadVideo, Modifier.padding(padding))
      HomeTab.Reviews -> ReviewsScreen(videos, reviews, openVideo, Modifier.padding(padding))
    }
  }
}

@Composable
private fun LibraryScreen(videos: List<VideoSummary>, openVideo: (VideoSummary) -> Unit, modifier: Modifier = Modifier) {
  LazyColumn(
    modifier = modifier.fillMaxSize().statusBarsPadding(),
    contentPadding = androidx.compose.foundation.layout.PaddingValues(18.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    item {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
          Text("VideoFlow", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
          Text("Your workspace", color = Color.White.copy(alpha = 0.48f), style = MaterialTheme.typography.bodySmall)
        }
        IconButton(onClick = {}) { Icon(Icons.Default.NotificationsNone, "Notifications") }
        IconButton(onClick = {}) { Icon(Icons.Default.FilterList, "Filter videos") }
      }
    }
    item {
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        StatusPill("All videos", true)
        StatusPill("Screen", false)
        StatusPill("Camera", false)
      }
    }
    items(videos, key = { it.id }) { video ->
      VideoRow(video = video, onClick = { openVideo(video) })
    }
  }
}

@Composable
private fun VideoRow(video: VideoSummary, onClick: () -> Unit) {
  Surface(
    modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
    shape = RoundedCornerShape(18.dp),
    color = VFSurface,
    border = androidx.compose.foundation.BorderStroke(1.dp, VFLine),
  ) {
    Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(13.dp)) {
      Box(
        Modifier.size(width = 112.dp, height = 72.dp)
          .background(
            Brush.linearGradient(listOf(Color(0xFF332B72), Color(0xFF131A2C))),
            RoundedCornerShape(12.dp),
          ),
        contentAlignment = Alignment.Center,
      ) {
        Icon(Icons.Default.PlayArrow, null, Modifier.size(30.dp), tint = Color.White.copy(alpha = 0.9f))
        Text(
          formatDuration(video.durationMs),
          Modifier.align(Alignment.BottomEnd).padding(6.dp)
            .background(Color.Black.copy(alpha = 0.65f), RoundedCornerShape(5.dp)).padding(horizontal = 5.dp, vertical = 2.dp),
          style = MaterialTheme.typography.labelSmall,
        )
      }
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(video.title, maxLines = 2, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium)
        Text("${video.views} views  ·  ${video.age}", color = Color.White.copy(alpha = 0.45f), style = MaterialTheme.typography.bodySmall)
        Text(video.status, color = statusColor(video.status), style = MaterialTheme.typography.labelMedium)
      }
      Icon(Icons.Default.MoreHoriz, "More", tint = Color.White.copy(alpha = 0.45f))
    }
  }
}

@Composable
private fun RecordScreen(
  isUploading: Boolean,
  uploadMessage: String?,
  uploadVideo: (Uri, String) -> Unit,
  modifier: Modifier = Modifier,
) {
  val context = LocalContext.current
  var selectedVideo by remember { mutableStateOf<Uri?>(null) }
  var pendingCapture by remember { mutableStateOf<Uri?>(null) }
  var title by rememberSaveable { mutableStateOf("Android video") }
  val importVideo = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri -> selectedVideo = uri }
  val captureVideo = rememberLauncherForActivityResult(ActivityResultContracts.CaptureVideo()) { saved ->
    selectedVideo = pendingCapture.takeIf { saved }
  }
  Box(modifier.fillMaxSize().statusBarsPadding().padding(24.dp), contentAlignment = Alignment.Center) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
      Box(Modifier.size(84.dp).background(VFPurple.copy(alpha = 0.16f), CircleShape), contentAlignment = Alignment.Center) {
        Icon(Icons.Default.FiberManualRecord, null, Modifier.size(44.dp), tint = VFPurple)
      }
      Text("Record a video", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
      Text(
        "Capture with the native camera, then review and edit in VideoFlow.",
        color = Color.White.copy(alpha = 0.55f),
        style = MaterialTheme.typography.bodyMedium,
      )
      Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Button(
          onClick = {
            val file = File.createTempFile("videoflow-capture-", ".mp4", context.cacheDir)
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
            pendingCapture = uri
            captureVideo.launch(uri)
          },
          enabled = !isUploading,
        ) {
          Icon(Icons.Default.FiberManualRecord, null)
          Spacer(Modifier.size(8.dp))
          Text("Camera")
        }
        FilledTonalButton(onClick = { importVideo.launch("video/*") }, enabled = !isUploading) {
          Icon(Icons.Default.VideoLibrary, null)
          Spacer(Modifier.size(8.dp))
          Text("Import")
        }
      }
      if (selectedVideo != null) {
        OutlinedTextField(
          value = title,
          onValueChange = { title = it.take(200) },
          label = { Text("Video title") },
          singleLine = true,
          modifier = Modifier.fillMaxWidth(),
        )
        Button(
          onClick = { selectedVideo?.let { uploadVideo(it, title) } },
          enabled = !isUploading,
          modifier = Modifier.fillMaxWidth(),
        ) {
          if (isUploading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
          else Icon(Icons.Default.VideoLibrary, null)
          Spacer(Modifier.size(8.dp))
          Text(if (isUploading) "Uploading…" else "Upload to VideoFlow")
        }
      }
      uploadMessage?.let { Text(it, color = VFGreen, style = MaterialTheme.typography.bodySmall) }
    }
  }
}

@Composable
private fun ReviewsScreen(
  videos: List<VideoSummary>,
  reviews: List<ReviewSummary>,
  openVideo: (VideoSummary) -> Unit,
  modifier: Modifier = Modifier,
) {
  LazyColumn(
    modifier = modifier.fillMaxSize().statusBarsPadding(),
    contentPadding = androidx.compose.foundation.layout.PaddingValues(18.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    item {
      Text("Reviews", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
      Text("Feedback without account friction", color = Color.White.copy(alpha = 0.48f))
      Spacer(Modifier.height(8.dp))
    }
    items(reviews, key = { it.id }) { review ->
      ReviewRow(review) {
        videos.firstOrNull { it.id == review.videoId }?.let(openVideo)
      }
    }
  }
}

@Composable
private fun ReviewRow(review: ReviewSummary, open: () -> Unit) {
  Surface(
    modifier = Modifier.fillMaxWidth().clickable(onClick = open),
    color = VFSurface,
    shape = RoundedCornerShape(18.dp),
    border = androidx.compose.foundation.BorderStroke(1.dp, VFLine),
  ) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Text(review.reviewer, Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
        Icon(
          if (review.status == "Approved") Icons.Default.CheckCircle else Icons.Default.Schedule,
          null,
          tint = statusColor(review.status),
        )
      }
      Text(review.videoTitle, maxLines = 1, overflow = TextOverflow.Ellipsis, color = Color.White.copy(alpha = 0.72f))
      Text(review.note, color = Color.White.copy(alpha = 0.48f), style = MaterialTheme.typography.bodySmall)
      Text("${review.status}  ·  ${review.due}", color = statusColor(review.status), style = MaterialTheme.typography.labelMedium)
    }
  }
}

@Composable
fun VideoDetailScreen(
  video: VideoSummary,
  sourceUrl: String?,
  back: () -> Unit,
  openEditor: () -> Unit,
) {
  val context = LocalContext.current
  val player = remember(sourceUrl) {
    sourceUrl?.let { url -> ExoPlayer.Builder(context).build().apply {
      setMediaItem(MediaItem.fromUri(url))
      prepare()
    } }
  }
  DisposableEffect(player) { onDispose { player?.release() } }

  LazyColumn(
    Modifier.fillMaxSize().background(VFBackground).statusBarsPadding(),
    contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 28.dp),
  ) {
    item {
      Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
        Text("Video", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Medium)
        IconButton(onClick = {}) { Icon(Icons.Default.MoreHoriz, "More") }
      }
    }
    item {
      if (player != null) {
        AndroidView(
          factory = {
            PlayerView(it).apply {
              this.player = player
              useController = true
              layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            }
          },
          modifier = Modifier.fillMaxWidth().aspectRatio(16 / 9f).background(Color.Black),
        )
      } else {
        Box(Modifier.fillMaxWidth().aspectRatio(16 / 9f).background(Color.Black), contentAlignment = Alignment.Center) {
          CircularProgressIndicator()
        }
      }
    }
    item {
      Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(video.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          StatusPill(video.status, false)
          StatusPill("${video.views} views", false)
        }
        Button(onClick = openEditor, modifier = Modifier.fillMaxWidth().height(52.dp)) {
          Icon(Icons.Default.Edit, null)
          Spacer(Modifier.size(8.dp))
          Text("Open video editor")
        }
        FilledTonalButton(onClick = {}, modifier = Modifier.fillMaxWidth().height(52.dp)) {
          Icon(Icons.Default.PeopleAlt, null)
          Spacer(Modifier.size(8.dp))
          Text("Request review")
        }
        Surface(color = VFSurface, shape = RoundedCornerShape(18.dp), border = androidx.compose.foundation.BorderStroke(1.dp, VFLine)) {
          Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
              Icon(Icons.Default.FolderOpen, null, tint = VFPurple)
              Spacer(Modifier.size(8.dp))
              Text("Review activity", fontWeight = FontWeight.SemiBold)
            }
            Text("Maya left feedback at 0:42", color = Color.White.copy(alpha = 0.62f))
            Text("Open requests do not require a VideoFlow login.", color = Color.White.copy(alpha = 0.42f), style = MaterialTheme.typography.bodySmall)
          }
        }
      }
    }
  }
}

@Composable
private fun StatusPill(label: String, selected: Boolean) {
  Surface(
    color = if (selected) VFPurple.copy(alpha = 0.2f) else Color.White.copy(alpha = 0.05f),
    shape = CircleShape,
    border = androidx.compose.foundation.BorderStroke(1.dp, if (selected) VFPurple.copy(alpha = 0.55f) else VFLine),
  ) {
    Text(label, Modifier.padding(horizontal = 11.dp, vertical = 7.dp), style = MaterialTheme.typography.labelMedium)
  }
}

private fun statusColor(status: String): Color = when {
  status.contains("Approved", true) -> VFGreen
  status.contains("Changes", true) -> VFAmber
  status.contains("Waiting", true) || status.contains("review", true) -> VFPurple
  else -> Color.White.copy(alpha = 0.5f)
}

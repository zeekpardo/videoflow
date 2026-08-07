@file:androidx.annotation.OptIn(
  androidx.media3.common.util.UnstableApi::class,
  androidx.media3.common.util.ExperimentalApi::class,
)

package com.videoflow.android.editor

import android.content.Intent
import android.view.ViewGroup
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Redo
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.AspectRatio
import androidx.compose.material.icons.filled.Audiotrack
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.FastForward
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.Subtitles
import androidx.compose.material.icons.filled.TextFields
import androidx.compose.material.icons.rounded.ContentCut
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.FileProvider
import androidx.media3.common.Player
import androidx.media3.transformer.CompositionPlayer
import androidx.media3.transformer.Transformer
import androidx.media3.ui.PlayerView
import com.videoflow.android.model.VideoSummary
import com.videoflow.android.model.formatDuration
import com.videoflow.android.ui.VFAmber
import com.videoflow.android.ui.VFBackground
import com.videoflow.android.ui.VFLine
import com.videoflow.android.ui.VFPurple
import com.videoflow.android.ui.VFSurface
import java.io.File
import kotlinx.coroutines.delay

@Composable
fun VideoEditorScreen(video: VideoSummary, sourceUrl: String, close: () -> Unit) {
  val context = LocalContext.current
  val draftStore = remember { EditorDraftStore(context.applicationContext) }
  val project = remember(video.id) { EditorProject(video.durationMs, draftStore.load(video.id)) }
  val player = remember { CompositionPlayer.Builder(context).build() }
  var currentTimeMs by remember { mutableLongStateOf(0) }
  var selectedTool by rememberSaveable { mutableStateOf(EditorTool.Edit) }
  var selectedAction by rememberSaveable { mutableStateOf(ClipAction.Trim) }
  var showExport by rememberSaveable { mutableStateOf(false) }
  var exportFile by remember { mutableStateOf<File?>(null) }
  var exportError by remember { mutableStateOf<String?>(null) }
  var exporter by remember { mutableStateOf<Transformer?>(null) }
  var draftStatus by remember { mutableStateOf("Local draft") }

  val composition = remember(project.revision, sourceUrl) { buildComposition(project, sourceUrl) }
  LaunchedEffect(composition) {
    val resumeAt = currentTimeMs.coerceIn(0, project.timelineDurationMs)
    player.setComposition(composition, resumeAt)
    player.prepare()
  }
  LaunchedEffect(player) {
    while (true) {
      currentTimeMs = player.currentPosition.coerceAtLeast(0)
      project.selectAt(currentTimeMs)
      delay(33)
    }
  }
  LaunchedEffect(project.revision) {
    draftStatus = "Saving…"
    delay(450)
    draftStore.save(video.id, project.draft())
    draftStatus = "Saved on device"
  }
  DisposableEffect(player) {
    onDispose {
      draftStore.save(video.id, project.draft())
      exporter?.cancel()
      player.release()
    }
  }

  Scaffold(
    containerColor = VFBackground,
    topBar = {
      EditorTopBar(
        title = video.title,
        subtitle = draftStatus,
        canUndo = project.canUndo,
        canRedo = project.canRedo,
        close = close,
        undo = project::undo,
        redo = project::redo,
        export = { showExport = true },
      )
    },
    bottomBar = {
      EditorToolShelf(
        selectedTool = selectedTool,
        selectedAction = selectedAction,
        selectTool = { selectedTool = it },
        selectAction = {
          selectedAction = it
          when (it) {
            ClipAction.Split -> project.split(currentTimeMs)
            ClipAction.Duplicate -> project.duplicateSelected()
            ClipAction.Delete -> project.deleteSelected()
            else -> Unit
          }
        },
      )
    },
  ) { padding ->
    Column(Modifier.fillMaxSize().padding(padding)) {
      EditorViewer(player, project.canvas.ratio)
      Transport(player, currentTimeMs, project.timelineDurationMs)
      TouchTimeline(
        project = project,
        currentTimeMs = currentTimeMs,
        seek = {
          currentTimeMs = it
          player.seekTo(it)
        },
        modifier = Modifier.weight(1f),
      )
      ContextPanel(project, selectedTool, selectedAction)
    }
  }

  if (showExport) {
    ExportDialog(
      durationMs = project.timelineDurationMs,
      canvas = project.canvas.label,
      exportFile = exportFile,
      error = exportError,
      isExporting = exporter != null,
      dismiss = {
        if (exporter == null) showExport = false
      },
      render = {
        exportError = null
        exportFile = null
        exporter = exportComposition(
          context = context,
          composition = composition,
          title = video.title,
          completed = {
            exportFile = it
            exporter = null
          },
          failed = {
            exportError = it.localizedMessage ?: "Export failed"
            exporter = null
          },
        )
      },
      share = { file ->
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        context.startActivity(
          Intent.createChooser(
            Intent(Intent.ACTION_SEND).apply {
              type = "video/mp4"
              putExtra(Intent.EXTRA_STREAM, uri)
              addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            },
            "Share edited video",
          ),
        )
      },
    )
  }
}

@Composable
private fun EditorTopBar(
  title: String,
  subtitle: String,
  canUndo: Boolean,
  canRedo: Boolean,
  close: () -> Unit,
  undo: () -> Unit,
  redo: () -> Unit,
  export: () -> Unit,
) {
  Row(
    Modifier.fillMaxWidth().background(VFBackground).statusBarsPadding().height(56.dp).padding(horizontal = 8.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    IconButton(onClick = close) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Close editor") }
    Column(Modifier.weight(1f)) {
      Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleSmall)
      Text(subtitle, color = Color.White.copy(alpha = 0.4f), style = MaterialTheme.typography.labelSmall)
    }
    IconButton(onClick = undo, enabled = canUndo) { Icon(Icons.AutoMirrored.Filled.Undo, "Undo") }
    IconButton(onClick = redo, enabled = canRedo) { Icon(Icons.AutoMirrored.Filled.Redo, "Redo") }
    Button(onClick = export, modifier = Modifier.height(40.dp)) {
      Icon(Icons.Default.Share, null, Modifier.size(16.dp))
      Spacer(Modifier.width(5.dp))
      Text("Export")
    }
  }
}

@Composable
private fun EditorViewer(player: CompositionPlayer, ratio: Float) {
  Box(
    Modifier.fillMaxWidth().padding(horizontal = 10.dp).heightIn(min = 190.dp, max = 350.dp)
      .aspectRatio(ratio, matchHeightConstraintsFirst = ratio < 0.8f)
      .background(Color.Black, RoundedCornerShape(12.dp))
      .border(1.dp, VFLine, RoundedCornerShape(12.dp)),
  ) {
    AndroidView(
      factory = {
        PlayerView(it).apply {
          this.player = player
          useController = false
          layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
      },
      update = { it.player = player },
      modifier = Modifier.fillMaxSize(),
    )
  }
}

@Composable
private fun Transport(player: Player, currentMs: Long, durationMs: Long) {
  Row(
    Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 18.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Text(formatDuration(currentMs), style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = 0.62f))
    Spacer(Modifier.weight(1f))
    IconButton(onClick = { player.seekTo((currentMs - 5_000).coerceAtLeast(0)) }) {
      Icon(Icons.Default.FastForward, "Back five seconds", Modifier.graphicsLayer(scaleX = -1f))
    }
    Surface(
      modifier = Modifier.size(42.dp).clickable { if (player.isPlaying) player.pause() else player.play() },
      shape = CircleShape,
      color = Color.White.copy(alpha = 0.12f),
    ) {
      Box(contentAlignment = Alignment.Center) {
        Icon(if (player.isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow, "Play or pause")
      }
    }
    IconButton(onClick = { player.seekTo((currentMs + 5_000).coerceAtMost(durationMs)) }) {
      Icon(Icons.Default.FastForward, "Forward five seconds")
    }
    Spacer(Modifier.weight(1f))
    Text(formatDuration(durationMs), style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = 0.62f))
  }
}

@Composable
private fun TouchTimeline(
  project: EditorProject,
  currentTimeMs: Long,
  seek: (Long) -> Unit,
  modifier: Modifier = Modifier,
) {
  var pixelsPerSecond by remember { mutableFloatStateOf(9f) }
  Column(modifier.padding(horizontal = 10.dp)) {
    Row(Modifier.fillMaxWidth().height(30.dp), verticalAlignment = Alignment.CenterVertically) {
      Text("Timeline", style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = 0.65f))
      Spacer(Modifier.weight(1f))
      Marker("0:42", VFPurple) { seek(42_000L.coerceAtMost(project.timelineDurationMs)) }
      Spacer(Modifier.width(9.dp))
      Text(
        "${formatDuration(currentTimeMs)} / ${formatDuration(project.timelineDurationMs)}",
        style = MaterialTheme.typography.labelSmall,
        color = Color.White.copy(alpha = 0.42f),
      )
    }
    BoxWithConstraints(
      Modifier.fillMaxWidth().weight(1f).background(Color(0xFF0D1019), RoundedCornerShape(12.dp))
        .border(1.dp, VFLine, RoundedCornerShape(12.dp))
        .pointerInput(project.timelineDurationMs, pixelsPerSecond) {
          detectTransformGestures { _, pan, zoom, _ ->
            pixelsPerSecond = (pixelsPerSecond * zoom).coerceIn(4f, 48f)
            val deltaMs = (-pan.x / pixelsPerSecond * 1_000).toLong()
            seek((currentTimeMs + deltaMs).coerceIn(0, project.timelineDurationMs))
          }
        },
    ) {
      val viewportWidth = constraints.maxWidth.toFloat()
      val contentWidth = (project.timelineDurationMs / 1_000f * pixelsPerSecond).coerceAtLeast(viewportWidth * 1.35f)
      val effectivePixelsPerMs = contentWidth / project.timelineDurationMs.coerceAtLeast(1)
      val timelineOffset = viewportWidth / 2 - currentTimeMs * effectivePixelsPerMs

      Column(
        Modifier.width(contentWidth.dp / androidx.compose.ui.platform.LocalDensity.current.density)
          .padding(top = 18.dp).graphicsLayer(translationX = timelineOffset),
      ) {
        Row(Modifier.height(62.dp)) {
          project.clips.forEachIndexed { index, clip ->
            val widthPx = (clip.timelineDurationMs * effectivePixelsPerMs).coerceAtLeast(42f)
            TimelineClip(
              clip = clip,
              index = index,
              selected = clip.id == project.selectedClipId,
              modifier = Modifier.width(widthPx.dp / androidx.compose.ui.platform.LocalDensity.current.density),
              select = { project.select(clip.id) },
            )
          }
        }
        if (project.hasTitle) Track("Title · ${project.titleText}", VFAmber, contentWidth * 0.48f)
        if (project.hasCaptions) Track("Captions", Color(0xFF62D1FF), contentWidth * 0.82f)
        if (project.hasAudio) WaveformTrack(contentWidth)
      }

      Column(Modifier.align(Alignment.TopCenter).fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
        Canvas(Modifier.size(10.dp)) {
          drawCircle(Color.White)
        }
        Box(Modifier.width(2.dp).weight(1f).background(Color.White))
      }
    }
  }
}

@Composable
private fun TimelineClip(clip: EditorClip, index: Int, selected: Boolean, modifier: Modifier, select: () -> Unit) {
  Surface(
    modifier = modifier.padding(horizontal = 2.dp).fillMaxSize().clickable(onClick = select),
    color = Color(0xFF29245A),
    shape = RoundedCornerShape(8.dp),
    border = BorderStroke(if (selected) 2.dp else 1.dp, if (selected) VFAmber else VFPurple.copy(alpha = 0.5f)),
  ) {
    Box {
      Canvas(Modifier.fillMaxSize()) {
        val band = size.width / 5
        repeat(5) { i ->
          drawRect(
            color = if ((i + index) % 2 == 0) Color(0xFF5143A6) else Color(0xFF302963),
            topLeft = Offset(i * band, 0f),
            size = androidx.compose.ui.geometry.Size(band, size.height),
          )
        }
      }
      Text(
        clip.label,
        Modifier.align(Alignment.BottomStart).padding(7.dp),
        style = MaterialTheme.typography.labelSmall,
        maxLines = 1,
      )
    }
  }
}

@Composable
private fun Track(label: String, color: Color, widthPx: Float) {
  Box(
    Modifier.width(widthPx.dp / androidx.compose.ui.platform.LocalDensity.current.density).height(27.dp).padding(top = 4.dp)
      .background(color.copy(alpha = 0.25f), RoundedCornerShape(6.dp)).border(1.dp, color.copy(alpha = 0.65f), RoundedCornerShape(6.dp)),
    contentAlignment = Alignment.CenterStart,
  ) {
    Text(label, Modifier.padding(horizontal = 8.dp), style = MaterialTheme.typography.labelSmall, maxLines = 1)
  }
}

@Composable
private fun WaveformTrack(contentWidth: Float) {
  Canvas(Modifier.width(contentWidth.dp / androidx.compose.ui.platform.LocalDensity.current.density).height(31.dp).padding(top = 4.dp)) {
    drawRoundRect(Color(0xFF163A31), cornerRadius = androidx.compose.ui.geometry.CornerRadius(6f))
    var x = 3f
    while (x < size.width) {
      val amplitude = 4f + ((x.toInt() * 17) % 14)
      drawLine(Color(0xFF43D39E), Offset(x, size.height / 2 - amplitude / 2), Offset(x, size.height / 2 + amplitude / 2), 1.5f, StrokeCap.Round)
      x += 4f
    }
  }
}

@Composable
private fun Marker(label: String, color: Color, click: () -> Unit) {
  Row(Modifier.clickable(onClick = click), verticalAlignment = Alignment.CenterVertically) {
    Box(Modifier.size(6.dp).background(color, CircleShape))
    Spacer(Modifier.width(4.dp))
    Text(label, style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.48f))
  }
}

@Composable
private fun ContextPanel(project: EditorProject, tool: EditorTool, action: ClipAction) {
  val selected = project.selectedClip
  when (tool) {
    EditorTool.Edit -> when (action) {
      ClipAction.Speed -> ValuePanel("Speed", selected?.speed ?: 1f, 0.25f..3f, { "%.2fx".format(it) }, project::setSpeed)
      ClipAction.Volume -> ValuePanel("Clip volume", selected?.volume ?: 1f, 0f..1f, { "${(it * 100).toInt()}%" }, project::setVolume)
      ClipAction.Trim -> TrimPanel(project)
      else -> Spacer(Modifier.height(0.dp))
    }
    EditorTool.Audio -> TogglePanel("Include clip audio", project.hasAudio, project::toggleAudio)
    EditorTool.Text -> TextPanel("Title", project.hasTitle, project.titleText, project::toggleTitle, project::updateTitle)
    EditorTool.Captions -> TextPanel("Caption", project.hasCaptions, project.captionText, project::toggleCaptions, project::updateCaption)
    EditorTool.Canvas -> CanvasPanel(project)
  }
}

@Composable
private fun TrimPanel(project: EditorProject) {
  val clip = project.selectedClip ?: return
  Row(
    Modifier.fillMaxWidth().height(78.dp).padding(horizontal = 14.dp, vertical = 8.dp)
      .background(VFSurface, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    TextButton(onClick = { project.setTrimStart(clip.sourceStartMs + 250) }) { Text("Trim start +0.25s") }
    Spacer(Modifier.weight(1f))
    TextButton(onClick = { project.setTrimEnd(clip.sourceEndMs - 250) }) { Text("Trim end −0.25s") }
  }
}

@Composable
private fun ValuePanel(title: String, value: Float, range: ClosedFloatingPointRange<Float>, format: (Float) -> String, change: (Float) -> Unit) {
  Column(
    Modifier.fillMaxWidth().height(84.dp).padding(horizontal = 14.dp, vertical = 6.dp)
      .background(VFSurface, RoundedCornerShape(12.dp)).padding(horizontal = 14.dp, vertical = 8.dp),
  ) {
    Row { Text(title, style = MaterialTheme.typography.labelMedium); Spacer(Modifier.weight(1f)); Text(format(value), color = VFAmber) }
    Slider(value = value, onValueChange = change, valueRange = range)
  }
}

@Composable
private fun TogglePanel(title: String, checked: Boolean, toggle: () -> Unit) {
  Row(
    Modifier.fillMaxWidth().height(72.dp).padding(12.dp).background(VFSurface, RoundedCornerShape(12.dp)).padding(horizontal = 14.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Text(title, Modifier.weight(1f))
    Switch(checked = checked, onCheckedChange = { toggle() })
  }
}

@Composable
private fun TextPanel(title: String, enabled: Boolean, value: String, toggle: () -> Unit, update: (String) -> Unit) {
  Row(
    Modifier.fillMaxWidth().height(92.dp).padding(horizontal = 12.dp, vertical = 6.dp).background(VFSurface, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Switch(checked = enabled, onCheckedChange = { toggle() })
    Spacer(Modifier.width(10.dp))
    OutlinedTextField(value = value, onValueChange = update, enabled = enabled, label = { Text(title) }, singleLine = true, modifier = Modifier.weight(1f))
  }
}

@Composable
private fun CanvasPanel(project: EditorProject) {
  Row(
    Modifier.fillMaxWidth().height(76.dp).horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp),
    horizontalArrangement = Arrangement.spacedBy(8.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    CanvasRatio.entries.forEach { ratio ->
      FilterChip(selected = project.canvas == ratio, onClick = { project.chooseCanvas(ratio) }, label = { Text(ratio.label) })
    }
  }
}

@Composable
private fun EditorToolShelf(
  selectedTool: EditorTool,
  selectedAction: ClipAction,
  selectTool: (EditorTool) -> Unit,
  selectAction: (ClipAction) -> Unit,
) {
  Column(Modifier.fillMaxWidth().background(VFSurface).navigationBarsPadding()) {
    if (selectedTool == EditorTool.Edit) {
      Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).height(52.dp).padding(horizontal = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        ClipAction.entries.forEach { action ->
          ToolButton(action.label, iconFor(action), action == selectedAction) { selectAction(action) }
        }
      }
    }
    Row(Modifier.fillMaxWidth().height(58.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
      EditorTool.entries.forEach { tool ->
        ToolButton(tool.label, iconFor(tool), tool == selectedTool) { selectTool(tool) }
      }
    }
  }
}

@Composable
private fun ToolButton(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, selected: Boolean, click: () -> Unit) {
  Column(
    Modifier.width(72.dp).fillMaxSize().clickable(onClick = click),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.Center,
  ) {
    Icon(icon, null, Modifier.size(19.dp), tint = if (selected) VFPurple else Color.White.copy(alpha = 0.66f))
    Text(label, style = MaterialTheme.typography.labelSmall, color = if (selected) Color.White else Color.White.copy(alpha = 0.5f))
  }
}

private fun iconFor(action: ClipAction) = when (action) {
  ClipAction.Split -> Icons.Rounded.ContentCut
  ClipAction.Trim -> Icons.Rounded.ContentCut
  ClipAction.Speed -> Icons.Default.Speed
  ClipAction.Volume -> Icons.AutoMirrored.Filled.VolumeUp
  ClipAction.Duplicate -> Icons.Default.ContentCopy
  ClipAction.Delete -> Icons.Default.Delete
}

private fun iconFor(tool: EditorTool) = when (tool) {
  EditorTool.Edit -> Icons.Rounded.ContentCut
  EditorTool.Audio -> Icons.Default.Audiotrack
  EditorTool.Text -> Icons.Default.TextFields
  EditorTool.Captions -> Icons.Default.Subtitles
  EditorTool.Canvas -> Icons.Default.AspectRatio
}

@Composable
private fun ExportDialog(
  durationMs: Long,
  canvas: String,
  exportFile: File?,
  error: String?,
  isExporting: Boolean,
  dismiss: () -> Unit,
  render: () -> Unit,
  share: (File) -> Unit,
) {
  AlertDialog(
    onDismissRequest = dismiss,
    title = { Text("Export edited video") },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
          Text(canvas, color = Color.White.copy(alpha = 0.58f))
          Text(formatDuration(durationMs), color = Color.White.copy(alpha = 0.58f))
          Text("H.264", color = Color.White.copy(alpha = 0.58f))
        }
        when {
          isExporting -> Row(verticalAlignment = Alignment.CenterVertically) {
            CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
            Spacer(Modifier.width(10.dp))
            Text("Rendering the current composition…")
          }
          exportFile != null -> Text("Your edited MP4 is ready to save or share.", color = Color(0xFF58D79B))
          error != null -> Text(error, color = MaterialTheme.colorScheme.error)
          else -> Text("Cuts, timing, audio, canvas, title, and captions are rendered into the file.")
        }
      }
    },
    confirmButton = {
      if (exportFile != null) {
        Button(onClick = { share(exportFile) }) { Text("Share edited video") }
      } else {
        Button(onClick = render, enabled = !isExporting) { Text("Render video") }
      }
    },
    dismissButton = { OutlinedButton(onClick = dismiss, enabled = !isExporting) { Text("Done") } },
  )
}

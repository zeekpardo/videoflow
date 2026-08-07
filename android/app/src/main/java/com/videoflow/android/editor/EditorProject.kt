package com.videoflow.android.editor

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.util.UUID
import kotlinx.serialization.Serializable
import kotlin.math.max
import kotlin.math.min

enum class CanvasRatio(val label: String, val ratio: Float) {
  Original("Original", 16 / 9f),
  Landscape("16:9", 16 / 9f),
  Square("1:1", 1f),
  Portrait("4:5", 4 / 5f),
  Vertical("9:16", 9 / 16f),
}

enum class EditorTool(val label: String) { Edit("Edit"), Audio("Audio"), Text("Text"), Captions("Captions"), Canvas("Canvas") }
enum class ClipAction(val label: String) { Split("Split"), Trim("Trim"), Speed("Speed"), Volume("Volume"), Duplicate("Duplicate"), Delete("Delete") }

@Serializable
data class EditorClip(
  val id: String = UUID.randomUUID().toString(),
  val sourceStartMs: Long,
  val sourceEndMs: Long,
  val speed: Float = 1f,
  val volume: Float = 1f,
  val label: String,
) {
  val sourceDurationMs: Long get() = max(1, sourceEndMs - sourceStartMs)
  val timelineDurationMs: Long get() = (sourceDurationMs / speed.coerceAtLeast(0.25f)).toLong()
}

@Serializable
data class EditorProjectDraft(
  val version: Int = 1,
  val sourceDurationMs: Long,
  val clips: List<EditorClip>,
  val selectedClipId: String?,
  val hasAudio: Boolean,
  val hasTitle: Boolean,
  val hasCaptions: Boolean,
  val titleText: String,
  val captionText: String,
  val canvas: String,
)

private data class ProjectSnapshot(
  val clips: List<EditorClip>,
  val selectedClipId: String?,
  val hasAudio: Boolean,
  val hasTitle: Boolean,
  val hasCaptions: Boolean,
  val titleText: String,
  val captionText: String,
  val canvas: CanvasRatio,
)

@Stable
class EditorProject(durationMs: Long, draft: EditorProjectDraft? = null) {
  val sourceDurationMs = durationMs.coerceAtLeast(250)
  val clips = mutableStateListOf(
    EditorClip(sourceStartMs = 0, sourceEndMs = sourceDurationMs, label = "Main clip"),
  )
  var selectedClipId: String? by mutableStateOf(clips.first().id)
    private set
  var hasAudio by mutableStateOf(true)
    private set
  var hasTitle by mutableStateOf(false)
    private set
  var hasCaptions by mutableStateOf(false)
    private set
  var titleText by mutableStateOf("VideoFlow")
    private set
  var captionText by mutableStateOf("Meet the faster review flow for teams.")
    private set
  var canvas by mutableStateOf(CanvasRatio.Original)
    private set
  var revision by mutableIntStateOf(0)
    private set

  private val undo = ArrayDeque<ProjectSnapshot>()
  private val redo = ArrayDeque<ProjectSnapshot>()

  init {
    if (
      draft != null && draft.version == 1 &&
      kotlin.math.abs(draft.sourceDurationMs - sourceDurationMs) < 1_000 &&
      draft.clips.isNotEmpty() &&
      draft.clips.all { it.sourceStartMs >= 0 && it.sourceEndMs <= sourceDurationMs && it.sourceDurationMs >= 250 }
    ) {
      clips.clear()
      clips.addAll(draft.clips)
      selectedClipId = draft.selectedClipId.takeIf { id -> clips.any { it.id == id } } ?: clips.first().id
      hasAudio = draft.hasAudio
      hasTitle = draft.hasTitle
      hasCaptions = draft.hasCaptions
      titleText = draft.titleText.take(80)
      captionText = draft.captionText.take(140)
      canvas = CanvasRatio.entries.firstOrNull { it.name == draft.canvas } ?: CanvasRatio.Original
    }
  }

  val selectedClip: EditorClip? get() = clips.firstOrNull { it.id == selectedClipId }
  val timelineDurationMs: Long get() = clips.sumOf { it.timelineDurationMs }
  val canUndo: Boolean get() = undo.isNotEmpty()
  val canRedo: Boolean get() = redo.isNotEmpty()

  fun draft() = EditorProjectDraft(
    sourceDurationMs = sourceDurationMs,
    clips = clips.toList(),
    selectedClipId = selectedClipId,
    hasAudio = hasAudio,
    hasTitle = hasTitle,
    hasCaptions = hasCaptions,
    titleText = titleText,
    captionText = captionText,
    canvas = canvas.name,
  )

  fun timelineStartMs(clipId: String): Long {
    var cursor = 0L
    clips.forEach { clip ->
      if (clip.id == clipId) return cursor
      cursor += clip.timelineDurationMs
    }
    return cursor
  }

  fun select(id: String) { selectedClipId = id }

  fun selectAt(timelineMs: Long) {
    selectedClipId = clips.firstOrNull { clip ->
      val start = timelineStartMs(clip.id)
      timelineMs in start until (start + clip.timelineDurationMs)
    }?.id ?: clips.lastOrNull()?.id
  }

  fun split(timelineMs: Long) {
    val index = clips.indexOfFirst { it.id == selectedClipId }
    if (index < 0) return
    val clip = clips[index]
    val localTimelineMs = timelineMs - timelineStartMs(clip.id)
    val sourceSplitMs = clip.sourceStartMs + (localTimelineMs * clip.speed).toLong()
    if (sourceSplitMs <= clip.sourceStartMs + 250 || sourceSplitMs >= clip.sourceEndMs - 250) return
    checkpoint()
    val left = clip.copy(sourceEndMs = sourceSplitMs)
    val right = clip.copy(
      id = UUID.randomUUID().toString(),
      sourceStartMs = sourceSplitMs,
      label = "${clip.label} ${clips.size + 1}",
    )
    clips.removeAt(index)
    clips.add(index, left)
    clips.add(index + 1, right)
    selectedClipId = right.id
    changed()
  }

  fun duplicateSelected() {
    val index = clips.indexOfFirst { it.id == selectedClipId }
    if (index < 0) return
    checkpoint()
    val copy = clips[index].copy(id = UUID.randomUUID().toString(), label = "${clips[index].label} copy")
    clips.add(index + 1, copy)
    selectedClipId = copy.id
    changed()
  }

  fun deleteSelected() {
    if (clips.size <= 1) return
    val index = clips.indexOfFirst { it.id == selectedClipId }
    if (index < 0) return
    checkpoint()
    clips.removeAt(index)
    selectedClipId = clips[min(index, clips.lastIndex)].id
    changed()
  }

  fun setSpeed(value: Float) = replaceSelected { it.copy(speed = value.coerceIn(0.25f, 3f)) }
  fun setVolume(value: Float) = replaceSelected { it.copy(volume = value.coerceIn(0f, 1f)) }

  fun setTrimStart(sourceMs: Long) = replaceSelected {
    it.copy(sourceStartMs = sourceMs.coerceIn(0, it.sourceEndMs - 250))
  }

  fun setTrimEnd(sourceMs: Long) = replaceSelected {
    it.copy(sourceEndMs = sourceMs.coerceIn(it.sourceStartMs + 250, sourceDurationMs))
  }

  fun toggleAudio() = mutate { hasAudio = !hasAudio }
  fun toggleTitle() = mutate { hasTitle = !hasTitle }
  fun toggleCaptions() = mutate { hasCaptions = !hasCaptions }
  fun updateTitle(value: String) = mutate { titleText = value.take(80) }
  fun updateCaption(value: String) = mutate { captionText = value.take(140) }
  fun chooseCanvas(value: CanvasRatio) = mutate { canvas = value }

  fun undo() {
    val snapshot = undo.removeLastOrNull() ?: return
    redo.addLast(snapshot())
    restore(snapshot)
  }

  fun redo() {
    val snapshot = redo.removeLastOrNull() ?: return
    undo.addLast(snapshot())
    restore(snapshot)
  }

  private fun replaceSelected(transform: (EditorClip) -> EditorClip) {
    val index = clips.indexOfFirst { it.id == selectedClipId }
    if (index < 0) return
    checkpoint()
    clips[index] = transform(clips[index])
    changed()
  }

  private fun mutate(block: () -> Unit) {
    checkpoint()
    block()
    changed()
  }

  private fun checkpoint() {
    undo.addLast(snapshot())
    if (undo.size > 50) undo.removeFirst()
    redo.clear()
  }

  private fun snapshot() = ProjectSnapshot(
    clips.toList(), selectedClipId, hasAudio, hasTitle, hasCaptions, titleText, captionText, canvas,
  )

  private fun restore(snapshot: ProjectSnapshot) {
    clips.clear()
    clips.addAll(snapshot.clips)
    selectedClipId = snapshot.selectedClipId
    hasAudio = snapshot.hasAudio
    hasTitle = snapshot.hasTitle
    hasCaptions = snapshot.hasCaptions
    titleText = snapshot.titleText
    captionText = snapshot.captionText
    canvas = snapshot.canvas
    changed()
  }

  private fun changed() { revision += 1 }
}

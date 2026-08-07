package com.videoflow.android.editor

import android.content.Context
import android.graphics.Color
import android.text.SpannableString
import android.text.Spanned
import android.text.style.AbsoluteSizeSpan
import android.text.style.ForegroundColorSpan
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.audio.GainProcessor
import androidx.media3.common.audio.SpeedProvider
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.Presentation
import androidx.media3.effect.StaticOverlaySettings
import androidx.media3.effect.TextOverlay
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import java.io.File

@OptIn(UnstableApi::class)
fun buildComposition(project: EditorProject, sourceUrl: String): Composition {
  val items = project.clips.map { clip ->
    val mediaItem = MediaItem.Builder()
      .setUri(sourceUrl)
      .setClippingConfiguration(
        MediaItem.ClippingConfiguration.Builder()
          .setStartPositionMs(clip.sourceStartMs)
          .setEndPositionMs(clip.sourceEndMs)
          .build(),
      )
      .build()

    val videoEffects = mutableListOf<Effect>()
    videoEffects += Presentation.createForAspectRatio(
      project.canvas.ratio,
      Presentation.LAYOUT_SCALE_TO_FIT,
    )
    val overlays = buildTextOverlays(project)
    if (overlays.isNotEmpty()) videoEffects += OverlayEffect(overlays)

    val audioEffects = if (clip.volume < 0.999f) {
      listOf(GainProcessor(ConstantGainProvider(clip.volume)))
    } else {
      emptyList()
    }

    EditedMediaItem.Builder(mediaItem)
      .setDurationUs(project.sourceDurationMs * 1_000)
      .setRemoveAudio(!project.hasAudio)
      .setSpeed(ConstantSpeedProvider(clip.speed))
      .setEffects(Effects(audioEffects, videoEffects))
      .build()
  }

  val sequence = EditedMediaItemSequence.withAudioAndVideoFrom(items)
  return Composition.Builder(sequence).build()
}

@OptIn(UnstableApi::class)
private fun buildTextOverlays(project: EditorProject): List<TextOverlay> {
  val overlays = mutableListOf<TextOverlay>()
  if (project.hasTitle && project.titleText.isNotBlank()) {
    val text = styledText(project.titleText, 34)
    val settings = StaticOverlaySettings.Builder()
      .setBackgroundFrameAnchor(-0.82f, 0.78f)
      .setOverlayFrameAnchor(-1f, 1f)
      .setScale(0.72f, 0.72f)
      .build()
    overlays += TextOverlay.createStaticTextOverlay(text, settings)
  }
  if (project.hasCaptions && project.captionText.isNotBlank()) {
    val text = styledText(project.captionText, 24)
    val settings = StaticOverlaySettings.Builder()
      .setBackgroundFrameAnchor(0f, -0.76f)
      .setOverlayFrameAnchor(0f, -1f)
      .setScale(0.62f, 0.62f)
      .build()
    overlays += TextOverlay.createStaticTextOverlay(text, settings)
  }
  return overlays
}

private fun styledText(value: String, pixels: Int) = SpannableString(value).apply {
  setSpan(ForegroundColorSpan(Color.WHITE), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
  setSpan(AbsoluteSizeSpan(pixels), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
}

@OptIn(UnstableApi::class)
private class ConstantSpeedProvider(private val speed: Float) : SpeedProvider {
  override fun getSpeed(timeUs: Long): Float = speed
  override fun getNextSpeedChangeTimeUs(timeUs: Long): Long = C.TIME_UNSET
}

@OptIn(UnstableApi::class)
private class ConstantGainProvider(private val gain: Float) : GainProcessor.GainProvider {
  override fun getGainFactorAtSamplePosition(samplePosition: Long, sampleRate: Int): Float = gain
  override fun isUnityUntil(samplePosition: Long, sampleRate: Int): Long =
    if (gain >= 0.999f) C.TIME_END_OF_SOURCE else C.TIME_UNSET
}

@OptIn(UnstableApi::class)
fun exportComposition(
  context: Context,
  composition: Composition,
  title: String,
  completed: (File) -> Unit,
  failed: (Throwable) -> Unit,
): Transformer {
  val exportDirectory = File(context.cacheDir, "exports").apply { mkdirs() }
  val safeTitle = title.replace(Regex("[^A-Za-z0-9]+"), "-").trim('-').take(48).ifBlank { "VideoFlow" }
  val output = File(exportDirectory, "$safeTitle-${System.currentTimeMillis()}.mp4")

  val transformer = Transformer.Builder(context)
    .setVideoMimeType(MimeTypes.VIDEO_H264)
    .setAudioMimeType(MimeTypes.AUDIO_AAC)
    .addListener(object : Transformer.Listener {
      override fun onCompleted(composition: Composition, result: ExportResult) = completed(output)

      override fun onError(
        composition: Composition,
        result: ExportResult,
        exception: ExportException,
      ) = failed(exception)
    })
    .build()
  transformer.start(composition, output.absolutePath)
  return transformer
}

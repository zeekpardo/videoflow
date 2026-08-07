package com.videoflow.android.editor

import android.content.Context
import java.io.File
import java.security.MessageDigest
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
private data class StoredEditorDraft(
  val videoId: String,
  val savedAt: Long,
  val project: EditorProjectDraft,
)

class EditorDraftStore(context: Context) {
  private val directory = File(context.filesDir, "editor-drafts").apply { mkdirs() }
  private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

  fun load(videoId: String): EditorProjectDraft? = runCatching {
    val stored = json.decodeFromString<StoredEditorDraft>(file(videoId).readText())
    stored.project.takeIf { stored.videoId == videoId }
  }.getOrNull()

  fun save(videoId: String, project: EditorProjectDraft) {
    val target = file(videoId)
    val temporary = File(directory, "${target.name}.tmp")
    temporary.writeText(json.encodeToString(StoredEditorDraft(videoId, System.currentTimeMillis(), project)))
    if (!temporary.renameTo(target)) {
      temporary.copyTo(target, overwrite = true)
      temporary.delete()
    }
  }

  fun remove(videoId: String) {
    file(videoId).delete()
  }

  private fun file(videoId: String): File {
    val digest = MessageDigest.getInstance("SHA-256").digest(videoId.toByteArray())
      .joinToString("") { "%02x".format(it) }
    return File(directory, "$digest.json")
  }
}

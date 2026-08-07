package com.videoflow.android.editor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EditorProjectTest {
  @Test
  fun splitDuplicateDeleteAndUndoKeepAnOrderedTimeline() {
    val project = EditorProject(10_000)
    project.split(4_000)
    assertEquals(listOf(4_000L, 6_000L), project.clips.map { it.timelineDurationMs })

    project.duplicateSelected()
    assertEquals(16_000L, project.timelineDurationMs)
    assertEquals(3, project.clips.size)

    project.deleteSelected()
    assertEquals(2, project.clips.size)
    project.undo()
    assertEquals(3, project.clips.size)
    assertTrue(project.canRedo)
  }

  @Test
  fun speedChangesTimelineDurationWithoutChangingSourceRange() {
    val project = EditorProject(10_000)
    project.setSpeed(2f)
    assertEquals(5_000L, project.timelineDurationMs)
    assertEquals(10_000L, project.selectedClip?.sourceDurationMs)
  }
}

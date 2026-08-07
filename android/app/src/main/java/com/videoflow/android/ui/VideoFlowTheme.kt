package com.videoflow.android.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val VFPurple = Color(0xFF6D5CFF)
val VFAmber = Color(0xFFFFB94A)
val VFBackground = Color(0xFF090B12)
val VFSurface = Color(0xFF10131E)
val VFLine = Color(0xFF242838)
val VFGreen = Color(0xFF3BCB8A)

private val VideoFlowColors = darkColorScheme(
  primary = VFPurple,
  secondary = VFAmber,
  background = VFBackground,
  surface = VFSurface,
  surfaceVariant = Color(0xFF171B29),
  onPrimary = Color.White,
  onBackground = Color(0xFFF5F5F8),
  onSurface = Color(0xFFF5F5F8),
  outline = VFLine,
)

@Composable
fun VideoFlowTheme(content: @Composable () -> Unit) {
  MaterialTheme(colorScheme = VideoFlowColors, content = content)
}

package com.videoflow.android.model

data class VideoSummary(
  val id: String,
  val title: String,
  val durationMs: Long,
  val mode: String,
  val views: Int,
  val status: String,
  val age: String,
)

data class ReviewSummary(
  val id: String,
  val videoId: String,
  val videoTitle: String,
  val reviewer: String,
  val status: String,
  val note: String,
  val due: String,
)

object PreviewData {
  const val sourceUrl = "https://media.w3.org/2010/05/sintel/trailer.mp4"

  val videos = listOf(
    VideoSummary(
      "sample-launch",
      "Summer launch — final creative walkthrough",
      52_208,
      "Screen",
      48,
      "Needs review",
      "Today",
    ),
    VideoSummary(
      "sample-mobile",
      "Mobile onboarding notes",
      52_208,
      "Camera",
      17,
      "Changes requested",
      "Yesterday",
    ),
    VideoSummary(
      "sample-campaign",
      "Q3 campaign cut v4",
      52_208,
      "Screen",
      31,
      "Approved",
      "Jul 25",
    ),
    VideoSummary(
      "sample-standup",
      "Design standup — Tuesday",
      52_208,
      "Camera",
      9,
      "Processing",
      "Jul 24",
    ),
  )

  val reviews = listOf(
    ReviewSummary(
      "review-pending",
      "sample-launch",
      videos[0].title,
      "Maya Chen",
      "Waiting",
      "Please check the new ending.",
      "Tomorrow",
    ),
    ReviewSummary(
      "review-changes",
      "sample-mobile",
      videos[1].title,
      "Leah Park",
      "Changes requested",
      "Slow down the permissions section and add one example.",
      "Friday",
    ),
    ReviewSummary(
      "review-approved",
      "sample-campaign",
      videos[2].title,
      "Owen Brooks",
      "Approved",
      "The pacing feels great now.",
      "Complete",
    ),
  )
}

fun formatDuration(milliseconds: Long): String {
  val totalSeconds = (milliseconds / 1_000).coerceAtLeast(0)
  return "%d:%02d".format(totalSeconds / 60, totalSeconds % 60)
}

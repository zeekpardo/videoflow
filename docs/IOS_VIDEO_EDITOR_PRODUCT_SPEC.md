# VideoFlow iOS Editor Product Spec

Status: functional editing core for v2.5
Scope: native iPhone editor opened from a VideoFlow video detail screen

## Product position

VideoFlow should not become a general-purpose CapCut clone. Its editor should make a
reviewed video publishable without forcing the creator to leave the product.

The interaction model combines:

- iMovie's direct, spatial editing model: select the media, manipulate it in place,
  keep the playhead meaningful, and reveal only controls that apply to the selection.
- CapCut's creator workflow: visible track layers, a two-level tool hierarchy, fast
  access to captions/text/audio/overlays, social canvas presets, and a persistent
  route to export.
- VideoFlow's own strengths: review comments, approval moments, task markers, brand
  styling, and optional social publishing.

The result should feel like a focused mobile editing room, not a dashboard squeezed
onto a phone and not an AI-generated collection of cards.

## Research synthesis

### What iMovie gets right

1. **The timeline is the object being edited.** Clips are selected directly and gain
   a strong yellow outline and trim handles.
2. **The playhead is stable.** The user moves the timeline beneath a fixed playhead,
   preserving a reliable relationship between the viewer and the edit point.
3. **Gestures have editing meaning.** Pinch changes timeline precision; long-press
   lifts a clip for reordering; a downward slice across the playhead splits a clip.
4. **The inspector follows selection.** Actions, speed, volume, titles, and filters
   appear for the chosen clip rather than living in a permanent settings form.
5. **Transitions are objects.** The cut between clips is tappable and editable.
6. **Tracks communicate media type.** Video, recorded audio, music, and overlays use
   distinct track placement and color.

### What CapCut gets right

1. **The first tool rail is task-oriented.** Edit, Audio, Text, Overlay, Captions,
   Effects, and Canvas match creator intent.
2. **A second tool rail provides depth.** Selecting Edit reveals Split, Speed,
   Animation, Style, Volume, Delete, and other clip-specific commands.
3. **The timeline is multi-track without feeling desktop-heavy.** Main video,
   overlays, captions, and waveforms remain understandable on a narrow display.
4. **Split is immediate.** The user parks the playhead and invokes Split without
   entering a separate trim form.
5. **Creator outputs are first-class.** Canvas ratio, captions, text, music, cover,
   resolution, and export are not buried in project settings.
6. **Preview and export stay visible.** Playback belongs near the viewer; export is a
   stable top-level destination.
7. **Advanced features remain progressively disclosed.** Keyframes, speed curves,
   chroma key, motion tracking, and background removal appear after the relevant
   media or tool is selected.

### What VideoFlow should avoid

- A row of unrelated glass cards competing with the media.
- Sliders for values that are more naturally manipulated on the timeline.
- A moving playhead over a fixed, compressed filmstrip.
- Showing every advanced feature before the user selects a clip or track.
- Pretending an edit has been rendered, saved, captioned, or published when only
  local preview state exists.
- Making automated tools the visual center of the editor.

## Editor anatomy

From top to bottom:

1. **Project bar**
   - Close
   - Truncated project title and draft state
   - Undo / redo
   - Export
2. **Viewer**
   - Black stage with the selected canvas centered inside it
   - Direct manipulation controls appear only for text or overlay selections
3. **Transport**
   - Current time / total time
   - Previous edit, play/pause, next edit
4. **Timeline viewport**
   - Fixed white playhead
   - Time ruler
   - Main video track with frame thumbnails and clip boundaries
   - Tappable transition objects between clips
   - Optional title, caption, overlay, and audio tracks
   - Add-track affordance
5. **Context inspector**
   - Appears only when the current tool has editable parameters
   - Direct actions and trim gestures must not reserve a permanent inspector
6. **Secondary tool rail**
   - Appears for a selected primary category
7. **Primary creator rail**
   - Edit, Audio, Text, Overlay, Captions, Canvas

The viewer should receive more vertical space when the timeline has fewer tracks and
the timeline should expand when layered media is present.

### Typography and hierarchy

Authenticated workspace screens should use a quiet, native hierarchy rather than
landing-page typography. Use sentence case, semibold only for the primary screen
title, medium weight for local section labels, and regular secondary text. Avoid
stacking an eyebrow, large title, and explanatory subtitle when two levels are
enough. Status copy should be concise and visually secondary to the media and edit.

### Aspect-aware vertical space model

The phone interface is vertical, but the source video may be 16:9, 1:1, 4:5, or
9:16. Original mode must read the source track's transformed dimensions and size the
viewer from that real aspect ratio. A portrait source receives a taller viewer. A
landscape source receives a shorter viewer and gives the recovered height to a more
capable timeline workspace with visible track lanes and add-layer actions; it must
not leave a decorative void or replace the space with a large settings controller.
Transport floats over the lower edge of the stage. Review markers live in the
timeline header, and primary creator tools and clip actions share one progressive
bottom shelf. Added tracks consume the timeline workspace before reducing the
viewer.

Trimming is direct manipulation: select a clip, drag its highlighted leading or
trailing edge, and pinch the timeline open or closed to change temporal precision.
Do not duplicate this interaction with persistent in/out sliders.

## Selection model

Only one editing object is primary at a time:

- video clip
- transition
- audio clip
- title
- caption segment
- overlay
- canvas

The selected object receives:

- a high-contrast outline
- trim handles when duration is editable
- a context-specific inspector
- a context-specific secondary tool rail

Purple remains the VideoFlow accent. Selection uses warm amber for timeline trim
focus so the editing state reads clearly against purple branded media.

## Gesture model

| Gesture | Timeline result |
| --- | --- |
| Horizontal drag | Scrub the timeline beneath the fixed playhead |
| Tap clip | Select clip and expose clip actions |
| Drag clip edge | Trim source in/out |
| Pinch timeline | Change pixels-per-second without changing playhead time |
| Long-press then drag | Reorder a clip |
| Swipe down across playhead | Split selected clip |
| Tap transition | Select the cut and open transition choices |
| Double tap clip | Fit the selected clip in the timeline viewport |
| Tap empty track area | Clear selection and return to creator tools |

Haptics should fire at clip boundaries, the start/end of available media, transition
centers, and review markers.

### Mobile editor research rules

VideoFlow follows the interaction patterns that remain consistent across current
mobile editors:

- [iMovie on iPhone](https://support.apple.com/en-ca/guide/imovie-iphone/knaeca4b0ea2/ios)
  uses a fixed playhead, direct timeline scrubbing, and pinch-to-zoom for precision.
- [iMovie transitions](https://support.apple.com/en-mo/guide/imovie-iphone/kna737b471f/ios)
  are edited by tapping the transition object between clips and choosing from a
  compact contextual set.
- [CapCut mobile overlays](https://www.capcut.com/resource/free-video-overlay-effects)
  remain visible as separate timeline layers and are trimmed by dragging their
  edges.
- [Premiere on iPhone](https://helpx.adobe.com/premiere/mobile/manage-clips/rearrange-clips.html)
  uses long-press and drag for clip reordering, while clip commands such as Split
  appear in the bottom toolbar.
- [Canva video editing](https://www.canva.com/learn/easily-edit-video-fast/)
  keeps trim, split, and reorder attached to the visible timeline rather than a
  form-style settings flow.

The product implication is progressive disclosure: the canvas and timeline stay
present, direct commands execute on the first tap, and parameter inspectors appear
only for controls such as speed, volume, canvas, or layer styling. While scrubbing,
show a precise floating timecode. Snap the fixed playhead to clip boundaries and
review markers with subtle haptic feedback. A Fit control may reset timeline zoom,
but persistent zoom or in/out sliders are not allowed.

## Tool hierarchy

### Edit

Immediate actions:

- Split
- Trim
- Speed
- Volume
- Replace
- Duplicate
- Freeze
- Delete

Later depth:

- Speed curves
- Stabilization
- Transform
- Crop
- Opacity
- Blend
- Keyframes

### Audio

- Clip audio mute and level
- Extracted audio
- Music
- Sound effects
- Voiceover
- Fade in/out
- Ducking
- Beat markers
- Noise cleanup

### Text

- Add title
- Add lower third
- Brand presets
- Font, weight, alignment, color, background
- In/out animation
- Duration and position

### Captions

- Generate from speech
- Import transcript
- Edit by segment
- Brand style
- Highlight active words
- Safe-area positioning
- Burn-in or sidecar export

Automatic captioning remains optional. A missing transcription provider must not
break manual editing, playback, or export.

### Overlay

- Photo/video
- Logo
- Screen recording callout
- Picture in picture
- Split screen
- Green/blue screen
- Mask, crop, transform, opacity

### Canvas

- Original
- 16:9
- 1:1
- 4:5
- 9:16
- Background blur / color
- Safe-area guides for Reels, Shorts, and TikTok

## VideoFlow-native layers

These should differentiate the editor after the core timeline is trustworthy:

- **Review markers:** comments appear as pins on the ruler and open in context.
- **Approval range:** approved portions are visibly marked.
- **Task markers:** a comment can become an editing task at its timecode.
- **Brand kit:** workspace fonts, colors, outro, logo, and caption style.
- **Publish checks:** ratio, duration, caption-safe area, loudness, and destination
  readiness before the export sheet.
- **Optional publishing:** Zernio remains an optional social destination and is
  never required for editing or export.

## Draft and rendering architecture

The editor should maintain a non-destructive project document:

- ordered source clips with source in/out points
- timeline ranges
- transforms and opacity
- clip speed and audio gain
- transition objects
- text/caption/overlay tracks
- canvas and export settings
- undoable mutations

Playback now uses `AVMutableComposition`, `AVMutableVideoComposition`, and
`AVMutableAudioMix` for ordered clips, source ranges, speed, gain, canvas sizing,
titles, captions, and transitions. Remote source media is staged into a local edit
file before composition. Final export produces a real shareable MP4 through a
separate render operation. The app must distinguish:

- local draft changed
- local draft saved
- render in progress
- export complete
- publish queued
- publish complete / failed

## Delivery phases

### Phase 1 — interaction foundation

- [x] fixed-playhead timeline
- [x] clip selection
- [x] split, delete, trim, speed, and volume
- [x] undo/redo
- [x] visible creator tracks
- [x] canvas presets
- [x] honest preview-draft state

### Phase 2 — durable edit project

- persistent local project document
- multiple imported clips
- reorder and transitions
- [x] transition objects and rendered cut, dissolve, slide, and fade behavior
- [x] per-clip audio gain and text/caption layers
- [x] composition-based preview
- [x] MP4 render and system share sheet
- background render progress, cancellation, and direct Photos save

### Phase 3 — creator workflow

- captions and transcript editing
- brand presets
- overlays and picture in picture
- review/task markers
- publish checks

### Phase 4 — social delivery

- export profiles
- optional Zernio publishing
- upload progress and retry
- per-destination copy, cover, aspect, and scheduling

## Acceptance criteria for the interaction foundation

- The playhead remains visually fixed while horizontal dragging changes time.
- Split creates two independently selectable visual clips at the playhead.
- Delete removes the selected segment and can be undone.
- Undo and redo reflect edit availability.
- Selecting Edit reveals clip actions; selecting a creator tool replaces them with
  its own inspector.
- Caption, title, audio, and overlay tracks appear only when enabled.
- Canvas changes immediately affect the viewer stage.
- Playback, scrubbing, speed, and volume remain functional without OpenAI, Resend,
  Zernio, or any social account.
- The interface never labels a preview-only draft as saved or exported.

## Current implementation boundary

The current native editor performs real non-destructive edits and renders them to
an MP4. Split, trim, duplicate, delete, speed, volume, audio mute, canvas, title,
captions, transitions, undo, and redo all rebuild the playable composition. The
overlay entry is intentionally withheld until media picking and picture-in-picture
composition exist; the UI must not advertise a mock control.

The next functional tranche is imported multi-source media and overlays, durable
project autosave, transcript-timed caption segments, render cancellation/progress,
and direct Photos-library export.

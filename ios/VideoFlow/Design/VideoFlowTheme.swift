import SwiftUI

enum VFTheme {
  static let ink = Color(red: 21 / 255, green: 23 / 255, blue: 43 / 255)
  static let mutedInk = Color(red: 119 / 255, green: 128 / 255, blue: 154 / 255)
  static let purple = Color(red: 109 / 255, green: 91 / 255, blue: 252 / 255)
  static let violet = Color(red: 120 / 255, green: 95 / 255, blue: 255 / 255)
  static let coral = Color(red: 220 / 255, green: 73 / 255, blue: 78 / 255)
  static let mint = Color(red: 16 / 255, green: 185 / 255, blue: 129 / 255)
  static let amber = Color(red: 217 / 255, green: 142 / 255, blue: 35 / 255)
  static let canvas = Color(red: 246 / 255, green: 248 / 255, blue: 252 / 255)
  static let card = Color.white
  static let mutedSurface = Color(red: 241 / 255, green: 243 / 255, blue: 248 / 255)
  static let accent = Color(red: 242 / 255, green: 240 / 255, blue: 255 / 255)
  static let border = Color(red: 226 / 255, green: 230 / 255, blue: 239 / 255)
  static let recordingSurface = Color(red: 238 / 255, green: 242 / 255, blue: 250 / 255)
  static let heroGradient = LinearGradient(
    colors: [Color(red: 17 / 255, green: 21 / 255, blue: 41 / 255), purple, Color(red: 166 / 255, green: 155 / 255, blue: 255 / 255)],
    startPoint: .topLeading,
    endPoint: .bottomTrailing
  )
}

private struct VFLogoWave: Shape {
  func path(in rect: CGRect) -> Path {
    let sx = rect.width / 64
    let sy = rect.height / 64
    func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * sx, y: y * sy) }
    var path = Path()
    path.move(to: point(16, 34.5))
    path.addCurve(to: point(24.6, 24.5), control1: point(19.8, 34.5), control2: point(20.6, 24.5))
    path.addCurve(to: point(33.6, 39.5), control1: point(28.6, 24.5), control2: point(29.3, 39.5))
    path.addCurve(to: point(42.4, 24.5), control1: point(37.6, 39.5), control2: point(38.3, 24.5))
    path.addCurve(to: point(50, 34.5), control1: point(46, 24.5), control2: point(46.9, 34.5))
    return path
  }
}

struct VFBrandMark: View {
  var size: CGFloat = 36

  var body: some View {
    ZStack {
      RoundedRectangle(cornerRadius: size * 0.22, style: .continuous)
        .fill(LinearGradient(colors: [VFTheme.violet, Color(red: 98 / 255, green: 71 / 255, blue: 236 / 255)], startPoint: .topLeading, endPoint: .bottomTrailing))
      VFLogoWave()
        .stroke(.white, style: StrokeStyle(lineWidth: size * 0.078, lineCap: .round, lineJoin: .round))
        .frame(width: size, height: size)
    }
    .frame(width: size, height: size)
    .shadow(color: VFTheme.purple.opacity(0.22), radius: size * 0.22, y: size * 0.1)
    .accessibilityHidden(true)
  }
}

struct VFWordmark: View {
  var compact = false

  var body: some View {
    HStack(spacing: 9) {
      VFBrandMark(size: compact ? 28 : 36)
      HStack(spacing: 0) {
        Text("Video").foregroundStyle(VFTheme.ink)
        Text("Flow").foregroundStyle(VFTheme.purple)
      }
      .font(.system(size: compact ? 17 : 20, weight: .bold))
      .tracking(-0.75)
    }
    .accessibilityElement(children: .combine)
    .accessibilityLabel("VideoFlow")
  }
}

struct VFPageHeader: View {
  let title: String
  let subtitle: String

  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      Text(title)
        .font(.system(size: 27, weight: .semibold))
        .tracking(-0.45)
        .foregroundStyle(VFTheme.ink)
      Text(subtitle)
        .font(.footnote)
        .foregroundStyle(VFTheme.mutedInk)
        .lineSpacing(2)
        .fixedSize(horizontal: false, vertical: true)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct VFSectionHeader: View {
  let title: String
  var detail: String?

  var body: some View {
    HStack(alignment: .firstTextBaseline) {
      Text(title)
        .font(.headline.weight(.semibold))
        .foregroundStyle(VFTheme.ink)
      Spacer()
      if let detail {
        Text(detail)
          .font(.caption)
          .foregroundStyle(VFTheme.mutedInk)
      }
    }
  }
}

struct VFMetricCard: View {
  let value: String
  let label: String
  let icon: String
  let tint: Color

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Image(systemName: icon)
        .font(.caption.bold())
        .foregroundStyle(tint)
        .frame(width: 28, height: 28)
        .background(tint.opacity(0.12), in: Circle())
      Text(value)
        .font(.title3.monospacedDigit().bold())
        .foregroundStyle(VFTheme.ink)
      Text(label)
        .font(.caption)
        .foregroundStyle(VFTheme.mutedInk)
        .lineLimit(1)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(13)
    .background(VFTheme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(VFTheme.border))
  }
}

struct VFPrimaryButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.headline)
      .foregroundStyle(.white)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 16)
      .background(VFTheme.purple, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      .shadow(color: VFTheme.purple.opacity(0.18), radius: 12, y: 6)
      .scaleEffect(configuration.isPressed ? 0.985 : 1)
      .animation(.easeOut(duration: 0.16), value: configuration.isPressed)
  }
}

extension View {
  func vfCard(cornerRadius: CGFloat = 14) -> some View {
    background(VFTheme.card, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous).stroke(VFTheme.border))
      .shadow(color: VFTheme.ink.opacity(0.035), radius: 4, y: 2)
  }
}

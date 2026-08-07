import ClerkKitUI
import SwiftUI

private enum ReviewFilter: String, CaseIterable, Identifiable {
  case all = "All"
  case pending = "Waiting"
  case approved = "Approved"
  case changesRequested = "Changes"

  var id: String { rawValue }

  func includes(_ review: ReviewRequestSummary) -> Bool {
    switch self {
    case .all: true
    case .pending: review.status == "pending"
    case .approved: review.status == "approved"
    case .changesRequested: review.status == "changes_requested"
    }
  }
}

struct ReviewsView: View {
  let model: AppModel
  var showsAccountButton = true
  @State private var filter: ReviewFilter = .all
  @State private var searchText = ""

  private var filteredReviews: [ReviewRequestSummary] {
    model.reviews
      .filter(filter.includes)
      .filter {
        searchText.isEmpty
          || $0.videoTitle.localizedCaseInsensitiveContains(searchText)
          || $0.recipientName.localizedCaseInsensitiveContains(searchText)
          || $0.recipientEmail.localizedCaseInsensitiveContains(searchText)
      }
  }

  var body: some View {
    NavigationStack {
      Group {
        if model.reviews.isEmpty {
          ContentUnavailableView(
            "No review requests",
            systemImage: "checkmark.bubble",
            description: Text("Open a video to request a review.")
          )
        } else {
          List {
            Section {
              VFPageHeader(
                title: "Reviews",
                subtitle: "Private feedback and approvals."
              )
              .listRowBackground(Color.clear)
              .listRowInsets(.init(top: 8, leading: 2, bottom: 10, trailing: 2))
            }

            Section {
              ReviewSummaryBar(reviews: model.reviews)
                .listRowBackground(Color.clear)
                .listRowInsets(.init(top: 2, leading: 0, bottom: 6, trailing: 0))
            }

            Section {
              Picker("Status", selection: $filter) {
                ForEach(ReviewFilter.allCases) { option in
                  Text(option.rawValue).tag(option)
                }
              }
              .pickerStyle(.segmented)
              .labelsHidden()
              .listRowBackground(Color.clear)
              .listRowInsets(.init(top: 4, leading: 0, bottom: 4, trailing: 0))
            }

            Section(filteredReviews.isEmpty ? "" : "\(filteredReviews.count) request\(filteredReviews.count == 1 ? "" : "s")") {
              if filteredReviews.isEmpty {
                Text("No requests match this filter.")
                  .foregroundStyle(.secondary)
              } else {
                ForEach(filteredReviews) { review in
                  NavigationLink(value: review) {
                    ReviewRow(review: review)
                  }
                }
              }
            }
          }
          .listStyle(.insetGrouped)
          .scrollContentBackground(.hidden)
          .background(VFTheme.canvas)
          .searchable(text: $searchText, prompt: "Search reviews")
        }
      }
      .navigationTitle("")
      .navigationBarTitleDisplayMode(.inline)
      .navigationDestination(for: ReviewRequestSummary.self) { review in
        ReviewDetailView(review: review, model: model)
      }
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          VFWordmark(compact: true)
        }
        if showsAccountButton {
          ToolbarItem(placement: .topBarTrailing) { UserButton() }
        }
      }
    }
  }
}

private struct ReviewSummaryBar: View {
  let reviews: [ReviewRequestSummary]

  private var pending: Int { reviews.filter { $0.status == "pending" }.count }
  private var approved: Int { reviews.filter { $0.status == "approved" }.count }

  var body: some View {
    let content = HStack(spacing: 0) {
      ReviewSummaryMetric(value: pending, label: "Waiting")
      Divider().frame(height: 32)
      ReviewSummaryMetric(value: approved, label: "Approved")
      Divider().frame(height: 32)
      ReviewSummaryMetric(value: reviews.count, label: "Total")
    }
    .padding(.vertical, 12)
    .padding(.horizontal, 6)

    if #available(iOS 26.0, *) {
      content.glassEffect(.regular, in: .rect(cornerRadius: 16))
    } else {
      content.vfCard(cornerRadius: 16)
    }
  }
}

private struct ReviewSummaryMetric: View {
  let value: Int
  let label: String

  var body: some View {
    VStack(spacing: 2) {
      Text("\(value)").font(.headline.monospacedDigit())
      Text(label).font(.caption2).foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity)
  }
}

private struct ReviewRow: View {
  let review: ReviewRequestSummary

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline) {
        Text(review.videoTitle)
          .font(.headline)
          .lineLimit(2)
        Spacer(minLength: 8)
        ReviewStatusBadge(status: review.status)
      }

      Text("Sent to \(review.recipientName)")
        .font(.subheadline)
        .foregroundStyle(.secondary)

      if let response = review.responseNote, !response.isEmpty {
        Text(response)
          .font(.subheadline)
          .foregroundStyle(.primary)
          .padding(.vertical, 8)
          .padding(.horizontal, 10)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(VFTheme.mutedSurface, in: RoundedRectangle(cornerRadius: 8))
      }

      HStack {
        if let dueDate = review.dueDate {
          Label("Due \(dueDate.formatted(date: .abbreviated, time: .omitted))", systemImage: "calendar")
        } else {
          Label("No due date", systemImage: "calendar.badge.minus")
        }
        Spacer()
        Label(review.linkStatus.capitalized, systemImage: "link")
      }
      .font(.caption)
      .foregroundStyle(.secondary)
    }
    .padding(.vertical, 6)
  }
}

private struct ReviewStatusBadge: View {
  let status: String

  private var color: Color {
    switch status {
    case "approved": VFTheme.mint
    case "changes_requested": VFTheme.coral
    case "canceled": .secondary
    default: VFTheme.purple
    }
  }

  var body: some View {
    Text(status == "changes_requested" ? "Changes" : status.capitalized)
      .font(.caption2.weight(.semibold))
      .foregroundStyle(color)
      .padding(.horizontal, 7)
      .padding(.vertical, 4)
      .background(color.opacity(0.10), in: Capsule())
  }
}

private struct ReviewDetailView: View {
  let review: ReviewRequestSummary
  let model: AppModel
  @State private var isWorking = false
  @State private var confirmsCancellation = false

  private var currentReview: ReviewRequestSummary {
    model.reviews.first(where: { $0.id == review.id }) ?? review
  }

  var body: some View {
    let review = currentReview
    List {
      Section {
        VStack(alignment: .leading, spacing: 10) {
          HStack {
            ReviewStatusBadge(status: review.status)
            Spacer()
            Text(review.createdAtDate, format: .dateTime.month(.abbreviated).day().year())
              .font(.caption)
              .foregroundStyle(.secondary)
          }
          Text(review.videoTitle)
            .font(.title3.bold())
        }
        .padding(.vertical, 4)
      }

      Section("Reviewer") {
        LabeledContent("Name", value: review.recipientName)
        LabeledContent("Email", value: review.recipientEmail)
        if let dueDate = review.dueDate {
          LabeledContent("Due", value: dueDate.formatted(date: .abbreviated, time: .shortened))
        }
      }

      if let message = review.message, !message.isEmpty {
        Section("Request note") { Text(message) }
      }

      if let response = review.responseNote, !response.isEmpty {
        Section("Response") {
          if let name = review.responseName { LabeledContent("From", value: name) }
          Text(response)
        }
      }

      Section("Private link") {
        LabeledContent("Status", value: review.linkStatus.capitalized)
        Label("No VideoFlow account required", systemImage: "person.crop.circle.badge.checkmark")
          .foregroundStyle(.secondary)
      }

      if review.status == "pending" {
        Section("Actions") {
          Button {
            isWorking = true
            Task {
              _ = await model.remindReview(review)
              isWorking = false
            }
          } label: {
            Label("Send Reminder", systemImage: "bell.badge")
          }
          .disabled(isWorking || review.linkStatus != "active")

          Button(role: .destructive) {
            confirmsCancellation = true
          } label: {
            Label("Cancel Review Request", systemImage: "xmark.circle")
          }
          .disabled(isWorking)
        }
      }
    }
    .navigationTitle("Review Request")
    .navigationBarTitleDisplayMode(.inline)
    .confirmationDialog(
      "Cancel this review request?",
      isPresented: $confirmsCancellation,
      titleVisibility: .visible
    ) {
      Button("Cancel Request", role: .destructive) {
        isWorking = true
        Task {
          _ = await model.cancelReview(review)
          isWorking = false
        }
      }
    } message: {
      Text("The private review link will be revoked. The request remains in review history.")
    }
    .overlay { if isWorking { ProgressView().controlSize(.large) } }
  }
}

#Preview {
  ReviewsView(model: AppModel(service: PreviewVideoFlowService()))
}

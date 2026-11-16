import SwiftUI

/// Skip the colony ahead by a week to ten years, watch the years blur past, then read what happened
/// as a chronicle: an epilogue, a timeline, and where everyone is now.
struct TimeskipView: View {
    @Environment(Game.self) private var game
    @Environment(\.dismiss) private var dismiss
    @State private var skip: TimeskipPublic?
    @State private var skipId: Id?
    @State private var starting = false
    @State private var message: String?
    @State private var cancel: (() -> Void)?

    var body: some View {
        NavigationStack {
            Group {
                if let skip, skip.status == "done", let summary = skip.summary {
                    TimeskipChronicleView(summary: summary) { id in
                        dismiss()
                        game.follow(id)
                    }
                } else if let skip, skip.status == "running" || skip.status == "summarizing" {
                    progress(skip)
                } else {
                    chooser
                }
            }
            .navigationTitle(skip?.status == "done" ? "The years between" : "Skip ahead")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(skip?.status == "done" ? "Done" : "Close") { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(skip?.status == "running" || skip?.status == "summarizing")
        .onAppear { watch(nil) }
        .onDisappear { cancel?() }
    }

    private func watch(_ id: Id?) {
        cancel?()
        cancel = game.watchTimeskip(id) { value in
            // Without an id the latest skip comes back; only show it if it is still running or this sheet started it.
            if id == nil, let value, value.status == "done" || value.status == "failed" { return }
            skip = value
            if let value, value.status == "failed" { message = value.error ?? "The skip could not finish." }
        }
    }

    private var chooser: some View {
        List {
            Section {
                Text("Let time pass. The colonists live out their lives without you: they fall in love, quarrel, build, betray and die. When you come back, the chronicler tells you what happened.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Section("How long?") {
                ForEach(TimeskipSpan.allCases) { span in
                    Button {
                        start(span)
                    } label: {
                        HStack(spacing: 14) {
                            Image(systemName: span.symbol)
                                .font(.title3)
                                .frame(width: 30)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(span.title).font(.headline)
                                Text(span.hint).font(.footnote).foregroundStyle(.secondary)
                            }
                            Spacer()
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(starting)
                }
            }
            if let message {
                Section { Label(message, systemImage: "exclamationmark.triangle").font(.footnote) }
            }
        }
    }

    private func start(_ span: TimeskipSpan) {
        starting = true
        message = nil
        Task {
            let r = await game.startTimeskip(span)
            starting = false
            if let id = r.id {
                skipId = id
                watch(id)
            } else {
                message = r.message
            }
        }
    }

    private func progress(_ skip: TimeskipPublic) -> some View {
        VStack(spacing: 28) {
            Spacer()
            Image(systemName: "hourglass")
                .font(.system(size: 54, weight: .light))
                .symbolEffect(.pulse, options: .repeating)
            VStack(spacing: 10) {
                Text(skip.status == "summarizing" ? "The chronicler is writing" : "The years are passing")
                    .font(.title2).fontDesign(.serif)
                ProgressView(value: min(max(skip.progress, 0), 1))
                    .progressViewStyle(.linear)
                    .frame(maxWidth: 280)
                Text(storyTime(skip.tick)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
            Text(skip.latestBeat ?? skip.progressLabel)
                .font(.body).fontDesign(.serif).italic()
                .multilineTextAlignment(.center)
                .padding(.horizontal, 28)
                .id(skip.latestBeat ?? skip.progressLabel)
                .transition(.opacity)
                .animation(.easeInOut(duration: 0.6), value: skip.latestBeat)
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .padding()
    }
}

/// The finished chronicle: read top to bottom like the last chapter of a book.
struct TimeskipChronicleView: View {
    @Environment(Game.self) private var game
    var summary: TimeskipSummary
    var onFollow: (Id) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                Text(summary.title)
                    .font(.largeTitle).fontDesign(.serif)
                    .frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(Array(summary.narrative.enumerated()), id: \.offset) { _, paragraph in
                        Text(paragraph)
                            .font(.body).fontDesign(.serif)
                            .lineSpacing(4)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                if let followed = summary.followed {
                    section("The one you followed") { card(followed) }
                }
                if !summary.people.isEmpty {
                    section("Where they are now") {
                        ForEach(summary.people) { card($0) }
                    }
                }
                if !summary.newPeople.isEmpty {
                    section("New faces") {
                        ForEach(summary.newPeople) { card($0) }
                    }
                }
                if !summary.beats.isEmpty {
                    section("Timeline") {
                        ForEach(Array(summary.beats.enumerated()), id: \.offset) { _, beat in
                            HStack(alignment: .firstTextBaseline, spacing: 12) {
                                Text(beat.period)
                                    .font(.caption.weight(.semibold).monospacedDigit())
                                    .foregroundStyle(.secondary)
                                    .frame(width: 64, alignment: .leading)
                                Text(beat.text).font(.subheadline)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }
                if !summary.tensions.isEmpty {
                    section("Still unfinished") {
                        ForEach(Array(summary.tensions.enumerated()), id: \.offset) { _, t in
                            Label(t, systemImage: "flame").font(.subheadline)
                        }
                    }
                }
            }
            .padding(20)
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title.uppercased())
                .font(.caption.weight(.bold))
                .foregroundStyle(.secondary)
            content()
        }
    }

    private func card(_ p: TimeskipPerson) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Avatar(spriteId: p.spriteId, alive: p.alive, size: 44)
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(p.name).font(.headline)
                    if !p.alive { Text("gone").font(.caption).foregroundStyle(.secondary) }
                    Spacer()
                    if p.alive && game.colonist(p.agentId)?.alive == true {
                        Button("Follow") { onFollow(p.agentId) }
                            .font(.caption.weight(.semibold))
                            .buttonStyle(.bordered)
                    }
                }
                Text(p.text).font(.subheadline).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(12)
        .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 16))
    }
}

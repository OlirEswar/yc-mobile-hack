import SwiftUI

@main
struct LivingMoonApp: App {
    @State private var game = Game()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(game)
                .preferredColorScheme(.dark)
                .tint(.amber)
                .task { await game.boot() }
        }
    }
}

struct RootView: View {
    @Environment(Game.self) private var game

    var body: some View {
        @Bindable var game = game

        switch game.phase {
        case .loading:
            ProgressView("Waking the colony…").controlSize(.large)
        case let .failed(message):
            ContentUnavailableView {
                Label("The colony could not be reached", systemImage: "moon.zzz")
            } description: {
                Text(message)
            } actions: {
                Button("Try again") { Task { await game.boot() } }
                if game.useLive { Button("Use the offline colony") { game.useLive = false } }
            }
        case .ready:
            TabView(selection: $game.tab) {
                Tab("Colony", systemImage: "moon.fill", value: .colony) { ColonyView() }
                Tab("People", systemImage: "person.2.fill", value: .people) { PeopleView() }
                Tab("Chronicle", systemImage: "book.fill", value: .chronicle) { ChronicleView() }
            }
            // One inspector, one power sheet and one follow cover serve every tab.
            .sheet(item: Binding(get: { game.colonist(game.selectedID) }, set: { game.selectedID = $0?.id })) { c in
                InspectSheet(id: c.id)
                    .presentationDetents([.medium, .large])
                    .presentationBackgroundInteraction(.enabled(upThrough: .medium))
            }
            .sheet(item: $game.activePower) { power in
                Group {
                    if power == .arrival { CreatorSheet() } else { PowerSheet(power: power) }
                }
                .presentationDetents([.large])
            }
            .sheet(isPresented: $game.showPatron) { PatronSheet() }
            .fullScreenCover(isPresented: Binding(get: { game.followingID != nil }, set: { if !$0 { game.unfollow() } })) {
                FollowView()
            }
            .overlay(alignment: .top) {
                if game.tab != .colony, let toast = game.toast { ToastView(toast: toast).padding(.horizontal, 16).padding(.top, 8) }
            }
        }
    }
}

/// The latest consequence, beside the Powers button on the map.
struct TickerView: View {
    @Environment(Game.self) private var game

    var body: some View {
        Group {
            if let e = game.visibleEvents.last {
                Button { game.goTo(e) } label: {
                    HStack(spacing: 10) {
                        Image(systemName: e.symbol).foregroundStyle(e.tint)
                        Text(e.summary).font(.subheadline).lineLimit(1)
                        Spacer(minLength: 4)
                        Text(Clock.time(e.tick)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint("Shows what caused it")
            } else {
                HStack(spacing: 10) {
                    Image(systemName: "moon.stars").foregroundStyle(.secondary)
                    Text("The colony is quiet.").font(.subheadline).foregroundStyle(.secondary)
                    Spacer()
                }
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 52)
        .glassEffect(.regular.interactive())
    }
}

struct ToastView: View {
    @Environment(Game.self) private var game
    var toast: Toast

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: toast.kind == .error ? "exclamationmark.triangle.fill" : toast.kind == .ok ? "checkmark.circle.fill" : "info.circle.fill")
                .foregroundStyle(toast.kind == .error ? Color.red : toast.kind == .ok ? .amber : .earth)
            Text(toast.text).font(.subheadline)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16).padding(.vertical, 13)
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .onTapGesture { game.toast = nil }
    }
}

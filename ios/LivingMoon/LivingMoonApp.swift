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
    @AppStorage("livingMoon.onboarded") private var onboarded = false

    var body: some View {
        @Bindable var game = game

        if !onboarded {
            OnboardingView { withAnimation(.smooth(duration: 0.6)) { onboarded = true } }
                .transition(.opacity)
        } else {
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
                    Tab("You", systemImage: "person.crop.circle.badge.plus", value: .you) { YouView() }
                }
                .tabViewBottomAccessory { TickerView() }
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
                    .presentationDetents(power == .arrival || power.believed ? [.large] : [.medium, .large])
                }
                .sheet(isPresented: $game.showPatron) { PatronSheet() }
                .fullScreenCover(isPresented: Binding(get: { game.followingID != nil }, set: { if !$0 { game.unfollow() } })) {
                    FollowView()
                }
                .overlay(alignment: .top) { ToastView() }
                .overlay {
                    if let c = game.cinematic {
                        CinematicOverlay(cinematic: c)
                            .id(c.id)
                            .transition(.opacity)
                    }
                }
            }
        }
    }
}

/// The latest consequence, pinned above the tab bar.
struct TickerView: View {
    @Environment(Game.self) private var game

    var body: some View {
        if let e = game.visibleEvents.last {
            Button { game.goTo(e) } label: {
                HStack(spacing: 10) {
                    Image(systemName: e.symbol).foregroundStyle(e.tint)
                    Text(e.summary).font(.footnote).lineLimit(1)
                    Spacer(minLength: 4)
                    Text(Clock.time(e.tick)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 16)
            }
            .buttonStyle(.plain)
        } else {
            HStack(spacing: 10) {
                Image(systemName: "moon.stars").foregroundStyle(.secondary)
                Text("The colony is quiet.").font(.footnote).foregroundStyle(.secondary)
                Spacer()
            }
            .padding(.horizontal, 16)
        }
    }
}

struct ToastView: View {
    @Environment(Game.self) private var game

    var body: some View {
        if let toast = game.toast {
            Text(toast.text)
                .font(.subheadline)
                .padding(.horizontal, 16).padding(.vertical, 10)
                .glassEffect(.regular.tint((toast.kind == .error ? Color.red : toast.kind == .ok ? .amber : .earth).opacity(0.35)))
                .padding(.horizontal, 20)
                .padding(.top, 160)
                .transition(.move(edge: .top).combined(with: .opacity))
                .onTapGesture { game.toast = nil }
        }
    }
}

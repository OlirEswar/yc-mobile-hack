import SwiftUI

extension StorylinePublic {
    var statusLabel: String { status.capitalized }
    var statusTint: Color {
        switch status {
        case "climax": .red
        case "rising": .amber
        case "brewing": .earth
        default: .secondary
        }
    }
}

/// Sol and time for a tick; ticks before Sol 1 belong to the colony's past.
func storyTime(_ tick: Double) -> String { tick < 0 ? "Before Sol 1" : Clock.stamp(tick) }

/// How hot a storyline is running, as a short bar.
struct TensionMeter: View {
    var tension: Double
    var width: CGFloat = 64

    var body: some View {
        ZStack(alignment: .leading) {
            Capsule().fill(.white.opacity(0.12))
            Capsule()
                .fill(LinearGradient(colors: [.earth, .amber, .red], startPoint: .leading, endPoint: .trailing))
                .frame(width: max(6, width * min(1, max(0, tension))))
        }
        .frame(width: width, height: 6)
        .accessibilityElement()
        .accessibilityLabel("Tension \(Int(tension * 100)) percent")
    }
}

/// Faces of the people in a story; tapping one follows them.
struct CastRow: View {
    @Environment(Game.self) private var game
    var ids: [Id]
    var size: CGFloat = 34

    var body: some View {
        HStack(spacing: -6) {
            ForEach(ids.prefix(8), id: \.self) { id in
                if let c = game.colonist(id) {
                    Button { game.follow(id) } label: { Avatar(spriteId: c.spriteId, alive: c.alive, size: size) }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Follow \(c.name)")
                }
            }
        }
    }
}

// MARK: - Introduction

/// The story so far: the place, its history, what is at stake and the people to watch, then the
/// player starts following the starter character.
struct StoryIntroView: View {
    @Environment(Game.self) private var game
    var intro: StoryIntro
    @State private var card: KeyCharacterCard?
    @State private var shown = false

    private var starterName: String {
        game.colonist(intro.starterAgentId)?.first ?? intro.keyCharacters.first { $0.agentId == intro.starterAgentId }.map { String($0.name.split(separator: " ")[0]) } ?? "the story"
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            ScrollView {
                VStack(alignment: .leading, spacing: 44) {
                    hero
                    history
                    stakes
                    people
                    if !game.storylines.isEmpty { inMotion }
                }
                .padding(.horizontal, 24)
                .padding(.top, 72)
                .padding(.bottom, 150)
            }
            .scrollIndicators(.hidden)
            actions
        }
        .background { backdrop }
        .preferredColorScheme(.dark)
        .sheet(item: $card) { c in CharacterCardSheet(card: c) { follow in
            card = nil
            game.finishIntro(begin: false)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { game.follow(follow) }
        } }
        .onAppear { withAnimation(.smooth(duration: 1.4).delay(0.2)) { shown = true } }
    }

    /// The colony's ground art, dimmed. Overlays so the image never widens the layout.
    private var backdrop: some View {
        Color.black
            .overlay {
                if let ground = Art.image(MapLayout.ground) { ground.resizable().scaledToFill().opacity(0.28).blur(radius: 2) }
            }
            .overlay { LinearGradient(colors: [.black.opacity(0.2), .black.opacity(0.85), .black], startPoint: .top, endPoint: .bottom) }
            .clipped()
            .ignoresSafeArea()
    }

    private func reveal<Content: View>(_ content: Content) -> some View {
        content.scrollTransition(.animated(.smooth)) { view, phase in
            view.opacity(phase.isIdentity ? 1 : 0.15).offset(y: phase.value * 24)
        }
    }

    private func heading(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.caption.weight(.semibold))
            .tracking(2)
            .foregroundStyle(Color.amber)
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(intro.title)
                .font(.system(size: 44, weight: .regular, design: .serif))
                .opacity(shown ? 1 : 0)
                .offset(y: shown ? 0 : 16)
            ForEach(Array(intro.setting.enumerated()), id: \.offset) { i, paragraph in
                Text(paragraph)
                    .font(i == intro.setting.count - 1 ? .title3.italic() : .body)
                    .fontDesign(.serif)
                    .foregroundStyle(i == intro.setting.count - 1 ? .primary : .secondary)
                    .opacity(shown ? 1 : 0)
                    .animation(.smooth(duration: 1.2).delay(0.6 + Double(i) * 0.7), value: shown)
            }
        }
    }

    private var history: some View {
        reveal(VStack(alignment: .leading, spacing: 0) {
            heading("The story so far").padding(.bottom, 16)
            ForEach(Array(intro.history.enumerated()), id: \.offset) { i, entry in
                HStack(alignment: .top, spacing: 14) {
                    VStack(spacing: 0) {
                        Circle().fill(i == intro.history.count - 1 ? Color.amber : .white.opacity(0.6)).frame(width: 9, height: 9).padding(.top, 5)
                        Rectangle().fill(.white.opacity(0.18)).frame(width: 1.5).opacity(i == intro.history.count - 1 ? 0 : 1)
                    }
                    .frame(width: 10)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(entry.era).font(.subheadline.weight(.semibold)).foregroundStyle(i == intro.history.count - 1 ? Color.amber : .primary)
                        Text(entry.text).font(.callout).foregroundStyle(.secondary)
                    }
                    .padding(.bottom, 20)
                }
            }
        })
    }

    private var stakes: some View {
        reveal(VStack(alignment: .leading, spacing: 14) {
            heading("What's at stake")
            ForEach(intro.tensions, id: \.self) { t in
                Label { Text(t).font(.callout) } icon: { Image(systemName: "flame.fill").foregroundStyle(Color.amber) }
            }
        })
    }

    private var people: some View {
        reveal(VStack(alignment: .leading, spacing: 14) {
            heading("The people to watch")
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                ForEach(intro.keyCharacters) { c in
                    Button { card = c } label: {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: 10) {
                                Avatar(spriteId: c.spriteId, size: 46)
                                if c.agentId == intro.starterAgentId {
                                    Text("START").font(.caption2.weight(.bold)).padding(.horizontal, 6).padding(.vertical, 3)
                                        .background(Color.amber.opacity(0.25), in: Capsule()).foregroundStyle(Color.amber)
                                }
                            }
                            Text(c.name).font(.headline).fontDesign(.serif)
                            Text(c.epithet).font(.caption).foregroundStyle(.secondary).lineLimit(3, reservesSpace: true)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 20))
                    }
                    .buttonStyle(.plain)
                }
            }
        })
    }

    private var inMotion: some View {
        reveal(VStack(alignment: .leading, spacing: 14) {
            heading("Already in motion")
            ForEach(game.storylines.filter(\.live).prefix(4)) { s in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(s.title).font(.headline).fontDesign(.serif)
                        Spacer()
                        TensionMeter(tension: s.tension, width: 48)
                    }
                    Text(s.premise).font(.callout).foregroundStyle(.secondary)
                }
            }
        })
    }

    private var actions: some View {
        VStack(spacing: 10) {
            Button { game.finishIntro(begin: true) } label: {
                Text("Begin with \(starterName)").font(.headline).frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            Button("Explore on my own") { game.finishIntro(begin: false) }
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 8)
        .padding(.top, 30)
        .background(LinearGradient(colors: [.clear, .black.opacity(0.9)], startPoint: .top, endPoint: .center).ignoresSafeArea())
    }
}

struct CharacterCardSheet: View {
    var card: KeyCharacterCard
    var onFollow: (Id) -> Void

    var body: some View {
        VStack(spacing: 16) {
            Avatar(spriteId: card.spriteId, size: 96).padding(.top, 28)
            VStack(spacing: 6) {
                Text(card.name).font(.title).fontDesign(.serif)
                Text(card.epithet).font(.subheadline.italic()).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            Text(card.hook).font(.body).fontDesign(.serif).multilineTextAlignment(.center).padding(.horizontal, 8)
            Spacer()
            Button { onFollow(card.agentId) } label: {
                Text("Follow \(card.name.split(separator: " ")[0])").frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 12)
        .presentationDetents([.medium])
    }
}

// MARK: - Tutorial

/// A non-blocking coach card for the current tutorial step. It advances when the player does what
/// the step asks, or on Next for steps that only explain.
struct CoachCard: View {
    @Environment(Game.self) private var game

    var body: some View {
        if let step = game.tutorialStep, let total = game.intro?.tutorial.count {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Image(systemName: "sparkle").foregroundStyle(Color.amber)
                    Text(step.title).font(.subheadline.weight(.semibold))
                    Spacer()
                    Text("\(game.tutorialIndex + 1) of \(total)").font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                    Button("Skip tour", systemImage: "xmark") { game.skipTutorial() }
                        .labelStyle(.iconOnly)
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.secondary)
                }
                Text(step.body).font(.footnote).fixedSize(horizontal: false, vertical: true)
                HStack {
                    Spacer()
                    if let target = step.agentId, target != game.followingID, step.action == .switch_character || step.action == .follow_starter, let c = game.colonist(target) {
                        Button("Follow \(c.first)") { game.follow(target) }
                            .buttonStyle(.glassProminent).controlSize(.small)
                    }
                    if step.action == .tap {
                        Button("Next") { game.advanceTutorial() }
                            .buttonStyle(.glassProminent).controlSize(.small)
                    }
                }
            }
            .padding(14)
            .glassEffect(.regular.tint(Color.amber.opacity(0.18)), in: .rect(cornerRadius: 22))
            .id(step.id)
            .transition(.asymmetric(insertion: .move(edge: .top).combined(with: .opacity), removal: .opacity))
        }
    }
}

// MARK: - Banner

/// A high-tension beat breaking over the wide view.
struct StoryBannerView: View {
    @Environment(Game.self) private var game

    var body: some View {
        if let b = game.banner {
            Button { game.openStoryline(b.storylineId) } label: {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "flame.fill").foregroundStyle(b.tension >= 0.75 ? .red : Color.amber).padding(.top, 2)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(b.title.uppercased()).font(.caption2.weight(.bold)).tracking(1.2).foregroundStyle(Color.amber)
                        Text(b.text).font(.subheadline).fontDesign(.serif).multilineTextAlignment(.leading)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                }
                .padding(14)
                .glassEffect(.regular.tint(.red.opacity(0.2)).interactive(), in: .rect(cornerRadius: 22))
            }
            .buttonStyle(.plain)
            .id(b.id)
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }
}

// MARK: - Stories tab

struct StoriesView: View {
    @Environment(Game.self) private var game
    enum Mode: Hashable { case storylines, almanac }
    @State private var mode = Mode.storylines
    @State private var path: [Id] = []

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                switch mode {
                case .storylines: StorylineList()
                case .almanac: AlmanacView()
                }
            }
            .navigationTitle(mode == .storylines ? "Storylines" : "Almanac")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Picker("View", selection: $mode) {
                        Text("Storylines").tag(Mode.storylines)
                        Text("Almanac").tag(Mode.almanac)
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 230)
                }
                if game.intro != nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Story so far", systemImage: "book.pages") { game.showIntro = true }
                    }
                }
            }
            .navigationDestination(for: Id.self) { id in StorylineDetail(id: id) }
        }
        .onAppear { openPending() }
        .onChange(of: game.storylineID) { openPending() }
    }

    private func openPending() {
        guard let id = game.storylineID else { return }
        mode = .storylines
        path = [id]
        game.storylineID = nil
    }
}

struct StorylineList: View {
    @Environment(Game.self) private var game

    var body: some View {
        let live = game.storylines.filter(\.live)
        let done = game.storylines.filter { !$0.live }
        if game.storylines.isEmpty {
            ContentUnavailableView("No storylines yet", systemImage: "book.closed", description: Text("Stories form as people want, fear and collide. Give it a few hours, or tip the world with a power."))
        } else {
            List {
                Section { ForEach(live) { StorylineRow(storyline: $0) } } header: { Text("Live") } footer: {
                    Text("Highest tension first. Tap a face to follow that person.")
                }
                if !done.isEmpty {
                    Section("Finished") { ForEach(done) { StorylineRow(storyline: $0) } }
                }
            }
        }
    }
}

struct StorylineRow: View {
    var storyline: StorylinePublic

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            NavigationLink(value: storyline.id) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text(storyline.title).font(.headline).fontDesign(.serif)
                        Spacer()
                        Text(storyline.statusLabel).font(.caption2.weight(.semibold)).foregroundStyle(storyline.statusTint)
                        TensionMeter(tension: storyline.tension, width: 44)
                    }
                    Text(storyline.premise).font(.subheadline).foregroundStyle(.secondary)
                }
            }
            CastRow(ids: storyline.participantIds, size: 30)
            BeatTimeline(beats: Array(storyline.beats.suffix(3).reversed()), compact: true)
        }
        .padding(.vertical, 6)
    }
}

/// Newest beat first, joined by a thin line.
struct BeatTimeline: View {
    var beats: [StoryBeat]
    var compact = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(beats.enumerated()), id: \.offset) { i, beat in
                HStack(alignment: .top, spacing: 10) {
                    VStack(spacing: 0) {
                        Circle().fill(i == 0 ? Color.amber : .white.opacity(0.4)).frame(width: 7, height: 7).padding(.top, 5)
                        Rectangle().fill(.white.opacity(0.15)).frame(width: 1).opacity(i == beats.count - 1 ? 0 : 1)
                    }
                    .frame(width: 8)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(beat.text).font(compact ? .footnote : .callout)
                        Text(storyTime(beat.tick)).font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                    }
                    .padding(.bottom, compact ? 8 : 14)
                }
            }
        }
    }
}

struct StorylineDetail: View {
    @Environment(Game.self) private var game
    var id: Id

    var body: some View {
        if let s = game.storyline(id) {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text(s.statusLabel).font(.caption.weight(.semibold)).foregroundStyle(s.statusTint)
                            TensionMeter(tension: s.tension, width: 90)
                            Spacer()
                            Text(s.origin == "seed" ? "Since Sol 1" : "Began " + storyTime(s.createdTick)).font(.caption).foregroundStyle(.secondary)
                        }
                        Text(s.premise).font(.body).fontDesign(.serif)
                    }
                }
                Section("People") {
                    ForEach(s.participantIds, id: \.self) { pid in
                        if let c = game.colonist(pid) {
                            Button { game.follow(pid) } label: {
                                HStack(spacing: 12) {
                                    Avatar(spriteId: c.spriteId, alive: c.alive, size: 38)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(c.name).foregroundStyle(.primary)
                                        Text(c.alive ? c.activityLabel : "Died").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                    }
                                    Spacer()
                                    if c.alive { Text("Follow").font(.caption.weight(.semibold)).foregroundStyle(Color.amber) }
                                }
                            }
                            .disabled(!c.alive)
                        }
                    }
                }
                Section("Chapters") { BeatTimeline(beats: s.beats.reversed()) }
            }
            .navigationTitle(s.title)
            .navigationBarTitleDisplayMode(.inline)
        } else {
            ContentUnavailableView("This storyline has ended", systemImage: "book.closed")
        }
    }
}

// MARK: - Almanac

/// The colony's history book: its institutions, discoveries, landmarks, famous works and people.
struct AlmanacView: View {
    @Environment(Game.self) private var game
    @State private var overview: SocietyOverview?
    @State private var loaded = false

    var body: some View {
        Group {
            if let o = overview {
                List {
                    if !o.notables.isEmpty {
                        Section("People of note") {
                            ForEach(o.notables) { n in person(n.agentId, name: n.name, line: n.known) }
                        }
                    }
                    if !o.organizations.isEmpty {
                        Section("Institutions") {
                            ForEach(o.organizations.filter { $0.status == "active" }) { org in
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack {
                                        Text(org.name).font(.headline).fontDesign(.serif)
                                        Spacer()
                                        Text(org.kind.capitalized).font(.caption).foregroundStyle(.secondary)
                                    }
                                    Text("\u{201C}\(org.creed)\u{201D}").font(.subheadline.italic()).foregroundStyle(.secondary)
                                    if let leader = game.colonist(org.leaderId) {
                                        Text("Led by \(leader.name) · \(org.memberIds.count) members").font(.caption)
                                    }
                                    if let rules = org.rules, !rules.isEmpty {
                                        Text(rules.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                                    }
                                    CastRow(ids: [org.leaderId].compactMap { $0 } + org.memberIds.filter { $0 != org.leaderId }, size: 28)
                                }
                                .padding(.vertical, 4)
                            }
                        }
                    }
                    if !o.discoveries.isEmpty {
                        Section("Discoveries") {
                            ForEach(o.discoveries.sorted { $0.tick > $1.tick }) { d in
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(d.name).font(.headline)
                                    Text(d.effect).font(.subheadline).foregroundStyle(.secondary)
                                    Text([storyTime(d.tick), names(d.discovererIds).map { "by " + $0 }].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    if !o.structures.isEmpty {
                        Section("Landmarks") {
                            ForEach(o.structures) { s in
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(s.name).font(.headline)
                                    Text(s.builtTick.map { "Built \(storyTime($0).lowercased()) at \(s.locationId.name)" } ?? "Being built at \(s.locationId.name), \(Int(s.progress * 100))% done")
                                        .font(.subheadline).foregroundStyle(.secondary)
                                    if let builders = names(s.builderIds) { Text("by " + builders).font(.caption).foregroundStyle(.secondary) }
                                }
                            }
                        }
                    }
                    if !o.works.isEmpty {
                        Section("Famous works") {
                            ForEach(o.works.sorted { $0.fame > $1.fame }) { w in
                                Button { game.follow(w.creatorId) } label: {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(w.title).font(.headline).fontDesign(.serif).foregroundStyle(.primary)
                                        Text("A \(w.kind) by \(w.creatorName)").font(.caption).foregroundStyle(Color.amber)
                                        Text(w.about).font(.subheadline).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
            } else if loaded {
                ContentUnavailableView("The almanac is empty", systemImage: "books.vertical", description: Text("This colony has not written its history down yet."))
            } else {
                ProgressView()
            }
        }
        .task {
            overview = await game.society()
            loaded = true
        }
    }

    private func names(_ ids: [Id]) -> String? {
        let list = ids.compactMap { game.colonist($0)?.name }
        return list.isEmpty ? nil : ListFormatter.localizedString(byJoining: list)
    }

    private func person(_ id: Id, name: String, line: String) -> some View {
        Button { game.follow(id) } label: {
            HStack(spacing: 12) {
                if let c = game.colonist(id) { Avatar(spriteId: c.spriteId, alive: c.alive, size: 40) }
                VStack(alignment: .leading, spacing: 2) {
                    Text(name).foregroundStyle(.primary)
                    Text(line).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }
}

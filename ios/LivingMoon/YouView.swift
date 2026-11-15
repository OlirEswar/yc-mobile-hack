import AuthenticationServices
import SwiftUI

// MARK: - You

/// Your own colonist: import what your apps know about you, build a character from it, drop it into
/// the colony, tell it what you want, and invite friends into the same world.
struct YouView: View {
    @Environment(Game.self) private var game
    @State private var importing: ImportKind?
    @State private var editing = false
    @State private var buildName = ""
    @State private var building = false
    @State private var spawning = false
    @State private var error: String?
    @State private var confirmForget = false

    enum ImportKind: String, Identifiable {
        case gmail, ai, aboutMe
        var id: String { rawValue }
    }

    private var sources: [PersonaSourcePublic] { game.avatar?.sources ?? [] }
    private var profile: AvatarProfile? { game.avatar?.profile }

    var body: some View {
        NavigationStack {
            List {
                if let me = game.myAvatar {
                    AvatarCard(avatar: me, spawning: spawning, respawn: spawn)
                } else if sources.isEmpty && profile == nil {
                    intro
                }
                sourcesSection
                characterSection
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
                PlayersSection()
                if game.avatar != nil {
                    Section {
                        Button("Forget my sources and profile", role: .destructive) { confirmForget = true }
                    } footer: {
                        Text("A character already in the colony stays there as an ordinary colonist.")
                    }
                }
            }
            .navigationTitle("You")
            .sheet(item: $importing) { kind in
                switch kind {
                case .gmail: GmailImportSheet()
                case .ai: AIMemorySheet()
                case .aboutMe: AboutMeSheet()
                }
            }
            .sheet(isPresented: $editing) {
                if let profile { ProfileEditor(profile: profile) }
            }
            .confirmationDialog("Forget everything you imported?", isPresented: $confirmForget, titleVisibility: .visible) {
                Button("Forget", role: .destructive) { run { await game.forgetAvatar() } }
            } message: { Text("Your sources and your character's profile are deleted.") }
        }
    }

    private var intro: some View {
        Section {
            VStack(spacing: 12) {
                Image(systemName: "person.crop.circle.badge.plus")
                    .font(.system(size: 54, weight: .light))
                    .foregroundStyle(Color.amber)
                Text("Put yourself on the Moon").font(.title2).fontDesign(.serif)
                Text("Import what your apps already know about you. Living Moon builds a colonist modelled on you who lives, works and chooses the way you would.")
                    .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .listRowBackground(Color.clear)
        }
    }

    private var sourcesSection: some View {
        Section {
            ForEach(sources) { s in
                SourceRow(source: s)
                    .swipeActions {
                        Button("Delete", systemImage: "trash", role: .destructive) { run { await game.removeSource(s.id) } }
                    }
            }
            if sources.count < 6 {
                importButton("Import from Gmail", detail: "Senders, subjects and labels, read on this phone", symbol: "envelope.fill", .gmail)
                importButton("Ask your AI", detail: "What ChatGPT, Claude or Gemini knows about you", symbol: "sparkles", .ai)
                importButton("Write about yourself", detail: "In your own words", symbol: "pencil.line", .aboutMe)
            }
        } header: {
            Text("About you")
        } footer: {
            Text("Everything is summarized on this phone first. Emails, phone numbers and links are removed before anything is kept. Up to 6 sources.")
        }
    }

    private func importButton(_ title: String, detail: String, symbol: String, _ kind: ImportKind) -> some View {
        Button { importing = kind } label: {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).foregroundStyle(.primary)
                    Text(detail).font(.caption).foregroundStyle(.secondary)
                }
            } icon: {
                Image(systemName: symbol).foregroundStyle(Color.amber)
            }
        }
    }

    @ViewBuilder
    private var characterSection: some View {
        if let profile {
            Section {
                ProfileCard(profile: profile, builtBy: game.avatar?.profileSource)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                HStack(spacing: 8) {
                    Button { editing = true } label: { Text("Edit").frame(maxWidth: .infinity) }
                        .buttonStyle(.glass)
                    Button { build() } label: { Text(building ? "Rebuilding…" : "Rebuild").frame(maxWidth: .infinity) }
                        .buttonStyle(.glass)
                        .disabled(building || sources.isEmpty)
                }
                .controlSize(.large)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                if game.myAvatar == nil {
                    Button { spawn() } label: {
                        Label(spawning ? "Landing…" : "Drop into the colony", systemImage: "airplane.arrival").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glassProminent)
                    .controlSize(.large)
                    .disabled(spawning)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                }
            } header: {
                Text("Your character")
            }
        } else {
            Section {
                TextField("Name (optional)", text: $buildName)
                    .textContentType(.name)
                Button { build() } label: {
                    HStack {
                        Text(building ? "Building your character…" : "Build my character")
                        Spacer()
                        if building { ProgressView() } else { Image(systemName: "wand.and.stars") }
                    }
                }
                .disabled(building || sources.isEmpty)
            } header: {
                Text("Your character")
            } footer: {
                Text(sources.isEmpty ? "Add at least one source about yourself first." : "You can edit everything before your character lands.")
            }
        }
    }

    private func build() {
        let name = buildName.trimmingCharacters(in: .whitespaces)
        building = true
        run {
            defer { building = false }
            return await game.synthesize(name: name.isEmpty ? nil : name)
        }
    }

    private func spawn() {
        spawning = true
        run {
            defer { spawning = false }
            return await game.spawnAvatar()
        }
    }

    private func run(_ op: @escaping () async -> String?) {
        Task {
            error = nil
            error = await op()
        }
    }
}

struct SourceRow: View {
    var source: PersonaSourcePublic

    private var symbol: String {
        switch source.kind {
        case .gmail: "envelope.fill"
        case .ai_memory: "sparkles"
        case .about_me: "person.text.rectangle"
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol).foregroundStyle(Color.amber).frame(width: 24).padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(source.label).font(.subheadline.weight(.semibold))
                    Spacer()
                    Text("\(Int(source.chars)) chars").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
                Text(source.preview).font(.caption).foregroundStyle(.secondary).lineLimit(3)
            }
        }
    }
}

// MARK: - Profile

extension AvatarProfile {
    var ageLabel: String { ["young": "Young", "adult": "Adult", "elder": "Elder"][ageBand] ?? ageBand.capitalized }
}

func builtByLabel(_ source: String?) -> String {
    switch source {
    case "llm": "Built by AI"
    case "rules": "Built by offline rules"
    case "player": "Edited by you"
    default: "Not built yet"
    }
}

func goalKindLabel(_ kind: String) -> String {
    kind == "custom" ? "Something else" : kind.replacingOccurrences(of: "_", with: " ").capitalized
}

struct ProfileCard: View {
    var profile: AvatarProfile
    var builtBy: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                Avatar(spriteId: profile.spriteId, size: 72)
                VStack(alignment: .leading, spacing: 4) {
                    Text(profile.name).font(.title2).fontDesign(.serif)
                    Text("\(occupation(profile.occupation).label) · \(profile.ageLabel) · \(profile.homeLocationId.name)")
                        .font(.caption).foregroundStyle(.secondary)
                    Text(builtByLabel(builtBy))
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Capsule().fill(Color.amber.opacity(0.22)))
                        .foregroundStyle(Color.amber)
                }
            }
            if !profile.summary.isEmpty { Text(profile.summary).font(.subheadline) }
            if !profile.interests.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(profile.interests, id: \.self) { Chip(text: $0) }
                }
            }
            if !profile.backstory.isEmpty {
                Text(profile.backstory).font(.footnote).foregroundStyle(.secondary).italic()
            }
            Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 6) {
                ForEach(TRAIT_KEYS, id: \.self) { key in
                    GridRow {
                        Text(key.capitalized).font(.caption).foregroundStyle(.secondary)
                        ProgressView(value: profile.traits[key] ?? 0.5).tint(.amber)
                    }
                }
            }
            if !profile.speechStyle.isEmpty {
                LabeledText(title: "Talks", text: profile.speechStyle)
            }
            if !profile.habits.isEmpty {
                LabeledText(title: "Habits", text: profile.habits.map { "• " + $0 }.joined(separator: "\n"))
            }
            if !profile.goals.isEmpty {
                LabeledText(title: "Wants", text: profile.goals.map { "• " + $0.description }.joined(separator: "\n"))
            }
        }
        .padding(18)
        .glassEffect(.regular, in: .rect(cornerRadius: 26))
    }
}

struct LabeledText: View {
    var title: String
    var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title.uppercased()).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            Text(text).font(.subheadline)
        }
    }
}

struct Chip: View {
    var text: String
    var onRemove: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 4) {
            Text(text).font(.caption.weight(.medium))
            if let onRemove {
                Button("Remove \(text)", systemImage: "xmark", action: onRemove)
                    .labelStyle(.iconOnly).font(.caption2.weight(.bold)).buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 5)
        .background(Capsule().fill(.white.opacity(0.1)))
        .overlay(Capsule().stroke(.white.opacity(0.15), lineWidth: 1))
    }
}

/// Lays children out left to right, wrapping onto new lines.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(proposal.width ?? .infinity, subviews)
        return CGSize(width: rows.map(\.width).max() ?? 0, height: rows.last.map { $0.y + $0.height } ?? 0)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for row in arrange(bounds.width, subviews) {
            var x = bounds.minX
            for i in row.items {
                let size = subviews[i].sizeThatFits(.unspecified)
                subviews[i].place(at: CGPoint(x: x, y: bounds.minY + row.y), proposal: .unspecified)
                x += size.width + spacing
            }
        }
    }

    private struct Row { var items: [Int] = []; var y: CGFloat = 0; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func arrange(_ maxWidth: CGFloat, _ subviews: Subviews) -> [Row] {
        var rows = [Row()]
        for i in subviews.indices {
            let size = subviews[i].sizeThatFits(.unspecified)
            if !rows[rows.count - 1].items.isEmpty && rows[rows.count - 1].width + spacing + size.width > maxWidth {
                let last = rows[rows.count - 1]
                rows.append(Row(y: last.y + last.height + spacing))
            }
            var row = rows[rows.count - 1]
            row.width += (row.items.isEmpty ? 0 : spacing) + size.width
            row.height = max(row.height, size.height)
            row.items.append(i)
            rows[rows.count - 1] = row
        }
        return rows
    }
}

struct ProfileEditor: View {
    @Environment(Game.self) private var game
    @Environment(\.dismiss) private var dismiss
    @State private var draft: AvatarProfile
    @State private var newInterest = ""
    @State private var saving = false
    @State private var error: String?

    init(profile: AvatarProfile) { _draft = State(initialValue: profile) }

    private var sprites: [String] {
        let mine = occupation(draft.occupation).archetype
        return ([mine] + SPRITE_ARCHETYPES.filter { $0 != mine }).flatMap { a in (0..<SPRITE_VARIANTS).map { "\(a)_\($0)" } }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: 10) {
                        Avatar(spriteId: draft.spriteId, size: 84)
                        ScrollView(.horizontal, showsIndicators: false) {
                            LazyHStack(spacing: 8) {
                                ForEach(sprites, id: \.self) { s in
                                    Button { draft.spriteId = s } label: {
                                        Avatar(spriteId: s, size: 44)
                                            .overlay(Circle().stroke(Color.amber, lineWidth: s == draft.spriteId ? 3 : 0))
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                }
                Section {
                    TextField("Name", text: $draft.name)
                    Picker("Occupation", selection: $draft.occupation) {
                        ForEach(OCCUPATIONS) { Text($0.label).tag($0.id) }
                    }
                    Picker("Age", selection: $draft.ageBand) {
                        Text("Young").tag("young"); Text("Adult").tag("adult"); Text("Elder").tag("elder")
                    }
                    .pickerStyle(.segmented)
                    Picker("Home", selection: $draft.homeLocationId) {
                        Text("Habitat Ring A").tag(LocationId.habitat_a); Text("Habitat Ring B").tag(LocationId.habitat_b)
                    }
                }
                Section("Temperament") {
                    ForEach(TRAIT_KEYS, id: \.self) { key in
                        LabeledContent(key.capitalized) { Slider(value: dial(\.traits, key)) }
                    }
                }
                Section("Cares about") {
                    ForEach(VALUE_KEYS, id: \.self) { key in
                        LabeledContent(key.capitalized) { Slider(value: dial(\.values, key)) }
                    }
                }
                Section {
                    TextField("Who they are, in one line", text: $draft.summary, axis: .vertical).lineLimit(1...3)
                } header: { Text("Summary") } footer: { Text("\(draft.summary.count)/160") }
                Section {
                    TextField("Backstory", text: $draft.backstory, axis: .vertical).lineLimit(2...6)
                } header: { Text("Backstory") } footer: { Text("\(draft.backstory.count)/280") }
                Section("Interests") {
                    if !draft.interests.isEmpty {
                        FlowLayout(spacing: 6) {
                            ForEach(draft.interests, id: \.self) { interest in
                                Chip(text: interest) { draft.interests.removeAll { $0 == interest } }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    if draft.interests.count < 6 {
                        TextField("Add an interest", text: $newInterest)
                            .onSubmit {
                                let t = newInterest.trimmingCharacters(in: .whitespaces)
                                if !t.isEmpty && !draft.interests.contains(t) { draft.interests.append(String(t.prefix(30))) }
                                newInterest = ""
                            }
                    }
                }
                Section {
                    TextField("How they talk", text: $draft.speechStyle, axis: .vertical).lineLimit(1...3)
                } header: { Text("Speech style") } footer: { Text("\(draft.speechStyle.count)/140") }
                Section("Habits") {
                    ForEach(Array(draft.habits.indices), id: \.self) { i in
                        TextField("Something they tend to do", text: item(\.habits, i))
                    }
                    .onDelete { draft.habits.remove(atOffsets: $0) }
                    if draft.habits.count < 4 {
                        Button("Add a habit", systemImage: "plus") { draft.habits.append("") }
                    }
                }
                Section {
                    ForEach(Array(draft.goals.indices), id: \.self) { i in
                        VStack(alignment: .leading) {
                            Picker("Kind", selection: goal(i, \.kind)) {
                                ForEach(GOAL_KINDS, id: \.self) { Text(goalKindLabel($0)).tag($0) }
                            }
                            TextField("What they want", text: goal(i, \.description), axis: .vertical)
                        }
                    }
                    .onDelete { draft.goals.remove(atOffsets: $0) }
                    if draft.goals.count < 2 {
                        Button("Add a goal", systemImage: "plus") { draft.goals.append(AvatarGoal(kind: "custom", description: "")) }
                    }
                } header: { Text("Goals") } footer: { Text("Up to 2. Swipe to remove.") }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle("Edit Character")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "…" : "Save") { save() }
                        .disabled(saving || draft.name.trimmingCharacters(in: .whitespaces).count < 2)
                }
            }
        }
    }

    private func dial(_ path: WritableKeyPath<AvatarProfile, [String: Double]>, _ key: String) -> Binding<Double> {
        Binding(get: { draft[keyPath: path][key] ?? 0.5 }, set: { draft[keyPath: path][key] = $0 })
    }

    private func item(_ path: WritableKeyPath<AvatarProfile, [String]>, _ i: Int) -> Binding<String> {
        Binding(get: { i < draft[keyPath: path].count ? draft[keyPath: path][i] : "" }, set: { if i < draft[keyPath: path].count { draft[keyPath: path][i] = $0 } })
    }

    private func goal(_ i: Int, _ path: WritableKeyPath<AvatarGoal, String>) -> Binding<String> {
        Binding(get: { i < draft.goals.count ? draft.goals[i][keyPath: path] : "" }, set: { if i < draft.goals.count { draft.goals[i][keyPath: path] = $0 } })
    }

    private func save() {
        var p = draft
        p.name = p.name.trimmingCharacters(in: .whitespaces)
        p.summary = String(p.summary.prefix(160))
        p.backstory = String(p.backstory.prefix(280))
        p.speechStyle = String(p.speechStyle.prefix(140))
        p.habits = p.habits.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        p.goals = p.goals.filter { !$0.description.trimmingCharacters(in: .whitespaces).isEmpty }
        saving = true
        Task {
            error = await game.saveProfile(p)
            saving = false
            if error == nil { dismiss() }
        }
    }
}

// MARK: - Avatar in the colony

struct AvatarCard: View {
    @Environment(Game.self) private var game
    var avatar: AgentLite
    var spawning: Bool
    var respawn: () -> Void
    @State private var order = ""
    @State private var sending = false
    @State private var error: String?

    private var trimmed: String { order.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        Section {
            HStack(spacing: 14) {
                Avatar(spriteId: avatar.spriteId, alive: avatar.alive, size: 64)
                VStack(alignment: .leading, spacing: 3) {
                    Text(avatar.name).font(.title2).fontDesign(.serif)
                    Text(avatar.alive ? avatar.activityLabel : "Died").font(.subheadline).lineLimit(2)
                    if avatar.alive {
                        Text("Feels \(avatar.mood) · at \(avatar.locationId.name)").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 4, leading: 4, bottom: 4, trailing: 4))

            if avatar.alive {
                HStack(spacing: 8) {
                    Button { game.follow(avatar.id) } label: { Text("Follow").frame(maxWidth: .infinity) }
                        .buttonStyle(.glassProminent)
                    Button { game.selectedID = avatar.id } label: { Text("Inspect").frame(maxWidth: .infinity) }
                        .buttonStyle(.glass)
                }
                .controlSize(.large)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))

                HStack(alignment: .bottom, spacing: 10) {
                    TextField("Tell \(avatar.first) to…", text: $order, axis: .vertical)
                        .lineLimit(1...4)
                        .onChange(of: order) { if order.count > 140 { order = String(order.prefix(140)) } }
                        .submitLabel(.send)
                    Button("Send", systemImage: "arrow.up.circle.fill") { send() }
                        .labelStyle(.iconOnly)
                        .font(.title2)
                        .disabled(trimmed.count < 3 || sending)
                }
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                ForEach(Array((game.avatar?.directives ?? []).enumerated()), id: \.offset) { _, d in
                    HStack(alignment: .firstTextBaseline) {
                        Image(systemName: "person.wave.2.fill").font(.caption).foregroundStyle(Color.amber)
                        Text(d.text).font(.subheadline)
                        Spacer()
                        Text(Clock.time(d.tick)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    }
                }
            } else {
                Button { respawn() } label: {
                    Label(spawning ? "Landing…" : "Send a new \(avatar.first) to the colony", systemImage: "arrow.counterclockwise").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
                .disabled(spawning)
                .listRowBackground(Color.clear)
            }
        } header: {
            Text("In the colony")
        } footer: {
            if avatar.alive { Text("\(avatar.first) decides how. Tell them what you want in a sentence: \"make friends with the medics\", \"get rich trading water\".") }
        }
    }

    private func send() {
        let text = trimmed
        guard text.count >= 3 else { return }
        sending = true
        Task {
            error = await game.direct(text)
            sending = false
            if error == nil { order = "" }
        }
    }
}

// MARK: - Multiplayer

struct PlayersSection: View {
    @Environment(Game.self) private var game
    @State private var name = ""
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?
    @State private var confirmJoin = false

    var body: some View {
        let state = game.multiplayer
        let me = state?.players.first { $0.isYou }
        Section {
            HStack {
                TextField("Your name", text: $name)
                    .textContentType(.nickname)
                    .submitLabel(.done)
                    .onSubmit(saveName)
                if !name.isEmpty && name != me?.name {
                    Button("Save", action: saveName).buttonStyle(.glass).controlSize(.small)
                }
            }
            if let state {
                if let invite = state.inviteCode {
                    VStack(spacing: 10) {
                        Text("Colony code").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        Text(invite)
                            .font(.system(size: 42, weight: .bold, design: .monospaced))
                            .tracking(6)
                            .foregroundStyle(Color.amber)
                            .textSelection(.enabled)
                        ShareLink(item: "Join my Moon colony in Living Moon with code \(invite)") {
                            Label("Share code", systemImage: "square.and.arrow.up")
                        }
                        .buttonStyle(.glass)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                } else if state.isHost {
                    Button { act { await game.invite() } } label: {
                        Label("Invite friends", systemImage: "person.2.badge.plus")
                    }
                }
                ForEach(state.players) { PlayerRow(player: $0) }
                if !state.isHost {
                    Button("Leave and return to my colony", systemImage: "arrow.uturn.backward", role: .destructive) { act { await game.leave() } }
                }
            }
            if let error { Text(error).font(.footnote).foregroundStyle(.red) }
        } header: {
            HStack {
                Text("Play with friends")
                Spacer()
                if let state { Text("\(state.players.count)/\(Int(state.maxPlayers))").monospacedDigit() }
            }
        } footer: {
            Text("Friends with the code join this world with their own characters. Your characters meet, talk and trade on their own.")
        }

        Section {
            HStack {
                TextField("6-character code", text: $code)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .font(.body.monospaced())
                    .onChange(of: code) {
                        let clean = String(code.uppercased().filter { $0.isLetter || $0.isNumber }.prefix(6))
                        if clean != code { code = clean }
                    }
                Button(busy ? "…" : "Join") { confirmJoin = true }
                    .buttonStyle(.glassProminent)
                    .disabled(code.count != 6 || busy)
            }
        } header: {
            Text("Join a friend's colony")
        }
        .confirmationDialog("Join colony \(code)?", isPresented: $confirmJoin, titleVisibility: .visible) {
            Button("Join") {
                let joining = code
                act { await game.join(code: joining) }
            }
        } message: {
            Text("You leave this colony. Your character here stays behind.")
        }
        .onAppear { if name.isEmpty { name = me?.name ?? "" } }
        .onChange(of: me?.name) { if let n = me?.name, name.isEmpty { name = n } }
    }

    private func saveName() {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2, trimmed != game.multiplayer?.players.first(where: { $0.isYou })?.name else { return }
        act { await game.setPlayerName(trimmed) }
    }

    private func act(_ op: @escaping () async -> String?) {
        busy = true
        Task {
            error = await op()
            busy = false
        }
    }
}

struct PlayerRow: View {
    @Environment(Game.self) private var game
    var player: PlayerPublic

    var body: some View {
        HStack(spacing: 10) {
            Circle().fill(player.online ? Color.green : Color.gray.opacity(0.5)).frame(width: 8, height: 8)
                .accessibilityLabel(player.online ? "Online" : "Offline")
            Text(player.name)
            if player.isHost { Badge(text: "Host") }
            if player.isYou { Badge(text: "You", tint: .earth) }
            Spacer()
            if let id = player.avatarAgentId, let name = player.avatarName {
                Button {
                    game.selectedID = id
                } label: {
                    HStack(spacing: 6) {
                        if let c = game.colonist(id) { Avatar(spriteId: c.spriteId, alive: c.alive, size: 24) }
                        Text(name).font(.caption)
                    }
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            } else {
                Text("No character yet").font(.caption).foregroundStyle(.tertiary)
            }
        }
    }
}

struct Badge: View {
    var text: String
    var tint: Color = .amber

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(Capsule().fill(tint.opacity(0.22)))
            .foregroundStyle(tint)
    }
}

// MARK: - Imports

/// Gmail headers digested on this phone. The token stays inside one Task and is never stored.
struct GmailImportSheet: View {
    @Environment(Game.self) private var game
    @Environment(\.dismiss) private var dismiss
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @State private var digest: String?
    @State private var count = 0
    @State private var working: String?
    @State private var error: String?
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Label("Reads only the sender, recipient and subject of up to 80 emails from the last 180 days, here on your phone.", systemImage: "envelope.open")
                    Label("Never reads message bodies and never keeps full email addresses, only domains like github.com.", systemImage: "eye.slash")
                    Label("Your Google sign-in is used once and forgotten. You read the summary before anything is sent.", systemImage: "lock")
                }
                .font(.subheadline)

                if !GoogleAuth.isConfigured {
                    Section {
                        Text("Gmail import needs a Google iOS OAuth client id. Add it as GoogleAuth.clientID in GoogleAuth.swift, then rebuild the app.")
                            .foregroundStyle(Color.amber)
                    }
                }

                if let digest {
                    Section {
                        Text(digest).font(.caption.monospaced()).textSelection(.enabled)
                    } header: {
                        Text("What will be sent")
                    } footer: {
                        Text("\(count) messages summarized, \(digest.count) characters.")
                    }
                } else {
                    Section {
                        Button {
                            connect()
                        } label: {
                            HStack {
                                Label(working ?? "Connect Gmail", systemImage: "envelope.badge.shield.half.filled")
                                Spacer()
                                if working != nil { ProgressView() }
                            }
                        }
                        .disabled(!GoogleAuth.isConfigured || working != nil)
                    }
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle("Gmail")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "…" : "Add") { add() }.disabled(digest == nil || saving)
                }
            }
        }
    }

    private func connect() {
        error = nil
        working = "Waiting for Google…"
        Task {
            defer { working = nil }
            do {
                let token = try await GoogleAuth.signIn(with: webAuthenticationSession)
                working = "Summarizing your mail…"
                let result = try await GoogleAuth.digest(token: token)
                digest = result.text
                count = result.messages
            } catch let failure as ASWebAuthenticationSessionError where failure.code == .canceledLogin {
                return
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    private func add() {
        guard let digest else { return }
        saving = true
        Task {
            error = await game.addSource(PersonaSourceInput(kind: .gmail, label: "Gmail, last 180 days", text: digest))
            saving = false
            if error == nil { dismiss() }
        }
    }
}

/// Ask the player's own assistant to describe them, then paste its answer.
struct AIMemorySheet: View {
    @Environment(Game.self) private var game
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var answer = ""
    @State private var label = "ChatGPT memory"
    @State private var copied = false
    @State private var saving = false
    @State private var error: String?

    static let prompt = "Describe everything you know about me from our conversations and your memory, in plain prose. Cover my personality, my work, my interests and hobbies, my habits and routines, how I talk and write, what I value, and the goals I am working towards. Do not include contact details, addresses, or private details about other people."
    private static let labels = ["ChatGPT memory", "Claude memory", "Gemini memory", "Other assistant"]

    private var encodedPrompt: String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return Self.prompt.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(Self.prompt).font(.callout).fontDesign(.serif).foregroundStyle(.secondary)
                    Button(copied ? "Copied" : "Copy prompt", systemImage: copied ? "checkmark" : "doc.on.doc") { copy() }
                    Button("Open ChatGPT", systemImage: "arrow.up.right.square") { open("https://chatgpt.com/?q=" + encodedPrompt, as: "ChatGPT memory") }
                    Button("Open Claude", systemImage: "arrow.up.right.square") { open("https://claude.ai/new?q=" + encodedPrompt, as: "Claude memory") }
                    Button("Open Gemini", systemImage: "arrow.up.right.square") {
                        copy()
                        open("https://gemini.google.com/app", as: "Gemini memory")
                    }
                } header: {
                    Text("1. Ask your assistant")
                } footer: {
                    Text("Gemini opens without the prompt, so it is copied for you to paste.")
                }
                Section {
                    TextEditor(text: $answer).frame(minHeight: 180)
                    Picker("From", selection: $label) {
                        ForEach(Self.labels, id: \.self) { Text($0) }
                    }
                } header: {
                    Text("2. Paste what it said")
                } footer: {
                    Text("\(answer.count) characters. Emails, phone numbers and links are removed.")
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle("Your AI")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "…" : "Add") { add() }
                        .disabled(answer.trimmingCharacters(in: .whitespacesAndNewlines).count < 20 || saving)
                }
            }
        }
    }

    private func copy() {
        UIPasteboard.general.string = Self.prompt
        copied = true
    }

    private func open(_ url: String, as source: String) {
        label = source
        if let url = URL(string: url) { openURL(url) }
    }

    private func add() {
        saving = true
        Task {
            error = await game.addSource(PersonaSourceInput(kind: .ai_memory, label: label, text: String(answer.prefix(8000))))
            saving = false
            if error == nil { dismiss() }
        }
    }
}

struct AboutMeSheet: View {
    @Environment(Game.self) private var game
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextEditor(text: $text).frame(minHeight: 220)
                } header: {
                    Text("In your own words")
                } footer: {
                    Text("What you do, what you love, how you spend a free evening, what you'd fight for. \(text.count) characters.")
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle("About Me")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "…" : "Add") { add() }
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).count < 20 || saving)
                }
            }
        }
    }

    private func add() {
        saving = true
        Task {
            error = await game.addSource(PersonaSourceInput(kind: .about_me, label: "About me", text: String(text.prefix(8000))))
            saving = false
            if error == nil { dismiss() }
        }
    }
}

import AuthenticationServices
import SwiftUI

// MARK: - Design

/// The You tab's vocabulary: quiet charcoal surfaces on black with generous spacing, and one
/// luminous module (the avatar, or the setup card before there is one) as the focal point.
enum YouStyle {
    static let page: CGFloat = 20
    static let section: CGFloat = 44
    static let radius: CGFloat = 28
    static let violet = Color(red: 0.45, green: 0.38, blue: 0.98)
    static let coral = Color(red: 0.98, green: 0.45, blue: 0.38)
    static let teal = Color(red: 0.25, green: 0.78, blue: 0.72)
}

extension View {
    /// A content surface: faint fill and a hairline. Glass stays on controls.
    func youSurface(_ radius: CGFloat = YouStyle.radius) -> some View {
        background(Color.white.opacity(0.05), in: .rect(cornerRadius: radius))
            .overlay(RoundedRectangle(cornerRadius: radius).strokeBorder(.white.opacity(0.08)))
    }

    /// A single-line input in a soft capsule, with room for a trailing button.
    func capsuleField() -> some View {
        padding(.leading, 20)
            .padding(.trailing, 6)
            .frame(minHeight: 54)
            .background(Color.white.opacity(0.06), in: .capsule)
            .overlay(Capsule().strokeBorder(.white.opacity(0.08)))
    }

    func primaryButton() -> some View {
        buttonStyle(.glassProminent)
            .controlSize(.extraLarge)
            .foregroundStyle(.black)
            .fontWeight(.semibold)
    }
}

struct SectionHeader: View {
    var title: String
    var detail: String? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader)
            Spacer()
            if let detail { Text(detail).font(.subheadline.monospacedDigit()).foregroundStyle(.secondary) }
        }
    }
}

struct ErrorText: View {
    var text: String
    var body: some View {
        Label(text, systemImage: "exclamationmark.circle").font(.footnote).foregroundStyle(.red)
    }
}

// MARK: - You

/// Your own colonist: import what your apps know about you, build a character from it, drop it into
/// the colony, tell it what you want, and invite friends into the same world.
struct YouView: View {
    @Environment(Game.self) private var game
    @State private var importing: ImportKind?
    @State private var editing = false
    @State private var confirmForget = false

    enum ImportKind: String, Identifiable {
        case gmail, ai, aboutMe
        var id: String { rawValue }
    }

    private enum Anchor: Hashable { case sources, character }

    private var sources: [PersonaSourcePublic] { game.avatar?.sources ?? [] }
    private var profile: AvatarProfile? { game.avatar?.profile }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: YouStyle.section) {
                        if let me = game.myAvatar {
                            VStack(spacing: 16) {
                                AvatarHero(avatar: me)
                                if me.alive { DirectiveComposer(avatar: me) }
                            }
                        } else {
                            VStack(alignment: .leading, spacing: 28) {
                                IntroHero()
                                SetupChecklist(sources: sources.count, hasProfile: profile != nil) { step in
                                    withAnimation(.smooth) { proxy.scrollTo(step == 0 ? Anchor.sources : Anchor.character, anchor: .top) }
                                }
                            }
                        }
                        AboutYouSection(sources: sources, importing: $importing).id(Anchor.sources)
                        CharacterSection(editing: $editing).id(Anchor.character)
                        FriendsSection()
                        if game.avatar != nil { forgetFooter }
                    }
                    .padding(.horizontal, YouStyle.page)
                    .padding(.top, 4)
                    .padding(.bottom, 120)
                }
                .scrollDismissesKeyboard(.interactively)
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
                Button("Forget", role: .destructive) { Task { _ = await game.forgetAvatar() } }
            } message: { Text("Your sources and your character's profile are deleted.") }
        }
    }

    private var forgetFooter: some View {
        VStack(spacing: 6) {
            Button("Forget my sources and profile", role: .destructive) { confirmForget = true }
                .font(.subheadline.weight(.medium))
            Text("A character already in the colony stays there as an ordinary colonist.")
                .font(.caption).foregroundStyle(.tertiary)
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Before the avatar lands

struct IntroHero: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Moon().frame(width: 112, height: 112)
            Text("Put yourself on the \(Text("Moon").foregroundStyle(Color.amber))")
                .font(.title.bold())
                .fixedSize(horizontal: false, vertical: true)
            Text("Import what your apps already know about you. Living Moon builds a colonist who lives, works and chooses the way you would.")
                .font(.body)
                .foregroundStyle(.secondary)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// Three steps to a colonist, with the state of each drawn as a ring.
struct SetupChecklist: View {
    var sources: Int
    var hasProfile: Bool
    var jump: (Int) -> Void

    private var steps: [(title: String, detail: String, done: Bool)] {
        [
            ("Tell it about you", sources == 0 ? "Gmail, your AI, or your own words" : "\(sources) of 6 sources added", sources > 0),
            ("Build your character", hasProfile ? "Built. Review it below" : sources == 0 ? "One tap once a source is in" : "Ready when you are", hasProfile),
            ("Land in the colony", "They step off the next shuttle", false),
        ]
    }

    var body: some View {
        let done = steps.filter(\.done).count
        let current = steps.firstIndex { !$0.done } ?? steps.count
        VStack(spacing: 0) {
            HStack(spacing: 14) {
                StepMark(mark: .progress(Double(done) / Double(steps.count)))
                Text("Get started").font(.headline)
                Spacer()
                Text("\(done)/\(steps.count)").font(.headline.monospacedDigit()).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 18)
            Rectangle().fill(.white.opacity(0.08)).frame(height: 1)
            VStack(spacing: 0) {
                ForEach(Array(steps.enumerated()), id: \.offset) { i, step in
                    Button { jump(i) } label: {
                        HStack(spacing: 14) {
                            StepMark(mark: step.done ? .done : i == current ? .current : .waiting)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(step.title)
                                    .font(.body.weight(i == current ? .semibold : .regular))
                                    .foregroundStyle(i > current ? .secondary : .primary)
                                Text(step.detail).font(.footnote).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if i == current && i < 2 {
                                Image(systemName: "chevron.down").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.vertical, 13)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .disabled(i == 2)
                    .accessibilityValue(step.done ? "Done" : i == current ? "Next" : "Not yet")
                }
            }
            .padding(.vertical, 8)
        }
        .youSurface()
    }
}

/// Complete, current, waiting and partial progress share one circular silhouette.
struct StepMark: View {
    enum Mark { case done, current, waiting, progress(Double) }
    var mark: Mark

    var body: some View {
        ZStack {
            switch mark {
            case .done:
                Circle().fill(Color.amber)
                Image(systemName: "checkmark").font(.system(size: 11, weight: .heavy)).foregroundStyle(.black)
            case .current:
                Circle().strokeBorder(Color.amber, style: StrokeStyle(lineWidth: 2, dash: [3.2, 3.2]))
            case .waiting:
                Circle().strokeBorder(.white.opacity(0.22), lineWidth: 1.5)
            case let .progress(p):
                Circle().strokeBorder(.white.opacity(0.14), lineWidth: 2.5)
                Circle()
                    .trim(from: 0, to: max(0.02, p))
                    .stroke(Color.amber, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .padding(1.25)
            }
        }
        .frame(width: 22, height: 22)
        .accessibilityHidden(true)
    }
}

// MARK: - About you

struct AboutYouSection: View {
    @Environment(Game.self) private var game
    var sources: [PersonaSourcePublic]
    @Binding var importing: YouView.ImportKind?
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SectionHeader(title: "About you", detail: "\(sources.count) of 6")
            if sources.count < 6 {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ImportCard(title: "Gmail", detail: "Senders, subjects and labels, read on this phone", symbol: "envelope.fill", colors: [YouStyle.coral, .amber], note: GoogleAuth.isConfigured ? nil : "Needs setup") { importing = .gmail }
                        ImportCard(title: "Your AI", detail: "What ChatGPT, Claude or Gemini knows about you", symbol: "sparkles", colors: [YouStyle.violet, .earth]) { importing = .ai }
                        ImportCard(title: "In your words", detail: "A few honest lines about who you are", symbol: "pencil.line", colors: [YouStyle.teal, .earth]) { importing = .aboutMe }
                    }
                    .padding(.horizontal, YouStyle.page)
                }
                .padding(.horizontal, -YouStyle.page)
                .scrollClipDisabled()
            }
            if !sources.isEmpty {
                VStack(spacing: 8) {
                    ForEach(sources) { s in
                        SourceRow(source: s) {
                            Task { error = await game.removeSource(s.id) }
                        }
                    }
                }
            }
            if let error { ErrorText(text: error) }
            Text("Everything is summarized on this phone first. Emails, phone numbers and links are removed before anything is kept.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// An import option: an expressive banner over a plain reading area.
struct ImportCard: View {
    var title: String
    var detail: String
    var symbol: String
    var colors: [Color]
    var note: String? = nil
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 0) {
                ZStack(alignment: .topTrailing) {
                    ZStack {
                        LinearGradient(colors: colors.map { $0.opacity(0.85) }, startPoint: .topLeading, endPoint: .bottomTrailing)
                        RadialGradient(colors: [.white.opacity(0.35), .clear], center: .topLeading, startRadius: 0, endRadius: 140)
                        RadialGradient(colors: [.black.opacity(0.25), .clear], center: .bottomTrailing, startRadius: 0, endRadius: 160)
                    }
                    .frame(height: 92)
                    .overlay {
                        Image(systemName: symbol)
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundStyle(colors[0])
                            .frame(width: 46, height: 46)
                            .background(.white, in: .rect(cornerRadius: 14))
                            .shadow(color: .black.opacity(0.18), radius: 8, y: 4)
                    }
                    .clipShape(.rect(cornerRadius: 18))
                    if let note {
                        Text(note)
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(.black.opacity(0.45), in: .capsule)
                            .foregroundStyle(.white)
                            .padding(8)
                    }
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.headline).foregroundStyle(.primary)
                    Text(detail).font(.footnote).foregroundStyle(.secondary).lineLimit(2, reservesSpace: true)
                }
                .padding(.horizontal, 10)
                .padding(.top, 14)
                .padding(.bottom, 10)
            }
            .padding(6)
            .frame(width: 214, alignment: .leading)
            .youSurface(24)
            .contentShape(.rect(cornerRadius: 24))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint(detail)
    }
}

struct SourceRow: View {
    var source: PersonaSourcePublic
    var remove: () -> Void

    private var symbol: String {
        switch source.kind {
        case .gmail: "envelope.fill"
        case .ai_memory: "sparkles"
        case .about_me: "pencil.line"
        }
    }

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.amber)
                .frame(width: 40, height: 40)
                .background(Color.white.opacity(0.07), in: .circle)
            VStack(alignment: .leading, spacing: 3) {
                Text(source.label).font(.subheadline.weight(.semibold))
                Text(source.preview).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            Text("\(Int(source.chars))").font(.caption.monospacedDigit()).foregroundStyle(.tertiary)
            Button("Remove \(source.label)", systemImage: "xmark", action: remove)
                .labelStyle(.iconOnly)
                .font(.caption.weight(.bold))
                .foregroundStyle(.secondary)
                .frame(width: 30, height: 30)
                .background(Color.white.opacity(0.06), in: .circle)
                .buttonStyle(.plain)
        }
        .padding(.leading, 12)
        .padding(.trailing, 12)
        .padding(.vertical, 12)
        .youSurface(24)
        .contextMenu { Button("Remove", systemImage: "trash", role: .destructive, action: remove) }
    }
}

// MARK: - Your character

struct CharacterSection: View {
    @Environment(Game.self) private var game
    @Binding var editing: Bool
    @State private var name = ""
    @State private var building = false
    @State private var spawning = false
    @State private var error: String?

    var body: some View {
        let profile = game.avatar?.profile
        let hasSources = !(game.avatar?.sources.isEmpty ?? true)
        VStack(alignment: .leading, spacing: 18) {
            SectionHeader(title: "Your character", detail: profile == nil ? nil : builtByLabel(game.avatar?.profileSource))
            if let profile {
                ProfileCard(profile: profile)
                HStack(spacing: 10) {
                    Button { editing = true } label: {
                        Label("Edit", systemImage: "slider.horizontal.3").frame(maxWidth: .infinity)
                    }
                    Button { build() } label: {
                        Label(building ? "Rebuilding…" : "Rebuild", systemImage: "arrow.clockwise").frame(maxWidth: .infinity)
                    }
                    .disabled(building || !hasSources)
                }
                .buttonStyle(.glass)
                .controlSize(.large)
                if game.myAvatar == nil {
                    Button { spawn() } label: {
                        Label(spawning ? "Landing…" : "Drop into the colony", systemImage: "airplane.arrival").frame(maxWidth: .infinity)
                    }
                    .primaryButton()
                    .disabled(spawning)
                }
            } else {
                VStack(alignment: .leading, spacing: 18) {
                    Text(hasSources ? "Living Moon reads your sources and drafts a colonist: a job, a temperament, a way of talking. You can change anything before they land." : "Add something about yourself first. Your character is drafted from it.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                    TextField("Name in the colony (optional)", text: $name)
                        .textContentType(.name)
                        .capsuleField()
                    Button { build() } label: {
                        HStack {
                            if building { ProgressView().tint(.black) } else { Image(systemName: "wand.and.stars") }
                            Text(building ? "Building…" : "Build my character")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .primaryButton()
                    .disabled(building || !hasSources)
                }
                .padding(20)
                .youSurface()
            }
            if let error { ErrorText(text: error) }
        }
    }

    private func build() {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        building = true
        Task {
            error = await game.synthesize(name: trimmed.isEmpty ? nil : trimmed)
            building = false
        }
    }

    private func spawn() {
        spawning = true
        Task {
            error = await game.spawnAvatar()
            spawning = false
        }
    }
}

extension AvatarProfile {
    var ageLabel: String { ["young": "Young", "adult": "Adult", "elder": "Elder"][ageBand] ?? ageBand.capitalized }
}

func builtByLabel(_ source: String?) -> String {
    switch source {
    case "llm": "Built by AI"
    case "rules": "Built offline"
    case "player": "Edited by you"
    default: "Not built yet"
    }
}

func goalKindLabel(_ kind: String) -> String {
    kind == "custom" ? "Something else" : kind.replacingOccurrences(of: "_", with: " ").capitalized
}

struct ProfileCard: View {
    var profile: AvatarProfile

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(spacing: 16) {
                Avatar(spriteId: profile.spriteId, size: 68)
                VStack(alignment: .leading, spacing: 4) {
                    Text(profile.name).font(.title2.weight(.semibold))
                    Text("\(occupation(profile.occupation).label) · \(profile.ageLabel) · \(profile.homeLocationId.name)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            if !profile.summary.isEmpty || !profile.interests.isEmpty {
                VStack(alignment: .leading, spacing: 14) {
                    if !profile.summary.isEmpty {
                        Text(profile.summary).font(.body).lineSpacing(3).fixedSize(horizontal: false, vertical: true)
                    }
                    if !profile.interests.isEmpty {
                        FlowLayout(spacing: 8) {
                            ForEach(profile.interests, id: \.self) { Chip(text: $0) }
                        }
                    }
                }
            }
            TraitGrid(traits: profile.traits)
            VStack(alignment: .leading, spacing: 18) {
                if !profile.speechStyle.isEmpty { DetailRow(symbol: "quote.bubble", title: "Talks", lines: [profile.speechStyle]) }
                if !profile.habits.isEmpty { DetailRow(symbol: "repeat", title: "Habits", lines: profile.habits) }
                if !profile.goals.isEmpty { DetailRow(symbol: "scope", title: "Wants", lines: profile.goals.map(\.description)) }
                if !profile.backstory.isEmpty { DetailRow(symbol: "book.closed", title: "Backstory", lines: [profile.backstory]) }
            }
        }
        .padding(22)
        .youSurface()
    }
}

/// Temperament as six small metrics: a readable number, a short label and a thin bar.
struct TraitGrid: View {
    var traits: [String: Double]

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
            ForEach(TRAIT_KEYS, id: \.self) { key in
                let value = min(1, max(0, traits[key] ?? 0.5))
                VStack(alignment: .leading, spacing: 6) {
                    Text("\(Int((value * 100).rounded()))").font(.title3.weight(.semibold).monospacedDigit())
                    Text(key.capitalized).font(.caption).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.75)
                    Capsule()
                        .fill(.white.opacity(0.08))
                        .frame(height: 3)
                        .overlay(alignment: .leading) {
                            GeometryReader { g in Capsule().fill(Color.amber).frame(width: g.size.width * value) }
                        }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.white.opacity(0.04), in: .rect(cornerRadius: 16))
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(key.capitalized), \(Int((value * 100).rounded())) out of 100")
            }
        }
    }
}

struct DetailRow: View {
    var symbol: String
    var title: String
    var lines: [String]

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 14) {
            Image(systemName: symbol).font(.subheadline).foregroundStyle(Color.amber).frame(width: 20)
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase).tracking(0.6)
                ForEach(lines, id: \.self) { line in
                    Text(line).font(.subheadline).lineSpacing(2).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}

struct Chip: View {
    var text: String
    var onRemove: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 4) {
            Text(text).font(.footnote.weight(.medium))
            if let onRemove {
                Button("Remove \(text)", systemImage: "xmark", action: onRemove)
                    .labelStyle(.iconOnly).font(.caption2.weight(.bold)).buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 7)
        .background(Capsule().fill(.white.opacity(0.07)))
        .overlay(Capsule().strokeBorder(.white.opacity(0.1), lineWidth: 1))
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

/// The focal module: the avatar on a dark panel lit from its edges.
struct AvatarHero: View {
    @Environment(Game.self) private var game
    var avatar: AgentLite
    @State private var spawning = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 20) {
            HStack(spacing: 8) {
                Circle().fill(avatar.alive ? Color.green : Color.gray).frame(width: 7, height: 7)
                Text(avatar.alive ? "Live in the colony" : "No longer in the colony")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.white.opacity(0.75))
                Spacer()
                if avatar.alive {
                    Button { game.selectedID = avatar.id } label: {
                        Image(systemName: "info").font(.footnote.weight(.bold))
                    }
                    .buttonStyle(.glass)
                    .buttonBorderShape(.circle)
                    .accessibilityLabel("Inspect \(avatar.first)")
                }
            }
            Avatar(spriteId: avatar.spriteId, alive: avatar.alive, size: 108)
                .background {
                    Circle().fill(Color.amber.opacity(avatar.alive ? 0.4 : 0.1)).blur(radius: 30).scaleEffect(1.35)
                }
                .padding(.top, 4)
            VStack(spacing: 8) {
                Text(avatar.name).font(.title.bold()).multilineTextAlignment(.center)
                Text(avatar.alive ? avatar.activityLabel : "They died. Your profile is still here.")
                    .font(.body)
                    .foregroundStyle(.white.opacity(0.72))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if avatar.alive {
                HStack(spacing: 8) {
                    HeroPill(symbol: "face.smiling", text: avatar.mood.capitalized)
                    HeroPill(symbol: avatar.move == nil ? "mappin.and.ellipse" : "figure.walk", text: (avatar.move == nil ? "" : "To ") + avatar.locationId.name)
                }
                Button { game.follow(avatar.id) } label: {
                    Label("Follow \(avatar.first)", systemImage: "scope").frame(maxWidth: .infinity)
                }
                .primaryButton()
                .padding(.top, 4)
            } else {
                Button {
                    spawning = true
                    Task {
                        error = await game.spawnAvatar()
                        spawning = false
                    }
                } label: {
                    Label(spawning ? "Landing…" : "Send a new \(avatar.first)", systemImage: "airplane.arrival").frame(maxWidth: .infinity)
                }
                .primaryButton()
                .disabled(spawning)
                if let error { ErrorText(text: error) }
            }
        }
        .padding(22)
        .frame(maxWidth: .infinity)
        .background { LuminousPanel(lit: avatar.alive) }
        .clipShape(.rect(cornerRadius: 36))
        .overlay(RoundedRectangle(cornerRadius: 36).strokeBorder(.white.opacity(0.12)))
    }
}

/// Near-black body with warm and violet light near the edges and a quiet centre for text.
struct LuminousPanel: View {
    var lit = true

    var body: some View {
        ZStack {
            Color(white: 0.05)
            RadialGradient(colors: [Color.amber.opacity(lit ? 0.7 : 0.2), .clear], center: .bottom, startRadius: 0, endRadius: 300)
                .offset(y: 70)
            RadialGradient(colors: [YouStyle.violet.opacity(lit ? 0.55 : 0.2), .clear], center: .topLeading, startRadius: 0, endRadius: 300)
            RadialGradient(colors: [.black.opacity(0.6), .clear], center: .center, startRadius: 10, endRadius: 210)
        }
        .accessibilityHidden(true)
    }
}

struct HeroPill: View {
    var symbol: String
    var text: String

    var body: some View {
        Label(text, systemImage: symbol)
            .font(.footnote.weight(.medium))
            .lineLimit(1)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(.white.opacity(0.1), in: .capsule)
    }
}

/// "Tell Neel to…": a composer, a few starting ideas, and what you asked before.
struct DirectiveComposer: View {
    @Environment(Game.self) private var game
    var avatar: AgentLite
    @State private var order = ""
    @FocusState private var typing: Bool
    @State private var sending = false
    @State private var error: String?

    private static let ideas = ["Make friends with the medics", "Get rich trading water", "Run for the council", "Explore the colony"]
    private var trimmed: String { order.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var directives: [AvatarDirective] { game.avatar?.directives ?? [] }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .bottom, spacing: 8) {
                TextField("Tell \(avatar.first) to…", text: $order, axis: .vertical)
                    .lineLimit(1...4)
                    .focused($typing)
                    .submitLabel(.send)
                    .padding(.leading, 20)
                    .padding(.vertical, 16)
                    .onChange(of: order) {
                        if order.contains("\n") {
                            order = order.replacingOccurrences(of: "\n", with: "")
                            send()
                        } else if order.count > 140 {
                            order = String(order.prefix(140))
                        }
                    }
                Button(action: send) {
                    Group {
                        if sending { ProgressView().tint(.black) } else { Image(systemName: "arrow.up").font(.body.weight(.bold)) }
                    }
                    .foregroundStyle(.black)
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(trimmed.count >= 3 ? Color.amber : Color.white.opacity(0.18)))
                }
                .buttonStyle(.plain)
                .disabled(trimmed.count < 3 || sending)
                .padding(7)
                .accessibilityLabel("Send to \(avatar.first)")
            }
            .background(Color.white.opacity(0.06), in: .rect(cornerRadius: 27))
            .overlay(RoundedRectangle(cornerRadius: 27).strokeBorder(.white.opacity(typing ? 0.2 : 0.08)))

            if let error { ErrorText(text: error).padding(.horizontal, 6) }

            if directives.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Self.ideas, id: \.self) { idea in
                            Button(idea) { order = idea; typing = true }
                                .font(.footnote.weight(.medium))
                                .foregroundStyle(.secondary)
                                .padding(.horizontal, 14).padding(.vertical, 9)
                                .background(Color.white.opacity(0.05), in: .capsule)
                                .overlay(Capsule().strokeBorder(.white.opacity(0.08)))
                                .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, YouStyle.page)
                }
                .padding(.horizontal, -YouStyle.page)
                .scrollClipDisabled()
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    Text("You asked").font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase).tracking(0.6)
                        .padding(.bottom, 4)
                    ForEach(Array(directives.enumerated()), id: \.offset) { i, d in
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            Text(d.text).font(.subheadline).foregroundStyle(i == 0 ? .primary : .secondary)
                            Spacer(minLength: 8)
                            Text(Clock.time(d.tick)).font(.caption.monospacedDigit()).foregroundStyle(.tertiary)
                        }
                        .padding(.vertical, 11)
                        if i < directives.count - 1 { Rectangle().fill(.white.opacity(0.06)).frame(height: 1) }
                    }
                }
                .padding(.horizontal, 6)
            }
        }
    }

    private func send() {
        let text = trimmed
        guard text.count >= 3, !sending else { return }
        sending = true
        Task {
            error = await game.direct(text)
            sending = false
            if error == nil {
                order = ""
                typing = false
            }
        }
    }
}

// MARK: - Multiplayer

struct FriendsSection: View {
    @Environment(Game.self) private var game
    @State private var name = ""
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?
    @State private var confirmJoin = false

    var body: some View {
        let state = game.multiplayer
        let me = state?.players.first { $0.isYou }
        VStack(alignment: .leading, spacing: 18) {
            SectionHeader(title: "Play with friends", detail: state.map { "\($0.players.count) of \(Int($0.maxPlayers))" })
            Text("Friends with your code join this world with their own characters. Your characters meet, talk and trade on their own.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)

            if let state {
                if let invite = state.inviteCode {
                    InviteCodeCard(code: invite)
                } else if state.isHost {
                    Button { act { await game.invite() } } label: {
                        Label("Invite friends", systemImage: "person.2.badge.plus").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glass)
                    .controlSize(.extraLarge)
                    .disabled(busy)
                }
                VStack(spacing: 8) {
                    ForEach(state.players) { PlayerRow(player: $0) }
                }
            }

            VStack(spacing: 10) {
                HStack(spacing: 12) {
                    Text("Name").foregroundStyle(.secondary).frame(width: 46, alignment: .leading)
                    TextField("How friends see you", text: $name)
                        .textContentType(.nickname)
                        .submitLabel(.done)
                        .onSubmit(saveName)
                    if name.trimmingCharacters(in: .whitespaces).count >= 2 && name != me?.name {
                        Button("Save", action: saveName).buttonStyle(.glass)
                    }
                }
                .capsuleField()
                HStack(spacing: 12) {
                    Text("Code").foregroundStyle(.secondary).frame(width: 46, alignment: .leading)
                    TextField("Friend's code", text: $code)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .font(.body.monospaced())
                        .onChange(of: code) {
                            let clean = String(code.uppercased().filter { $0.isLetter || $0.isNumber }.prefix(6))
                            if clean != code { code = clean }
                        }
                    Button(busy ? "…" : "Join") { confirmJoin = true }
                        .buttonStyle(.glassProminent)
                        .foregroundStyle(.black)
                        .disabled(code.count != 6 || busy)
                }
                .capsuleField()
            }

            if let state, !state.isHost {
                Button("Leave and return to my colony", systemImage: "arrow.uturn.backward", role: .destructive) { act { await game.leave() } }
                    .font(.subheadline.weight(.medium))
            }
            if let error { ErrorText(text: error) }
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

/// The join code as a lit dot display, with a share action.
struct InviteCodeCard: View {
    var code: String

    var body: some View {
        VStack(spacing: 20) {
            Text("Colony code").font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase).tracking(1)
            DotMatrixText(text: code, dot: 4.5, gap: 2, color: .amber)
            ShareLink(item: "Join my Moon colony in Living Moon with code \(code)") {
                Label("Share code", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity)
            }
            .buttonStyle(.glass)
            .controlSize(.large)
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 24)
        .frame(maxWidth: .infinity)
        .background {
            ZStack {
                Color(white: 0.05)
                RadialGradient(colors: [Color.amber.opacity(0.22), .clear], center: .top, startRadius: 0, endRadius: 240)
            }
        }
        .clipShape(.rect(cornerRadius: YouStyle.radius))
        .overlay(RoundedRectangle(cornerRadius: YouStyle.radius).strokeBorder(.white.opacity(0.1)))
        .contextMenu {
            Button("Copy code", systemImage: "doc.on.doc") { UIPasteboard.general.string = code }
        }
    }
}

struct PlayerRow: View {
    @Environment(Game.self) private var game
    var player: PlayerPublic

    var body: some View {
        let colonist = game.colonist(player.avatarAgentId)
        Button {
            if let id = player.avatarAgentId { game.selectedID = id }
        } label: {
            HStack(spacing: 14) {
                Group {
                    if let colonist {
                        Avatar(spriteId: colonist.spriteId, alive: colonist.alive, size: 42)
                    } else {
                        Text(String(player.name.prefix(1)).uppercased())
                            .font(.headline)
                            .frame(width: 42, height: 42)
                            .background(Color.white.opacity(0.08), in: .circle)
                    }
                }
                .overlay(alignment: .bottomTrailing) {
                    Circle()
                        .fill(player.online ? Color.green : Color.gray)
                        .frame(width: 11, height: 11)
                        .overlay(Circle().stroke(.black, lineWidth: 2))
                }
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(player.name).font(.subheadline.weight(.semibold))
                        if player.isHost { Badge(text: "Host") }
                        if player.isYou { Badge(text: "You", tint: .earth) }
                    }
                    Text(player.avatarName ?? "No character yet").font(.footnote).foregroundStyle(.secondary)
                }
                Spacer()
                if player.avatarAgentId != nil {
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                }
            }
            .padding(12)
            .youSurface(24)
            .contentShape(.rect(cornerRadius: 24))
        }
        .buttonStyle(.plain)
        .allowsHitTesting(player.avatarAgentId != nil)
        .accessibilityLabel("\(player.name)\(player.isHost ? ", host" : "")\(player.isYou ? ", you" : ""), \(player.online ? "online" : "offline"), \(player.avatarName ?? "no character yet")")
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

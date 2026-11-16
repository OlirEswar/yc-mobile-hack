import SafariServices
import SwiftUI

extension Color {
    /// What the player did.
    static let amber = Color(red: 0.98, green: 0.72, blue: 0.36)
    /// What a colonist merely believes (earthlight).
    static let earth = Color(red: 0.47, green: 0.74, blue: 0.98)
}

extension WorldEventPublic {
    private static let beliefTypes: Set<String> = ["whisper", "rumor_started", "rumor_spread", "suspicion"]
    var believed: Bool { Self.beliefTypes.contains(eventType) }
    var byPlayer: Bool { category == .intervention }
    var tint: Color { believed ? .earth : byPlayer ? .amber : .secondary }
    var symbol: String {
        if believed { return "sparkles" }
        switch category {
        case .environment: return "moon.stars.fill"
        case .economy: return "creditcard.fill"
        case .social: return "bubble.left.and.bubble.right.fill"
        case .politics: return "building.columns.fill"
        case .health: return "heart.fill"
        case .action: return "wrench.and.screwdriver.fill"
        case .intervention: return "hand.point.up.left.fill"
        }
    }
    var categoryLabel: String { category == .intervention ? "Intervention" : category.rawValue.capitalized }
}

// MARK: - Colony (god mode)

struct ColonyView: View {
    @Environment(Game.self) private var game
    @State private var lastFood: (value: Double, trend: Int) = (0, 0)
    @State private var lastPrice: (value: Double, trend: Int) = (0, 0)

    var body: some View {
        @Bindable var game = game
        let world = game.world
        let food = (world?.stockpiles["depot"]?["food"] ?? 0).rounded()
        let price = world?.prices["food"] ?? 0

        NavigationStack {
            ZStack {
                MapView()
                VStack(spacing: 10) {
                    StatStrip(stats: [
                        .init(label: "People", symbol: "person.2.fill", value: "\(Int(world?.population.alive ?? 0))"),
                        .init(label: "Food", symbol: "fork.knife", value: "\(Int(food))", trend: lastFood.trend, goodWhenUp: true),
                        .init(label: "Food price", symbol: "creditcard.fill", value: "\(Int(price))cr", trend: lastPrice.trend, goodWhenUp: false),
                    ])
                    .frame(maxWidth: .infinity, alignment: .leading)
                    ForEach(world?.activeEffects ?? []) { effect in
                        let sols = max(1, Int(((effect.endTick - (world?.tick ?? 0)) / Clock.ticksPerDay).rounded(.up)))
                        Label(effect.label + " · " + (effect.type == "storm" ? "passing" : "\(sols) sol\(sols == 1 ? "" : "s") left"), systemImage: effect.type == "storm" ? "burst.fill" : "drop.degreesign.slash")
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .glassEffect(.regular.tint((effect.type == "storm" ? Color.red : .amber).opacity(0.35)))
                    }
                    if let note = game.backendNote {
                        Label(note, systemImage: "exclamationmark.triangle")
                            .font(.caption2).lineLimit(2)
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .glassEffect()
                    }
                    Spacer()
                    if let loc = game.selectedLocation { PlaceCard(location: loc) }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 10)
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        Picker("Speed", selection: Binding(get: { game.speed }, set: { game.setSpeed($0) })) {
                            Label("Pause", systemImage: "pause.fill").tag(0.0)
                            Label("1× speed", systemImage: "play.fill").tag(1.0)
                            Label("4× speed", systemImage: "forward.fill").tag(4.0)
                            Label("8× speed", systemImage: "forward.end.fill").tag(8.0)
                        }
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: game.speed == 0 ? "pause.fill" : game.speed == 1 ? "play.fill" : "forward.fill")
                                .font(.caption.weight(.bold))
                            Text(game.stamp)
                                .font(.subheadline.weight(.semibold).monospacedDigit())
                        }
                        .padding(.horizontal, 6)
                        .fixedSize()
                    }
                    .tint(.white)
                    .accessibilityLabel("\(game.stamp), simulation speed")
                }
                ToolbarItem(placement: .topBarTrailing) { PowerMenu() }
                ToolbarSpacer(.fixed, placement: .topBarTrailing)
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button(game.premium ? "Colony Pass" : "Become a Patron", systemImage: "moon.circle") { game.showPatron = true }
                        Toggle("Live backend", systemImage: "antenna.radiowaves.left.and.right", isOn: $game.useLive)
                    } label: {
                        Image(systemName: "ellipsis")
                    }
                    .tint(.white)
                }
            }
            .toolbarBackground(.hidden, for: .navigationBar)
        }
        .onChange(of: food) { old, new in lastFood = (new, new > old ? 1 : new < old ? -1 : lastFood.trend) }
        .onChange(of: price) { old, new in lastPrice = (new, new > old ? 1 : new < old ? -1 : lastPrice.trend) }
    }
}

/// The colony's vital numbers in one glass strip, with a trend arrow when a value moved.
struct StatStrip: View {
    struct Stat {
        var label: String
        var symbol: String
        var value: String
        var trend = 0
        var goodWhenUp = true
    }

    var stats: [Stat]

    var body: some View {
        HStack(spacing: 12) {
            ForEach(stats.indices, id: \.self) { i in
                if i > 0 { Capsule().fill(.white.opacity(0.18)).frame(width: 1, height: 14) }
                let stat = stats[i]
                HStack(spacing: 5) {
                    Image(systemName: stat.symbol).font(.caption2).foregroundStyle(.secondary)
                    Text(stat.value).font(.footnote.weight(.semibold).monospacedDigit())
                    if stat.trend != 0 {
                        Image(systemName: stat.trend > 0 ? "arrow.up" : "arrow.down")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle((stat.trend > 0) == stat.goodWhenUp ? Color.green : .red)
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(stat.label) \(stat.value)")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .glassEffect()
    }
}

struct PlaceCard: View {
    @Environment(Game.self) private var game
    var location: LocationId

    var body: some View {
        let damaged = (game.world?.damage[location.rawValue] ?? 0) > 0
        let stock = game.world?.stockpiles[location.rawValue] ?? [:]
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(location.name).font(.headline)
                if damaged { Text("Damaged").font(.caption.weight(.semibold)).foregroundStyle(.red) }
                Spacer()
                Button("Close", systemImage: "xmark") { game.selectedLocation = nil }.labelStyle(.iconOnly)
            }
            Text(location.def.description).font(.footnote).foregroundStyle(.secondary)
            if !stock.isEmpty {
                Text(stock.sorted { $0.key < $1.key }.map { "\($0.key.capitalized) \(Int($0.value))" }.joined(separator: " · "))
                    .font(.caption.monospacedDigit())
            }
        }
        .padding(14)
        .glassEffect(.regular, in: .rect(cornerRadius: 22))
    }
}

/// The god powers as a dropdown in the top bar. A power opened while a colonist is selected targets them.
struct PowerMenu: View {
    @Environment(Game.self) private var game

    var body: some View {
        Menu {
            Section("Change the world") {
                ForEach(Power.allCases.filter { !$0.believed }) { item($0) }
            }
            Section("Change what they believe") {
                ForEach(Power.allCases.filter(\.believed)) { item($0) }
            }
        } label: {
            HStack(spacing: 5) {
                Text("Powers")
                Image(systemName: "chevron.down").font(.caption2.weight(.bold))
            }
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 6)
            .fixedSize()
        }
        .tint(.amber)
        .accessibilityLabel("God powers")
    }

    private func item(_ power: Power) -> some View {
        Button(power.title, systemImage: power.symbol) {
            game.powerTarget = game.selectedID
            game.selectedID = nil
            game.activePower = power
        }
    }
}

// MARK: - Inspect

struct Avatar: View {
    var spriteId: String
    var alive = true
    var size: CGFloat = 44

    var body: some View {
        Group {
            if let image = Art.portrait(spriteId) {
                image.resizable().scaledToFit()
            } else {
                Circle().fill(.gray)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().stroke(.white.opacity(0.2), lineWidth: 1))
        .opacity(alive ? 1 : 0.4)
    }
}

struct InspectSheet: View {
    @Environment(Game.self) private var game
    var id: Id
    @State private var detail: AgentDetail?

    var body: some View {
        if let c = game.colonist(id) {
            List {
                Section {
                    HStack(spacing: 14) {
                        Avatar(spriteId: c.spriteId, alive: c.alive, size: 60)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(c.name).font(.title.weight(.regular)).fontDesign(.serif)
                            Text(occupation(c.occupation).label + (c.alive ? " · feels \(c.mood)" : " · died")).font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 4, leading: 4, bottom: 4, trailing: 4))
                    .listRowSeparator(.hidden)

                    if c.alive {
                        HStack(spacing: 8) {
                            Button { open(nil, following: c.id) } label: { Text("Follow").frame(maxWidth: .infinity) }
                                .buttonStyle(.glassProminent)
                            Button { open(.whisper, following: nil) } label: { Text("Whisper").frame(maxWidth: .infinity) }
                                .buttonStyle(.glass)
                            Button { open(.supplyDrop, following: nil) } label: { Text("Drop").frame(maxWidth: .infinity) }
                                .buttonStyle(.glass)
                        }
                        .controlSize(.large)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                    }
                }

                Section("Doing") {
                    Label(detail?.death.map { "Died: " + $0.cause } ?? c.activityLabel, systemImage: c.alive ? Mind.symbol(activity: c.activity) : "moon.zzz")
                }

                if c.alive {
                    Section("On their mind") {
                        ThoughtCard(agent: c, detail: detail, nowTick: game.world?.tick ?? 0)
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                    }
                }

                Section("Needs") {
                    HStack {
                        NeedGauge(label: "Hunger", value: c.needs.hunger, tint: c.needs.hunger > 55 ? .amber : .green)
                        Spacer()
                        NeedGauge(label: "Thirst", value: c.needs.thirst, tint: c.needs.thirst > 55 ? .amber : .green)
                        Spacer()
                        NeedGauge(label: "Rest", value: 100 - c.needs.fatigue, tint: c.needs.fatigue > 65 ? .amber : .green)
                        Spacer()
                        NeedGauge(label: "Health", value: c.health, tint: c.health < 40 ? .red : .green)
                    }
                    .padding(.vertical, 4)
                    ForEach((detail?.inventory ?? [:]).sorted { $0.key < $1.key }, id: \.key) { item in
                        LabeledContent(item.key.capitalized, value: item.key == "credits" ? "\(Int(item.value))cr" : "\(Int(item.value))")
                    }
                }

                if let goals = detail?.goals, !goals.isEmpty {
                    Section("Wants most") {
                        ForEach(goals.prefix(3)) { g in
                            Label(g.description, systemImage: g.source == "divine" ? "sparkles" : "scope")
                                .foregroundStyle(g.source == "divine" ? Color.earth : .primary)
                        }
                    }
                }

                if let beliefs = detail?.beliefs, !beliefs.isEmpty {
                    Section {
                        ForEach(beliefs) { b in
                            HStack {
                                if b.divine { Image(systemName: "sparkles").foregroundStyle(Color.earth) }
                                Text(b.text)
                                Spacer()
                                VStack(alignment: .trailing) {
                                    Text(b.confidence, format: .percent.precision(.fractionLength(0))).monospacedDigit()
                                    Text(b.sourceAgentName ?? sourceLabel(b.sourceType)).font(.caption2).foregroundStyle(b.divine ? Color.earth : .secondary)
                                }
                                .font(.subheadline)
                            }
                            .listRowBackground(b.divine ? Color.earth.opacity(0.14) : nil)
                        }
                    } header: { Text("Believes") } footer: { Text("Beliefs are what \(c.first) thinks, not what is true.") }
                }

                if let ties = detail?.relationships, !ties.isEmpty {
                    Section("Ties") {
                        ForEach(ties, id: \.toAgentId) { t in
                            LabeledContent {
                                Text(t.trust, format: .number.precision(.fractionLength(2)).sign(strategy: .always()))
                                    .monospacedDigit().foregroundStyle(t.trust < 0 ? .red : .primary)
                            } label: {
                                Text(t.toAgentName).foregroundStyle(t.toAgentAlive ? .primary : .secondary)
                                Text(t.kind.capitalized)
                            }
                        }
                    }
                }
            }
            .task(id: id) {
                for await d in game.detailStream(id) { detail = d }
            }
        }
    }

    private func sourceLabel(_ s: String) -> String {
        ["observed": "saw it", "told": "was told", "rumor": "rumor", "divine": "whisper", "inference": "worked it out"][s] ?? s
    }

    /// Close the inspector, then present the next surface once it has gone.
    private func open(_ power: Power?, following: Id?) {
        game.powerTarget = id
        game.selectedID = nil
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            if let power { game.activePower = power }
            if let following { game.follow(following) }
        }
    }
}

struct NeedGauge: View {
    var label: String
    var value: Double
    var tint: Color

    var body: some View {
        VStack(spacing: 4) {
            Gauge(value: min(100, max(0, value)), in: 0...100) { EmptyView() } currentValueLabel: { Text("\(Int(value))") }
                .gaugeStyle(.accessoryCircularCapacity)
                .tint(tint)
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label) \(Int(value)) of 100")
    }
}

// MARK: - Powers

struct PowerSheet: View {
    @Environment(Game.self) private var game
    @Environment(\.dismiss) private var dismiss
    var power: Power

    @State private var target: Id = ""
    @State private var about: Id = ""
    @State private var severity = 0.7
    @State private var sols = 3
    @State private var sites: Set<LocationId> = []
    @State private var resource = Resource.food
    @State private var amount = 12
    @State private var cause = "Accident"
    @State private var presetKey = ""
    @State private var idea = ""
    @State private var strength = 0.7
    @State private var seed: LocationId?
    @State private var confirmEnd = false
    @State private var sending = false
    @State private var error: String?
    @State private var commandId = UUID().uuidString

    private var presets: [IdeaPreset] { power == .rumor ? RUMOR_PRESETS : WHISPER_PRESETS }
    private var preset: IdeaPreset { presets.first { $0.key == presetKey } ?? presets[0] }
    private var name: String { game.colonist(target)?.first ?? "They" }
    private var living: [AgentLite] { game.agents.filter(\.alive).sorted { $0.name < $1.name } }

    var body: some View {
        NavigationStack {
            Form {
                switch power {
                case .drought:
                    Section {
                        LabeledContent("Severity") { Slider(value: $severity, in: 0.1...1) }
                        Stepper("Lasts \(sols) sols", value: $sols, in: 1...7)
                    } footer: {
                        Text("The ice wells fail, water runs short, then the hydroponics yield falls. What people do about it is up to them.")
                    }
                case .meteors:
                    Section {
                        ForEach(LocationId.allCases) { loc in
                            Button {
                                if sites.contains(loc) { sites.remove(loc) } else { sites.insert(loc) }
                            } label: {
                                HStack {
                                    Text(loc.name).foregroundStyle(.primary)
                                    if loc.def.exposed { Text("exposed").font(.caption).foregroundStyle(.secondary) }
                                    Spacer()
                                    if sites.contains(loc) { Image(systemName: "checkmark").foregroundStyle(.red) }
                                }
                            }
                        }
                    } header: { Text("Strikes") } footer: { Text("With none picked it hits every exposed site. Damage interrupts work there until someone repairs it.") }
                    Section { LabeledContent("Severity") { Slider(value: $severity, in: 0.1...1) } }
                case .supplyDrop:
                    Section { targetPicker("Who", selection: $target, from: living) }
                    Section {
                        Picker("Resource", selection: $resource) {
                            ForEach(Resource.allCases) { Text($0.label).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        Stepper("\(amount) \(resource.rawValue)", value: $amount, in: 1...(resource == .credits ? 500 : 60), step: resource == .credits ? 10 : 1)
                    } footer: { Text("Others may notice \(name)'s sudden luck.") }
                case .endLife:
                    Section { targetPicker("Who", selection: $target, from: living) }
                    Section {
                        Picker("Cause", selection: $cause) {
                            ForEach(["Accident", "Illness", "Suit failure"], id: \.self) { Text($0) }
                        }
                    } footer: { Text("Their plans stop, their goods pass to their household, and those who knew them will learn of it.") }
                case .whisper, .rumor:
                    Section { targetPicker(power == .rumor ? "About" : "Who", selection: $target, from: power == .rumor ? game.agents : living) }
                    Section(power == .rumor ? "The rumor" : "\(name) will come to suspect") {
                        Picker("Idea", selection: $presetKey) {
                            ForEach(presets) { Text($0.label).tag($0.key) }
                        }
                        TextField("An idea", text: $idea, axis: .vertical)
                            .font(.title3).fontDesign(.serif)
                            .lineLimit(2...4)
                    }
                    if power == .whisper {
                        if preset.needsSubject {
                            Section { targetPicker("About", selection: $about, from: game.agents.filter { $0.id != target }) }
                        }
                        Section {
                            LabeledContent("Strength") {
                                HStack {
                                    Slider(value: $strength)
                                    Text(strength, format: .number.precision(.fractionLength(2))).monospacedDigit().frame(width: 40)
                                }
                            }
                        } footer: {
                            Text("Only \(name) hears this. They may believe it, resist it, or tell someone. It doesn't have to be true.")
                        }
                    } else {
                        Section {
                            Picker("Starts at", selection: $seed) {
                                Text("The canteen").tag(LocationId?.none)
                                ForEach(LocationId.allCases) { Text($0.name).tag(Optional($0)) }
                            }
                        } footer: { Text("It spreads from person to person through talk, changing as it goes.") }
                    }
                case .arrival:
                    EmptyView()
                }
                if let error {
                    Section {
                        Text(error).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(power.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(sending ? "…" : power == .endLife ? "End" : power == .whisper ? "Whisper" : power == .rumor ? "Spread" : "Begin") {
                        if power == .endLife { confirmEnd = true } else { send() }
                    }
                    .tint(power == .endLife ? .red : power.believed ? .earth : .amber)
                    .disabled(intervention == nil || sending)
                }
            }
            .confirmationDialog("End \(game.colonist(target)?.name ?? "this life")?", isPresented: $confirmEnd, titleVisibility: .visible) {
                Button("End Life", role: .destructive) { send() }
            } message: { Text("This cannot be undone.") }
        }
        .onAppear {
            let picked = game.colonist(game.powerTarget)
            target = picked.flatMap { $0.alive || power == .rumor ? $0.id : nil } ?? living.first?.id ?? ""
            presetKey = presets[0].key
            fillIdea()
        }
        .onChange(of: presetKey) { fillIdea() }
        .onChange(of: about) { fillIdea() }
        .onChange(of: target) { if power == .rumor { fillIdea() } }
    }

    private func targetPicker(_ label: String, selection: Binding<Id>, from people: [AgentLite]) -> some View {
        Picker(label, selection: selection) {
            Text("Choose…").tag("")
            ForEach(people) { Text($0.name).tag($0.id) }
        }
        .pickerStyle(.navigationLink)
    }

    private func fillIdea() {
        let subject = power == .rumor ? game.colonist(target) : game.colonist(about)
        idea = preset.text.replacingOccurrences(of: "{name}", with: subject?.name ?? "someone")
    }

    private var intervention: Intervention? {
        let text = idea.trimmingCharacters(in: .whitespacesAndNewlines)
        switch power {
        case .drought: return .drought(severity: severity, durationDays: Double(sols))
        case .meteors: return .storm(severity: severity, locationIds: LocationId.allCases.filter { sites.contains($0) })
        case .supplyDrop: return target.isEmpty ? nil : .grant(agentId: target, resource: resource, amount: Double(amount))
        case .endLife: return target.isEmpty ? nil : .kill(agentId: target, cause: cause)
        case .whisper:
            guard !target.isEmpty, text.count >= 3, !(preset.needsSubject && about.isEmpty) else { return nil }
            return .whisper(agentId: target, presetKey: preset.key, text: text, strength: strength, aboutAgentId: preset.needsSubject ? about : nil)
        case .rumor:
            guard !target.isEmpty, text.count >= 3 else { return nil }
            return .rumor(aboutAgentId: target, presetKey: preset.key, text: text, seedLocationId: seed)
        case .arrival: return nil
        }
    }

    private func send() {
        guard let intervention else { return }
        sending = true
        Task {
            error = await game.apply(intervention, commandId: commandId)
            sending = false
            if error == nil { dismiss() }
        }
    }
}

struct CreatorSheet: View {
    @Environment(Game.self) private var game
    @Environment(\.dismiss) private var dismiss

    @State private var name = "Corin Vale"
    @State private var occupationId = "trader"
    @State private var variant = 0
    @State private var ageBand = "adult"
    @State private var home = LocationId.habitat_b
    @State private var ambition = 0.9
    @State private var empathy = 0.3
    @State private var sociability = 0.8
    @State private var credits = 40
    @State private var food = 6
    @State private var goal = "Dominate the water trade"
    @State private var sending = false
    @State private var error: String?
    @State private var commandId = UUID().uuidString

    private var spriteId: String { occupation(occupationId).archetype + "_\(variant)" }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: 10) {
                        Avatar(spriteId: spriteId, size: 84)
                        Text(name.isEmpty ? "Unnamed" : name).font(.title2).fontDesign(.serif)
                        Button("Next face", systemImage: "arrow.triangle.2.circlepath") { variant = (variant + 1) % SPRITE_VARIANTS }
                            .buttonStyle(.glass).controlSize(.small)
                    }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                }
                Section {
                    TextField("Name", text: $name)
                    Picker("Occupation", selection: $occupationId) {
                        ForEach(OCCUPATIONS) { Text($0.label).tag($0.id) }
                    }
                    Picker("Age", selection: $ageBand) {
                        Text("Young").tag("young"); Text("Adult").tag("adult"); Text("Elder").tag("elder")
                    }
                    .pickerStyle(.segmented)
                    Picker("Home", selection: $home) {
                        Text("Habitat Ring A").tag(LocationId.habitat_a); Text("Habitat Ring B").tag(LocationId.habitat_b)
                    }
                }
                Section("Temperament") {
                    LabeledContent("Ambition") { Slider(value: $ambition) }
                    LabeledContent("Empathy") { Slider(value: $empathy) }
                    LabeledContent("Sociability") { Slider(value: $sociability) }
                }
                Section("Arrives with") {
                    Stepper("\(credits) credits", value: $credits, in: 0...300, step: 5)
                    Stepper("\(food) food", value: $food, in: 0...20)
                }
                Section("First goal") {
                    TextField("Goal", text: $goal, axis: .vertical)
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle("New Arrival")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(sending ? "…" : "Land") { land() }
                        .disabled(name.trimmingCharacters(in: .whitespaces).count < 2 || sending)
                }
                ToolbarItem(placement: .bottomBar) {
                    Button("Randomize", systemImage: "dice") { randomize() }
                }
            }
        }
    }

    private func land() {
        var traits = Dictionary(uniqueKeysWithValues: TRAIT_KEYS.map { ($0, 0.5) })
        traits["ambition"] = ambition
        traits["empathy"] = empathy
        traits["sociability"] = sociability
        let trimmedGoal = goal.trimmingCharacters(in: .whitespacesAndNewlines)
        let p = NewCharacter(name: name.trimmingCharacters(in: .whitespaces), spriteId: spriteId, ageBand: ageBand, occupation: occupationId, home: home, traits: traits, values: Dictionary(uniqueKeysWithValues: VALUE_KEYS.map { ($0, 0.5) }), backstory: "Came up on the latest shuttle hoping to " + trimmedGoal.prefix(1).lowercased() + trimmedGoal.dropFirst() + ".", credits: Double(credits), food: Double(food), goal: trimmedGoal)
        sending = true
        Task {
            error = await game.apply(.createCharacter(p), commandId: commandId)
            sending = false
            if error == nil { dismiss() }
        }
    }

    private func randomize() {
        let names = ["Corin Vale", "Sefa Lund", "Idris Kwan", "Maren Holt", "Tovi Arce"]
        let goals = ["Dominate the water trade", "Map the far crater", "Open a second canteen", "Earn a seat on the council"]
        withAnimation {
            name = names.randomElement()!
            occupationId = OCCUPATIONS.randomElement()!.id
            variant = Int.random(in: 0..<SPRITE_VARIANTS)
            ambition = .random(in: 0...1); empathy = .random(in: 0...1); sociability = .random(in: 0...1)
            credits = Int.random(in: 0...16) * 5
            food = Int.random(in: 0...12)
            goal = goals.randomElement()!
        }
    }
}

// MARK: - Follow

struct FollowView: View {
    @Environment(Game.self) private var game
    @State private var detail: AgentDetail?
    /// Shows the colony through the colonist's eyes: who they know, what they believe, what they think.
    @State private var mind = false

    var body: some View {
        ZStack {
            MapView(focus: game.followingID, lens: mind ? detail : nil)
            if let c = game.colonist(game.followingID) {
                VStack {
                    HStack {
                        Button { game.unfollow() } label: {
                            Label("Colony", systemImage: "chevron.left").padding(.horizontal, 4)
                        }
                        .buttonStyle(.glass)
                        Button { withAnimation(.smooth) { mind.toggle() } } label: {
                            Image(systemName: mind ? "brain.head.profile.fill" : "brain.head.profile")
                                .symbolEffect(.bounce, value: mind)
                        }
                        .buttonStyle(.glass)
                        .tint(mind ? .earth : nil)
                        .foregroundStyle(mind ? Color.earth : .primary)
                        .accessibilityLabel(mind ? "Hide their mind" : "See through their eyes")
                        Spacer()
                        Picker("Speed", selection: Binding(get: { game.speed }, set: { game.setSpeed($0) })) {
                            Image(systemName: "pause.fill").tag(0.0)
                            Text("1×").tag(1.0)
                            Text("4×").tag(4.0)
                            Text("8×").tag(8.0)
                        }
                        .pickerStyle(.segmented)
                        .frame(width: 170)
                    }
                    if let toast = game.toast {
                        Text(toast.text).font(.subheadline).padding(12).glassEffect().onTapGesture { game.toast = nil }
                    }
                    Spacer()
                    if mind { mindHud(c).transition(.move(edge: .bottom).combined(with: .opacity)) } else { hud(c) }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
                .task(id: c.id) {
                    for await d in game.detailStream(c.id) { detail = d }
                }
            }
        }
    }

    private func header(_ c: AgentLite) -> some View {
        HStack(spacing: 12) {
            Avatar(spriteId: c.spriteId)
            VStack(alignment: .leading, spacing: 2) {
                Text(c.name).font(.title3).fontDesign(.serif)
                Text("\(occupation(c.occupation).label) · \(game.stamp)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 5) {
                MiniBar(label: "Hunger", value: c.needs.hunger, tint: .amber)
                MiniBar(label: "Rest", value: 100 - c.needs.fatigue, tint: .white)
                MiniBar(label: "Health", value: c.health, tint: .green)
            }
        }
    }

    /// The follow card in mind mode: what they are thinking, the plan it led to, and a key to the map.
    private func mindHud(_ c: AgentLite) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            header(c)
            ThoughtCard(agent: c, detail: detail, nowTick: game.world?.tick ?? 0)
            HStack(spacing: 14) {
                legend("Family", .amber)
                legend("Friend", .green)
                legend("Rival", .red)
                legend("Belief", .earth)
            }
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.secondary)
        }
        .padding(18)
        .glassEffect(.regular.tint(Color.earth.opacity(0.12)), in: .rect(cornerRadius: 30))
    }

    private func legend(_ label: String, _ tint: Color) -> some View {
        HStack(spacing: 5) {
            Circle().fill(tint).frame(width: 7, height: 7)
            Text(label)
        }
    }

    private func hud(_ c: AgentLite) -> some View {
        let nearby = game.agents.filter { $0.id != c.id && $0.alive && $0.move == nil && $0.locationId == c.locationId }.prefix(2).map(\.name)
        return VStack(alignment: .leading, spacing: 14) {
            header(c)
            Divider()
            Grid(alignment: .topLeading, horizontalSpacing: 14, verticalSpacing: 10) {
                GridRow { key("Doing"); Label(c.activityLabel, systemImage: Mind.symbol(activity: c.activity)) }
                if let thought = detail?.lastThought {
                    GridRow { key("Thinks"); Text("\u{201C}" + thought.intent + "\u{201D}").fontDesign(.serif).italic().foregroundStyle(Color.earth) }
                }
                if let goal = detail?.goals.first { GridRow { key("Wants"); Text(goal.description) } }
                if let beliefs = detail?.beliefs.prefix(2), !beliefs.isEmpty {
                    GridRow {
                        key("Believes")
                        VStack(alignment: .leading, spacing: 5) {
                            ForEach(beliefs) { b in
                                HStack(spacing: 6) {
                                    if b.divine { Image(systemName: "sparkles").font(.caption) }
                                    Text(b.text)
                                    Spacer(minLength: 4)
                                    Text("\(Int(b.confidence * 100))%").font(.caption2.monospacedDigit()).opacity(0.8)
                                }
                                .foregroundStyle(b.divine ? Color.earth : .primary)
                            }
                        }
                    }
                }
                GridRow { key("Nearby"); Text((nearby.isEmpty ? "" : nearby.joined(separator: ", ") + " · ") + (c.move != nil ? "on the way to " : "") + c.locationId.name) }
            }
            .font(.subheadline)
            HStack(spacing: 8) {
                Button { game.skipToNotable() } label: {
                    Label(game.skipping ? "Skipping…" : "Next Notable Event", systemImage: "forward.end.fill").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .disabled(game.skipping)
                Button("Ties") {
                    let id = c.id
                    game.unfollow()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { game.selectedID = id }
                }
                .buttonStyle(.glass)
            }
            .controlSize(.large)
        }
        .padding(18)
        .glassEffect(.regular, in: .rect(cornerRadius: 30))
    }

    private func key(_ s: String) -> some View {
        Text(s.uppercased()).font(.caption2.weight(.semibold)).foregroundStyle(.secondary).padding(.top, 3)
            .gridColumnAlignment(.leading)
    }
}

struct MiniBar: View {
    var label: String
    var value: Double
    var tint: Color

    var body: some View {
        HStack(spacing: 6) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            ProgressView(value: min(100, max(0, value)), total: 100).tint(tint).frame(width: 46)
        }
    }
}

// MARK: - People

struct PeopleView: View {
    @Environment(Game.self) private var game
    @State private var query = ""

    private var shown: [AgentLite] {
        let list = query.isEmpty ? game.agents : game.agents.filter { $0.name.localizedCaseInsensitiveContains(query) || occupation($0.occupation).label.localizedCaseInsensitiveContains(query) }
        return list.sorted { ($0.alive ? 0 : 1, $0.name) < ($1.alive ? 0 : 1, $1.name) }
    }

    var body: some View {
        NavigationStack {
            List(shown) { c in
                Button { game.selectedID = c.id } label: {
                    HStack(spacing: 12) {
                        Avatar(spriteId: c.spriteId, alive: c.alive, size: 40)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.name).foregroundStyle(c.alive ? .primary : .secondary)
                            Text(c.alive ? c.activityLabel : "Died").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer()
                        Text(occupation(c.occupation).label).font(.caption).foregroundStyle(.secondary)
                    }
                }
                .tint(.primary)
            }
            .navigationTitle("People")
            .searchable(text: $query, prompt: "Name or occupation")
        }
    }
}

// MARK: - Chronicle

struct ChronicleView: View {
    @Environment(Game.self) private var game
    @State private var chain = true
    @State private var links: [WorldEventPublic] = []
    @State private var loadError: String?

    /// The pinned event, else the newest event with a recorded cause, else the newest thing you did.
    private var focus: WorldEventPublic? {
        let feed = game.visibleEvents
        if let pinned = game.chronicleEventID, let e = feed.first(where: { $0.id == pinned }) { return e }
        return feed.last { $0.causationEventId != nil } ?? feed.last { $0.byPlayer } ?? feed.last
    }

    var body: some View {
        NavigationStack {
            List {
                if chain {
                    Section {
                        if let loadError { Text(loadError).foregroundStyle(.secondary) }
                        ForEach(Array(links.enumerated()), id: \.element.id) { i, e in
                            Button { game.goTo(e) } label: {
                                ChainRow(event: e, cause: links.first { $0.id == e.causationEventId }, last: i == links.count - 1)
                            }
                            .buttonStyle(.plain)
                            .listRowSeparator(.hidden)
                            .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                        }
                    } footer: {
                        Text("Every link is a recorded cause. Amber is something you did; blue is something someone only believes.")
                            .padding(.top, 8)
                    }
                } else {
                    ForEach(game.visibleEvents.reversed()) { e in
                        Button {
                            game.chronicleEventID = e.id
                            chain = true
                        } label: {
                            HStack(alignment: .top, spacing: 12) {
                                Image(systemName: e.symbol).foregroundStyle(e.tint).frame(width: 26)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(e.summary)
                                    Text("\(Clock.stamp(e.tick)) · \(e.categoryLabel)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                                }
                            }
                        }
                        .tint(.primary)
                    }
                }
            }
            .navigationTitle("Chronicle")
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Picker("View", selection: $chain) {
                        Text("Cause Chain").tag(true)
                        Text("World Feed").tag(false)
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 230)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .task(id: "\(focus?.id ?? "")/\(game.events.count)") {
                guard let id = focus?.id else { return links = [] }
                do {
                    links = try await game.chain(id)
                    loadError = nil
                } catch {
                    loadError = "Could not load the cause chain: \(error.localizedDescription)"
                }
            }
        }
    }
}

struct ChainRow: View {
    var event: WorldEventPublic
    var cause: WorldEventPublic?
    var last: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 0) {
                Image(systemName: event.byPlayer ? "circle.fill" : "circle")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(event.tint)
                    .padding(.top, 15)
                Rectangle().fill(.tertiary).frame(width: 2).opacity(last ? 0 : 1)
            }
            .frame(width: 14)
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(event.byPlayer ? "You · \(Clock.stamp(event.tick))" : Clock.stamp(event.tick)).monospacedDigit()
                    Spacer()
                    Text(event.categoryLabel)
                }
                .font(.caption.weight(.medium))
                .foregroundStyle(event.byPlayer ? event.tint : .secondary)
                Text(event.summary)
                if let cause {
                    Label("because " + cause.summary.prefix(1).lowercased() + cause.summary.dropFirst(), systemImage: "arrow.turn.down.right")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            .padding(.vertical, 12)
        }
    }
}

// MARK: - Patron

struct PatronSheet: View {
    @Environment(Game.self) private var game
    @Environment(\.dismiss) private var dismiss
    @State private var checkout: URL?
    @State private var opening = false
    private let perks: [(String, String, String)] = [
        ("brain.head.profile", "Deeper minds", "60 thoughts a sol. Free colonies get 20."),
        ("moon.haze.fill", "Time passes while you're away", "Up to 3 sols of offline catch-up."),
        ("person.3.fill", "A colony of 120", "The free cap is 60."),
        ("globe.europe.africa.fill", "Three colonies", "Run separate histories side by side."),
    ]

    var body: some View {
        NavigationStack {
            VStack(spacing: 22) {
                Circle()
                    .fill(RadialGradient(colors: [Color(white: 0.98), Color(white: 0.62), Color(white: 0.2)],
                                         center: .init(x: 0.32, y: 0.28), startRadius: 0, endRadius: 120))
                    .frame(width: 120, height: 120)
                    .shadow(color: .white.opacity(0.25), radius: 30)
                    .padding(.top, 8)
                VStack(spacing: 6) {
                    Text(game.premium ? "You tend more worlds" : "Tend more worlds").font(.largeTitle).fontDesign(.serif)
                    Text("Every power stays free.").font(.footnote).foregroundStyle(.secondary)
                }
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(perks, id: \.0) { perk in
                        Label {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(perk.1).font(.headline)
                                Text(perk.2).font(.subheadline).foregroundStyle(.secondary)
                            }
                        } icon: {
                            Image(systemName: perk.0).foregroundStyle(Color.amber).frame(width: 30)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Spacer()
                if game.premium {
                    Label("Colony Pass active", systemImage: "checkmark.seal.fill").foregroundStyle(Color.amber)
                } else {
                    Button {
                        opening = true
                        Task {
                            checkout = await game.checkout()
                            opening = false
                        }
                    } label: {
                        Text(opening ? "Opening checkout…" : "Unlock Colony Pass · $4.99").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glassProminent)
                    .controlSize(.large)
                    .disabled(opening)
                }
            }
            .padding(.horizontal, 24).padding(.bottom, 12)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close", systemImage: "xmark") { dismiss() } }
            }
            .sheet(item: $checkout) { url in SafariView(url: url).ignoresSafeArea() }
        }
    }
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}

struct SafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}

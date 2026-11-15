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
        let world = game.world
        let food = (world?.stockpiles["depot"]?["food"] ?? 0).rounded()
        let price = world?.prices["food"] ?? 0

        ZStack {
            MapView()
            VStack(spacing: 12) {
                header
                StatusCard(metrics: [
                    Metric(label: "Colonists", value: "\(Int(world?.population.alive ?? 0))"),
                    Metric(label: "Food stored", value: "\(Int(food))", trend: lastFood.trend, goodWhenUp: true),
                    Metric(label: "Food price", value: "\(Int(price))", unit: "cr", trend: lastPrice.trend, goodWhenUp: false),
                ])
                ForEach(world?.activeEffects ?? []) { effect in
                    let sols = max(1, Int(((effect.endTick - (world?.tick ?? 0)) / Clock.ticksPerDay).rounded(.up)))
                    EffectBanner(storm: effect.type == "storm", title: effect.label, detail: effect.type == "storm" ? "Passing" : "\(sols) sol\(sols == 1 ? "" : "s") left")
                }
                if let note = game.backendNote {
                    Label(note, systemImage: "exclamationmark.triangle")
                        .font(.footnote).foregroundStyle(.secondary)
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .glassEffect(.regular, in: .rect(cornerRadius: 18))
                }
                Spacer()
                if let toast = game.toast { ToastView(toast: toast) }
                if let loc = game.selectedLocation { PlaceCard(location: loc) }
                HStack(spacing: 10) {
                    TickerView()
                    Button { game.choosingPower = true } label: {
                        Label("Powers", systemImage: "wand.and.stars")
                            .font(.headline)
                            .padding(.horizontal, 6)
                            .frame(height: 40)
                    }
                    .buttonStyle(.glassProminent)
                    .accessibilityHint("Choose how to change the colony")
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
            .animation(.snappy(duration: 0.25), value: game.toast)
        }
        .sheet(isPresented: Binding(get: { game.choosingPower }, set: { game.choosingPower = $0 })) {
            PowerMenu { power in
                game.choosingPower = false
                game.powerTarget = nil
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { game.activePower = power }
            }
            .presentationDetents([.medium, .large])
        }
        .onChange(of: food) { old, new in lastFood = (new, new > old ? 1 : new < old ? -1 : lastFood.trend) }
        .onChange(of: price) { old, new in lastPrice = (new, new > old ? 1 : new < old ? -1 : lastPrice.trend) }
    }

    private var header: some View {
        @Bindable var game = game
        let parts = Clock.parts(game.world?.tick ?? 0)
        return HStack(alignment: .center, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "moon.fill").foregroundStyle(Color.amber)
                Text("Sol \(parts.sol)").foregroundStyle(.secondary)
                Text(Clock.time(game.world?.tick ?? 0)).monospacedDigit()
            }
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 16).frame(height: 44)
            .glassEffect()
            .accessibilityElement(children: .combine)
            Spacer()
            Menu {
                Picker("Speed", selection: Binding(get: { game.speed }, set: { game.setSpeed($0) })) {
                    Label("Pause", systemImage: "pause.fill").tag(0.0)
                    Label("Normal speed", systemImage: "play.fill").tag(1.0)
                    Label("4× speed", systemImage: "forward.fill").tag(4.0)
                    Label("8× speed", systemImage: "forward.end.fill").tag(8.0)
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: game.speed == 0 ? "pause.fill" : "play.fill")
                    Text(game.speed == 0 ? "Paused" : "\(Int(game.speed))×").monospacedDigit()
                }
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 14).frame(height: 44)
                .glassEffect(.regular.interactive())
            }
            .accessibilityLabel("Simulation speed")
            Menu {
                Button(game.premium ? "Colony Pass" : "Become a Patron", systemImage: "moon.circle") { game.showPatron = true }
                Toggle("Live backend", systemImage: "antenna.radiowaves.left.and.right", isOn: $game.useLive)
            } label: {
                Image(systemName: "ellipsis")
                    .font(.subheadline.weight(.semibold))
                    .frame(width: 44, height: 44)
                    .glassEffect(.regular.interactive())
            }
            .accessibilityLabel("More")
        }
        .padding(.leading, 4)
    }
}

struct Metric: Identifiable {
    var id: String { label }
    var label: String
    var value: String
    var unit: String? = nil
    var trend = 0
    var goodWhenUp = true
}

/// One quiet surface for the colony's headline numbers.
struct StatusCard: View {
    var metrics: [Metric]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(metrics.enumerated()), id: \.element.id) { i, m in
                if i > 0 { Rectangle().fill(.white.opacity(0.12)).frame(width: 1, height: 34) }
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline, spacing: 3) {
                        Text(m.value).font(.system(.title3, design: .rounded).weight(.semibold).monospacedDigit())
                        if let unit = m.unit { Text(unit).font(.caption).foregroundStyle(.secondary) }
                        if m.trend != 0 {
                            Image(systemName: m.trend > 0 ? "arrow.up.right" : "arrow.down.right")
                                .font(.caption.weight(.bold))
                                .foregroundStyle((m.trend > 0) == m.goodWhenUp ? Color.green : .red)
                                .accessibilityLabel(m.trend > 0 ? "rising" : "falling")
                        }
                    }
                    Text(m.label).font(.caption).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, i == 0 ? 0 : 14)
                .accessibilityElement(children: .combine)
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
        .glassEffect(.regular, in: .rect(cornerRadius: 22))
    }
}

struct EffectBanner: View {
    var storm: Bool
    var title: String
    var detail: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: storm ? "burst.fill" : "drop.degreesign.slash")
                .foregroundStyle(storm ? Color.red : .amber)
            Text(title).font(.subheadline.weight(.semibold))
            Spacer()
            Text(detail).font(.footnote).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 16).padding(.vertical, 11)
        .glassEffect(.regular.tint((storm ? Color.red : .amber).opacity(0.22)), in: .rect(cornerRadius: 18))
    }
}

struct PlaceCard: View {
    @Environment(Game.self) private var game
    var location: LocationId

    var body: some View {
        let damaged = (game.world?.damage[location.rawValue] ?? 0) > 0
        let stock = game.world?.stockpiles[location.rawValue] ?? [:]
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(location.name).font(.title3.weight(.semibold))
                if damaged {
                    Text("Damaged").font(.caption.weight(.semibold)).foregroundStyle(.red)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(.red.opacity(0.15), in: .capsule)
                }
                Spacer()
                Button("Close", systemImage: "xmark") { game.selectedLocation = nil }
                    .labelStyle(.iconOnly).buttonStyle(.glass).buttonBorderShape(.circle).controlSize(.small)
            }
            Text(location.def.description).font(.subheadline).foregroundStyle(.secondary)
            if !stock.isEmpty {
                HStack(spacing: 18) {
                    ForEach(stock.sorted { $0.key < $1.key }, id: \.key) { item in
                        VStack(alignment: .leading, spacing: 1) {
                            Text("\(Int(item.value))").font(.system(.headline, design: .rounded).monospacedDigit())
                            Text(item.key.capitalized).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .padding(18)
        .glassEffect(.regular, in: .rect(cornerRadius: 24))
    }
}

/// Every power, grouped by what it changes, each with a plain description.
struct PowerMenu: View {
    @Environment(\.dismiss) private var dismiss
    var choose: (Power) -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    ForEach(Power.Kind.allCases, id: \.self) { group in
                        VStack(alignment: .leading, spacing: 10) {
                            Text(group.title).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                                .padding(.leading, 4)
                            VStack(spacing: 0) {
                                let powers = Power.allCases.filter { $0.kind == group }
                                ForEach(Array(powers.enumerated()), id: \.element) { i, power in
                                    if i > 0 { Divider().padding(.leading, 70) }
                                    Button { choose(power) } label: { PowerRow(power: power) }
                                        .buttonStyle(.plain)
                                }
                            }
                            .background(Color.white.opacity(0.06), in: .rect(cornerRadius: 22))
                        }
                    }
                }
                .padding(.horizontal, 20).padding(.top, 4).padding(.bottom, 24)
            }
            .navigationTitle("Powers")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close", systemImage: "xmark") { dismiss() } }
            }
        }
    }
}

struct PowerRow: View {
    var power: Power

    var body: some View {
        HStack(spacing: 14) {
            PowerIcon(power: power, size: 42)
            VStack(alignment: .leading, spacing: 3) {
                Text(power.title).font(.body.weight(.semibold))
                Text(power.blurb).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 14).padding(.vertical, 14)
        .contentShape(Rectangle())
    }
}

struct PowerIcon: View {
    var power: Power
    var size: CGFloat = 42

    var body: some View {
        Image(systemName: power.symbol)
            .font(.system(size: size * 0.42, weight: .semibold))
            .foregroundStyle(power.tint)
            .frame(width: size, height: size)
            .background(power.tint.opacity(0.16), in: .rect(cornerRadius: size * 0.3))
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
                    HStack(spacing: 16) {
                        Avatar(spriteId: c.spriteId, alive: c.alive, size: 68)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(c.name).font(.title.weight(.regular)).fontDesign(.serif)
                            Text(occupation(c.occupation).label).font(.subheadline.weight(.medium))
                            Text(c.alive ? "Feels \(c.mood)" : "Died").font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 8, leading: 4, bottom: 12, trailing: 4))
                    .listRowSeparator(.hidden)

                    if c.alive {
                        HStack(spacing: 10) {
                            Button { open(nil, following: c.id) } label: {
                                Text("Follow").frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.glassProminent)
                            Button { open(.whisper, following: nil) } label: {
                                Text("Whisper").frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.glass)
                            .tint(.earth)
                            Button { open(.supplyDrop, following: nil) } label: {
                                Text("Give").frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.glass)
                        }
                        .font(.body.weight(.semibold))
                        .lineLimit(1)
                        .controlSize(.large)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 8, trailing: 0))
                    }
                }

                Section("Doing") {
                    Text(detail?.death.map { "Died: " + $0.cause } ?? c.activityLabel).font(.body.weight(.medium))
                    if let plan = detail?.plan { Text(plan.intent).foregroundStyle(.secondary) }
                }

                Section("Needs") {
                    Grid(horizontalSpacing: 20, verticalSpacing: 16) {
                        GridRow {
                            NeedMeter(label: "Hunger", value: c.needs.hunger, warn: c.needs.hunger > 55, lowIsGood: true)
                            NeedMeter(label: "Thirst", value: c.needs.thirst, warn: c.needs.thirst > 55, lowIsGood: true)
                        }
                        GridRow {
                            NeedMeter(label: "Rest", value: 100 - c.needs.fatigue, warn: c.needs.fatigue > 65)
                            NeedMeter(label: "Health", value: c.health, warn: c.health < 40, danger: c.health < 40)
                        }
                    }
                    .padding(.vertical, 8)
                    ForEach((detail?.inventory ?? [:]).sorted { $0.key < $1.key }, id: \.key) { item in
                        LabeledContent(item.key.capitalized, value: item.key == "credits" ? "\(Int(item.value)) cr" : "\(Int(item.value))")
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

                if let thought = detail?.lastThought {
                    Section("Why") {
                        Text(thought.intent)
                        Text("after " + thought.trigger).font(.caption).foregroundStyle(.secondary)
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

struct NeedMeter: View {
    var label: String
    var value: Double
    var warn = false
    var lowIsGood = false
    var danger = false

    var body: some View {
        let v = min(100, max(0, value))
        let tint: Color = danger ? .red : warn ? .amber : .green
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(label).font(.subheadline).foregroundStyle(.secondary)
                Spacer()
                Text("\(Int(v))").font(.system(.headline, design: .rounded).monospacedDigit())
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(0.1))
                    Capsule().fill(tint).frame(width: max(6, geo.size.width * v / 100))
                }
            }
            .frame(height: 6)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label) \(Int(v)) of 100\(warn ? ", needs attention" : "")")
    }
}

// MARK: - Powers

extension Power {
    enum Kind: CaseIterable {
        case world, minds, people
        var title: String {
            switch self {
            case .world: "Change the world"
            case .minds: "Change minds"
            case .people: "Change who lives here"
            }
        }
    }
    var kind: Kind {
        switch self {
        case .drought, .meteors, .supplyDrop: .world
        case .whisper, .rumor: .minds
        case .arrival, .endLife: .people
        }
    }
    var blurb: String {
        switch self {
        case .drought: "The ice wells fail for a few sols. Water and crops run short."
        case .meteors: "Debris strikes exposed sites and stops work until it's repaired."
        case .supplyDrop: "Give one colonist food, water or credits out of nowhere."
        case .whisper: "Plant an idea in one person's mind. It doesn't have to be true."
        case .rumor: "Start talk about someone and watch it spread and change."
        case .arrival: "Design a new colonist and land them on the next shuttle."
        case .endLife: "A colonist dies. Their household and friends will feel it."
        }
    }
    var tint: Color {
        switch kind {
        case .world: .amber
        case .minds: .earth
        case .people: self == .endLife ? .red : .amber
        }
    }
}

/// The one filled action at the foot of a sheet.
struct PrimaryAction: View {
    var title: String
    var tint: Color
    var disabled = false
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title).font(.headline).lineLimit(1).frame(maxWidth: .infinity).frame(height: 30)
        }
        .buttonStyle(.glassProminent)
        .tint(tint)
        .controlSize(.large)
        .disabled(disabled)
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .padding(.bottom, 4)
    }
}

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
                Section {
                    HStack(spacing: 14) {
                        PowerIcon(power: power, size: 50)
                        Text(power.blurb).font(.subheadline).foregroundStyle(.secondary)
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 4, leading: 4, bottom: 4, trailing: 4))
                }
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
            }
            .safeAreaInset(edge: .bottom) {
                PrimaryAction(title: sending ? "Working…" : actionTitle, tint: power == .endLife ? .red : power.tint, disabled: intervention == nil || sending) {
                    if power == .endLife { confirmEnd = true } else { send() }
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

    private var actionTitle: String {
        switch power {
        case .drought: "Start the drought"
        case .meteors: "Call the storm"
        case .supplyDrop: "Send \(amount) \(resource.rawValue) to \(name)"
        case .endLife: "End \(name)'s life"
        case .whisper: "Whisper to \(name)"
        case .rumor: "Spread the rumor"
        case .arrival: "Land"
        }
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
                    LabeledContent("Name") { TextField("Name", text: $name).multilineTextAlignment(.trailing) }
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
                ToolbarItem(placement: .primaryAction) {
                    Button("Randomize", systemImage: "dice") { randomize() }
                }
            }
            .safeAreaInset(edge: .bottom) {
                PrimaryAction(title: sending ? "Landing…" : "Land \(name.split(separator: " ").first.map(String.init) ?? "them")", tint: .amber, disabled: name.trimmingCharacters(in: .whitespaces).count < 2 || sending) { land() }
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

    var body: some View {
        ZStack {
            MapView(focus: game.followingID)
            if let c = game.colonist(game.followingID) {
                VStack {
                    HStack {
                        Button { game.unfollow() } label: {
                            Label("Colony", systemImage: "chevron.left").padding(.horizontal, 4)
                        }
                        .buttonStyle(.glass)
                        Spacer()
                        Text(Clock.time(game.world?.tick ?? 0))
                            .font(.subheadline.weight(.semibold).monospacedDigit())
                            .padding(.horizontal, 12).frame(height: 36)
                            .glassEffect()
                            .accessibilityLabel(game.stamp)
                        Spacer()
                        Picker("Speed", selection: Binding(get: { game.speed }, set: { game.setSpeed($0) })) {
                            Image(systemName: "pause.fill").tag(0.0)
                            Text("1×").tag(1.0)
                            Text("4×").tag(4.0)
                            Text("8×").tag(8.0)
                        }
                        .pickerStyle(.segmented)
                        .frame(width: 172)
                    }
                    if let toast = game.toast { ToastView(toast: toast).padding(.top, 8) }
                    Spacer()
                    hud(c)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
                .task(id: c.id) {
                    for await d in game.detailStream(c.id) { detail = d }
                }
            }
        }
    }

    private func hud(_ c: AgentLite) -> some View {
        let nearby = game.agents.filter { $0.id != c.id && $0.alive && $0.move == nil && $0.locationId == c.locationId }.prefix(2).map(\.name)
        return VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Avatar(spriteId: c.spriteId)
                VStack(alignment: .leading, spacing: 2) {
                    Text(c.name).font(.title3).fontDesign(.serif)
                    Text(occupation(c.occupation).label).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 5) {
                    MiniBar(label: "Hunger", value: c.needs.hunger, tint: .amber)
                    MiniBar(label: "Rest", value: 100 - c.needs.fatigue, tint: .white)
                    MiniBar(label: "Health", value: c.health, tint: .green)
                }
            }
            Divider()
            Grid(alignment: .topLeading, horizontalSpacing: 14, verticalSpacing: 10) {
                GridRow { key("Doing"); Text(c.activityLabel) }
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
                Button("Profile") {
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

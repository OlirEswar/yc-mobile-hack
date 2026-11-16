import Foundation
import Observation
import SwiftUI

/// The god powers, in the mock's tray order, plus the rumor the backend also offers.
enum Power: String, CaseIterable, Identifiable {
    case drought, meteors, supplyDrop, arrival, endLife, whisper, rumor
    var id: String { rawValue }
    var title: String {
        switch self {
        case .drought: "Drought"
        case .meteors: "Meteor Storm"
        case .supplyDrop: "Supply Drop"
        case .arrival: "New Arrival"
        case .endLife: "End a Life"
        case .whisper: "Whisper"
        case .rumor: "Rumor"
        }
    }
    var short: String {
        switch self {
        case .drought: "Drought"
        case .meteors: "Meteors"
        case .supplyDrop: "Drop"
        case .arrival: "Arrival"
        case .endLife: "End"
        case .whisper: "Whisper"
        case .rumor: "Rumor"
        }
    }
    var symbol: String {
        switch self {
        case .drought: "drop.degreesign.slash"
        case .meteors: "burst.fill"
        case .supplyDrop: "shippingbox.fill"
        case .arrival: "person.badge.plus"
        case .endLife: "hourglass"
        case .whisper: "sparkles"
        case .rumor: "bubble.left.and.text.bubble.right.fill"
        }
    }
    /// Whispers and rumors change what people believe; the rest change the world.
    var believed: Bool { self == .whisper || self == .rumor }
}

/// A high-tension storyline beat, shown as a banner over the wide view.
struct StoryBanner: Identifiable, Equatable {
    let id: String
    var storylineId: Id
    var title: String
    var text: String
    var tension: Double
}

struct Toast: Identifiable, Equatable {
    enum Kind { case ok, info, error }
    let id = UUID()
    var kind: Kind
    var text: String
}

/// Everything the screens read and every action they take. Owns the WorldSource.
@Observable
@MainActor
final class Game: SourceSink {
    enum Phase: Equatable { case loading, ready, failed(String) }
    enum Tab: Hashable { case colony, people, stories, chronicle }

    static let convexURL = "https://utmost-hyena-958.convex.cloud"
    private static let liveKey = "livingMoon.useLiveBackend"
    private static let deviceKey = "livingMoon.deviceId"

    var phase: Phase = .loading
    var world: WorldPublic?
    private(set) var agents: [AgentLite] = []
    private var index: [Id: Int] = [:]
    private(set) var events: [WorldEventPublic] = []
    var premium = false
    /// The live deployment by default; the offline mock stays behind the menu toggle.
    var useLive = UserDefaults.standard.object(forKey: liveKey) as? Bool ?? true {
        didSet {
            UserDefaults.standard.set(useLive, forKey: Self.liveKey)
            Task { await boot() }
        }
    }

    var tab: Tab = .colony
    var selectedID: Id?
    var selectedLocation: LocationId?
    var followingID: Id?
    var activePower: Power?
    /// Who the next power targets: the colonist selected when the power was opened.
    var powerTarget: Id?
    var showPatron = false
    /// The timeskip sheet: choose a span, watch the years pass, read the chronicle.
    var showTimeskip = false
    var chronicleEventID: Id?
    var toast: Toast?
    var backendNote: String?

    /// The world's introduction, when the backend has one.
    private(set) var intro: StoryIntro?
    var showIntro = false
    /// Live and recent storylines, highest tension first.
    private(set) var storylines: [StorylinePublic] = []
    var banner: StoryBanner?
    var storylineID: Id?
    /// Index of the current tutorial card; past the end once finished or skipped.
    private(set) var tutorialIndex = 0

    /// When the current world tick arrived, so the map can interpolate between ticks.
    @ObservationIgnored private var tickArrivedAt = Date()
    @ObservationIgnored private var shownTick = 0.0
    @ObservationIgnored private var shownAt = Date()
    /// Measured ticks per real second, so movement runs at the pace ticks actually arrive.
    @ObservationIgnored private var tickRate = 1 / Clock.secondsPerTick
    /// When each colonist was first seen dead, so the map can show the body before the grave.
    @ObservationIgnored private(set) var diedAt: [Id: Date] = [:]
    @ObservationIgnored private var source: WorldSource?
    @ObservationIgnored private var heartbeatTimer: Timer?
    @ObservationIgnored private var toastTask: Task<Void, Never>?
    @ObservationIgnored private var bannerTask: Task<Void, Never>?
    @ObservationIgnored private var lastBannerAt = Date.distantPast
    @ObservationIgnored private var storylinesCancel: (() -> Void)?
    /// Last beat tick seen per storyline, so only new beats raise a banner.
    @ObservationIgnored private var beatTicks: [Id: Double]?

    var isLive: Bool { source?.isLive ?? false }

    // MARK: Lifecycle

    func boot() async {
        phase = .loading
        source?.stop()
        world = nil
        agents = []
        index = [:]
        events = []
        backendNote = nil
        selectedID = nil
        followingID = nil
        intro = nil
        showIntro = false
        storylines = []
        banner = nil
        beatTicks = nil
        storylinesCancel?()
        let next: WorldSource = useLive ? ConvexSource(url: Self.convexURL) : MockSource()
        source = next
        do {
            try await next.start(deviceId: deviceId(), sink: self)
            heartbeatTimer?.invalidate()
            heartbeatTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
                _ = MainActor.assumeIsolated { Task { await self?.source?.heartbeat() } }
            }
            phase = .ready
            storylinesCancel = next.watchStorylines(agentId: nil) { [weak self] in self?.received(storylines: $0) }
            await loadIntro(from: next)
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    private func deviceId() -> String {
        if let id = UserDefaults.standard.string(forKey: Self.deviceKey) { return id }
        let id = UUID().uuidString.lowercased()
        UserDefaults.standard.set(id, forKey: Self.deviceKey)
        return id
    }

    // MARK: Story

    private func worldKey(_ name: String) -> String { "livingMoon.\(name).\(source?.worldId ?? "none")" }

    private func loadIntro(from source: WorldSource) async {
        guard let loaded = await source.intro(), source === self.source else { return }
        intro = loaded
        tutorialIndex = UserDefaults.standard.integer(forKey: worldKey("tutorial"))
        if !UserDefaults.standard.bool(forKey: worldKey("introSeen")) { showIntro = true }
    }

    /// Closes the introduction. With begin set, starts following the starter character.
    func finishIntro(begin: Bool) {
        UserDefaults.standard.set(true, forKey: worldKey("introSeen"))
        showIntro = false
        guard begin, let starter = intro?.starterAgentId else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.follow(starter) }
    }

    var tutorialStep: TutorialStep? {
        guard let steps = intro?.tutorial, steps.indices.contains(tutorialIndex), !showIntro else { return nil }
        return steps[tutorialIndex]
    }

    /// Advances the tutorial when the player does what the current card asks.
    func didAct(_ action: TutorialAction) {
        guard let step = tutorialStep, step.action == action else { return }
        advanceTutorial()
    }

    func advanceTutorial() {
        withAnimation(.smooth) {
            tutorialIndex += 1
            if let step = tutorialStep, step.action == .follow_starter, let id = followingID, id == (step.agentId ?? intro?.starterAgentId) { tutorialIndex += 1 }
        }
        UserDefaults.standard.set(tutorialIndex, forKey: worldKey("tutorial"))
    }

    func skipTutorial() {
        withAnimation(.smooth) { tutorialIndex = intro?.tutorial.count ?? 0 }
        UserDefaults.standard.set(tutorialIndex, forKey: worldKey("tutorial"))
    }

    func storyline(_ id: Id?) -> StorylinePublic? { id.flatMap { id in storylines.first { $0.id == id } } }

    private func received(storylines next: [StorylinePublic]) {
        storylines = next
        let ticks = Dictionary(next.map { ($0.id, $0.lastBeatTick) }, uniquingKeysWith: max)
        defer { beatTicks = ticks }
        guard let seen = beatTicks, followingID == nil, Date().timeIntervalSince(lastBannerAt) > 90 else { return }
        let fresh = next.filter { $0.live && $0.tension >= 0.75 && $0.lastBeatTick > (seen[$0.id] ?? -1) }
        guard let top = fresh.max(by: { $0.tension < $1.tension }), let beat = top.beats.last else { return }
        lastBannerAt = Date()
        bannerTask?.cancel()
        withAnimation(.smooth) { banner = StoryBanner(id: top.id + "/\(beat.tick)", storylineId: top.id, title: top.title, text: beat.text, tension: top.tension) }
        bannerTask = Task {
            try? await Task.sleep(for: .seconds(7))
            if !Task.isCancelled { withAnimation(.smooth) { banner = nil } }
        }
    }

    func openStoryline(_ id: Id) {
        banner = nil
        storylineID = id
        tab = .stories
    }

    // MARK: SourceSink

    func received(world next: WorldPublic) {
        if let old = world?.tick, next.tick > old {
            let elapsed = Date().timeIntervalSince(tickArrivedAt)
            if elapsed > 0.2, elapsed < 12 { tickRate = tickRate * 0.6 + (next.tick - old) / elapsed * 0.4 }
        }
        if next.tick != world?.tick { tickArrivedAt = Date() }
        world = next
    }

    func received(agents next: [AgentLite]) {
        if !agents.isEmpty {
            for a in next where !a.alive && colonist(a.id)?.alive == true { diedAt[a.id] = Date() }
        }
        agents = next
        index = Dictionary(uniqueKeysWithValues: next.enumerated().map { ($1.id, $0) })
    }

    func received(events next: [WorldEventPublic]) { events = next }
    func received(premium next: Bool) { premium = next }
    func sourceFailed(_ message: String) {
        if backendNote == nil { backendNote = message }
    }

    // MARK: Lookup

    func colonist(_ id: Id?) -> AgentLite? { id.flatMap { index[$0] }.map { agents[$0] } }

    /// The world tick with the fraction elapsed since it arrived, for smooth movement.
    /// Trails the latest tick at the pace ticks arrive, so nobody jumps when one lands.
    func displayTick(at date: Date) -> Double {
        guard let world else { return 0 }
        let dt = min(0.25, max(0, date.timeIntervalSince(shownAt)))
        shownAt = date
        let behind = world.tick - shownTick
        if behind > 6 || behind < 0 { shownTick = world.tick - min(1, max(0, behind)) }
        shownTick = min(world.tick, shownTick + dt * tickRate * (world.tick - shownTick > 1.3 ? 1.6 : 1))
        return shownTick
    }

    var stamp: String { world.map { Clock.stamp($0.tick) } ?? "" }
    var speed: Double { world.map { $0.running ? $0.speed : 0 } ?? 0 }

    /// The latest news the player may see: public events and their own interventions.
    var visibleEvents: [WorldEventPublic] { events.filter { $0.visibility != "private" || $0.category == .intervention } }

    func detailStream(_ id: Id) -> AsyncStream<AgentDetail?> {
        AsyncStream { continuation in
            guard let source else { return continuation.finish() }
            let cancel = source.watchDetail(id) { continuation.yield($0) }
            continuation.onTermination = { _ in Task { @MainActor in cancel() } }
        }
    }

    func chain(_ eventId: Id) async throws -> [WorldEventPublic] {
        guard let source else { return [] }
        return try await source.chain(eventId)
    }

    func focusStream(_ id: Id) -> AsyncStream<FocusState?> {
        AsyncStream { continuation in
            guard let source else { return continuation.finish() }
            let cancel = source.watchFocus(id) { continuation.yield($0) }
            continuation.onTermination = { _ in Task { @MainActor in cancel() } }
        }
    }

    func conversationStream(_ id: Id) -> AsyncStream<[AskTurn]> {
        AsyncStream { continuation in
            guard let source else { return continuation.finish() }
            let cancel = source.watchConversation(id) { continuation.yield($0) }
            continuation.onTermination = { _ in Task { @MainActor in cancel() } }
        }
    }

    /// Asks the colonist a question. Returns the answer, or throws a message to show.
    func plant(_ id: Id, _ text: String) async throws {
        guard let source else { throw SourceError.unsupported("Not connected.") }
        let result: PlantResult
        do {
            result = try await source.plant(id, text: text)
        } catch {
            if let message = await apply(.whisper(agentId: id, presetKey: "custom", text: text, strength: 0.7, aboutAgentId: nil), commandId: UUID().uuidString) {
                throw SourceError.unsupported(message)
            }
            return
        }
        guard result.ok else { throw SourceError.unsupported(result.message ?? "The thought doesn't take.") }
        didAct(.use_power)
    }

    func ask(_ id: Id, _ question: String) async throws -> AskTurn {
        guard let source else { throw SourceError.unsupported("Not connected.") }
        let result: AskResult
        do { result = try await source.ask(id, question: question) } catch { throw SourceError.unsupported(unsupported(error, "ask them")) }
        switch result {
        case let .answered(turn):
            didAct(.ask_question)
            return turn
        case let .refused(_, message):
            throw SourceError.unsupported(message)
        }
    }

    func society() async -> SocietyOverview? { await source?.society() }

    /// Starts a timeskip. Returns the skip id, or a message for the sheet.
    func startTimeskip(_ span: TimeskipSpan) async -> (id: Id?, message: String?) {
        guard let source else { return (nil, "Not connected.") }
        do {
            let r = try await source.startTimeskip(span: span)
            return r.ok ? (r.timeskipId, nil) : (nil, r.message ?? "The years would not turn.")
        } catch {
            return (nil, unsupported(error, "skip ahead"))
        }
    }

    func watchTimeskip(_ id: Id?, _ onValue: @escaping (TimeskipPublic?) -> Void) -> () -> Void {
        source?.watchTimeskip(id, onValue) ?? {}
    }

    /// True while the backend fast-forwards through the followed colonist's routine.
    var warping: Bool { followingID != nil && world?.focusWarp == true }

    // MARK: Actions

    func show(_ kind: Toast.Kind, _ text: String) {
        toastTask?.cancel()
        withAnimation { toast = Toast(kind: kind, text: text) }
        toastTask = Task {
            try? await Task.sleep(for: .seconds(kind == .error ? 6 : 3.6))
            if !Task.isCancelled { withAnimation { toast = nil } }
        }
    }

    @ObservationIgnored private var resumeSpeed = 1.0

    func togglePause() {
        if speed > 0 {
            resumeSpeed = speed
            setSpeed(0)
        } else {
            setSpeed(resumeSpeed)
        }
    }

    func setSpeed(_ speed: Double) {
        Task {
            do { try await source?.setSpeed(speed) } catch { show(.error, unsupported(error, "change the speed")) }
        }
    }

    func follow(_ id: Id) {
        guard colonist(id)?.alive == true, id != followingID else { return }
        let starter = intro?.starterAgentId
        let switching = followingID != nil
        tab = .colony
        selectedID = nil
        followingID = id
        Task { await source?.setFocus(id) }
        if id == starter { didAct(.follow_starter) }
        if switching || (starter != nil && id != starter) { didAct(.switch_character) }
    }

    func unfollow() {
        followingID = nil
        Task { await source?.setFocus(nil) }
    }

    /// Sends a power. Returns nil on success, else a message for the sheet.
    func apply(_ intervention: Intervention, commandId: String) async -> String? {
        guard let source else { return "Not connected." }
        do {
            let r = try await source.apply(intervention, commandId: commandId)
            guard r.ok else { return r.message ?? "The colony refused." }
            show(.ok, resultText(intervention, r))
            didAct(.use_power)
            if let created = r.createdAgentId { selectedID = created }
            // From the wide view, go to whoever it hit hardest.
            if followingID == nil, let hit = r.affectedAgentIds.first(where: { colonist($0)?.alive == true }) {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { if self.followingID == nil { self.follow(hit) } }
            }
            return nil
        } catch {
            return unsupported(error, "reach the colony") + " Nothing was changed. You can try again."
        }
    }

    func checkout() async -> URL? {
        do { return try await source?.checkoutURL() } catch {
            show(.error, error.localizedDescription)
            return nil
        }
    }

    func goTo(_ event: WorldEventPublic) {
        if let actor = colonist(event.actorId) {
            tab = .colony
            selectedID = actor.id
        } else if let loc = event.locationId {
            tab = .colony
            selectedLocation = loc
        } else {
            chronicleEventID = event.id
            tab = .chronicle
        }
    }

    private func unsupported(_ error: Error, _ what: String) -> String {
        let text = error.localizedDescription
        if text.contains("Could not find public function") { return "The live backend can't \(what) yet." }
        return "Could not \(what): \(text)"
    }

    private func resultText(_ iv: Intervention, _ r: InterventionResult) -> String {
        func name(_ id: Id) -> String { colonist(id)?.name ?? "They" }
        switch iv {
        case .drought: return "The ice wells are failing. Watch the water price."
        case .storm:
            let n = r.affectedAgentIds.count
            return n == 0 ? "The storm has hit. No one was caught in it." : "The storm has hit. \(n) colonist\(n == 1 ? " was" : "s were") caught in it."
        case let .grant(id, resource, amount): return "\(name(id)) received \(Int(amount)) \(resource.rawValue)."
        case let .kill(id, _): return "\(name(id)) is dead." + (r.affectedAgentIds.count > 1 ? " \(r.affectedAgentIds.count - 1) others felt it at once." : "")
        case let .whisper(id, _, _, _, _): return "The idea is planted in \(name(id))'s mind. Only they know."
        case .rumor: return "The rumor is out. \(r.affectedAgentIds.count) colonists heard it first."
        case let .createCharacter(p): return "\(p.name) has arrived at the colony."
        }
    }
}

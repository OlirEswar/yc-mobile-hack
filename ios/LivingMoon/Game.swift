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
    var tint: Color {
        switch self {
        case .meteors: Color(red: 1, green: 0.45, blue: 0.2)
        case .endLife: Color(red: 0.85, green: 0.3, blue: 0.3)
        case .whisper, .rumor, .arrival: .earth
        default: .amber
        }
    }
}

/// The full-screen moment that plays after a power lands, and what it needs to tell the story.
struct Cinematic: Identifiable {
    let id = UUID()
    var power: Power
    var headline: String
    var result: String
    var severity: Double = 0.7
    var sites: [LocationId] = []
    var subject: AgentLite?
    /// The whispered or rumored words, the cause of a death, or the amount granted.
    var quote: String?
    var resource: Resource?
    /// Who felt it, to show how they took it.
    var affected: [Id] = []
    var tick: Double = 0
}

/// A camera move the colony map should make, e.g. to where a power just landed.
struct Flight: Equatable {
    let id = UUID()
    var point: CGPoint
    var zoom: CGFloat
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
    enum Tab: Hashable { case colony, people, chronicle }

    static let convexURL = "https://utmost-hyena-958.convex.cloud"
    private static let liveKey = "livingMoon.useLiveBackend"
    private static let deviceKey = "livingMoon.deviceId"

    var phase: Phase = .loading
    var world: WorldPublic?
    private(set) var agents: [AgentLite] = []
    private var index: [Id: Int] = [:]
    private(set) var events: [WorldEventPublic] = []
    var premium = false
    var useLive = UserDefaults.standard.bool(forKey: liveKey) {
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
    var chronicleEventID: Id?
    var toast: Toast?
    var cinematic: Cinematic?
    var flight: Flight?
    /// Colonists who just felt a power, and when, so the map can show them react.
    var reactions: [Id: Date] = [:]
    var skipping = false
    var backendNote: String?

    /// When the current world tick arrived, so the map can interpolate between ticks.
    @ObservationIgnored private(set) var tickArrivedAt = Date()
    @ObservationIgnored private var source: WorldSource?
    @ObservationIgnored private var heartbeatTimer: Timer?
    @ObservationIgnored private var toastTask: Task<Void, Never>?

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
        let next: WorldSource = useLive ? ConvexSource(url: Self.convexURL) : MockSource()
        source = next
        do {
            try await next.start(deviceId: deviceId(), sink: self)
            heartbeatTimer?.invalidate()
            heartbeatTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
                _ = MainActor.assumeIsolated { Task { await self?.source?.heartbeat() } }
            }
            phase = .ready
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

    // MARK: SourceSink

    func received(world next: WorldPublic) {
        if next.tick != world?.tick { tickArrivedAt = Date() }
        world = next
    }

    func received(agents next: [AgentLite]) {
        agents = next
        index = Dictionary(uniqueKeysWithValues: next.enumerated().map { ($1.id, $0) })
        if let f = followingID, colonist(f)?.alive == false {
            followingID = nil
            show(.info, (colonist(f)?.name ?? "They") + " has died. Back to the colony view.")
        }
    }

    func received(events next: [WorldEventPublic]) { events = next }
    func received(premium next: Bool) { premium = next }
    func sourceFailed(_ message: String) {
        if backendNote == nil { backendNote = message }
    }

    // MARK: Lookup

    func colonist(_ id: Id?) -> AgentLite? { id.flatMap { index[$0] }.map { agents[$0] } }

    /// The world tick with the fraction elapsed since it arrived, for smooth movement.
    func displayTick(at date: Date) -> Double {
        guard let world else { return 0 }
        guard world.running else { return world.tick }
        let fraction = date.timeIntervalSince(tickArrivedAt) / (Clock.secondsPerTick / world.speed)
        return world.tick + min(1, max(0, fraction))
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

    // MARK: Actions

    func show(_ kind: Toast.Kind, _ text: String) {
        toastTask?.cancel()
        withAnimation { toast = Toast(kind: kind, text: text) }
        toastTask = Task {
            try? await Task.sleep(for: .seconds(kind == .error ? 6 : 3.6))
            if !Task.isCancelled { withAnimation { toast = nil } }
        }
    }

    func setSpeed(_ speed: Double) {
        Task {
            do { try await source?.setSpeed(speed) } catch { show(.error, unsupported(error, "change the speed")) }
        }
    }

    func follow(_ id: Id) {
        guard colonist(id)?.alive == true else { return }
        tab = .colony
        followingID = id
        Task { await source?.setFocus(id) }
    }

    func unfollow() {
        followingID = nil
        Task { await source?.setFocus(nil) }
    }

    func skipToNotable() {
        guard !skipping, let source else { return }
        skipping = true
        Task {
            defer { skipping = false }
            do {
                let r = try await source.skipToNotable(agentId: followingID)
                let hours = (r.advancedTicks / Clock.ticksPerHour * 10).rounded() / 10
                let e = events.first { $0.id == r.eventId }
                show(.info, e.map { "Skipped \(hours.formatted())h: \($0.summary)" } ?? "Skipped \(hours.formatted())h. Nothing notable happened.")
            } catch {
                show(.error, unsupported(error, "skip ahead"))
            }
        }
    }

    /// Sends a power. Returns nil on success, else a message for the sheet.
    func apply(_ intervention: Intervention, commandId: String) async -> String? {
        guard let source else { return "Not connected." }
        do {
            let r = try await source.apply(intervention, commandId: commandId)
            guard r.ok else { return r.message ?? "The colony refused." }
            withAnimation(.easeOut(duration: 0.35)) { cinematic = makeCinematic(intervention, r) }
            return nil
        } catch {
            return unsupported(error, "reach the colony") + " Nothing was changed. You can try again."
        }
    }

    /// Close the cinematic and take the player to where it happened, or follow the person it happened to.
    func endCinematic(follow id: Id? = nil) {
        guard let c = cinematic else { return }
        withAnimation(.smooth(duration: 0.5)) { cinematic = nil }
        let now = Date()
        reactions = reactions.filter { now.timeIntervalSince($0.value) < 8 }
        for a in c.affected.prefix(40) { reactions[a] = now }
        if c.power != .rumor, let s = c.subject?.id { reactions[s] = now }
        if let id {
            follow(id)
            return
        }
        let point: CGPoint? = if c.power != .rumor, let s = c.subject.flatMap({ colonist($0.id) }) {
            Placement.position(of: s, at: displayTick(at: now)).point
        } else if let site = c.sites.first {
            MapLayout.locations[site]!.center
        } else { nil }
        if let point {
            tab = .colony
            flight = Flight(point: point, zoom: c.sites.count > 1 ? 1.3 : 2.4)
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

    private func makeCinematic(_ iv: Intervention, _ r: InterventionResult) -> Cinematic {
        let result = resultText(iv, r)
        let tick = world?.tick ?? 0
        switch iv {
        case let .drought(severity, days):
            return Cinematic(power: .drought, headline: "The ice wells run dry", result: result, severity: severity, sites: [.ice_wells], quote: "\(Int(days)) sol\(days == 1 ? "" : "s")", affected: r.affectedAgentIds, tick: tick)
        case let .storm(severity, ids):
            let sites = ids.isEmpty ? LocationId.allCases.filter { $0.def.exposed } : ids
            let headline = sites.count == 1 ? "Meteors strike \(sites[0].name)" : "Meteors strike \(sites.count) sites"
            return Cinematic(power: .meteors, headline: headline, result: result, severity: severity, sites: sites, affected: r.affectedAgentIds, tick: tick)
        case let .grant(id, resource, amount):
            return Cinematic(power: .supplyDrop, headline: "A gift from nowhere", result: result, subject: colonist(id), quote: "+\(Int(amount)) \(resource.label.lowercased())", resource: resource, affected: [id], tick: tick)
        case let .kill(id, cause):
            return Cinematic(power: .endLife, headline: colonist(id)?.name ?? "A life", result: result, subject: colonist(id), quote: cause, affected: r.affectedAgentIds.filter { $0 != id }, tick: tick)
        case let .whisper(id, _, text, strength, _):
            return Cinematic(power: .whisper, headline: "A voice in \(colonist(id)?.first ?? "their")'s mind", result: result, severity: strength, subject: colonist(id), quote: text, affected: [id], tick: tick)
        case let .rumor(about, _, text, seed):
            return Cinematic(power: .rumor, headline: "Word gets around", result: result, sites: [seed ?? .canteen], subject: colonist(about), quote: text, affected: r.affectedAgentIds, tick: tick)
        case let .createCharacter(p):
            let created = colonist(r.createdAgentId)
            return Cinematic(power: .arrival, headline: p.name, result: result, sites: [.landing_pad], subject: created, quote: occupation(p.occupation).label, affected: created.map { [$0.id] } ?? [], tick: tick)
        }
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

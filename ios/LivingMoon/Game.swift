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
    enum Tab: Hashable { case colony, people, chronicle, you }

    static let convexURL = "https://utmost-hyena-958.convex.cloud"
    private static let liveKey = "livingMoon.useLiveBackend"
    private static let deviceKey = "livingMoon.deviceId"

    var phase: Phase = .loading
    var world: WorldPublic?
    private(set) var agents: [AgentLite] = []
    private var index: [Id: Int] = [:]
    private(set) var events: [WorldEventPublic] = []
    var premium = false
    /// The player's sources, profile, avatar in this world and recent directives.
    private(set) var avatar: AvatarPublic?
    /// Who shares this world.
    private(set) var multiplayer: MultiplayerPublic?
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
        avatar = nil
        multiplayer = nil
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
    func received(avatar next: AvatarPublic?) { avatar = next }
    func received(multiplayer next: MultiplayerPublic?) { multiplayer = next }
    func sourceFailed(_ message: String) {
        if backendNote == nil { backendNote = message }
    }

    // MARK: Lookup

    func colonist(_ id: Id?) -> AgentLite? { id.flatMap { index[$0] }.map { agents[$0] } }

    /// The player's own avatar in this world, alive or dead.
    var myAvatar: AgentLite? { colonist(avatar?.agentId) }
    func isMine(_ id: Id) -> Bool { avatar?.agentId == id }

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
            show(.ok, resultText(intervention, r))
            if let created = r.createdAgentId { selectedID = created }
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

    // MARK: Avatar and multiplayer

    /// Each returns nil on success, else a message for the screen.
    func addSource(_ input: PersonaSourceInput) async -> String? {
        await reply("save that source") { try await $0.addSource(input) }
    }

    func removeSource(_ id: Id) async -> String? {
        await reply("remove that source") { try await $0.removeSource(id) }
    }

    func synthesize(name: String?) async -> String? {
        await reply("build your character") { try await $0.synthesize(name: name) }
    }

    func saveProfile(_ profile: AvatarProfile) async -> String? {
        await reply("save your character") { try await $0.saveProfile(profile) }
    }

    func spawnAvatar() async -> String? {
        let error = await reply("drop your character in") { try await $0.spawnAvatar() }
        if error == nil { show(.ok, "\(avatar?.profile?.name ?? "Your character") stepped off the shuttle at the Landing Pad.") }
        return error
    }

    func direct(_ text: String) async -> String? {
        let error = await reply("reach your character") { try await $0.direct(text) }
        if error == nil { show(.ok, "\(myAvatar?.first ?? "They") will see to it.") }
        return error
    }

    func forgetAvatar() async -> String? {
        await reply("forget your sources") { try await $0.forgetAvatar() }
    }

    func setPlayerName(_ name: String) async -> String? {
        await reply("change your name") { try await $0.setPlayerName(name) }
    }

    func invite() async -> String? {
        await reply("open the colony to friends") { try await $0.invite() }
    }

    /// Joining or leaving moves this session to another world, so every subscription restarts.
    func join(code: String) async -> String? {
        let error = await reply("join that colony") { try await $0.join(code: code) }
        if error == nil {
            await boot()
            show(.ok, "You joined \(world?.name ?? "your friend's colony").")
        }
        return error
    }

    func leave() async -> String? {
        let error = await reply("leave this colony") { try await $0.leave() }
        if error == nil {
            await boot()
            show(.info, "Back in your own colony.")
        }
        return error
    }

    private func reply<R: SourceReply>(_ what: String, _ op: (WorldSource) async throws -> R) async -> String? {
        guard let source else { return "Not connected." }
        do {
            let r = try await op(source)
            return r.ok ? nil : r.message ?? "The colony refused."
        } catch {
            return unsupported(error, what)
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

/// The { ok, message } answer shared by the avatar and multiplayer calls.
protocol SourceReply {
    var ok: Bool { get }
    var message: String? { get }
}
extension AvatarResult: SourceReply {}
extension MultiplayerResult: SourceReply {}

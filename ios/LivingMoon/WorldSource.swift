import Foundation

/// Receives everything a source pushes. Implemented by Game.
@MainActor
protocol SourceSink: AnyObject {
    func received(world: WorldPublic)
    /// Every colonist, alive or dead.
    func received(agents: [AgentLite])
    /// Recent events, oldest first.
    func received(events: [WorldEventPublic])
    func received(premium: Bool)
    /// avatar:mine. nil when the player has no sources, profile or avatar yet.
    func received(avatar: AvatarPublic?)
    /// multiplayer:state.
    func received(multiplayer: MultiplayerPublic?)
    func sourceFailed(_ message: String)
}

/// The seam between the app and the backend: a local mock or the Convex deployment.
/// Each method mirrors one entry of mobile/shared/api.ts.
@MainActor
protocol WorldSource: AnyObject {
    var isLive: Bool { get }
    /// session:bootstrap, then the reactive world, agents, events and billing subscriptions.
    func start(deviceId: String, sink: SourceSink) async throws
    func heartbeat() async
    func setFocus(_ agentId: Id?) async
    func setSpeed(_ speed: Double) async throws
    func skipToNotable(agentId: Id?) async throws -> (advancedTicks: Double, eventId: Id?)
    /// agents:get, reactive. Returns a cancel closure.
    func watchDetail(_ agentId: Id, _ onDetail: @escaping (AgentDetail?) -> Void) -> () -> Void
    func chain(_ eventId: Id) async throws -> [WorldEventPublic]
    func apply(_ intervention: Intervention, commandId: String) async throws -> InterventionResult
    func checkoutURL() async throws -> URL

    // avatar:*
    func addSource(_ source: PersonaSourceInput) async throws -> AvatarResult
    func removeSource(_ sourceId: Id) async throws -> AvatarResult
    func synthesize(name: String?) async throws -> AvatarResult
    func saveProfile(_ profile: AvatarProfile) async throws -> AvatarResult
    func spawnAvatar() async throws -> AvatarResult
    func direct(_ text: String) async throws -> AvatarResult
    func forgetAvatar() async throws -> AvatarResult

    // multiplayer:*
    func setPlayerName(_ name: String) async throws -> MultiplayerResult
    func invite() async throws -> MultiplayerResult
    /// After a successful join or leave the session's world has changed: restart with start().
    func join(code: String) async throws -> MultiplayerResult
    func leave() async throws -> MultiplayerResult
    func stop()
}

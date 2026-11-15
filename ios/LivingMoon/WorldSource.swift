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
    func stop()
}

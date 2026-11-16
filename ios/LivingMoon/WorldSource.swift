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
    /// The world this source plays, once started.
    var worldId: Id { get }
    /// session:bootstrap, then the reactive world, agents, events and billing subscriptions.
    func start(deviceId: String, sink: SourceSink) async throws
    func heartbeat() async
    func setFocus(_ agentId: Id?) async
    func setSpeed(_ speed: Double) async throws
    /// agents:get, reactive. Returns a cancel closure.
    func watchDetail(_ agentId: Id, _ onDetail: @escaping (AgentDetail?) -> Void) -> () -> Void
    func chain(_ eventId: Id) async throws -> [WorldEventPublic]
    /// story:intro. Nil when the world has no introduction (or the backend predates it).
    func intro() async -> StoryIntro?
    /// story:storylines, reactive, highest tension first. Only theirs with agentId. Returns a cancel closure.
    func watchStorylines(agentId: Id?, _ onValue: @escaping ([StorylinePublic]) -> Void) -> () -> Void
    /// focus:state, reactive: the followed colonist's monologue, hooks and storylines.
    func watchFocus(_ agentId: Id, _ onValue: @escaping (FocusState?) -> Void) -> () -> Void
    /// focus:conversation, reactive: the player's questions to this colonist, oldest first.
    func watchConversation(_ agentId: Id, _ onValue: @escaping ([AskTurn]) -> Void) -> () -> Void
    /// society/api:overview: the almanac. Nil when the backend has no society layer.
    func society() async -> SocietyOverview?
    /// focus:ask. They answer in character; it never changes the world.
    func ask(_ agentId: Id, question: String) async throws -> AskResult
    func plant(_ agentId: Id, text: String) async throws -> PlantResult
    func apply(_ intervention: Intervention, commandId: String) async throws -> InterventionResult
    func checkoutURL() async throws -> URL
    /// world:timeskip. Starts a skip, or returns the one already running.
    func startTimeskip(span: TimeskipSpan) async throws -> TimeskipStartResult
    /// timeskip:get, reactive: progress and, once done, the chronicle. Returns a cancel closure.
    func watchTimeskip(_ timeskipId: Id?, _ onValue: @escaping (TimeskipPublic?) -> Void) -> () -> Void
    func stop()
}

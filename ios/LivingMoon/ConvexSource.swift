import Combine
import ConvexMobile
import Foundation

/// WorldSource over the live Convex deployment. Paths and argument shapes follow mobile/shared/api.ts.
/// Numbers go out as Doubles: the backend validates v.number() and rejects Convex int64 values.
@MainActor
final class ConvexSource: WorldSource {
    let isLive = true
    private let client: ConvexClient
    private var sessionToken = ""
    private(set) var worldId = ""
    private var bag: Set<AnyCancellable> = []
    private weak var sink: SourceSink?

    init(url: String) {
        client = ConvexClient(deploymentUrl: url)
    }

    private func watch<T: Decodable>(_ path: String, _ args: [String: ConvexEncodable?], as type: T.Type, onError: ((String) -> Void)? = nil, _ onValue: @escaping (T) -> Void) -> AnyCancellable {
        client.subscribe(to: path, with: args, yielding: type)
            .receive(on: DispatchQueue.main)
            .sink(receiveCompletion: { completion in
                if case let .failure(error) = completion { onError?("\(path): \(error.localizedDescription)") }
            }, receiveValue: onValue)
    }

    private struct Session: Decodable { let sessionToken: String; let worldId: String }
    private struct Premium: Decodable { let premium: Bool }
    /// Mutations that answer { ok }. ConvexMobile's result-less overload decodes String? and fails on objects.
    private struct Ok: Decodable { let ok: Bool }

    func start(deviceId: String, sink: SourceSink) async throws {
        self.sink = sink
        let session: Session = try await client.mutation("session:bootstrap", with: ["deviceId": deviceId])
        sessionToken = session.sessionToken
        worldId = session.worldId
        await heartbeat()
        let fail: (String) -> Void = { [weak sink] in sink?.sourceFailed($0) }
        watch("world:get", ["worldId": worldId], as: WorldPublic?.self, onError: fail) { [weak sink] in if let w = $0 { sink?.received(world: w) } }.store(in: &bag)
        watch("agents:list", ["worldId": worldId], as: [AgentLite].self, onError: fail) { [weak sink] in sink?.received(agents: $0) }.store(in: &bag)
        watch("chronicle:feed", ["worldId": worldId, "limit": 100.0, "minSalience": 0.0], as: [WorldEventPublic].self, onError: fail) { [weak sink] in sink?.received(events: $0.reversed()) }.store(in: &bag)
        watch("billing:status", ["sessionToken": sessionToken], as: Premium.self) { [weak sink] in sink?.received(premium: $0.premium) }.store(in: &bag)
    }

    func heartbeat() async {
        let _: Ok? = try? await client.mutation("session:heartbeat", with: ["sessionToken": sessionToken])
    }

    func setFocus(_ agentId: Id?) async {
        var args: [String: ConvexEncodable?] = ["sessionToken": sessionToken]
        args.updateValue(agentId as ConvexEncodable?, forKey: "agentId")
        let _: Ok? = try? await client.mutation("session:setFocus", with: args)
    }

    func setSpeed(_ speed: Double) async throws {
        let _: Ok = try await client.mutation("world:setSpeed", with: ["sessionToken": sessionToken, "worldId": worldId, "speed": speed])
    }

    private struct Skip: Decodable { let advancedTicks: Double; let eventId: String? }
    func skipToNotable(agentId: Id?) async throws -> (advancedTicks: Double, eventId: Id?) {
        var args: [String: ConvexEncodable?] = ["sessionToken": sessionToken, "worldId": worldId]
        if let agentId { args["agentId"] = agentId }
        let r: Skip = try await client.mutation("world:skipToNotable", with: args)
        return (r.advancedTicks, r.eventId)
    }

    func watchDetail(_ agentId: Id, _ onDetail: @escaping (AgentDetail?) -> Void) -> () -> Void {
        let c = watch("agents:get", ["worldId": worldId, "agentId": agentId], as: AgentDetail?.self, onError: { _ in onDetail(nil) }, onDetail)
        return { c.cancel() }
    }

    func chain(_ eventId: Id) async throws -> [WorldEventPublic] {
        try await first("chronicle:chain", ["worldId": worldId, "eventId": eventId], as: [WorldEventPublic].self)
    }

    func intro() async -> StoryIntro? {
        try? await first("story:intro", ["worldId": worldId], as: StoryIntro?.self)
    }

    func society() async -> SocietyOverview? {
        for path in ["society/api:overview", "society:overview"] {
            if let overview = try? await first(path, ["worldId": worldId], as: SocietyOverview.self) { return overview }
        }
        return nil
    }

    /// The story and focus queries are newer than some deployments: a missing function reads as empty.
    func watchStorylines(agentId: Id?, _ onValue: @escaping ([StorylinePublic]) -> Void) -> () -> Void {
        var args: [String: ConvexEncodable?] = ["worldId": worldId]
        if let agentId { args["agentId"] = agentId }
        let c = watch("story:storylines", args, as: [StorylinePublic].self, onError: { _ in onValue([]) }, onValue)
        return { c.cancel() }
    }

    func watchFocus(_ agentId: Id, _ onValue: @escaping (FocusState?) -> Void) -> () -> Void {
        let c = watch("focus:state", ["worldId": worldId, "agentId": agentId], as: FocusState?.self, onError: { _ in onValue(nil) }, onValue)
        return { c.cancel() }
    }

    func watchConversation(_ agentId: Id, _ onValue: @escaping ([AskTurn]) -> Void) -> () -> Void {
        let c = watch("focus:conversation", ["sessionToken": sessionToken, "agentId": agentId], as: [AskTurn].self, onError: { _ in onValue([]) }, onValue)
        return { c.cancel() }
    }

    func startTimeskip(span: TimeskipSpan) async throws -> TimeskipStartResult {
        try await client.mutation("world:timeskip", with: ["sessionToken": sessionToken, "worldId": worldId, "span": span.rawValue])
    }

    func watchTimeskip(_ timeskipId: Id?, _ onValue: @escaping (TimeskipPublic?) -> Void) -> () -> Void {
        var args: [String: ConvexEncodable?] = ["worldId": worldId]
        if let timeskipId { args["timeskipId"] = timeskipId }
        let c = watch("timeskip:get", args, as: TimeskipPublic?.self, onError: { _ in onValue(nil) }, onValue)
        return { c.cancel() }
    }

    func ask(_ agentId: Id, question: String) async throws -> AskResult {
        try await client.action("focus:ask", with: ["sessionToken": sessionToken, "worldId": worldId, "agentId": agentId, "question": question])
    }

    /// One value from a query. ConvexMobile only exposes reactive queries.
    private func first<T: Decodable>(_ path: String, _ args: [String: ConvexEncodable?], as type: T.Type) async throws -> T {
        for try await value in client.subscribe(to: path, with: args, yielding: type).values { return value }
        throw SourceError.unsupported(path + " returned nothing.")
    }

    private struct ApplyResult: Decodable {
        let ok: Bool
        let message: String?
        let affectedAgentIds: [String]?
        let createdAgentId: String?
    }

    func apply(_ intervention: Intervention, commandId: String) async throws -> InterventionResult {
        var args: [String: ConvexEncodable?] = ["commandId": commandId, "worldId": worldId, "sessionToken": sessionToken]
        switch intervention {
        case let .drought(severity, days):
            args["type"] = "drought"
            args["params"] = ["severity": severity, "durationDays": days] as [String: ConvexEncodable?]
        case let .storm(severity, ids):
            args["type"] = "storm"
            var params: [String: ConvexEncodable?] = ["severity": severity]
            if !ids.isEmpty { params["locationIds"] = ids.map(\.rawValue) as [ConvexEncodable?] }
            args["params"] = params
        case let .grant(agentId, resource, amount):
            args["type"] = "grant"
            args["params"] = ["agentId": agentId, "resource": resource.rawValue, "amount": amount] as [String: ConvexEncodable?]
        case let .kill(agentId, cause):
            args["type"] = "kill"
            args["params"] = ["agentId": agentId, "cause": cause] as [String: ConvexEncodable?]
        case let .whisper(agentId, presetKey, text, strength, about):
            args["type"] = "whisper"
            var params: [String: ConvexEncodable?] = ["agentId": agentId, "presetKey": presetKey, "text": text, "strength": strength]
            if let about { params["aboutAgentId"] = about }
            args["params"] = params
        case let .rumor(about, presetKey, text, seed):
            args["type"] = "rumor"
            var params: [String: ConvexEncodable?] = ["aboutAgentId": about, "presetKey": presetKey, "text": text]
            if let seed { params["seedLocationId"] = seed.rawValue }
            args["params"] = params
        case let .createCharacter(p):
            args["type"] = "create_character"
            let goals: [ConvexEncodable?] = p.goal.isEmpty ? [] : [["kind": "custom", "description": p.goal] as [String: ConvexEncodable?]]
            args["params"] = [
                "name": p.name, "spriteId": p.spriteId, "ageBand": p.ageBand, "occupation": p.occupation, "homeLocationId": p.home.rawValue,
                "traits": p.traits.mapValues { $0 as ConvexEncodable? }, "values": p.values.mapValues { $0 as ConvexEncodable? }, "backstory": p.backstory,
                "startingResources": ["credits": p.credits, "food": p.food] as [String: ConvexEncodable?], "goals": goals,
            ] as [String: ConvexEncodable?]
        }
        let r: ApplyResult = try await client.mutation("interventions:apply", with: args)
        return InterventionResult(ok: r.ok, message: r.message, affectedAgentIds: r.affectedAgentIds ?? [], createdAgentId: r.createdAgentId)
    }

    private struct Checkout: Decodable { let purchaseUrl: String }
    func checkoutURL() async throws -> URL {
        let r: Checkout = try await client.action("billing:createCheckout", with: ["sessionToken": sessionToken])
        guard let url = URL(string: r.purchaseUrl) else { throw SourceError.unsupported("The checkout link was not a valid URL.") }
        return url
    }

    func stop() {
        bag.removeAll()
    }
}

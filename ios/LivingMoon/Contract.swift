import CoreGraphics
import Foundation

// Swift mirror of mobile/shared/colony.ts, mobile/shared/types.ts and mobile/shared/mapLayout.ts.
// The Convex backend and the TypeScript contract stay the source of truth; change both together.
// Every number is a Double because the backend stores float64 and rejects Convex int64 arguments.

typealias Id = String

// MARK: - Time

enum Clock {
    static let tickMinutes = 10.0
    static let ticksPerHour = 6.0
    static let ticksPerDay = 144.0
    static let startHour = 6.0
    /// Real seconds per tick at 1x speed.
    static let secondsPerTick = 3.333
    static let speeds: [Double] = [0, 1, 4, 8]

    static func parts(_ tick: Double) -> (sol: Int, hour: Int, minute: Int) {
        let total = Int(tick) * 10 + 6 * 60
        return (total / 1440 + 1, (total % 1440) / 60, total % 60)
    }
    /// "Sol 3 · 15:30"
    static func stamp(_ tick: Double) -> String {
        let p = parts(tick)
        return "Sol \(p.sol) · " + time(tick)
    }
    static func time(_ tick: Double) -> String {
        let p = parts(tick)
        return String(format: "%02d:%02d", p.hour, p.minute)
    }
}

// MARK: - Places

enum LocationId: String, Codable, CaseIterable, Identifiable {
    case plaza, market, canteen, hydroponics, depot, workshop, medbay
    case habitat_a, habitat_b, ice_wells, quarry, solar_farm, observatory, landing_pad
    var id: String { rawValue }
}

struct LocationDef {
    let name: String
    let exposed: Bool
    let produces: String?
    let description: String
}

let LOCATIONS: [LocationId: LocationDef] = [
    .plaza: .init(name: "Commons Plaza", exposed: false, produces: nil, description: "Central dome with the council chamber and the public notice board."),
    .market: .init(name: "Exchange Concourse", exposed: false, produces: nil, description: "Trading stalls where food, water, parts and medicine change hands for credits."),
    .canteen: .init(name: "The Airlock Canteen", exposed: false, produces: nil, description: "Mess hall and bar. Where the colony eats, drinks and gossips."),
    .hydroponics: .init(name: "Hydroponics Bays", exposed: false, produces: "food", description: "Grow racks that turn water and light into food."),
    .depot: .init(name: "Supply Depot", exposed: false, produces: nil, description: "The colony reserve of food, water and parts, run by the quartermaster."),
    .workshop: .init(name: "Fabrication Works", exposed: false, produces: "parts", description: "Printers and forges that turn regolith into parts."),
    .medbay: .init(name: "Med Bay", exposed: false, produces: "medicine", description: "Clinic and pharmacy."),
    .habitat_a: .init(name: "Habitat Ring A", exposed: false, produces: nil, description: "Older family quarters near the farms."),
    .habitat_b: .init(name: "Habitat Ring B", exposed: false, produces: nil, description: "Newer bunk blocks near the works."),
    .ice_wells: .init(name: "Ice Wells", exposed: true, produces: "water", description: "Drill site in the permanently shadowed crater. The only source of water."),
    .quarry: .init(name: "Regolith Quarry", exposed: true, produces: nil, description: "Open-pit regolith dig that feeds the Fabrication Works."),
    .solar_farm: .init(name: "Solar Farm", exposed: true, produces: nil, description: "Panel field on the crater rim that powers the colony."),
    .observatory: .init(name: "Observatory Lab", exposed: false, produces: nil, description: "Research dome and telescope."),
    .landing_pad: .init(name: "Landing Pad", exposed: true, produces: nil, description: "Where shuttles land. New arrivals and off-world cargo come through here."),
]

extension LocationId {
    var def: LocationDef { LOCATIONS[self]! }
    var name: String { def.name }
}

struct Route { let a: LocationId; let b: LocationId; let ticks: Double }

let ROUTES: [Route] = [
    .init(a: .plaza, b: .observatory, ticks: 1), .init(a: .plaza, b: .canteen, ticks: 1), .init(a: .plaza, b: .market, ticks: 1),
    .init(a: .plaza, b: .depot, ticks: 1), .init(a: .observatory, b: .solar_farm, ticks: 1), .init(a: .observatory, b: .landing_pad, ticks: 1),
    .init(a: .market, b: .landing_pad, ticks: 1), .init(a: .canteen, b: .solar_farm, ticks: 1), .init(a: .canteen, b: .hydroponics, ticks: 1),
    .init(a: .market, b: .workshop, ticks: 1), .init(a: .depot, b: .hydroponics, ticks: 1), .init(a: .depot, b: .workshop, ticks: 1),
    .init(a: .depot, b: .medbay, ticks: 1), .init(a: .medbay, b: .habitat_a, ticks: 1), .init(a: .medbay, b: .habitat_b, ticks: 1),
    .init(a: .hydroponics, b: .habitat_a, ticks: 1), .init(a: .workshop, b: .habitat_b, ticks: 1), .init(a: .habitat_a, b: .ice_wells, ticks: 1),
    .init(a: .habitat_b, b: .quarry, ticks: 1), .init(a: .ice_wells, b: .quarry, ticks: 2),
]

/// Shortest path by travel ticks. Ties resolve by LocationId order, like the TypeScript version.
func findPath(_ from: LocationId, _ to: LocationId) -> (nodes: [LocationId], ticks: Double)? {
    if from == to { return ([from], 0) }
    var dist: [LocationId: Double] = [from: 0]
    var prev: [LocationId: LocationId] = [:]
    var done: Set<LocationId> = []
    while true {
        guard let current = LocationId.allCases.filter({ dist[$0] != nil && !done.contains($0) }).min(by: { dist[$0]! < dist[$1]! }) else { return nil }
        if current == to { break }
        done.insert(current)
        for route in ROUTES where route.a == current || route.b == current {
            let next = route.a == current ? route.b : route.a
            let candidate = dist[current]! + route.ticks
            if candidate < dist[next, default: .infinity] {
                dist[next] = candidate
                prev[next] = current
            }
        }
    }
    var nodes = [to]
    while nodes[0] != from { nodes.insert(prev[nodes[0]]!, at: 0) }
    return (nodes, dist[to]!)
}

// MARK: - Map geometry (world pixels on the 1280 x 1920 ground image)

struct LocationLayout { let center: CGPoint; let footprint: CGRect; let entry: CGPoint; let stand: CGRect }

enum MapLayout {
    static let size = CGSize(width: 1280, height: 1920)

    private static func make(_ cx: CGFloat, _ cy: CGFloat, _ w: CGFloat, _ h: CGFloat, entry: CGPoint) -> LocationLayout {
        let box = CGRect(x: cx - w / 2, y: cy - h / 2, width: w, height: h)
        let stand = CGRect(x: cx - (w - 96) / 2, y: cy + 8 - (h - 104) / 2, width: w - 96, height: h - 104)
        return LocationLayout(center: CGPoint(x: cx, y: cy), footprint: box, entry: entry, stand: stand)
    }

    static let locations: [LocationId: LocationLayout] = [
        .solar_farm: make(300, 230, 384, 256, entry: .init(x: 400, y: 360)),
        .observatory: make(640, 330, 224, 224, entry: .init(x: 640, y: 444)),
        .landing_pad: make(980, 220, 320, 256, entry: .init(x: 900, y: 350)),
        .canteen: make(300, 680, 256, 224, entry: .init(x: 430, y: 700)),
        .market: make(980, 690, 288, 224, entry: .init(x: 834, y: 710)),
        .plaza: make(640, 860, 320, 288, entry: .init(x: 640, y: 860)),
        .hydroponics: make(290, 1140, 384, 288, entry: .init(x: 484, y: 1160)),
        .depot: make(640, 1200, 224, 192, entry: .init(x: 640, y: 1102)),
        .workshop: make(990, 1150, 288, 256, entry: .init(x: 844, y: 1170)),
        .habitat_a: make(330, 1520, 352, 288, entry: .init(x: 508, y: 1500)),
        .medbay: make(660, 1480, 224, 192, entry: .init(x: 660, y: 1382)),
        .habitat_b: make(980, 1530, 352, 288, entry: .init(x: 802, y: 1510)),
        .ice_wells: make(360, 1800, 352, 176, entry: .init(x: 380, y: 1710)),
        .quarry: make(960, 1810, 352, 176, entry: .init(x: 940, y: 1720)),
    ]

    /// Top-left corner of each building's art, from the art manifest.
    static let buildingOrigin: [LocationId: CGPoint] = [
        .plaza: .init(x: 480, y: 716), .market: .init(x: 836, y: 578), .canteen: .init(x: 172, y: 568), .hydroponics: .init(x: 98, y: 996),
        .depot: .init(x: 528, y: 1104), .workshop: .init(x: 846, y: 1022), .medbay: .init(x: 548, y: 1384), .habitat_a: .init(x: 154, y: 1376),
        .habitat_b: .init(x: 804, y: 1386), .ice_wells: .init(x: 184, y: 1712), .quarry: .init(x: 784, y: 1722), .solar_farm: .init(x: 108, y: 102),
        .observatory: .init(x: 528, y: 218), .landing_pad: .init(x: 820, y: 92),
    ]

    static func location(at p: CGPoint) -> LocationId? {
        LocationId.allCases.first { locations[$0]!.footprint.contains(p) }
    }
}

// MARK: - People

let SPRITE_ARCHETYPES = ["farmer", "miner", "engineer", "medic", "scientist", "merchant", "guard", "official", "worker", "civilian"]
let SPRITE_VARIANTS = 6

struct OccupationDef: Identifiable { let id: String; let label: String; let work: LocationId; let archetype: String }

let OCCUPATIONS: [OccupationDef] = [
    .init(id: "hydroponicist", label: "Hydroponicist", work: .hydroponics, archetype: "farmer"),
    .init(id: "ice_miner", label: "Ice Miner", work: .ice_wells, archetype: "miner"),
    .init(id: "quarry_hand", label: "Quarry Hand", work: .quarry, archetype: "miner"),
    .init(id: "fabricator", label: "Fabricator", work: .workshop, archetype: "engineer"),
    .init(id: "solar_tech", label: "Solar Technician", work: .solar_farm, archetype: "engineer"),
    .init(id: "trader", label: "Trader", work: .market, archetype: "merchant"),
    .init(id: "quartermaster", label: "Quartermaster", work: .depot, archetype: "official"),
    .init(id: "councilor", label: "Councilor", work: .plaza, archetype: "official"),
    .init(id: "security", label: "Security Officer", work: .plaza, archetype: "guard"),
    .init(id: "medic", label: "Medic", work: .medbay, archetype: "medic"),
    .init(id: "researcher", label: "Researcher", work: .observatory, archetype: "scientist"),
    .init(id: "cook", label: "Canteen Cook", work: .canteen, archetype: "worker"),
    .init(id: "dock_hand", label: "Dock Hand", work: .landing_pad, archetype: "worker"),
    .init(id: "hauler", label: "Hauler", work: .depot, archetype: "worker"),
    .init(id: "resident", label: "Resident", work: .plaza, archetype: "civilian"),
]
func occupation(_ id: String) -> OccupationDef { OCCUPATIONS.first { $0.id == id } ?? OCCUPATIONS.last! }

let TRAIT_KEYS = ["ambition", "empathy", "caution", "curiosity", "sociability", "stubbornness"]
let VALUE_KEYS = ["wealth", "family", "status", "harmony", "freedom"]

enum Resource: String, Codable, CaseIterable, Identifiable {
    case food, water, parts, medicine, credits
    var id: String { rawValue }
    var label: String { rawValue.capitalized }
}

struct IdeaPreset: Identifiable { let key: String; let label: String; let text: String; let needsSubject: Bool; var id: String { key } }

let RUMOR_PRESETS: [IdeaPreset] = [
    .init(key: "hoarding", label: "Hoarding supplies", text: "{name} is secretly hoarding food and water.", needsSubject: true),
    .init(key: "thief", label: "Thief", text: "{name} has been stealing from the Supply Depot.", needsSubject: true),
    .init(key: "saboteur", label: "Saboteur", text: "{name} sabotaged the ice drills.", needsSubject: true),
    .init(key: "corrupt", label: "Corrupt", text: "{name} takes bribes and skims credits.", needsSubject: true),
    .init(key: "hero", label: "Quiet hero", text: "{name} has been giving their own rations to hungry families.", needsSubject: true),
    .init(key: "custom", label: "Write your own", text: "", needsSubject: true),
]

let WHISPER_PRESETS: [IdeaPreset] = [
    .init(key: "suspect_hoarding", label: "Suspect hoarding", text: "You suspect {name} is hiding supplies.", needsSubject: true),
    .init(key: "distrust", label: "Distrust someone", text: "{name} cannot be trusted.", needsSubject: true),
    .init(key: "befriend", label: "Seek a friend", text: "You should get closer to {name}.", needsSubject: true),
    .init(key: "seek_power", label: "Seek power", text: "You deserve a seat on the council.", needsSubject: false),
    .init(key: "get_rich", label: "Get rich", text: "You should be the richest person in the colony.", needsSubject: false),
    .init(key: "share", label: "Share what you have", text: "Those with plenty should give to those without.", needsSubject: false),
    .init(key: "custom", label: "Write your own", text: "", needsSubject: false),
]

// MARK: - Public data shapes

struct Needs: Codable, Hashable { var hunger, thirst, fatigue, safety, social: Double }

struct Move: Codable, Hashable { var from: LocationId; var to: LocationId; var departTick: Double; var arriveTick: Double }

struct AgentLite: Codable, Identifiable, Hashable {
    var id: Id
    var name: String
    var spriteId: String
    var occupation: String
    var factionId: String?
    var alive: Bool
    var locationId: LocationId
    var move: Move?
    var activity: String
    var activityLabel: String
    var busyUntilTick: Double
    var interactingWithId: Id?
    var speech: String?
    var mood: String
    var health: Double
    var needs: Needs
    var updatedAtVersion: Double
    /// Set when this colonist is a player's avatar: the player's display name.
    var ownerName: String? = nil

    var first: String { String(name.split(separator: " ").first ?? "") }
}

struct GoalPublic: Codable, Identifiable, Hashable {
    var id: Id
    var kind: String
    var description: String
    var priority: Double
    var source: String
    var status: String
    var targetAgentId: Id?
    var targetAgentName: String?
    var createdAtTick: Double
}

struct BeliefPublic: Codable, Identifiable, Hashable {
    var id: Id
    var text: String
    var subjectAgentId: Id?
    var subjectAgentName: String?
    var confidence: Double
    var sourceType: String
    var sourceAgentName: String?
    var learnedAtTick: Double
    var divine: Bool { sourceType == "divine" }
}

struct RelationshipPublic: Codable, Hashable {
    var toAgentId: Id
    var toAgentName: String
    var toAgentAlive: Bool
    var kind: String
    var affinity: Double
    var trust: Double
    var fear: Double
}

struct PlanStep: Codable, Hashable { var label: String; var status: String }
struct PlanPublic: Codable, Hashable { var intent: String; var source: String; var goalId: Id?; var steps: [PlanStep]; var cursor: Double }
struct ThoughtPublic: Codable, Hashable { var tick: Double; var trigger: String; var intent: String; var source: String }
struct Death: Codable, Hashable { var tick: Double; var cause: String }

enum EventCategory: String, Codable { case environment, economy, social, politics, health, action, intervention }

struct WorldEventPublic: Codable, Identifiable, Hashable {
    var id: Id
    var tick: Double
    var category: EventCategory
    var eventType: String
    var actorId: Id?
    var participantIds: [Id]
    var locationId: LocationId?
    var summary: String
    var salience: Double
    var causationEventId: Id?
    var banner: Bool
    var visibility: String
}

struct AgentDetail: Codable, Identifiable, Hashable {
    var id: Id
    var name: String
    var spriteId: String
    var occupation: String
    var alive: Bool
    var locationId: LocationId
    var activityLabel: String
    var mood: String
    var health: Double
    var needs: Needs
    var ageBand: String
    var background: String
    var homeLocationId: LocationId
    var workLocationId: LocationId?
    var householdName: String?
    var factionName: String?
    var traits: [String: Double]
    var inventory: [String: Double]
    var goals: [GoalPublic]
    var plan: PlanPublic?
    var beliefs: [BeliefPublic]
    var relationships: [RelationshipPublic]
    var recentEvents: [WorldEventPublic]
    var lastThought: ThoughtPublic?
    var death: Death?
    /// Set when this colonist is a player's avatar: who they are modelled on, in general terms.
    var persona: AvatarPersona? = nil
}

struct ActiveEffect: Codable, Identifiable, Hashable {
    var id: Id
    var type: String
    var locationIds: [LocationId]
    var severity: Double
    var startTick: Double
    var endTick: Double
    var label: String
}

struct Population: Codable, Hashable { var alive: Double; var dead: Double }

struct WorldPublic: Codable, Hashable {
    var id: Id
    var name: String
    var tick: Double
    var speed: Double
    var status: String
    var version: Double
    var population: Population
    var activeEffects: [ActiveEffect]
    var stockpiles: [String: [String: Double]]
    var damage: [String: Double]
    var prices: [String: Double]

    var running: Bool { status == "running" && speed > 0 }
}

// MARK: - God powers

struct NewCharacter {
    var name: String
    var spriteId: String
    var ageBand: String
    var occupation: String
    var home: LocationId
    var traits: [String: Double]
    var values: [String: Double]
    var backstory: String
    var credits: Double
    var food: Double
    var goal: String
}

enum Intervention {
    case drought(severity: Double, durationDays: Double)
    case storm(severity: Double, locationIds: [LocationId])
    case grant(agentId: Id, resource: Resource, amount: Double)
    case kill(agentId: Id, cause: String)
    case whisper(agentId: Id, presetKey: String, text: String, strength: Double, aboutAgentId: Id?)
    case rumor(aboutAgentId: Id, presetKey: String, text: String, seedLocationId: LocationId?)
    case createCharacter(NewCharacter)
}

struct InterventionResult {
    var ok: Bool
    var message: String?
    var affectedAgentIds: [Id] = []
    var createdAgentId: Id?
}

// MARK: - Avatars

let GOAL_KINDS = ["survive", "earn_wealth", "acquire_resource", "protect_person", "improve_relationship", "gain_influence", "change_job", "join_faction", "avoid_person", "investigate", "custom"]

enum PersonaSourceKind: String, Codable, Hashable { case gmail, ai_memory, about_me }

struct PersonaSourceInput: Hashable {
    var kind: PersonaSourceKind
    /// 1..60 chars, e.g. "Gmail, last 180 days".
    var label: String
    /// The digested text, 20..8000 chars.
    var text: String
}

struct PersonaSourcePublic: Codable, Identifiable, Hashable {
    var id: Id
    var kind: PersonaSourceKind
    var label: String
    var chars: Double
    var preview: String
    var addedAt: Double
}

/// How an avatar thinks and talks.
struct AvatarPersona: Codable, Hashable {
    var summary: String
    var interests: [String]
    var speechStyle: String
    var habits: [String]
}

struct AvatarGoal: Codable, Hashable {
    var kind: String
    var description: String
}

/// The character built from the player's sources. The player can edit it before spawning.
struct AvatarProfile: Codable, Hashable {
    var name: String
    var spriteId: String
    var ageBand: String
    var occupation: String
    var homeLocationId: LocationId
    var traits: [String: Double]
    var values: [String: Double]
    var backstory: String
    var goals: [AvatarGoal]
    var summary: String
    var interests: [String]
    var speechStyle: String
    var habits: [String]

    var persona: AvatarPersona { AvatarPersona(summary: summary, interests: interests, speechStyle: speechStyle, habits: habits) }
    var first: String { String(name.split(separator: " ").first ?? "") }
}

struct AvatarDirective: Codable, Hashable {
    var text: String
    var tick: Double
    var worldId: Id
}

struct AvatarPublic: Codable, Hashable {
    var sources: [PersonaSourcePublic]
    var profile: AvatarProfile?
    /// "llm", "rules" or "player".
    var profileSource: String?
    var agentId: Id?
    /// Newest first, up to 5.
    var directives: [AvatarDirective]
}

/// Answer of the avatar mutations and actions: { ok: true, ... } or { ok: false, message }.
struct AvatarResult: Decodable {
    var ok: Bool
    var message: String?
    var agentId: Id?
    var profile: AvatarProfile?
    var profileSource: String?
}

// MARK: - Multiplayer

struct PlayerPublic: Codable, Identifiable, Hashable {
    var id: Id
    var name: String
    var isHost: Bool
    var isYou: Bool
    var online: Bool
    var avatarAgentId: Id?
    var avatarName: String?
}

struct MultiplayerPublic: Codable, Hashable {
    var worldId: Id
    var inviteCode: String?
    var isHost: Bool
    /// Host first, then by join time.
    var players: [PlayerPublic]
    var maxPlayers: Double
}

struct MultiplayerResult: Decodable {
    var ok: Bool
    var message: String?
    var worldId: Id?
    var inviteCode: String?
}

/// Removes email addresses, phone numbers and links, as the backend does before storing a source.
enum Scrub {
    private static let patterns = [
        #"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}"#,
        #"(https?://|www\.)\S+"#,
        #"\+?\d[\d\s().\-]{7,}\d"#,
    ]

    static func text(_ s: String) -> String {
        var out = s
        for p in patterns { out = out.replacingOccurrences(of: p, with: "", options: .regularExpression) }
        out = out.replacingOccurrences(of: #"[ \t]{2,}"#, with: " ", options: .regularExpression)
        return out.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

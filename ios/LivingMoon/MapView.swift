import SwiftUI
import UIKit

/// The pixel art from mobile/assets/game, bundled flat under Art/ by ios/tools/sync-art.mjs.
@MainActor
enum Art {
    private static var cache: [String: UIImage] = [:]
    private static var frames: [String: Image] = [:]

    static func ui(_ name: String, scale: CGFloat = 1) -> UIImage? {
        let key = scale == 1 ? name : "\(name)@\(scale)"
        if let hit = cache[key] { return hit }
        let url = Bundle.main.url(forResource: name, withExtension: "png") ?? Bundle.main.url(forResource: name, withExtension: "png", subdirectory: "Art")
        var image = url.flatMap { UIImage(contentsOfFile: $0.path) }
        if scale != 1, let cg = image?.cgImage { image = UIImage(cgImage: cg, scale: scale, orientation: .up) }
        cache[key] = image
        return image
    }

    /// Map art (ground, buildings, characters, fx) is drawn at MapLayout.artScale pixels per world px,
    /// so its size comes back in world px.
    static func map(_ name: String) -> UIImage? { ui(name, scale: MapLayout.artScale) }

    static func image(_ name: String) -> Image? {
        ui(name).map { Image(uiImage: $0).interpolation(.none) }
    }

    static func portrait(_ spriteId: String) -> Image? { IconArt.portraits[spriteId].flatMap(image) }

    /// One frame of a colonist from the character atlas. Directions: 0 down, 1 left, 2 right, 3 up.
    static func sprite(_ spriteId: String, direction: Int, frame: Int) -> Image? {
        let key = "\(spriteId)/\(direction)/\(frame)"
        if let hit = frames[key] { return hit }
        guard let row = CharacterArt.rows[spriteId], let atlas = ui(CharacterArt.atlas)?.cgImage else { return nil }
        let s = MapLayout.artScale
        let size = CGSize(width: CharacterArt.frame.width * s, height: CharacterArt.frame.height * s)
        let col = direction * CharacterArt.framesPerDirection + frame
        let rect = CGRect(x: CGFloat(col) * size.width, y: CGFloat(row) * size.height, width: size.width, height: size.height)
        guard let cropped = atlas.cropping(to: rect) else { return nil }
        let image = Image(uiImage: UIImage(cgImage: cropped)).interpolation(.none)
        frames[key] = image
        return image
    }
}

/// How each kind of action looks on the map: a floating emote and a way of moving.
enum ActionFX {
    enum Style { case aggressive, bouncy, sneaky, sad, busy, calm }

    static func kind(of a: AgentLite) -> String? {
        if let k = a.act?.kind { return k }
        switch a.activity {
        case "sleeping": return "sleep"
        case "eating": return "eat"
        case "drinking": return "drink"
        case "working": return "work"
        case "stealing": return "steal"
        case "mourning": return "mourn"
        case "helping": return "help"
        case "giving": return "give"
        case "trading": return "barter"
        case "investigating": return "investigate"
        default: return nil
        }
    }

    static func style(_ kind: String) -> Style {
        switch kind {
        case "fight", "duel", "rob", "extort", "threaten", "intimidate", "vandalize", "sabotage", "kill", "attack", "brawl", "chase", "arrest": return .aggressive
        case "dance", "carouse", "celebrate", "perform", "kiss", "rally", "strike", "ritual", "preach", "gamble", "propose": return .bouncy
        case "steal", "spy", "eavesdrop", "hide", "smuggle", "lie", "blackmail": return .sneaky
        case "cry", "mourn", "beg", "confess": return .sad
        case "work", "build", "repair", "experiment", "create_art", "study", "grow", "scavenge", "teach", "investigate": return .busy
        default: return .calm
        }
    }

    static func emote(_ kind: String) -> String? {
        switch kind {
        case "fight", "brawl", "attack", "threaten", "intimidate", "arrest": return "💢"
        case "duel", "kill": return "⚔️"
        case "rob", "extort", "bribe", "borrow", "repay", "sell", "buy": return "💰"
        case "vandalize": return "💥"
        case "sabotage", "repair", "build": return "🔨"
        case "steal", "lie", "confide": return "🤫"
        case "spy", "eavesdrop": return "👂"
        case "hide": return "👀"
        case "smuggle", "barter", "give": return "📦"
        case "blackmail": return "✉️"
        case "preach": return "📣"
        case "ritual": return "🕯️"
        case "recruit", "help", "join_org", "found_org", "reconcile": return "🤝"
        case "perform": return "🎵"
        case "dance": return "🎶"
        case "carouse": return "🍺"
        case "gamble": return "🎲"
        case "court": return "💕"
        case "kiss": return "❤️"
        case "propose": return "💍"
        case "comfort", "care": return "🫂"
        case "cry", "mourn": return "💧"
        case "celebrate": return "🎉"
        case "accuse", "confess": return "❗"
        case "rally", "org_action": return "✊"
        case "strike", "petition": return "📜"
        case "study", "teach": return "📖"
        case "experiment": return "⚗️"
        case "create_art": return "🎨"
        case "work": return "⚙️"
        case "grow": return "🌱"
        case "scavenge": return "🔩"
        case "investigate": return "🔍"
        case "sleep", "rest": return "💤"
        case "eat", "ration": return "🍽️"
        case "drink": return "🥤"
        case "flee", "chase": return "💨"
        case "beg": return "🙏"
        case "adopt_pet": return "🐾"
        default: return nil
        }
    }
}

/// Where a colonist stands or walks at a given (fractional) tick, in world pixels.
@MainActor
enum Placement {
    private static var paths: [String: [CGPoint]] = [:]

    private static func hash(_ s: String) -> UInt32 {
        s.utf8.reduce(5381) { ($0 &<< 5) &+ $0 &+ UInt32($1) }
    }

    /// A stable spot on the open floor of a location, picked per colonist and weighted by floor area.
    static func stand(_ id: Id, at loc: LocationId) -> CGPoint {
        let areas = MapLayout.locations[loc]!.standAreas
        let h = hash(id)
        let total = areas.reduce(0) { $0 + $1.width * $1.height }
        var pick = CGFloat(h % 10007) / 10007 * total
        let r = areas.first { area in
            pick -= area.width * area.height
            return pick <= 0
        } ?? areas[areas.count - 1]
        return CGPoint(x: r.minX + CGFloat((h / 7) % 997) / 997 * r.width, y: r.minY + CGFloat((h / 6997) % 991) / 991 * r.height)
    }

    /// The walk from one location to another: off the floor, through each door and along the painted
    /// tubes and tracks (ROUTE_WAYPOINTS), onto the floor at the destination.
    private static func path(_ id: Id, _ move: Move) -> [CGPoint] {
        let key = "\(id)/\(move.from.rawValue)/\(move.to.rawValue)"
        if let hit = paths[key] { return hit }
        let nodes = findPath(move.from, move.to)?.nodes ?? [move.from, move.to]
        var pts = [stand(id, at: move.from)]
        for (a, b) in zip(nodes, nodes.dropFirst()) {
            for p in MapLayout.leg(a, b) where p != pts.last { pts.append(p) }
        }
        pts.append(stand(id, at: move.to))
        if paths.count > 2000 { paths.removeAll() }
        paths[key] = pts
        return pts
    }

    /// Every living colonist's position, with standing colonists who share a spot nudged apart into a tidy
    /// row so sprites never pile on top of each other. Each stays inside the stand area it was placed in.
    static func placements(_ agents: [AgentLite], at tick: Double) -> [(AgentLite, (point: CGPoint, heading: Int?))] {
        var placed = agents.filter(\.alive).map { ($0, position(of: $0, at: tick)) }
        let standing = placed.indices.filter { placed[$0].1.heading == nil }
        let areas: [Int: CGRect] = Dictionary(uniqueKeysWithValues: standing.compactMap { i -> (Int, CGRect)? in
            let p = placed[i].1.point
            return MapLayout.locations[placed[i].0.locationId]?.standAreas.first { $0.insetBy(dx: -1, dy: -1).contains(p) }.map { (i, $0) }
        })
        let gapX: CGFloat = 14, gapY: CGFloat = 10
        for _ in 0..<10 {
            var moved = false
            for (n, i) in standing.enumerated() {
                for j in standing[(n + 1)...] where placed[j].0.locationId == placed[i].0.locationId {
                    let a = placed[i].1.point, b = placed[j].1.point
                    let dx = b.x - a.x, dy = b.y - a.y
                    let ox = gapX - abs(dx), oy = gapY - abs(dy)
                    guard ox > 0, oy > 0 else { continue }
                    moved = true
                    let tieLeft: CGFloat = placed[i].0.id < placed[j].0.id ? 1 : -1
                    var push = CGVector(dx: 0, dy: 0)
                    if ox / gapX <= oy / gapY || (areas[i]?.height ?? 0) < gapY * 2 {
                        push.dx = (dx == 0 ? tieLeft : (dx > 0 ? 1 : -1)) * (ox / 2 + 0.5)
                    } else {
                        push.dy = (dy == 0 ? tieLeft : (dy > 0 ? 1 : -1)) * (oy / 2 + 0.5)
                    }
                    placed[i].1.point = clamp(CGPoint(x: a.x - push.dx, y: a.y - push.dy), to: areas[i])
                    placed[j].1.point = clamp(CGPoint(x: b.x + push.dx, y: b.y + push.dy), to: areas[j])
                }
            }
            if !moved { break }
        }
        return placed
    }

    private static func clamp(_ p: CGPoint, to area: CGRect?) -> CGPoint {
        guard let r = area else { return p }
        return CGPoint(x: min(max(p.x, r.minX), r.maxX), y: min(max(p.y, r.minY), r.maxY))
    }

    /// Position and the direction of travel (0 down, 1 left, 2 right, 3 up), or nil when standing.
    static func position(of a: AgentLite, at tick: Double) -> (point: CGPoint, heading: Int?) {
        guard let move = a.move, tick < move.arriveTick else { return (stand(a.id, at: a.locationId), nil) }
        let pts = path(a.id, move)
        guard tick > move.departTick else { return (pts[0], nil) }
        var lengths: [CGFloat] = []
        for i in 1..<pts.count { lengths.append(hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)) }
        let total = lengths.reduce(0, +)
        var remaining = total * CGFloat((tick - move.departTick) / max(0.001, move.arriveTick - move.departTick))
        for i in 1..<pts.count {
            let len = lengths[i - 1]
            if remaining <= len || i == pts.count - 1 {
                let t = len > 0 ? min(1, remaining / len) : 1
                let a = pts[i - 1], b = pts[i]
                let p = CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t)
                let dx = b.x - a.x, dy = b.y - a.y
                let heading = abs(dx) > abs(dy) ? (dx < 0 ? 1 : 2) : (dy < 0 ? 3 : 0)
                return (p, heading)
            }
            remaining -= len
        }
        return (pts.last!, nil)
    }
}

/// The colony map: ground, buildings and colonists drawn from the pixel art, with pan and pinch.
/// With focus set, the camera tracks that colonist (follow mode) and glides when the focus changes. With a lens, the map shows the
/// colony as that colonist sees it: the people they know, how they feel about them, what they believe.
struct MapView: View {
    @Environment(Game.self) private var game
    var focus: Id? = nil
    /// Where the followed colonist sits vertically, as a fraction of the height.
    var focusAnchor: CGFloat = 0.3
    var lens: AgentDetail? = nil

    @State private var center = CGPoint(x: 640, y: 960)
    /// Starts zoomed in past the fit so the map pans both ways; pinching out to 1 shows the whole map.
    @State private var zoom: CGFloat = 1.6
    @State private var glide: (from: CGPoint, start: Date)?
    @State private var lastCenter = LastCenter()
    /// Where the camera was when a flight began, to ease from there to the new centre and zoom.
    @State private var flightFrom: (center: CGPoint, zoom: CGFloat, start: Date)?
    @GestureState private var drag: CGSize = .zero
    @GestureState private var pinch: CGFloat = 1

    /// The camera centre of the last frame, kept outside SwiftUI state so drawing never invalidates.
    private final class LastCenter { var point: CGPoint? }

    var body: some View {
        GeometryReader { geo in
            TimelineView(.animation) { timeline in
                let tick = game.displayTick(at: timeline.date)
                let cam = camera(geo.size, tick: tick, date: timeline.date)
                Canvas { ctx, size in
                    draw(&ctx, size: size, cam: cam, tick: tick, date: timeline.date)
                }
                .contentShape(Rectangle())
                .gesture(SpatialTapGesture().onEnded { tap($0.location, cam: cam, tick: tick) })
            }
            .gesture(panAndPinch(geo.size), isEnabled: focus == nil)
            .onChange(of: game.flight) { _, flight in
                guard let flight, focus == nil else { return }
                flightFrom = (center, zoom, Date())
                zoom = min(4, max(1, flight.zoom))
                center = clamp(flight.point, k: fit(geo.size) * zoom, size: geo.size)
            }
        }
        .ignoresSafeArea()
        .background(Color.black)
        .onChange(of: focus) { old, new in
            if old != nil, new != nil, let from = lastCenter.point { glide = (from, Date()) }
        }
    }

    private struct Camera {
        let k: CGFloat
        let origin: CGPoint
        func screen(_ p: CGPoint) -> CGPoint { CGPoint(x: origin.x + p.x * k, y: origin.y + p.y * k) }
    }

    private func fit(_ s: CGSize) -> CGFloat { max(s.width / MapLayout.size.width, s.height / MapLayout.size.height) }

    private func camera(_ s: CGSize, tick: Double, date: Date) -> Camera {
        if let f = game.colonist(focus) {
            let k = fit(s) * 2.6
            var p = Placement.position(of: f, at: tick).point
            if let glide {
                let t = min(1, date.timeIntervalSince(glide.start) / 1.1)
                let e = CGFloat(t < 0.5 ? 2 * t * t : 1 - pow(-2 * t + 2, 2) / 2)
                p = CGPoint(x: glide.from.x + (p.x - glide.from.x) * e, y: glide.from.y + (p.y - glide.from.y) * e)
            }
            lastCenter.point = p
            let x = min(0, max(s.width - MapLayout.size.width * k, s.width / 2 - p.x * k))
            let y = min(0, max(s.height - MapLayout.size.height * k, s.height * focusAnchor - p.y * k))
            return Camera(k: k, origin: CGPoint(x: x, y: y))
        }
        var k = fit(s) * zoom * pinch
        var c = clamp(CGPoint(x: center.x - drag.width / k, y: center.y - drag.height / k), k: k, size: s)
        if let from = flightFrom {
            let p = min(1, date.timeIntervalSince(from.start) / 1.3)
            if p < 1 {
                let e = p < 0.5 ? 4 * p * p * p : 1 - pow(-2 * p + 2, 3) / 2
                k = fit(s) * (from.zoom + (zoom - from.zoom) * e)
                let a = clamp(from.center, k: k, size: s)
                c = clamp(CGPoint(x: a.x + (c.x - a.x) * e, y: a.y + (c.y - a.y) * e), k: k, size: s)
            }
        }
        return Camera(k: k, origin: CGPoint(x: s.width / 2 - c.x * k, y: s.height / 2 - c.y * k))
    }

    private func clamp(_ c: CGPoint, k: CGFloat, size s: CGSize) -> CGPoint {
        let hw = s.width / 2 / k, hh = s.height / 2 / k
        let x = MapLayout.size.width <= hw * 2 ? MapLayout.size.width / 2 : min(max(c.x, hw), MapLayout.size.width - hw)
        let y = MapLayout.size.height <= hh * 2 ? MapLayout.size.height / 2 : min(max(c.y, hh), MapLayout.size.height - hh)
        return CGPoint(x: x, y: y)
    }

    private func panAndPinch(_ s: CGSize) -> some Gesture {
        SimultaneousGesture(
            DragGesture(minimumDistance: 4)
                .updating($drag) { v, state, _ in state = v.translation }
                .onEnded { v in
                    flightFrom = nil
                    let k = fit(s) * zoom
                    center = clamp(CGPoint(x: center.x - v.translation.width / k, y: center.y - v.translation.height / k), k: k, size: s)
                },
            MagnifyGesture()
                .updating($pinch) { v, state, _ in state = min(4 / zoom, max(1 / zoom, v.magnification)) }
                .onEnded { v in
                    flightFrom = nil
                    zoom = min(4, max(1, zoom * v.magnification))
                }
        )
    }

    private func tap(_ p: CGPoint, cam: Camera, tick: Double) {
        let world = CGPoint(x: (p.x - cam.origin.x) / cam.k, y: (p.y - cam.origin.y) / cam.k)
        let reach = 24 / cam.k
        let nearest = Placement.placements(game.agents, at: tick)
            .map { e -> (AgentLite, CGFloat) in (e.0, hypot(e.1.point.x - world.x, e.1.point.y - 18 - world.y)) }
            .min { $0.1 < $1.1 }
        if let focus {
            if let (a, d) = nearest, d < reach, a.id != focus { game.follow(a.id) }
            return
        }
        if let (a, d) = nearest, d < reach {
            game.selectedLocation = nil
            game.selectedID = a.id
        } else {
            game.selectedLocation = MapLayout.location(at: world)
        }
    }

    // MARK: Drawing

    private func tile(_ name: String?, over rect: CGRect, in map: GraphicsContext, opacity: Double) {
        guard let name, let img = Art.map(name) else { return }
        var layer = map
        layer.clip(to: Path(rect))
        layer.opacity = opacity
        let image = Image(uiImage: img).interpolation(.none)
        var y = rect.minY
        while y < rect.maxY {
            var x = rect.minX
            while x < rect.maxX {
                layer.draw(image, in: CGRect(origin: CGPoint(x: x, y: y), size: img.size))
                x += img.size.width
            }
            y += img.size.height
        }
    }

    private func draw(_ ctx: inout GraphicsContext, size: CGSize, cam: Camera, tick: Double, date: Date) {
        let world = game.world
        let t = date.timeIntervalSinceReferenceDate
        var map = ctx
        map.translateBy(x: cam.origin.x, y: cam.origin.y)
        map.scaleBy(x: cam.k, y: cam.k)
        if let ground = Art.image(MapLayout.ground) { map.draw(ground, in: CGRect(origin: .zero, size: MapLayout.size)) }

        let damaged = Set((world?.damage ?? [:]).filter { $0.value > 0 }.keys)
        for loc in LocationId.allCases {
            guard let b = MapLayout.buildings[loc] else { continue }
            let box = CGRect(origin: b.origin, size: b.size)
            if let img = Art.image(b.base) { map.draw(img, in: box) }
            if damaged.contains(loc.rawValue), let name = b.damaged, let img = Art.image(name) { map.draw(img, in: box) }
        }

        for a in game.agents where !a.alive {
            guard let grave = Art.map(IconArt.grave) else { break }
            let p = Placement.stand(a.id, at: a.locationId)
            // The body lies where they fell for a while before the grave marks the spot.
            let since = game.diedAt[a.id].map { date.timeIntervalSince($0) } ?? 999
            if since < 40, let sprite = Art.sprite(a.spriteId, direction: 0, frame: 0) {
                var body = map
                body.translateBy(x: p.x, y: p.y - 5)
                body.rotate(by: .degrees(90 * min(1, since / 0.5)))
                body.opacity = since > 34 ? max(0, (40 - since) / 6) : 1
                body.fill(Path(ellipseIn: CGRect(x: -16, y: -9, width: 30, height: 18)), with: .color(.red.opacity(0.28 * min(1, since / 6))))
                body.draw(sprite, in: CGRect(x: -CharacterArt.feet.x, y: -CharacterArt.feet.y + 6, width: CharacterArt.frame.width, height: CharacterArt.frame.height))
                if since < 34 { continue }
            }
            map.draw(Image(uiImage: grave).interpolation(.none), in: CGRect(x: p.x - grave.size.width / 2, y: p.y - grave.size.height + 2, width: grave.size.width, height: grave.size.height))
        }

        let seconds = date.timeIntervalSinceReferenceDate
        let frame = Int(seconds * 8) % CharacterArt.framesPerDirection
        let marked = focus ?? game.selectedID
        var placed = Placement.placements(game.agents, at: tick)
        // Whoever acts on someone steps up beside them, so a fight, a kiss or a shakedown reads at a glance.
        var spot: [Id: Int] = [:]
        for (i, e) in placed.enumerated() { spot[e.0.id] = i }
        var facing: [Id: Int] = [:]
        var struck: Set<Id> = []
        for i in placed.indices {
            let a = placed[i].0
            guard placed[i].1.heading == nil, let act = a.act, let tid = act.targetId, let j = spot[tid], placed[j].1.heading == nil, placed[j].0.locationId == a.locationId else { continue }
            let other = placed[j].0
            if other.act?.targetId == a.id, other.id < a.id { continue }
            let from = placed[i].1.point, to = placed[j].1.point
            let side: CGFloat = from.x <= to.x ? -1 : 1
            let u = CGFloat(min(1, max(0, (tick - act.startTick) / 0.5)))
            let e = u * u * (3 - 2 * u)
            let goal = CGPoint(x: to.x + side * 15, y: to.y + 1)
            placed[i].1.point = CGPoint(x: from.x + (goal.x - from.x) * e, y: from.y + (goal.y - from.y) * e)
            facing[a.id] = side < 0 ? 2 : 1
            if facing[other.id] == nil { facing[other.id] = side < 0 ? 1 : 2 }
            if ActionFX.style(act.kind) == .aggressive, e > 0.9 { struck.insert(other.id) }
        }
        placed.sort { ($0.0.id == marked ? 1 : 0, $0.1.point.y) < ($1.0.id == marked ? 1 : 0, $1.1.point.y) }
        let feet = CharacterArt.feet, fsize = CharacterArt.frame
        let close = cam.k >= fit(size) * 2.2
        let reacting = game.reactions.compactMapValues { since -> Double? in
            let age = date.timeIntervalSince(since)
            return age < 6 ? age : nil
        }

        for (a, pos) in placed {
            guard let age = reacting[a.id], age < 3 else { continue }
            let rx = 10 + age * 20
            map.stroke(ellipse(pos.point, rx, rx * 0.4), with: .color(Color.amber.opacity(0.9 * (1 - age / 3))), lineWidth: 2)
        }
        for (a, pos) in placed {
            var p = pos.point
            let kind = pos.heading == nil ? ActionFX.kind(of: a) : (a.act?.kind == "flee" || a.act?.kind == "chase" ? a.act?.kind : nil)
            let style = kind.map(ActionFX.style) ?? .calm
            let phase = Double(a.id.utf8.reduce(0) { ($0 &+ Int($1)) % 97 }) / 9.7
            let t = seconds + phase
            var opacity = 1.0
            if pos.heading == nil {
                switch style {
                case .aggressive:
                    let dir: CGFloat = facing[a.id] == 1 ? -1 : 1
                    p.x += dir * CGFloat(max(0, sin(t * 9))) * 4
                    p.y -= CGFloat(abs(sin(t * 9))) * 1.5
                case .bouncy: p.y -= CGFloat(abs(sin(t * 6))) * 4
                case .busy: p.y -= CGFloat(abs(sin(t * 5))) * 1.2
                case .sneaky: opacity = 0.6
                case .sad, .calm: break
                }
                if struck.contains(a.id) { p.x += CGFloat(sin(t * 34)) * 1.4 }
            }
            if a.id == marked {
                let ring = CGRect(x: p.x - 13, y: p.y - 4.5, width: 26, height: 9)
                map.fill(Path(ellipseIn: ring), with: .color(.amber.opacity(0.22)))
                map.stroke(Path(ellipseIn: ring), with: .color(.amber.opacity(0.9)), lineWidth: 1)
            } else if a.ownerName != nil {
                let ring = CGRect(x: p.x - 13, y: p.y - 5, width: 26, height: 10)
                let mine = game.isMine(a.id)
                map.fill(Path(ellipseIn: ring), with: .color(.amber.opacity(mine ? 0.35 : 0.12)))
                map.stroke(Path(ellipseIn: ring), with: .color(.amber), style: StrokeStyle(lineWidth: 1.5, dash: mine ? [] : [3, 2]))
            }
            if let sprite = Art.sprite(a.spriteId, direction: pos.heading ?? facing[a.id] ?? 0, frame: pos.heading == nil ? 0 : frame) {
                var body = map
                body.opacity = opacity
                body.draw(sprite, in: CGRect(x: p.x - feet.x, y: p.y - feet.y, width: fsize.width, height: fsize.height))
                if struck.contains(a.id), sin(t * 9) > 0.55 {
                    map.draw(Text("💥").font(.system(size: 11)), at: CGPoint(x: p.x, y: p.y - fsize.height * 0.45), anchor: .center)
                }
            }
            // The action's emote drifts up from their head; quiet ones only when the camera is close.
            if let kind, let emote = ActionFX.emote(kind), close || style == .aggressive || style == .bouncy || style == .sad {
                let u = (t * 0.7).truncatingRemainder(dividingBy: 1)
                var fx = map
                fx.opacity = (u < 0.15 ? u / 0.15 : 1 - max(0, (u - 0.6) / 0.4)) * (style == .busy || style == .calm ? 0.8 : 1)
                let lift: CGFloat = a.id == marked ? 16 : 4
                fx.draw(Text(emote).font(.system(size: style == .busy || style == .calm ? 8 : 10)), at: CGPoint(x: p.x + 7, y: p.y - feet.y - lift - CGFloat(u) * 8), anchor: .center)
            }
            if a.id == marked, let pointer = Art.map(IconArt.selection) {
                let bob = CGFloat(sin(seconds * 4)) * 2
                map.draw(Image(uiImage: pointer).interpolation(.none), in: CGRect(x: p.x - pointer.size.width / 2, y: p.y - feet.y - pointer.size.height - 2 + bob, width: pointer.size.width, height: pointer.size.height))
            }
        }

        for loc in LocationId.allCases {
            guard let b = MapLayout.buildings[loc], let name = b.overlay, let img = Art.image(name) else { continue }
            map.draw(img, in: CGRect(origin: b.origin, size: b.size))
        }

        for loc in LocationId.allCases where damaged.contains(loc.rawValue) { smoke(map, over: loc, t: t) }
        for effect in world?.activeEffects ?? [] {
            if effect.type == "drought" {
                drought(ctx, size: size, severity: effect.severity, t: t)
                for loc in [LocationId.ice_wells, .hydroponics] {
                    tile(IconArt.droughtOverlay, over: MapLayout.locations[loc]!.footprint, in: map, opacity: 0.35 + effect.severity * 0.4)
                }
            } else {
                let sites = effect.locationIds.isEmpty ? LocationId.allCases.filter { $0.def.exposed } : effect.locationIds
                for (i, s) in sites.enumerated() {
                    tile(IconArt.stormOverlay, over: MapLayout.locations[s]!.footprint.insetBy(dx: -12, dy: -12), in: map, opacity: 0.5 + effect.severity * 0.4)
                    storm(map, at: s, index: i, t: t)
                }
                ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .radialGradient(Gradient(colors: [.clear, .red.opacity(0.18 + 0.06 * sin(t * 2))]), center: CGPoint(x: size.width / 2, y: size.height / 2), startRadius: size.width * 0.45, endRadius: size.height * 0.8))
            }
        }
        if let loc = game.selectedLocation, focus == nil {
            map.stroke(Path(MapLayout.locations[loc]!.footprint.insetBy(dx: -6, dy: -6)), with: .color(.white.opacity(0.8)), lineWidth: 2)
        }

        var labels = ctx
        labels.addFilter(.shadow(color: .black.opacity(0.7), radius: 1.5))
        for loc in LocationId.allCases {
            let l = MapLayout.locations[loc]!
            let hurt = damaged.contains(loc.rawValue)
            let p = CGPoint(x: cam.origin.x + l.center.x * cam.k, y: cam.origin.y + l.footprint.minY * cam.k - 6)
            labels.draw(Text(loc.name.uppercased()).font(.system(size: 7, weight: .semibold, design: .rounded)).tracking(1.2).foregroundStyle(hurt ? Color.red.opacity(0.9) : Color.white.opacity(0.42)), at: p, anchor: .center)
        }

        // Names only for the followed and selected colonists, plus the few nearest the camera's focus when zoomed in.
        var named: [Id] = [focus, game.selectedID].compactMap { $0 }
        if cam.k >= fit(size) * 2.2 {
            let anchor = CGPoint(x: size.width / 2, y: focus == nil ? size.height / 2 : size.height * focusAnchor)
            let eye = CGPoint(x: (anchor.x - cam.origin.x) / cam.k, y: (anchor.y - cam.origin.y) / cam.k)
            let already = named
            let nearby = placed.filter { !already.contains($0.0.id) }
                .map { ($0.0.id, hypot($0.1.point.x - eye.x, $0.1.point.y - eye.y)) }
                .filter { $0.1 < 110 }
                .sorted { $0.1 < $1.1 }
                .prefix(3)
                .map { $0.0 }
            named += nearby
        }
        var taken: [CGRect] = []
        for id in named {
            guard let (a, pos) = placed.first(where: { $0.0.id == id }) else { continue }
            let isMarked = a.id == marked
            let text = ctx.resolve(Text(a.first).font(.system(size: 8.5, weight: .semibold, design: .rounded)).foregroundStyle(isMarked ? Color.amber : Color.white.opacity(0.9)))
            let s = text.measure(in: CGSize(width: 120, height: 20))
            let p = CGPoint(x: cam.origin.x + pos.point.x * cam.k, y: cam.origin.y + (pos.point.y + 3) * cam.k)
            let pill = CGRect(x: p.x - s.width / 2 - 5, y: p.y, width: s.width + 10, height: s.height + 3)
            if taken.contains(where: { $0.intersects(pill) }) { continue }
            taken.append(pill)
            ctx.fill(Path(roundedRect: pill, cornerRadius: pill.height / 2), with: .color(.black.opacity(0.55)))
            ctx.draw(text, in: pill.insetBy(dx: 5, dy: 1.5))
        }

        for (a, pos) in placed {
            guard let owner = a.ownerName else { continue }
            let mine = game.isMine(a.id)
            let p = CGPoint(x: cam.origin.x + pos.point.x * cam.k, y: cam.origin.y + (pos.point.y - feet.y - 8) * cam.k)
            let tag = ctx.resolve(Text(mine ? "You" : owner).font(.system(size: 10, weight: .bold)).foregroundStyle(mine ? Color.black : .amber))
            let s = tag.measure(in: CGSize(width: 120, height: 20))
            let pill = CGRect(x: p.x - s.width / 2 - 6, y: p.y - s.height - 4, width: s.width + 12, height: s.height + 4)
            ctx.fill(Path(roundedRect: pill, cornerRadius: pill.height / 2), with: .color(mine ? .amber : .black.opacity(0.7)))
            if !mine { ctx.stroke(Path(roundedRect: pill, cornerRadius: pill.height / 2), with: .color(.amber), lineWidth: 1) }
            ctx.draw(tag, in: pill.insetBy(dx: 6, dy: 2))
        }

        let index = Dictionary(placed.map { ($0.0.id, $0.1.point) }, uniquingKeysWith: { a, _ in a })
        var known: Set<Id> = []
        if let lens, let me = index[lens.id] {
            known = drawLens(ctx, lens: lens, at: cam.screen(me), index: index, cam: cam, size: size, t: t)
        }

        let scale = min(1.25, max(0.85, Double(cam.k) / 0.9))
        let bounds = CGRect(origin: .zero, size: size).insetBy(dx: -40, dy: -40)
        // The marked colonist and anyone reacting claim their spot first; in a crowd the rest share one bubble per spot.
        let ranked = placed.sorted { (($0.0.id == marked ? 2 : 0) + (reacting[$0.0.id] != nil ? 1 : 0)) > (($1.0.id == marked ? 2 : 0) + (reacting[$1.0.id] != nil ? 1 : 0)) }
        var taken: [CGPoint] = []
        for (a, pos) in ranked {
            if lens != nil && a.id != lens?.id && !known.contains(a.id) { continue }
            var head = cam.screen(CGPoint(x: pos.point.x, y: pos.point.y - feet.y))
            if a.ownerName != nil { head.y -= 5 * cam.k + 18 }
            guard bounds.contains(head) else { continue }
            let age = reacting[a.id]
            let isMarked = a.id == marked
            if cam.k < 0.5 && !isMarked && age == nil { continue }
            if !isMarked && taken.contains(where: { abs($0.x - head.x) < 22 * scale && abs($0.y - head.y) < 22 * scale }) { continue }
            taken.append(head)
            let bob = sin(t * 2.2 + Double(abs(a.id.hashValue % 100))) * 1.2
            let at = CGPoint(x: head.x, y: head.y + bob)
            if let speech = a.speech, isMarked || cam.k >= 1 {
                speechBubble(ctx, at: at, text: speech, wide: isMarked, width: size.width)
            } else if let age, age < 2.2 {
                thoughtBubble(ctx, at: at, symbol: "exclamationmark", tint: .red, text: nil, scale: scale * (0.4 + 0.6 * popIn(age / 0.45)), width: size.width)
            } else {
                thoughtBubble(ctx, at: at, symbol: a.bubbleSymbol, tint: a.bubbleTint, text: isMarked ? a.activityLabel : nil, scale: scale, width: size.width)
            }
        }
    }

    // MARK: Bubbles

    private func popIn(_ x: Double) -> Double {
        let p = min(1, max(0, x)) - 1
        return 1 + 2.70158 * p * p * p + 1.70158 * p * p
    }

    private func truncated(_ s: String, _ n: Int) -> String { s.count > n ? String(s.prefix(n - 1)) + "…" : s }

    /// A cartoon thought cloud over a colonist's head with a symbol for what they are doing or feeling.
    private func thoughtBubble(_ ctx: GraphicsContext, at head: CGPoint, symbol: String, tint: Color, text: String?, scale s: Double, width screen: CGFloat) {
        let d = 20 * s
        let icon = ctx.resolve(Text(Image(systemName: symbol)).font(.system(size: 10.5 * s, weight: .bold)).foregroundStyle(tint))
        let label = text.map { ctx.resolve(Text(truncated($0, 34)).font(.system(size: 11, weight: .medium)).foregroundStyle(Color(white: 0.12))) }
        let labelSize = label?.measure(in: CGSize(width: 220, height: 30)) ?? .zero
        let width = label == nil ? d : d + labelSize.width + 8
        let x = min(max(head.x + 4 * s - d / 2, 10), max(10, screen - 10 - width))
        let body = CGRect(x: label == nil ? head.x + 4 * s - d / 2 : x, y: head.y - 12 * s - d, width: width, height: d)
        var cloud = Path(roundedRect: body, cornerRadius: d / 2)
        cloud.addEllipse(in: CGRect(x: head.x + 0.5 * s - 2.6 * s, y: head.y - 9.5 * s - 2.6 * s, width: 5.2 * s, height: 5.2 * s))
        cloud.addEllipse(in: CGRect(x: head.x - 1.5 * s - 1.5 * s, y: head.y - 4 * s - 1.5 * s, width: 3 * s, height: 3 * s))
        ctx.fill(cloud.offsetBy(dx: 0, dy: 1.5), with: .color(.black.opacity(0.3)))
        ctx.fill(cloud, with: .color(.white.opacity(0.95)))
        ctx.draw(icon, at: CGPoint(x: body.minX + d / 2, y: body.midY), anchor: .center)
        if let label { ctx.draw(label, at: CGPoint(x: body.minX + d + 2, y: body.midY), anchor: .leading) }
    }

    /// A speech bubble with a tail, for what a colonist is saying out loud.
    private func speechBubble(_ ctx: GraphicsContext, at head: CGPoint, text: String, wide: Bool, width screen: CGFloat) {
        let resolved = ctx.resolve(Text(wide ? text : truncated(text, 42)).font(wide ? .caption : .system(size: 10.5)).foregroundStyle(.black))
        let s = resolved.measure(in: CGSize(width: wide ? 220 : 150, height: 80))
        let bubble = CGRect(x: min(max(head.x - s.width / 2 - 8, 10), max(10, screen - 10 - s.width - 16)), y: head.y - s.height - 20, width: s.width + 16, height: s.height + 10)
        var shape = Path(roundedRect: bubble, cornerRadius: 10)
        shape.move(to: CGPoint(x: head.x - 5, y: bubble.maxY))
        shape.addLine(to: CGPoint(x: head.x, y: bubble.maxY + 7))
        shape.addLine(to: CGPoint(x: head.x + 5, y: bubble.maxY))
        ctx.fill(shape.offsetBy(dx: 0, dy: 1.5), with: .color(.black.opacity(0.3)))
        ctx.fill(shape, with: .color(.white.opacity(0.96)))
        ctx.draw(resolved, in: bubble.insetBy(dx: 8, dy: 5))
    }

    // MARK: Mind lens

    /// Darkens what the colonist cannot see, then draws who they know and what they believe about them.
    /// Returns the people it marked, so only their bubbles stay on.
    private func drawLens(_ ctx: GraphicsContext, lens: AgentDetail, at me: CGPoint, index: [Id: CGPoint], cam: Camera, size: CGSize, t: Double) -> Set<Id> {
        let full = Path(CGRect(origin: .zero, size: size))
        ctx.fill(full, with: .radialGradient(Gradient(stops: [.init(color: .clear, location: 0), .init(color: .clear, location: 0.22), .init(color: Color(red: 0.01, green: 0.02, blue: 0.06).opacity(0.78), location: 1)]), center: me, startRadius: 0, endRadius: max(size.width, size.height) * 0.7))
        ctx.stroke(ellipse(me, 120, 120), with: .color(Color.earth.opacity(0.45)), style: StrokeStyle(lineWidth: 1, dash: [3, 6], dashPhase: t * 12))
        ctx.stroke(ellipse(me, 120 + (t * 40).truncatingRemainder(dividingBy: 60), 120 + (t * 40).truncatingRemainder(dividingBy: 60)), with: .color(Color.earth.opacity(0.25 * (1 - (t * 40).truncatingRemainder(dividingBy: 60) / 60))), lineWidth: 1)

        var marked: Set<Id> = []
        let inset = CGRect(origin: .zero, size: size).insetBy(dx: 70, dy: 120)
        var chips: [(point: CGPoint, text: String, tint: Color, divine: Bool, onScreen: Bool)] = []
        for tie in lens.relationships where tie.toAgentAlive {
            guard let pos = index[tie.toAgentId] else { continue }
            marked.insert(tie.toAgentId)
            let p = cam.screen(pos)
            let onScreen = inset.contains(p)
            let end = onScreen ? p : CGPoint(x: min(max(p.x, inset.minX), inset.maxX), y: min(max(p.y, inset.minY), inset.maxY))
            let tint = Mind.tint(relationship: tie.kind, affinity: tie.affinity)
            var link = Path()
            link.move(to: me)
            link.addLine(to: end)
            ctx.stroke(link, with: .color(tint.opacity(0.55)), style: StrokeStyle(lineWidth: 1.5, dash: [5, 5], dashPhase: -t * 14))
            if onScreen { ctx.stroke(ellipse(CGPoint(x: p.x, y: p.y - 2), 13, 5), with: .color(tint), lineWidth: 1.5) }
            let first = tie.toAgentName.split(separator: " ").first.map(String.init) ?? tie.toAgentName
            let trust = tie.trust >= 0 ? "trusts" : "distrusts"
            chips.append((CGPoint(x: end.x, y: end.y + (onScreen ? 14 : 0)), "\(first) · \(tie.kind) · \(trust)", tint, false, onScreen))
        }
        for belief in lens.beliefs {
            guard let subject = belief.subjectAgentId, let pos = index[subject] else { continue }
            marked.insert(subject)
            let p = cam.screen(pos)
            guard inset.insetBy(dx: -40, dy: -60).contains(p) else { continue }
            chips.append((CGPoint(x: p.x, y: p.y + 30), "\u{201C}" + truncated(belief.text, 30) + "\u{201D}", .earth, belief.divine, true))
        }
        for chip in chips {
            let label = ctx.resolve(Text((chip.divine ? "✦ " : "") + chip.text).font(.system(size: 10, weight: .semibold)).foregroundStyle(.white))
            let s = label.measure(in: CGSize(width: 220, height: 20))
            let rect = CGRect(x: chip.point.x - s.width / 2 - 8, y: chip.point.y - s.height / 2 - 4, width: s.width + 16, height: s.height + 8)
            let shape = Path(roundedRect: rect, cornerRadius: rect.height / 2)
            ctx.fill(shape, with: .color(.black.opacity(0.72)))
            ctx.stroke(shape, with: .color(chip.tint.opacity(0.9)), lineWidth: 1)
            ctx.draw(label, at: CGPoint(x: rect.midX, y: rect.midY), anchor: .center)
        }
        return marked
    }

    // MARK: Effects

    private func noise(_ x: Double) -> Double {
        let v = sin(x * 12.9898) * 43758.5453
        return v - floor(v)
    }

    private func ellipse(_ c: CGPoint, _ rx: Double, _ ry: Double) -> Path {
        Path(ellipseIn: CGRect(x: c.x - rx, y: c.y - ry, width: rx * 2, height: ry * 2))
    }

    /// Meteors falling on a site while a storm lasts, each with a trail, a flash and a shock ring.
    private func storm(_ map: GraphicsContext, at site: LocationId, index si: Int, t: Double) {
        let fp = MapLayout.locations[site]!.footprint
        let zone = Path(roundedRect: fp.insetBy(dx: -14, dy: -14), cornerRadius: 18)
        map.fill(zone, with: .color(.red.opacity(0.08 + 0.05 * sin(t * 3))))
        map.stroke(zone, with: .color(.red.opacity(0.55)), style: StrokeStyle(lineWidth: 2, dash: [10, 8], dashPhase: t * 20))
        let hot = Color(red: 1, green: 0.55, blue: 0.18)
        for j in 0..<4 {
            let seed = Double(si * 7 + j)
            let period = 1.4 + noise(seed + 0.3) * 0.9
            let phase = t / period + noise(seed + 0.5)
            let ph = phase - floor(phase)
            let cycle = floor(phase)
            let impact = CGPoint(x: fp.minX + fp.width * noise(seed + cycle * 3.1), y: fp.minY + fp.height * (0.3 + 0.6 * noise(seed + cycle * 5.7)))
            if ph < 0.35 {
                let f = ph / 0.35
                let origin = CGPoint(x: impact.x + 240, y: impact.y - 380)
                let head = CGPoint(x: origin.x + (impact.x - origin.x) * f, y: origin.y + (impact.y - origin.y) * f)
                let tf = max(0, f - 0.25)
                let tail = CGPoint(x: origin.x + (impact.x - origin.x) * tf, y: origin.y + (impact.y - origin.y) * tf)
                var trail = Path()
                trail.move(to: tail)
                trail.addLine(to: head)
                map.stroke(trail, with: .color(hot.opacity(0.2)), style: StrokeStyle(lineWidth: 14, lineCap: .round))
                map.stroke(trail, with: .linearGradient(Gradient(colors: [.clear, hot, .white]), startPoint: tail, endPoint: head), style: StrokeStyle(lineWidth: 4, lineCap: .round))
                map.fill(ellipse(head, 4, 4), with: .color(.white))
            } else if ph < 0.75 {
                let f = (ph - 0.35) / 0.4
                map.fill(ellipse(impact, 34 * (1 - f) + 6, 34 * (1 - f) + 6), with: .radialGradient(Gradient(colors: [.white.opacity(1 - f), hot.opacity(0.7 * (1 - f)), .clear]), center: impact, startRadius: 0, endRadius: 40))
                map.stroke(ellipse(impact, 8 + 70 * f, (8 + 70 * f) * 0.4), with: .color(hot.opacity(1 - f)), lineWidth: 3 * (1 - f) + 0.5)
            }
        }
    }

    /// Smoke and embers rising from a damaged building until it is repaired.
    private func smoke(_ map: GraphicsContext, over loc: LocationId, t: Double) {
        let fp = MapLayout.locations[loc]!.footprint
        let base = CGPoint(x: fp.midX + 18, y: fp.minY + fp.height * 0.4)
        for i in 0..<8 {
            let phase = t * 0.22 + Double(i) / 8
            let ph = phase - floor(phase)
            let p = CGPoint(x: base.x + sin(ph * 4 + Double(i)) * 12 + ph * 34, y: base.y - ph * 150)
            let r = 10 + ph * 30
            map.fill(ellipse(p, r, r), with: .color(Color(white: 0.2).opacity(0.5 * (1 - ph) * min(1, ph * 6))))
        }
        for i in 0..<5 {
            let flicker = 0.5 + 0.5 * sin(t * (9 + Double(i)) + Double(i) * 2)
            let p = CGPoint(x: base.x - 20 + Double(i) * 10, y: base.y + 8 + noise(Double(i)) * 10)
            map.fill(ellipse(p, 3, 3), with: .color(Color(red: 1, green: 0.5, blue: 0.15).opacity(0.4 + 0.5 * flicker)))
        }
    }

    /// A warm cast, a breathing vignette and drifting dust over the whole view while the wells are dry.
    private func drought(_ ctx: GraphicsContext, size: CGSize, severity: Double, t: Double) {
        let full = Path(CGRect(origin: .zero, size: size))
        ctx.fill(full, with: .color(Color(red: 0.8, green: 0.5, blue: 0.2).opacity(0.10 + severity * 0.12)))
        let breathe = 0.5 + 0.5 * sin(t * 0.8)
        ctx.fill(full, with: .radialGradient(Gradient(colors: [.clear, Color(red: 0.45, green: 0.22, blue: 0.05).opacity(0.35 + 0.15 * breathe)]), center: CGPoint(x: size.width / 2, y: size.height / 2), startRadius: size.width * 0.4, endRadius: size.height * 0.75))
        for i in 0..<36 {
            let speed = 14 + 30 * noise(Double(i) + 0.1)
            let x = (noise(Double(i) + 0.2) * size.width + t * speed).truncatingRemainder(dividingBy: size.width)
            let y = noise(Double(i) + 0.3) * size.height + sin(t + Double(i)) * 8
            ctx.fill(Path(CGRect(x: x, y: y, width: 2, height: 2)), with: .color(Color.amber.opacity(0.3)))
        }
    }
}

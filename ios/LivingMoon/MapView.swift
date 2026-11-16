import SwiftUI
import UIKit

/// The placeholder pixel art from mobile/src/dev/placeholderArt, bundled flat under Art/.
@MainActor
enum Art {
    private static var cache: [String: UIImage] = [:]
    private static var frames: [String: Image] = [:]

    static func ui(_ name: String) -> UIImage? {
        if let hit = cache[name] { return hit }
        let url = Bundle.main.url(forResource: name, withExtension: "png") ?? Bundle.main.url(forResource: name, withExtension: "png", subdirectory: "Art")
        let image = url.flatMap { UIImage(contentsOfFile: $0.path) }
        cache[name] = image
        return image
    }

    static func image(_ name: String) -> Image? {
        ui(name).map { Image(uiImage: $0).interpolation(.none) }
    }

    static func portrait(_ spriteId: String) -> Image? { image(spriteId) }

    /// One frame of a colonist from the character atlas. Directions: 0 down, 1 left, 2 right, 3 up.
    static let frameSize = CGSize(width: 24, height: 36)
    static let feet = CGPoint(x: 12, y: 33)
    static func sprite(_ spriteId: String, direction: Int, frame: Int) -> Image? {
        let key = "\(spriteId)/\(direction)/\(frame)"
        if let hit = frames[key] { return hit }
        let parts = spriteId.split(separator: "_")
        guard parts.count == 2, let archetype = SPRITE_ARCHETYPES.firstIndex(of: String(parts[0])), let variant = Int(parts[1]),
              let atlas = ui("characters")?.cgImage else { return nil }
        let row = archetype * SPRITE_VARIANTS + variant
        let col = direction * 4 + frame
        let rect = CGRect(x: CGFloat(col) * frameSize.width, y: CGFloat(row) * frameSize.height, width: frameSize.width, height: frameSize.height)
        guard let cropped = atlas.cropping(to: rect) else { return nil }
        let image = Image(uiImage: UIImage(cgImage: cropped)).interpolation(.none)
        frames[key] = image
        return image
    }
}

/// Where a colonist stands or walks at a given (fractional) tick, in world pixels.
enum Placement {
    private static func hash(_ s: String) -> UInt32 {
        s.utf8.reduce(5381) { ($0 &<< 5) &+ $0 &+ UInt32($1) }
    }

    static func stand(_ id: Id, at loc: LocationId) -> CGPoint {
        let r = MapLayout.locations[loc]!.stand
        let h = hash(id)
        return CGPoint(x: r.minX + CGFloat(h % 997) / 997 * r.width, y: r.minY + CGFloat((h / 997) % 991) / 991 * r.height)
    }

    /// Position and the direction of travel (0 down, 1 left, 2 right, 3 up), or nil when standing.
    static func position(of a: AgentLite, at tick: Double) -> (point: CGPoint, heading: Int?) {
        guard let move = a.move, tick < move.arriveTick else { return (stand(a.id, at: a.locationId), nil) }
        let start = stand(a.id, at: move.from)
        guard tick > move.departTick else { return (start, nil) }
        let nodes = findPath(move.from, move.to)?.nodes ?? [move.from, move.to]
        let pts = [start] + nodes.map { MapLayout.locations[$0]!.entry } + [stand(a.id, at: move.to)]
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
/// With focus set, the camera tracks that colonist (follow mode). With a lens, the map shows the
/// colony as that colonist sees it: the people they know, how they feel about them, what they believe.
struct MapView: View {
    @Environment(Game.self) private var game
    var focus: Id? = nil
    var lens: AgentDetail? = nil

    @State private var center = CGPoint(x: 640, y: 960)
    /// Starts zoomed in past the fit so the map pans both ways; pinching out to 1 shows the whole map.
    @State private var zoom: CGFloat = 1.6
    /// Where the camera was when a flight began, to ease from there to the new centre and zoom.
    @State private var flightFrom: (center: CGPoint, zoom: CGFloat, start: Date)?
    @GestureState private var drag: CGSize = .zero
    @GestureState private var pinch: CGFloat = 1

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
            let p = Placement.position(of: f, at: tick).point
            return Camera(k: k, origin: CGPoint(x: s.width / 2 - p.x * k, y: s.height * 0.3 - p.y * k))
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
        guard focus == nil else { return }
        let world = CGPoint(x: (p.x - cam.origin.x) / cam.k, y: (p.y - cam.origin.y) / cam.k)
        let reach = 24 / cam.k
        let nearest = game.agents.filter(\.alive)
            .map { a -> (AgentLite, CGFloat) in
                let q = Placement.position(of: a, at: tick).point
                return (a, hypot(q.x - world.x, q.y - 16 - world.y))
            }
            .min { $0.1 < $1.1 }
        if let (a, d) = nearest, d < reach {
            game.selectedLocation = nil
            game.selectedID = a.id
        } else {
            game.selectedLocation = MapLayout.location(at: world)
        }
    }

    // MARK: Drawing

    private func draw(_ ctx: inout GraphicsContext, size: CGSize, cam: Camera, tick: Double, date: Date) {
        let world = game.world
        let t = date.timeIntervalSinceReferenceDate
        var map = ctx
        map.translateBy(x: cam.origin.x, y: cam.origin.y)
        map.scaleBy(x: cam.k, y: cam.k)
        if let ground = Art.image("ground") { map.draw(ground, in: CGRect(origin: .zero, size: MapLayout.size)) }

        let damaged = Set((world?.damage ?? [:]).filter { $0.value > 0 }.keys)
        for loc in LocationId.allCases {
            guard let o = MapLayout.buildingOrigin[loc] else { continue }
            let base = loc.rawValue
            if let img = Art.ui(base + "_base") { map.draw(Image(uiImage: img).interpolation(.none), in: CGRect(origin: o, size: img.size)) }
            if damaged.contains(loc.rawValue), let img = Art.ui(base + "_damaged") { map.draw(Image(uiImage: img).interpolation(.none), in: CGRect(origin: o, size: img.size)) }
        }

        let frame = Int(date.timeIntervalSinceReferenceDate * 6) % 4
        let placed = game.agents.filter(\.alive).map { ($0, Placement.position(of: $0, at: tick)) }.sorted { $0.1.point.y < $1.1.point.y }
        let marked = focus ?? game.selectedID
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
            let p = pos.point
            if a.id == marked {
                let ring = CGRect(x: p.x - 16, y: p.y - 6, width: 32, height: 12)
                map.fill(Path(ellipseIn: ring), with: .color(.amber.opacity(0.35)))
                map.stroke(Path(ellipseIn: ring), with: .color(.amber), lineWidth: 2)
            }
            if let sprite = Art.sprite(a.spriteId, direction: pos.heading ?? 0, frame: pos.heading == nil ? 0 : frame) {
                map.draw(sprite, in: CGRect(x: p.x - Art.feet.x, y: p.y - Art.feet.y, width: Art.frameSize.width, height: Art.frameSize.height))
            }
        }

        for loc in LocationId.allCases {
            guard let o = MapLayout.buildingOrigin[loc], let img = Art.ui(loc.rawValue + "_overlay") else { continue }
            map.draw(Image(uiImage: img).interpolation(.none), in: CGRect(origin: o, size: img.size))
        }

        for loc in LocationId.allCases where damaged.contains(loc.rawValue) { smoke(map, over: loc, t: t) }
        for effect in world?.activeEffects ?? [] {
            if effect.type == "drought" {
                drought(ctx, size: size, severity: effect.severity, t: t)
            } else {
                let sites = effect.locationIds.isEmpty ? LocationId.allCases.filter { $0.def.exposed } : effect.locationIds
                for (i, s) in sites.enumerated() { storm(map, at: s, index: i, t: t) }
                ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .radialGradient(Gradient(colors: [.clear, .red.opacity(0.18 + 0.06 * sin(t * 2))]), center: CGPoint(x: size.width / 2, y: size.height / 2), startRadius: size.width * 0.45, endRadius: size.height * 0.8))
            }
        }
        if let loc = game.selectedLocation, focus == nil {
            map.stroke(Path(MapLayout.locations[loc]!.footprint.insetBy(dx: -6, dy: -6)), with: .color(.white.opacity(0.8)), lineWidth: 2)
        }

        var labels = ctx
        labels.addFilter(.shadow(color: .black.opacity(0.9), radius: 2))
        for loc in LocationId.allCases {
            let l = MapLayout.locations[loc]!
            let p = CGPoint(x: cam.origin.x + l.center.x * cam.k, y: cam.origin.y + l.footprint.minY * cam.k - 8)
            labels.draw(Text(loc.name.uppercased()).font(.system(size: 8.5, weight: .semibold, design: .monospaced)).foregroundStyle(damaged.contains(loc.rawValue) ? .red : .white.opacity(0.8)), at: p, anchor: .center)
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
            let head = cam.screen(CGPoint(x: pos.point.x, y: pos.point.y - Art.feet.y))
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

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
/// With focus set, the camera tracks that colonist (follow mode).
struct MapView: View {
    @Environment(Game.self) private var game
    var focus: Id? = nil

    @State private var center = CGPoint(x: 640, y: 960)
    @State private var zoom: CGFloat = 1
    @GestureState private var drag: CGSize = .zero
    @GestureState private var pinch: CGFloat = 1

    var body: some View {
        GeometryReader { geo in
            TimelineView(.animation) { timeline in
                let tick = game.displayTick(at: timeline.date)
                let cam = camera(geo.size, tick: tick)
                Canvas { ctx, size in
                    draw(&ctx, size: size, cam: cam, tick: tick, date: timeline.date)
                }
                .contentShape(Rectangle())
                .gesture(SpatialTapGesture().onEnded { tap($0.location, cam: cam, tick: tick) })
            }
            .gesture(panAndPinch(geo.size), isEnabled: focus == nil)
        }
        .ignoresSafeArea()
        .background(Color.black)
    }

    private struct Camera { let k: CGFloat; let origin: CGPoint }

    private func fit(_ s: CGSize) -> CGFloat { max(s.width / MapLayout.size.width, s.height / MapLayout.size.height) }

    private func camera(_ s: CGSize, tick: Double) -> Camera {
        if let f = game.colonist(focus) {
            let k = fit(s) * 2.6
            let p = Placement.position(of: f, at: tick).point
            return Camera(k: k, origin: CGPoint(x: s.width / 2 - p.x * k, y: s.height * 0.3 - p.y * k))
        }
        let k = fit(s) * zoom * pinch
        var c = CGPoint(x: center.x - drag.width / k, y: center.y - drag.height / k)
        c = clamp(c, k: k, size: s)
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
                    let k = fit(s) * zoom
                    center = clamp(CGPoint(x: center.x - v.translation.width / k, y: center.y - v.translation.height / k), k: k, size: s)
                },
            MagnifyGesture()
                .updating($pinch) { v, state, _ in state = min(4 / zoom, max(1 / zoom, v.magnification)) }
                .onEnded { v in zoom = min(4, max(1, zoom * v.magnification)) }
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

        for effect in world?.activeEffects ?? [] {
            if effect.type == "drought" {
                ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Color(red: 0.8, green: 0.5, blue: 0.2).opacity(0.10 + effect.severity * 0.12)))
            } else {
                let sites = effect.locationIds.isEmpty ? LocationId.allCases.filter { $0.def.exposed } : effect.locationIds
                for s in sites {
                    let r = MapLayout.locations[s]!.footprint.insetBy(dx: -12, dy: -12)
                    map.stroke(Path(r), with: .color(.red.opacity(0.85)), style: StrokeStyle(lineWidth: 3, dash: [10, 8]))
                    map.fill(Path(r), with: .color(.red.opacity(0.12)))
                }
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

        if let speaker = placed.first(where: { $0.0.id == marked && $0.0.speech != nil }) {
            let p = CGPoint(x: cam.origin.x + speaker.1.point.x * cam.k, y: cam.origin.y + (speaker.1.point.y - 40) * cam.k)
            let text = Text(speaker.0.speech!).font(.caption).foregroundStyle(.black)
            let resolved = ctx.resolve(text)
            let s = resolved.measure(in: CGSize(width: 220, height: 80))
            let bubble = CGRect(x: p.x - s.width / 2 - 8, y: p.y - s.height - 10, width: s.width + 16, height: s.height + 10)
            ctx.fill(Path(roundedRect: bubble, cornerRadius: 10), with: .color(.white.opacity(0.95)))
            ctx.draw(resolved, in: bubble.insetBy(dx: 8, dy: 5))
        }
    }
}

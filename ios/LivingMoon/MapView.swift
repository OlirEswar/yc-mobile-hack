import SwiftUI
import UIKit

/// The pixel art from mobile/assets/game, bundled flat under Art/ by ios/tools/sync-art.mjs.
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

    static func portrait(_ spriteId: String) -> Image? { IconArt.portraits[spriteId].flatMap(image) }

    /// One frame of a colonist from the character atlas. Directions: 0 down, 1 left, 2 right, 3 up.
    static func sprite(_ spriteId: String, direction: Int, frame: Int) -> Image? {
        let key = "\(spriteId)/\(direction)/\(frame)"
        if let hit = frames[key] { return hit }
        guard let row = CharacterArt.rows[spriteId], let atlas = ui(CharacterArt.atlas)?.cgImage else { return nil }
        let size = CharacterArt.frame
        let col = direction * CharacterArt.framesPerDirection + frame
        let rect = CGRect(x: CGFloat(col) * size.width, y: CGFloat(row) * size.height, width: size.width, height: size.height)
        guard let cropped = atlas.cropping(to: rect) else { return nil }
        let image = Image(uiImage: UIImage(cgImage: cropped)).interpolation(.none)
        frames[key] = image
        return image
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
/// With focus set, the camera tracks that colonist (follow mode) and glides when the focus changes.
struct MapView: View {
    @Environment(Game.self) private var game
    var focus: Id? = nil
    /// Where the followed colonist sits vertically, as a fraction of the height.
    var focusAnchor: CGFloat = 0.3

    @State private var center = CGPoint(x: 640, y: 960)
    /// Starts zoomed in past the fit so the map pans both ways; pinching out to 1 shows the whole map.
    @State private var zoom: CGFloat = 1.6
<<<<<<< HEAD
    @State private var glide: (from: CGPoint, start: Date)?
    @State private var lastCenter = LastCenter()
=======
>>>>>>> origin/Onboarding
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
        }
        .ignoresSafeArea()
        .background(Color.black)
        .onChange(of: focus) { old, new in
            if old != nil, new != nil, let from = lastCenter.point { glide = (from, Date()) }
        }
    }

    private struct Camera { let k: CGFloat; let origin: CGPoint }

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
        let world = CGPoint(x: (p.x - cam.origin.x) / cam.k, y: (p.y - cam.origin.y) / cam.k)
        let reach = 24 / cam.k
        let nearest = game.agents.filter(\.alive)
            .map { a -> (AgentLite, CGFloat) in
                let q = Placement.position(of: a, at: tick).point
                return (a, hypot(q.x - world.x, q.y - 18 - world.y))
            }
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
        guard let name, let img = Art.ui(name) else { return }
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
            guard let grave = Art.ui(IconArt.grave) else { break }
            let p = Placement.stand(a.id, at: a.locationId)
            map.draw(Image(uiImage: grave).interpolation(.none), in: CGRect(x: p.x - grave.size.width / 2, y: p.y - grave.size.height + 2, width: grave.size.width, height: grave.size.height))
        }

        let seconds = date.timeIntervalSinceReferenceDate
        let frame = Int(seconds * 8) % CharacterArt.framesPerDirection
        let marked = focus ?? game.selectedID
        let placed = game.agents.filter(\.alive).map { ($0, Placement.position(of: $0, at: tick)) }
            .sorted { ($0.0.id == marked ? 1 : 0, $0.1.point.y) < ($1.0.id == marked ? 1 : 0, $1.1.point.y) }
        let feet = CharacterArt.feet, fsize = CharacterArt.frame
        for (a, pos) in placed {
            let p = pos.point
            if a.id == marked {
                let ring = CGRect(x: p.x - 15, y: p.y - 5, width: 30, height: 10)
                map.fill(Path(ellipseIn: ring), with: .color(.amber.opacity(0.35)))
                map.stroke(Path(ellipseIn: ring), with: .color(.amber), lineWidth: 1.5)
            }
            if let sprite = Art.sprite(a.spriteId, direction: pos.heading ?? 0, frame: pos.heading == nil ? 0 : frame) {
                map.draw(sprite, in: CGRect(x: p.x - feet.x, y: p.y - feet.y, width: fsize.width, height: fsize.height))
            }
            if a.id == marked, let pointer = Art.ui(IconArt.selection) {
                let bob = CGFloat(sin(seconds * 4)) * 2
                map.draw(Image(uiImage: pointer).interpolation(.none), in: CGRect(x: p.x - pointer.size.width / 2, y: p.y - feet.y - pointer.size.height - 2 + bob, width: pointer.size.width, height: pointer.size.height))
            }
        }

        for loc in LocationId.allCases {
            guard let b = MapLayout.buildings[loc], let name = b.overlay, let img = Art.image(name) else { continue }
            map.draw(img, in: CGRect(origin: b.origin, size: b.size))
        }

        for effect in world?.activeEffects ?? [] {
            if effect.type == "drought" {
                ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Color(red: 0.8, green: 0.5, blue: 0.2).opacity(0.08 + effect.severity * 0.1)))
                for loc in [LocationId.ice_wells, .hydroponics] {
                    tile(IconArt.droughtOverlay, over: MapLayout.locations[loc]!.footprint, in: map, opacity: 0.35 + effect.severity * 0.4)
                }
            } else {
                let sites = effect.locationIds.isEmpty ? LocationId.allCases.filter { $0.def.exposed } : effect.locationIds
                for s in sites {
                    let r = MapLayout.locations[s]!.footprint.insetBy(dx: -12, dy: -12)
                    tile(IconArt.stormOverlay, over: r, in: map, opacity: 0.5 + effect.severity * 0.4)
                    map.stroke(Path(r), with: .color(.red.opacity(0.8)), style: StrokeStyle(lineWidth: 3, dash: [10, 8]))
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
        if focus != nil {
            for (a, pos) in placed where a.id != focus {
                let p = CGPoint(x: cam.origin.x + pos.point.x * cam.k, y: cam.origin.y + (pos.point.y + 6) * cam.k)
                labels.draw(Text(a.first).font(.system(size: 9, weight: .medium)).foregroundStyle(.white.opacity(0.75)), at: p, anchor: .top)
            }
        }

        let partner = game.colonist(marked)?.interactingWithId
        var bubbles: [CGRect] = []
        for (a, pos) in placed.reversed() where (a.id == marked || a.id == partner) && a.speech != nil {
            let p = CGPoint(x: cam.origin.x + pos.point.x * cam.k, y: cam.origin.y + (pos.point.y - feet.y - 6) * cam.k)
            let text = Text(a.speech!).font(.caption).foregroundStyle(.black)
            let resolved = ctx.resolve(text)
            let s = resolved.measure(in: CGSize(width: 160, height: 80))
            var bubble = CGRect(x: p.x - s.width / 2 - 8, y: p.y - s.height - 12, width: s.width + 16, height: s.height + 10)
            while let hit = bubbles.first(where: { $0.intersects(bubble) }) { bubble.origin.y = hit.minY - bubble.height - 6 }
            bubbles.append(bubble)
            var tail = Path()
            tail.move(to: CGPoint(x: p.x - 5, y: bubble.maxY - 1))
            tail.addLine(to: CGPoint(x: p.x, y: max(bubble.maxY + 6, p.y - 4)))
            tail.addLine(to: CGPoint(x: p.x + 5, y: bubble.maxY - 1))
            ctx.fill(tail, with: .color(.white.opacity(0.95)))
            ctx.fill(Path(roundedRect: bubble, cornerRadius: 10), with: .color(.white.opacity(0.95)))
            ctx.draw(resolved, in: bubble.insetBy(dx: 8, dy: 5))
        }
    }
}

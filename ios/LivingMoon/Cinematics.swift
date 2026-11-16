import SwiftUI

// Full-screen cinematics that play when a god power lands, then hand over to an aftermath panel
// that shows how the people it touched took it. Everything is drawn procedurally at frame rate.

// MARK: - Maths

private func clamp01(_ x: Double) -> Double { min(1, max(0, x)) }

private func ss(_ a: Double, _ b: Double, _ x: Double) -> Double {
    let t = clamp01((x - a) / (b - a))
    return t * t * (3 - 2 * t)
}

/// A stable pseudo-random number in 0..<1 for an index and a salt.
private func rnd(_ i: Int, _ salt: Int) -> Double {
    let x = sin(Double(i) * 12.9898 + Double(salt) * 78.233) * 43758.5453
    return x - floor(x)
}

private func easeOutBack(_ x: Double) -> Double {
    let c1 = 1.70158
    let c3 = c1 + 1
    let p = x - 1
    return 1 + c3 * p * p * p + c1 * p * p
}

private func lerp(_ a: CGPoint, _ b: CGPoint, _ t: Double) -> CGPoint {
    CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t)
}

private func circle(_ c: CGPoint, _ r: Double) -> Path {
    Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))
}

private func ellipse(_ c: CGPoint, _ rx: Double, _ ry: Double) -> Path {
    Path(ellipseIn: CGRect(x: c.x - rx, y: c.y - ry, width: rx * 2, height: ry * 2))
}

private extension View {
    /// Fades, unblurs and lifts a view in as p goes from 0 to 1.
    func reveal(_ p: Double) -> some View {
        opacity(p).blur(radius: (1 - p) * 8).offset(y: (1 - p) * 14)
    }
}

// MARK: - Overlay

struct CinematicOverlay: View {
    @Environment(Game.self) private var game
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let cinematic: Cinematic

    @State private var start = Date()
    @State private var aftermath = false
    @State private var thud = 0

    private var length: Double {
        switch cinematic.power {
        case .endLife: 4.0
        case .meteors: 3.6
        default: 3.3
        }
    }

    var body: some View {
        let portrait = cinematic.subject.flatMap { Art.portrait($0.spriteId) }
        ZStack {
            TimelineView(.animation) { timeline in
                let t = timeline.date.timeIntervalSince(start)
                let scene = CinematicScene(c: cinematic, t: t, portrait: portrait)
                ZStack {
                    Canvas { ctx, size in scene.draw(&ctx, size: size) }
                    CinematicTitles(c: cinematic, t: t)
                        .opacity(aftermath ? 0 : 1)
                }
                .offset(scene.shake)
            }
            .ignoresSafeArea()

            if aftermath {
                LinearGradient(colors: [.clear, .black.opacity(0.75)], startPoint: .top, endPoint: .bottom)
                    .ignoresSafeArea()
                    .transition(.opacity)
                AftermathPanel(cinematic: cinematic)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            } else {
                VStack {
                    Spacer()
                    Text("Tap to skip")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.white.opacity(0.4))
                        .padding(.bottom, 12)
                }
            }
        }
        .background(Color.black)
        .contentShape(Rectangle())
        .onTapGesture {
            guard !aftermath else { return }
            withAnimation(.smooth(duration: 0.5)) { aftermath = true }
        }
        .sensoryFeedback(trigger: thud) { _, _ in
            cinematic.power.believed ? .impact(flexibility: .soft, intensity: 0.7) : .impact(weight: .heavy, intensity: 1)
        }
        .preferredColorScheme(.dark)
        .task {
            if reduceMotion {
                start = Date().addingTimeInterval(-length)
                aftermath = true
                return
            }
            let began = Date()
            for beat in CinematicScene.beats(cinematic) {
                let wait = beat - Date().timeIntervalSince(began)
                if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
                if Task.isCancelled || aftermath { return }
                thud += 1
            }
            let rest = length - Date().timeIntervalSince(began)
            if rest > 0 { try? await Task.sleep(for: .seconds(rest)) }
            guard !Task.isCancelled, !aftermath else { return }
            withAnimation(.smooth(duration: 0.6)) { aftermath = true }
        }
    }
}

// MARK: - Titles

private struct CinematicTitles: View {
    let c: Cinematic
    let t: Double

    private var centred: Bool { c.power == .endLife || c.power == .whisper || c.power == .arrival }

    var body: some View {
        GeometryReader { geo in
            VStack(spacing: 10) {
                if centred { Spacer().frame(height: geo.size.height * 0.42 + 100) }
                Text(c.power.title.uppercased())
                    .font(.caption.weight(.heavy)).tracking(3)
                    .foregroundStyle(c.power.tint)
                    .reveal(ss(0.35, 0.8, t))
                Text(c.headline)
                    .font(.system(size: centred ? 36 : 32, weight: centred ? .regular : .bold, design: centred ? .serif : .default))
                    .multilineTextAlignment(.center)
                    .shadow(color: .black.opacity(0.6), radius: 10)
                    .reveal(ss(0.55, 1.1, t))
                details
                Spacer()
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 28)
            .padding(.top, centred ? 0 : max(geo.safeAreaInsets.top, 54) + 46)
            .frame(maxWidth: .infinity)
        }
    }

    @ViewBuilder private var details: some View {
        switch c.power {
        case .meteors:
            Text(c.sites.count > 1 ? c.sites.map(\.name).joined(separator: " · ") : "Severity \(Int(c.severity * 100))% · \(c.affected.count) caught in it")
                .font(.subheadline).foregroundStyle(.white.opacity(0.7))
                .multilineTextAlignment(.center)
                .reveal(ss(0.9, 1.4, t))
        case .drought:
            let fall = c.severity * 100 * ss(0.9, 2.6, t)
            VStack(spacing: 10) {
                Text("WATER OUTPUT").font(.caption2.weight(.bold)).tracking(1.6).foregroundStyle(.white.opacity(0.6))
                DotMatrixText(text: "\(Int((100 - fall).rounded()))%", dot: 5, gap: 2.5, color: fall > 40 ? .orange : .white)
                Text("for " + (c.quote ?? "")).font(.subheadline).foregroundStyle(.white.opacity(0.7))
            }
            .padding(.top, 8)
            .reveal(ss(0.8, 1.3, t))
        case .supplyDrop:
            Text("for " + (c.subject?.name ?? "someone")).font(.subheadline).foregroundStyle(.white.opacity(0.7)).reveal(ss(0.9, 1.4, t))
            Text(c.quote ?? "")
                .font(.system(size: 44, weight: .heavy, design: .rounded))
                .foregroundStyle(Color.amber)
                .shadow(color: .amber.opacity(0.6), radius: 16)
                .scaleEffect(0.6 + 0.4 * easeOutBack(clamp01((t - 2.2) / 0.5)))
                .opacity(ss(2.2, 2.4, t))
        case .rumor:
            Text("\u{201C}" + (c.quote ?? "") + "\u{201D}")
                .font(.title3).fontDesign(.serif).italic()
                .multilineTextAlignment(.center)
                .reveal(ss(0.9, 1.5, t))
            Text("about \(c.subject?.name ?? "someone") · starting at \(c.sites.first?.name ?? "the canteen")")
                .font(.footnote).foregroundStyle(.white.opacity(0.6))
                .reveal(ss(1.3, 1.8, t))
        case .endLife:
            Text((c.quote ?? "") + " · " + Clock.stamp(c.tick))
                .font(.subheadline.monospacedDigit()).foregroundStyle(.white.opacity(0.6))
                .reveal(ss(1.0, 1.6, t))
        case .whisper:
            let words = c.quote ?? ""
            let typed = Int(Double(words.count) * clamp01((t - 1.1) / 1.4))
            Text("\u{201C}" + String(words.prefix(typed)) + "\u{201D}")
                .font(.title3).fontDesign(.serif).italic()
                .foregroundStyle(Color.earth)
                .multilineTextAlignment(.center)
                .opacity(ss(1.0, 1.2, t))
            Text("Only \(c.subject?.first ?? "they") hears it.")
                .font(.footnote).foregroundStyle(.white.opacity(0.55))
                .reveal(ss(2.5, 3.0, t))
        case .arrival:
            Text(c.quote ?? "")
                .font(.subheadline).foregroundStyle(.white.opacity(0.7))
                .reveal(ss(2.2, 2.7, t))
        }
    }
}

// MARK: - Aftermath

private struct AftermathPanel: View {
    @Environment(Game.self) private var game
    let cinematic: Cinematic

    private var heading: String {
        switch cinematic.power {
        case .endLife: "THOSE WHO LOVED THEM"
        case .rumor: "FIRST TO HEAR IT"
        case .whisper, .supplyDrop, .arrival: "INSIDE THEIR HEAD"
        default: "HOW THEY TOOK IT"
        }
    }

    private var followable: AgentLite? {
        let personal: Set<Power> = [.whisper, .supplyDrop, .arrival]
        let id = personal.contains(cinematic.power) ? cinematic.subject?.id : cinematic.affected.first
        return game.colonist(id).flatMap { $0.alive ? $0 : nil }
    }

    var body: some View {
        let shown = Array(cinematic.affected.prefix(4))
        VStack {
            Spacer()
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Label(cinematic.power.title.uppercased(), systemImage: cinematic.power.symbol)
                        .font(.caption2.weight(.bold)).tracking(1.4)
                        .foregroundStyle(cinematic.power.tint)
                    Text(cinematic.result)
                        .font(.title3.weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)
                }
                if shown.isEmpty {
                    Text(cinematic.power == .meteors ? "No one was out there. The damage will still be felt." : "No one has noticed. Yet.")
                        .font(.callout).foregroundStyle(.secondary)
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(heading).font(.caption2.weight(.semibold)).tracking(1.2).foregroundStyle(.secondary)
                        ForEach(Array(shown.enumerated()), id: \.element) { i, id in
                            ReactionRow(id: id, index: i, since: cinematic.tick)
                        }
                        if cinematic.affected.count > shown.count {
                            Text("and \(cinematic.affected.count - shown.count) more").font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
                HStack(spacing: 10) {
                    Button { game.endCinematic() } label: {
                        Label("See it on the map", systemImage: "map.fill").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glassProminent)
                    .tint(cinematic.power.tint)
                    if let f = followable {
                        Button { game.endCinematic(follow: f.id) } label: { Text("Follow \(f.first)") }
                            .buttonStyle(.glass)
                    }
                }
                .controlSize(.large)
                .fontWeight(.semibold)
            }
            .padding(20)
            .glassEffect(.regular, in: .rect(cornerRadius: 32))
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
        }
    }
}

/// One person's reaction: their face, mood, and the thought, belief or goal the power left them with.
private struct ReactionRow: View {
    @Environment(Game.self) private var game
    let id: Id
    let index: Int
    let since: Double

    @State private var detail: AgentDetail?
    @State private var shown = false

    var body: some View {
        if let c = game.colonist(id) {
            let said = reaction(c)
            HStack(alignment: .top, spacing: 12) {
                Avatar(spriteId: c.spriteId, alive: c.alive, size: 42)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(c.name).font(.subheadline.weight(.semibold))
                        MoodChip(mood: c.alive ? c.mood : "dead")
                    }
                    Group {
                        if said.inner {
                            Text("\u{201C}" + said.line + "\u{201D}").fontDesign(.serif).italic()
                        } else {
                            Label(said.line, systemImage: Mind.symbol(activity: c.activity)).foregroundStyle(.secondary)
                        }
                    }
                    .font(.callout)
                    .fixedSize(horizontal: false, vertical: true)
                    if !said.caption.isEmpty {
                        Text(said.caption).font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
            }
            .opacity(shown ? 1 : 0)
            .offset(y: shown ? 0 : 14)
            .task(id: id) {
                try? await Task.sleep(for: .milliseconds(180 + 140 * index))
                withAnimation(.smooth(duration: 0.45)) { shown = true }
                for await d in game.detailStream(id) { detail = d }
            }
        }
    }

    /// Their own thought, belief or goal since the power landed, quoted; otherwise what they are doing now.
    private func reaction(_ c: AgentLite) -> (line: String, caption: String, inner: Bool) {
        if let th = detail?.lastThought, th.tick >= since - 1 { return (th.intent, "because " + th.trigger, true) }
        if let b = detail?.beliefs.first(where: { $0.learnedAtTick >= since - 1 }) {
            return (b.text, "believes it · \(Int(b.confidence * 100))% sure", true)
        }
        if let g = detail?.goals.first(where: { $0.source == "divine" && $0.createdAtTick >= since - 1 }) {
            return (g.description, "a new goal", true)
        }
        return (c.activityLabel, "", false)
    }
}

// MARK: - Scenes

private struct Strike {
    let t0: Double
    let duration: Double
    /// Impact as a fraction of the width, and depth into the ground from the horizon (0) to the bottom (1).
    let x: Double
    let depth: Double
    let size: Double
    var lands: Double { t0 + duration }
}

private struct CinematicScene {
    let c: Cinematic
    let t: Double
    let portrait: Image?

    static func strikes(_ severity: Double) -> [Strike] {
        let n = 10 + Int(severity * 14)
        return (0..<n).map { i in
            let big = i % 5 == 2
            return Strike(t0: 0.3 + 2.3 * Double(i) / Double(n) + 0.2 * rnd(i, 14), duration: 0.45 + 0.25 * rnd(i, 15), x: 0.06 + 0.88 * rnd(i, 11), depth: 0.05 + 0.6 * rnd(i, 12), size: big ? 1.6 : 0.5 + 0.6 * rnd(i, 16))
        }
    }

    /// When the haptic thuds land, in seconds from the start.
    static func beats(_ c: Cinematic) -> [Double] {
        switch c.power {
        case .meteors: Array(strikes(c.severity).map(\.lands).sorted().prefix(9))
        case .drought: [0.95, 1.7, 2.4]
        case .supplyDrop: [1.7, 2.25]
        case .arrival: [1.2, 2.0]
        case .endLife: [0.7, 0.95, 1.5, 1.75]
        case .whisper: [1.85]
        case .rumor: [0.5, 1.0]
        }
    }

    var shake: CGSize {
        var amp = 0.0
        switch c.power {
        case .meteors:
            for s in Self.strikes(c.severity) {
                let a = t - s.lands
                if a >= 0 && a < 0.35 { amp += 6 * s.size * (1 - a / 0.35) * (0.6 + s.depth) }
            }
        case .supplyDrop:
            let a = t - 1.7
            if a >= 0 && a < 0.4 { amp = 7 * (1 - a / 0.4) }
        default: return .zero
        }
        amp = min(amp, 14)
        return CGSize(width: sin(t * 97) * amp, height: cos(t * 83) * amp * 0.7)
    }

    func draw(_ ctx: inout GraphicsContext, size: CGSize) {
        let w = Double(size.width), h = Double(size.height)
        switch c.power {
        case .meteors: meteors(ctx, w, h)
        case .drought: drought(ctx, w, h)
        case .supplyDrop: supplyDrop(ctx, w, h)
        case .arrival: arrival(ctx, w, h)
        case .endLife: endLife(ctx, w, h)
        case .whisper: whisper(ctx, w, h)
        case .rumor: rumor(ctx, w, h)
        }
    }

    // MARK: Shared scenery

    private func sky(_ ctx: GraphicsContext, _ w: Double, _ h: Double, top: Color, bottom: Color, to y: Double) {
        ctx.fill(Path(CGRect(x: 0, y: 0, width: w, height: h)), with: .linearGradient(Gradient(colors: [top, bottom]), startPoint: .zero, endPoint: CGPoint(x: 0, y: y)))
    }

    private func stars(_ ctx: GraphicsContext, _ w: Double, below maxY: Double, count: Int = 140, alpha: Double = 1) {
        for i in 0..<count {
            let r = 0.4 + rnd(i, 3) * 1.1
            let twinkle = 0.6 + 0.4 * sin(t * (1 + rnd(i, 4) * 3) + Double(i))
            let o = (0.2 + 0.6 * rnd(i, 5)) * twinkle * alpha
            ctx.fill(circle(CGPoint(x: rnd(i, 1) * w, y: rnd(i, 2) * maxY), r), with: .color(.white.opacity(o)))
        }
    }

    private func surfaceY(_ x: Double, _ w: Double, _ h: Double, horizon: Double) -> Double {
        let u = (x - w / 2) / (w / 2)
        return horizon + u * u * h * 0.05
    }

    private func ground(_ w: Double, _ h: Double, horizon: Double) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: 0, y: h))
        for k in 0...40 {
            let x = w * Double(k) / 40
            p.addLine(to: CGPoint(x: x, y: surfaceY(x, w, h, horizon: horizon)))
        }
        p.addLine(to: CGPoint(x: w, y: h))
        p.closeSubpath()
        return p
    }

    private func surface(_ ctx: GraphicsContext, _ w: Double, _ h: Double, horizon: Double, rim: Color, warmth: Double = 0) {
        let g = ground(w, h, horizon: horizon)
        let top = Color(red: 0.17 + warmth * 0.12, green: 0.16 + warmth * 0.05, blue: 0.16)
        ctx.fill(g, with: .linearGradient(Gradient(colors: [top, Color(white: 0.03)]), startPoint: CGPoint(x: 0, y: horizon), endPoint: CGPoint(x: 0, y: h)))
        for i in 0..<10 {
            let x = rnd(i, 31) * w
            let depth = rnd(i, 32)
            let y = surfaceY(x, w, h, horizon: horizon) + 18 + depth * (h - horizon) * 0.8
            let rx = (14 + 40 * rnd(i, 33)) * (0.5 + depth)
            ctx.fill(ellipse(CGPoint(x: x, y: y), rx, rx * 0.3), with: .color(.black.opacity(0.35)))
            ctx.stroke(ellipse(CGPoint(x: x, y: y - 1), rx, rx * 0.3), with: .color(.white.opacity(0.05)), lineWidth: 1)
        }
        var edge = Path()
        for k in 0...40 {
            let x = w * Double(k) / 40
            let p = CGPoint(x: x, y: surfaceY(x, w, h, horizon: horizon))
            if k == 0 { edge.move(to: p) } else { edge.addLine(to: p) }
        }
        ctx.stroke(edge, with: .color(rim), lineWidth: 1.5)
    }

    /// The colony's domes on the horizon, with lit windows.
    private func domes(_ ctx: GraphicsContext, _ w: Double, _ h: Double, horizon: Double) {
        for (i, f) in [0.16, 0.27, 0.6, 0.71, 0.84].enumerated() {
            let x = w * f
            let y = surfaceY(x, w, h, horizon: horizon) + 2
            let r = 12 + 12 * rnd(i, 41)
            var dome = Path()
            dome.addArc(center: CGPoint(x: x, y: y), radius: r, startAngle: .degrees(180), endAngle: .degrees(360), clockwise: false)
            dome.closeSubpath()
            ctx.fill(dome, with: .color(Color(white: 0.2)))
            ctx.stroke(dome, with: .color(.white.opacity(0.18)), lineWidth: 1)
            for k in 0..<3 {
                let wx = x - r * 0.5 + Double(k) * r * 0.5
                ctx.fill(Path(CGRect(x: wx - 1.5, y: y - r * 0.4, width: 3, height: 3)), with: .color(Color.amber.opacity(0.85)))
            }
        }
    }

    private func symbol(_ ctx: GraphicsContext, _ name: String, at p: CGPoint, size: Double, color: Color) {
        let text = Text(Image(systemName: name)).font(.system(size: size, weight: .semibold)).foregroundStyle(color)
        ctx.draw(ctx.resolve(text), at: p, anchor: .center)
    }

    private func drawPortrait(_ ctx: GraphicsContext, at p: CGPoint, diameter d: Double, saturation: Double = 1, opacity: Double = 1) {
        guard let portrait, opacity > 0 else { return }
        var pc = ctx
        let rect = CGRect(x: p.x - d / 2, y: p.y - d / 2, width: d, height: d)
        pc.clip(to: Path(ellipseIn: rect))
        pc.opacity = opacity
        if saturation < 1 { pc.addFilter(.saturation(saturation)) }
        pc.fill(Path(rect), with: .color(Color(white: 0.12)))
        pc.draw(portrait, in: rect)
    }

    // MARK: Meteor storm

    private func meteors(_ ctx: GraphicsContext, _ w: Double, _ h: Double) {
        let horizon = h * 0.64
        let heat = ss(0.4, 2.8, t)
        sky(ctx, w, h, top: Color(red: 0.01, green: 0.01, blue: 0.03), bottom: Color(red: 0.1 + 0.3 * heat, green: 0.03 + 0.06 * heat, blue: 0.04), to: horizon)
        stars(ctx, w, below: horizon)
        ctx.fill(ellipse(CGPoint(x: w / 2, y: horizon), w, h * 0.2), with: .radialGradient(Gradient(colors: [Color.orange.opacity(0.4 * heat), .clear]), center: CGPoint(x: w / 2, y: horizon), startRadius: 0, endRadius: w * 0.9))
        surface(ctx, w, h, horizon: horizon, rim: Color.orange.opacity(0.25 + 0.4 * heat))
        domes(ctx, w, h, horizon: horizon)

        let strikes = Self.strikes(c.severity)
        let hot = Color(red: 1, green: 0.55, blue: 0.18)
        for (i, s) in strikes.enumerated() {
            let sx = s.x * w
            let gy = surfaceY(sx, w, h, horizon: horizon)
            let impact = CGPoint(x: sx, y: gy + (h - gy) * s.depth)
            let scale = 0.6 + 0.9 * s.depth
            let origin = CGPoint(x: impact.x + w * (0.45 + 0.3 * rnd(i, 13)), y: impact.y - h * 0.9)
            let f = (t - s.t0) / s.duration
            if f > 0 && f < 1 {
                let pf = pow(f, 1.3)
                let head = lerp(origin, impact, pf)
                let tail = lerp(origin, impact, max(0, pf - 0.24))
                var trail = Path()
                trail.move(to: tail)
                trail.addLine(to: head)
                let width = (2 + 3 * s.size) * scale
                ctx.stroke(trail, with: .color(hot.opacity(0.15)), style: StrokeStyle(lineWidth: width * 4, lineCap: .round))
                ctx.stroke(trail, with: .linearGradient(Gradient(colors: [.clear, hot.opacity(0.8), Color(red: 1, green: 0.95, blue: 0.85)]), startPoint: tail, endPoint: head), style: StrokeStyle(lineWidth: width, lineCap: .round))
                ctx.fill(circle(head, 12 * s.size * scale), with: .color(hot.opacity(0.22)))
                ctx.fill(circle(head, 3.5 * s.size * scale), with: .color(.white))
            }
            let a = t - s.lands
            guard a >= 0 else { continue }
            ctx.fill(ellipse(impact, 16 * s.size * scale, 5 * s.size * scale), with: .color(hot.opacity((0.2 + 0.3 * max(0, 1 - a / 2)) * (0.8 + 0.2 * sin(t * 20 + Double(i))))))
            if a > 0.2 {
                for k in 0..<4 {
                    let ph = (t * 0.35 + Double(k) / 4 + rnd(i, 17)).truncatingRemainder(dividingBy: 1)
                    let p = CGPoint(x: impact.x + sin(ph * 5 + Double(i)) * 8 + ph * 24, y: impact.y - ph * 90 * scale)
                    ctx.fill(circle(p, (6 + ph * 22) * scale), with: .color(Color(white: 0.28).opacity(0.28 * (1 - ph) * min(1, (a - 0.2) * 2))))
                }
            }
            if a < 0.6 {
                let r = 70 * s.size * scale * (0.6 + a)
                let fade = 1 - a / 0.6
                ctx.fill(circle(impact, r), with: .radialGradient(Gradient(colors: [.white.opacity(fade), hot.opacity(0.6 * fade), .clear]), center: impact, startRadius: 0, endRadius: r))
            }
            if a < 1.4 {
                let rx = (20 + a * 170) * s.size * scale
                ctx.stroke(ellipse(impact, rx, rx * 0.32), with: .color(Color(red: 1, green: 0.65, blue: 0.35).opacity(0.8 * (1 - a / 1.4))), lineWidth: 0.5 + 2.5 * (1 - a / 1.4))
            }
            if a < 1.3 {
                for k in 0..<7 {
                    let j = i * 7 + k
                    let angle = -Double.pi / 2 + (rnd(j, 21) - 0.5) * 2.4
                    let v = (120 + 180 * rnd(j, 22)) * s.size * scale
                    let p = CGPoint(x: impact.x + cos(angle) * v * a, y: impact.y + sin(angle) * v * a + 210 * a * a)
                    let r = 1.5 + 2 * rnd(j, 23)
                    ctx.fill(Path(CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2)), with: .color(Color(red: 1, green: 0.6 * (1 - a / 1.3) + 0.1, blue: 0.2).opacity(1 - a / 1.3)))
                }
            }
            if s.size > 1.5 && a < 0.5 {
                ctx.fill(Path(CGRect(x: 0, y: 0, width: w, height: h)), with: .color(Color(red: 1, green: 0.88, blue: 0.75).opacity(0.35 * (1 - a / 0.5))))
            }
        }
        ctx.fill(Path(CGRect(x: 0, y: 0, width: w, height: h)), with: .radialGradient(Gradient(colors: [.clear, Color(red: 0.4, green: 0.02, blue: 0).opacity(0.55 * heat)]), center: CGPoint(x: w / 2, y: h / 2), startRadius: w * 0.35, endRadius: h * 0.75))
    }

    // MARK: Drought

    private func drought(_ ctx: GraphicsContext, _ w: Double, _ h: Double) {
        let horizon = h * 0.6
        let heat = ss(0.2, 3, t)
        sky(ctx, w, h, top: Color(red: 0.05, green: 0.03, blue: 0.02), bottom: Color(red: 0.3 + 0.2 * heat, green: 0.13 + 0.06 * heat, blue: 0.04), to: horizon)
        stars(ctx, w, below: horizon * 0.7, count: 70, alpha: 1 - heat)
        ctx.fill(ellipse(CGPoint(x: w / 2, y: horizon), w * 1.2, h * 0.3), with: .radialGradient(Gradient(colors: [Color(red: 1, green: 0.75, blue: 0.4).opacity(0.5 * heat), .clear]), center: CGPoint(x: w / 2, y: horizon), startRadius: 0, endRadius: w))
        surface(ctx, w, h, horizon: horizon, rim: Color.amber.opacity(0.5), warmth: heat)

        let centre = CGPoint(x: w / 2, y: horizon + (h - horizon) * 0.42)
        let reach = ss(0.5, 2.8, t)
        for i in 0..<11 {
            var angle = 2 * Double.pi * Double(i) / 11 + rnd(i, 51) * 0.4
            var p = centre
            var branchFrom: CGPoint?
            var branchAngle = 0.0
            for s in 0..<9 {
                let shown = reach * 9 - Double(s)
                if shown <= 0 { break }
                angle += (rnd(i * 9 + s, 52) - 0.5) * 0.7
                let len = (18 + 26 * rnd(i * 9 + s, 53)) * min(1, shown)
                let q = CGPoint(x: p.x + cos(angle) * len, y: p.y + sin(angle) * len * 0.42)
                var seg = Path()
                seg.move(to: p)
                seg.addLine(to: q)
                ctx.stroke(seg, with: .color(.black.opacity(0.85)), style: StrokeStyle(lineWidth: max(0.8, 3.4 - Double(s) * 0.3), lineCap: .round))
                ctx.stroke(seg, with: .color(Color.amber.opacity(0.35)), lineWidth: 0.7)
                if s == 3 {
                    branchFrom = q
                    branchAngle = angle + (rnd(i, 54) > 0.5 ? 0.8 : -0.8)
                }
                p = q
            }
            if var b = branchFrom {
                let shown = reach * 9 - 4
                for s in 0..<4 where shown > Double(s) {
                    let q = CGPoint(x: b.x + cos(branchAngle) * 16 * min(1, shown - Double(s)), y: b.y + sin(branchAngle) * 7 * min(1, shown - Double(s)))
                    var seg = Path()
                    seg.move(to: b)
                    seg.addLine(to: q)
                    ctx.stroke(seg, with: .color(.black.opacity(0.75)), style: StrokeStyle(lineWidth: 1.2, lineCap: .round))
                    b = q
                }
            }
        }

        for j in 0..<7 {
            var line = Path()
            let y0 = horizon + 14 + Double(j) * 22
            for k in 0...30 {
                let x = w * Double(k) / 30
                let p = CGPoint(x: x, y: y0 + sin(x * 0.03 + t * 3 + Double(j)) * 3)
                if k == 0 { line.move(to: p) } else { line.addLine(to: p) }
            }
            ctx.stroke(line, with: .color(Color.amber.opacity(0.06 * heat)), lineWidth: 1)
        }

        let dry = ss(0.9, 2.6, t)
        let drop = CGPoint(x: centre.x, y: centre.y - h * 0.2)
        ctx.fill(circle(drop, 110), with: .radialGradient(Gradient(colors: [Color.earth.opacity(0.35 * (1 - dry)), .clear]), center: drop, startRadius: 0, endRadius: 110))
        var dc = ctx
        dc.translateBy(x: drop.x, y: drop.y)
        dc.scaleBy(x: (1 - 0.65 * dry) * (1 + 0.04 * sin(t * 9) * dry), y: 1 - 0.65 * dry)
        dc.opacity = 1 - 0.95 * dry
        let glyph = Text(Image(systemName: "drop.fill")).font(.system(size: 104)).foregroundStyle(LinearGradient(colors: [.white, .earth], startPoint: .top, endPoint: .bottom))
        dc.draw(dc.resolve(glyph), at: .zero, anchor: .center)

        for i in 0..<60 {
            let born = 0.8 + rnd(i, 55) * 2.2
            let age = t - born
            guard age > 0 && age < 1.6 else { continue }
            let p = CGPoint(x: drop.x + (rnd(i, 56) - 0.5) * 70 + sin(age * 4 + Double(i)) * 10, y: drop.y + 20 - age * 150)
            ctx.fill(circle(p, 1.5 + 1.5 * rnd(i, 57)), with: .color(Color.earth.opacity(0.8 * (1 - age / 1.6))))
        }
        for i in 0..<40 {
            let speed = 20 + 40 * rnd(i, 58)
            let x = (rnd(i, 59) * w + t * speed).truncatingRemainder(dividingBy: w)
            let y = horizon - 40 + rnd(i, 60) * (h - horizon + 40)
            ctx.fill(Path(CGRect(x: x, y: y, width: 2, height: 2)), with: .color(Color.amber.opacity(0.35 * heat)))
        }
    }

    // MARK: Supply drop

    private func supplyDrop(_ ctx: GraphicsContext, _ w: Double, _ h: Double) {
        let horizon = h * 0.68
        sky(ctx, w, h, top: Color(red: 0.01, green: 0.02, blue: 0.05), bottom: Color(red: 0.08, green: 0.08, blue: 0.14), to: horizon)
        stars(ctx, w, below: horizon)
        surface(ctx, w, h, horizon: horizon, rim: .white.opacity(0.2))
        domes(ctx, w, h, horizon: horizon)

        let cx = w / 2
        let land = surfaceY(cx, w, h, horizon: horizon) + 26
        let p = clamp01((t - 0.25) / 1.45)
        let bottom = -40 + (land + 40) * (1 - pow(1 - p, 3))
        let wobble = sin(t * 7) * 3 * (1 - p)
        let beam = 0.22 * ss(0.1, 0.6, t) * (1 - ss(2.4, 3.2, t))
        var cone = Path()
        cone.move(to: CGPoint(x: cx - 24, y: 0))
        cone.addLine(to: CGPoint(x: cx + 24, y: 0))
        cone.addLine(to: CGPoint(x: cx + 110, y: land))
        cone.addLine(to: CGPoint(x: cx - 110, y: land))
        cone.closeSubpath()
        ctx.fill(cone, with: .linearGradient(Gradient(colors: [.clear, Color.amber.opacity(beam)]), startPoint: .zero, endPoint: CGPoint(x: 0, y: land)))
        ctx.fill(ellipse(CGPoint(x: cx, y: land), 120, 20), with: .radialGradient(Gradient(colors: [Color.amber.opacity(0.45 * p * (1 - ss(2.4, 3.2, t))), .clear]), center: CGPoint(x: cx, y: land), startRadius: 0, endRadius: 120))

        let open = ss(2.0, 2.4, t)
        let podTop = bottom - 86
        if open > 0 {
            let centre = CGPoint(x: cx, y: podTop + 10)
            for k in 0..<12 {
                let angle = (Double(k) * 30 + t * 14) * Double.pi / 180
                var ray = Path()
                ray.move(to: centre)
                ray.addLine(to: CGPoint(x: centre.x + cos(angle - 0.07) * 260, y: centre.y + sin(angle - 0.07) * 260))
                ray.addLine(to: CGPoint(x: centre.x + cos(angle + 0.07) * 260, y: centre.y + sin(angle + 0.07) * 260))
                ray.closeSubpath()
                ctx.fill(ray, with: .radialGradient(Gradient(colors: [Color.amber.opacity(0.4 * open), .clear]), center: centre, startRadius: 10, endRadius: 260))
            }
        }

        if t < 1.85 {
            let flicker = 34 + 10 * sin(t * 53) + (1 - p) * 30
            var flame = Path()
            flame.move(to: CGPoint(x: cx - 13 + wobble, y: bottom))
            flame.addLine(to: CGPoint(x: cx + 13 + wobble, y: bottom))
            flame.addLine(to: CGPoint(x: cx + wobble, y: bottom + flicker))
            flame.closeSubpath()
            ctx.fill(flame, with: .linearGradient(Gradient(colors: [.white, Color.amber, .clear]), startPoint: CGPoint(x: 0, y: bottom), endPoint: CGPoint(x: 0, y: bottom + flicker)))
        }

        let body = CGRect(x: cx - 35 + wobble, y: podTop, width: 70, height: 86)
        var fins = Path()
        fins.move(to: CGPoint(x: body.minX, y: body.maxY - 30))
        fins.addLine(to: CGPoint(x: body.minX - 14, y: body.maxY))
        fins.addLine(to: CGPoint(x: body.minX, y: body.maxY))
        fins.move(to: CGPoint(x: body.maxX, y: body.maxY - 30))
        fins.addLine(to: CGPoint(x: body.maxX + 14, y: body.maxY))
        fins.addLine(to: CGPoint(x: body.maxX, y: body.maxY))
        ctx.fill(fins, with: .color(Color(white: 0.45)))
        ctx.fill(Path(roundedRect: body, cornerRadius: 14), with: .linearGradient(Gradient(colors: [Color(white: 0.85), Color(white: 0.4)]), startPoint: CGPoint(x: body.minX, y: 0), endPoint: CGPoint(x: body.maxX, y: 0)))
        ctx.fill(Path(CGRect(x: body.minX, y: body.minY + 52, width: 70, height: 10)), with: .color(Color.amber))
        ctx.fill(ellipse(CGPoint(x: body.midX, y: body.minY + 26), 11, 11), with: .color(Color(white: 0.1)))
        ctx.fill(ellipse(CGPoint(x: body.midX - 3, y: body.minY + 23), 3, 3), with: .color(.white.opacity(0.7)))
        if open > 0 {
            ctx.fill(Path(roundedRect: CGRect(x: body.minX + 6, y: body.minY - 4 - 18 * open, width: 58, height: 8), cornerRadius: 3), with: .color(Color(white: 0.7)))
        }

        let a = t - 1.7
        if a > 0 && a < 1.8 {
            for i in 0..<40 {
                let side = i % 2 == 0 ? -1.0 : 1.0
                let v = 60 + 160 * rnd(i, 61)
                let x = cx + side * (24 + v * a * (1 - min(a, 1.4) * 0.35))
                let y = land - 4 - rnd(i, 62) * 34 * a - 6 * sin(a * 3)
                let r = 1.5 + 2.5 * rnd(i, 63)
                ctx.fill(Path(CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2)), with: .color(Color(white: 0.7).opacity(0.7 * (1 - a / 1.8))))
            }
            if a < 1.2 {
                let rx = 40 + a * 230
                ctx.stroke(ellipse(CGPoint(x: cx, y: land), rx, rx * 0.16), with: .color(.white.opacity(0.5 * (1 - a / 1.2))), lineWidth: 2)
            }
        }

        let pop = clamp01((t - 2.15) / 0.5)
        if pop > 0 {
            let item = CGPoint(x: cx, y: podTop - 36 - 60 * easeOutBack(pop))
            ctx.fill(circle(item, 60), with: .radialGradient(Gradient(colors: [Color.amber.opacity(0.55 * pop), .clear]), center: item, startRadius: 0, endRadius: 60))
            var ic = ctx
            ic.translateBy(x: item.x, y: item.y)
            ic.scaleBy(x: easeOutBack(pop), y: easeOutBack(pop))
            symbol(ic, Self.resourceSymbol(c.resource), at: .zero, size: 46, color: .white)
        }
    }

    static func resourceSymbol(_ r: Resource?) -> String {
        switch r {
        case .water?: "drop.fill"
        case .parts?: "gearshape.2.fill"
        case .medicine?: "cross.case.fill"
        case .credits?: "creditcard.fill"
        default: "fork.knife"
        }
    }

    // MARK: New arrival

    private func arrival(_ ctx: GraphicsContext, _ w: Double, _ h: Double) {
        let horizon = h * 0.72
        sky(ctx, w, h, top: Color(red: 0.01, green: 0.02, blue: 0.05), bottom: Color(red: 0.05, green: 0.1, blue: 0.18), to: horizon)
        stars(ctx, w, below: horizon)
        surface(ctx, w, h, horizon: horizon, rim: Color.earth.opacity(0.35))
        let pad = CGPoint(x: w / 2, y: surfaceY(w / 2, w, h, horizon: horizon) + 30)
        ctx.fill(ellipse(pad, 90, 16), with: .color(Color(white: 0.22)))
        ctx.stroke(ellipse(pad, 90, 16), with: .color(.white.opacity(0.2)), lineWidth: 1)
        for k in 0..<10 {
            let angle = Double(k) / 10 * 2 * Double.pi
            let on = (Int(t * 6) + k) % 3 == 0
            ctx.fill(circle(CGPoint(x: pad.x + cos(angle) * 84, y: pad.y + sin(angle) * 14), 2), with: .color(on ? Color.amber : Color.amber.opacity(0.25)))
        }

        let descend = clamp01((t - 0.15) / 1.05)
        if descend > 0 && descend < 1 {
            let e = 1 - pow(1 - descend, 3)
            let from = CGPoint(x: w * 0.85, y: -40)
            let head = lerp(from, pad, e)
            let tail = lerp(from, pad, max(0, e - 0.2))
            var trail = Path()
            trail.move(to: tail)
            trail.addLine(to: head)
            ctx.stroke(trail, with: .linearGradient(Gradient(colors: [.clear, Color.earth.opacity(0.8), .white]), startPoint: tail, endPoint: head), style: StrokeStyle(lineWidth: 4, lineCap: .round))
            ctx.fill(circle(head, 14), with: .color(Color.earth.opacity(0.3)))
            ctx.fill(circle(head, 4), with: .color(.white))
        }

        let beam = ss(1.2, 1.5, t) * (1 - 0.6 * ss(2.6, 3.4, t))
        if beam > 0 {
            ctx.fill(Path(CGRect(x: pad.x - 55, y: 0, width: 110, height: pad.y)), with: .linearGradient(Gradient(colors: [.clear, Color.earth.opacity(0.3 * beam), .white.opacity(0.45 * beam)]), startPoint: .zero, endPoint: CGPoint(x: 0, y: pad.y)))
            ctx.fill(ellipse(pad, 120, 26), with: .radialGradient(Gradient(colors: [Color.white.opacity(0.6 * beam), Color.earth.opacity(0.2 * beam), .clear]), center: pad, startRadius: 0, endRadius: 120))
        }
        let flash = t - 1.2
        if flash > 0 && flash < 1 {
            let rx = 30 + flash * 200
            ctx.stroke(ellipse(pad, rx, rx * 0.2), with: .color(Color.earth.opacity(1 - flash)), lineWidth: 2)
        }

        let centre = CGPoint(x: w / 2, y: h * 0.42 - 40)
        for i in 0..<70 {
            let start = 1.3 + rnd(i, 71) * 0.5
            let f = clamp01((t - start) / 0.8)
            guard f > 0 && f < 1 else { continue }
            let angle = rnd(i, 72) * 2 * Double.pi
            let r0 = 140 + 120 * rnd(i, 73)
            let e = f * f
            let p = CGPoint(x: centre.x + cos(angle + e) * r0 * (1 - e), y: centre.y + sin(angle + e) * r0 * (1 - e))
            ctx.fill(circle(p, 1.8), with: .color(Color.earth.opacity(sin(f * Double.pi))))
        }
        let reveal = clamp01((t - 1.9) / 0.6)
        if reveal > 0 {
            let d = 150 * (0.85 + 0.15 * easeOutBack(reveal))
            ctx.fill(circle(centre, d * 0.75), with: .radialGradient(Gradient(colors: [Color.earth.opacity(0.4 * reveal), .clear]), center: centre, startRadius: 0, endRadius: d * 0.75))
            drawPortrait(ctx, at: centre, diameter: d, opacity: reveal)
            ctx.stroke(circle(centre, d / 2 + 2), with: .color(.white.opacity(0.5 * reveal)), lineWidth: 1.5)
            var ring = ctx
            ring.translateBy(x: centre.x, y: centre.y)
            ring.rotate(by: .radians(t * 0.8))
            ring.stroke(circle(.zero, d / 2 + 12), with: .color(Color.earth.opacity(0.7 * reveal)), style: StrokeStyle(lineWidth: 1.5, dash: [4, 7]))
        }
    }

    // MARK: End a life

    private func endLife(_ ctx: GraphicsContext, _ w: Double, _ h: Double) {
        ctx.fill(Path(CGRect(x: 0, y: 0, width: w, height: h)), with: .color(.black))
        let centre = CGPoint(x: w / 2, y: h * 0.42 - 40)
        ctx.fill(circle(centre, w * 0.8), with: .radialGradient(Gradient(colors: [Color(red: 0.25, green: 0.05, blue: 0.06).opacity(0.6), .clear]), center: centre, startRadius: 0, endRadius: w * 0.8))
        for i in 0..<50 {
            let y = (rnd(i, 81) * h - t * (8 + 14 * rnd(i, 82))).truncatingRemainder(dividingBy: h)
            let p = CGPoint(x: rnd(i, 83) * w + sin(t + Double(i)) * 6, y: y < 0 ? y + h : y)
            ctx.fill(circle(p, 0.8 + rnd(i, 84)), with: .color(.white.opacity(0.12)))
        }

        let d = 170.0
        let beats = [(0.7, 1.0), (0.95, 0.6), (1.5, 0.8), (1.75, 0.5)]
        let pulse = beats.reduce(0.0) { acc, b in acc + b.1 * exp(-pow((t - b.0) * 14, 2)) }
        let life = 1 - ss(0.5, 2.0, t)
        let ringR = (d / 2 + 16) * (1 + 0.05 * pulse)
        ctx.stroke(circle(centre, ringR), with: .color(.white.opacity(0.08)), lineWidth: 3)
        if life > 0 {
            var arc = Path()
            arc.addArc(center: centre, radius: ringR, startAngle: .degrees(-90), endAngle: .degrees(-90 + 360 * life), clockwise: false)
            let tint = Color(red: 1, green: 0.4 + 0.6 * life, blue: 0.4 + 0.6 * life)
            ctx.stroke(arc, with: .color(tint.opacity(0.9)), style: StrokeStyle(lineWidth: 3, lineCap: .round))
        }
        if pulse > 0.05 {
            ctx.stroke(circle(centre, ringR + 10 * pulse), with: .color(Color(red: 1, green: 0.35, blue: 0.35).opacity(0.35 * pulse)), lineWidth: 6)
        }

        let fade = ss(2.3, 3.6, t)
        if fade < 1 {
            var pc = ctx
            let cut = centre.y - d / 2 + fade * d
            pc.clip(to: Path(CGRect(x: 0, y: cut, width: w, height: h)))
            drawPortrait(pc, at: centre, diameter: d, saturation: 1 - ss(1.4, 2.3, t), opacity: 1)
        }
        let cell = 7.0
        let cells = Int(d / cell)
        for gy in 0..<cells {
            for gx in 0..<cells {
                let px = centre.x - d / 2 + (Double(gx) + 0.5) * cell
                let py = centre.y - d / 2 + (Double(gy) + 0.5) * cell
                let dx = px - centre.x, dy = py - centre.y
                guard dx * dx + dy * dy < d * d / 4 else { continue }
                let j = gy * cells + gx
                guard j % 2 == 0 else { continue }
                let born = 2.3 + (Double(gy) / Double(cells)) * 1.3 + rnd(j, 85) * 0.1
                let age = t - born
                guard age > 0 && age < 2.2 else { continue }
                let p = CGPoint(x: px + age * (30 + 50 * rnd(j, 86)), y: py - age * (40 + 70 * rnd(j, 87)) - age * age * 12)
                let s = cell * 0.8 * (1 - age / 2.2)
                ctx.fill(Path(CGRect(x: p.x - s / 2, y: p.y - s / 2, width: s, height: s)), with: .color(Color(white: 0.55 + 0.35 * rnd(j, 88)).opacity(1 - age / 2.2)))
            }
        }
    }

    // MARK: Whisper

    private func whisper(_ ctx: GraphicsContext, _ w: Double, _ h: Double) {
        sky(ctx, w, h, top: Color(red: 0.02, green: 0.03, blue: 0.09), bottom: .black, to: h)
        stars(ctx, w, below: h, count: 90, alpha: 0.6)
        for k in 0..<3 {
            let p = CGPoint(x: w * (0.3 + 0.4 * rnd(k, 91)) + sin(t * 0.4 + Double(k)) * 30, y: h * (0.25 + 0.4 * rnd(k, 92)))
            let tint = k == 1 ? Color(red: 0.45, green: 0.35, blue: 0.95) : Color.earth
            ctx.fill(circle(p, w * 0.6), with: .radialGradient(Gradient(colors: [tint.opacity(0.18), .clear]), center: p, startRadius: 0, endRadius: w * 0.6))
        }
        let centre = CGPoint(x: w / 2, y: h * 0.42 - 40)
        let d = 140.0
        let absorbed = ss(1.1, 2.1, t)
        ctx.fill(circle(centre, d * (0.7 + 0.4 * absorbed)), with: .radialGradient(Gradient(colors: [Color.earth.opacity(0.15 + 0.45 * absorbed), .clear]), center: centre, startRadius: 0, endRadius: d * (0.7 + 0.4 * absorbed)))
        drawPortrait(ctx, at: centre, diameter: d, opacity: ss(0.1, 0.6, t))
        ctx.stroke(circle(centre, d / 2 + 1), with: .color(Color.earth.opacity(0.3 + 0.5 * absorbed)), lineWidth: 1.5)

        let reach = max(w, h) * 0.6
        for i in 0..<120 {
            let start = 0.2 + rnd(i, 93) * 1.0
            let f = clamp01((t - start) / 1.3)
            guard f > 0 && f < 1 else { continue }
            let theta = rnd(i, 94) * 2 * Double.pi
            let r0 = reach * (0.6 + 0.4 * rnd(i, 95))
            func at(_ f: Double) -> CGPoint {
                let e = f * f * (3 - 2 * f)
                let r = r0 * (1 - e) + d / 2 * e
                return CGPoint(x: centre.x + cos(theta + e * 2.4) * r, y: centre.y + sin(theta + e * 2.4) * r)
            }
            var trail = Path()
            trail.move(to: at(max(0, f - 0.07)))
            trail.addLine(to: at(f))
            let o = sin(f * Double.pi)
            ctx.stroke(trail, with: .color(Color.earth.opacity(0.6 * o)), style: StrokeStyle(lineWidth: 1.6, lineCap: .round))
            ctx.fill(circle(at(f), 1.4), with: .color(.white.opacity(o)))
        }
        let a = t - 1.85
        if a > 0 && a < 1.2 {
            ctx.stroke(circle(centre, d / 2 + a * 130), with: .color(Color.earth.opacity(0.8 * (1 - a / 1.2))), lineWidth: 2 * (1 - a / 1.2) + 0.5)
        }
    }

    // MARK: Rumor

    private func rumor(_ ctx: GraphicsContext, _ w: Double, _ h: Double) {
        sky(ctx, w, h, top: .black, bottom: Color(red: 0.03, green: 0.07, blue: 0.13), to: h)
        let count = 30
        var nodes: [CGPoint] = [CGPoint(x: w / 2, y: h * 0.6)]
        for i in 1..<count {
            nodes.append(CGPoint(x: w * (0.07 + 0.86 * rnd(i, 101)), y: h * (0.4 + 0.42 * rnd(i, 102))))
        }
        var edges: Set<[Int]> = []
        for i in 0..<count {
            let near = (0..<count).filter { $0 != i }.sorted { hypot(nodes[$0].x - nodes[i].x, nodes[$0].y - nodes[i].y) < hypot(nodes[$1].x - nodes[i].x, nodes[$1].y - nodes[i].y) }
            for j in near.prefix(2) { edges.insert([min(i, j), max(i, j)]) }
        }
        var dist = [Double](repeating: .infinity, count: count)
        var parent = [Int](repeating: -1, count: count)
        var done = Set<Int>()
        dist[0] = 0
        while let u = (0..<count).filter({ !done.contains($0) && dist[$0] < .infinity }).min(by: { dist[$0] < dist[$1] }) {
            done.insert(u)
            for e in edges where e.contains(u) {
                let v = e[0] == u ? e[1] : e[0]
                let nd = dist[u] + hypot(nodes[v].x - nodes[u].x, nodes[v].y - nodes[u].y)
                if nd < dist[v] {
                    dist[v] = nd
                    parent[v] = u
                }
            }
        }
        let reached = dist.map { 0.5 + $0 / 240 }

        for e in edges {
            var line = Path()
            line.move(to: nodes[e[0]])
            line.addLine(to: nodes[e[1]])
            ctx.stroke(line, with: .color(.white.opacity(0.07)), lineWidth: 1)
        }
        for v in 1..<count where parent[v] >= 0 {
            let u = parent[v]
            let f = clamp01((t - reached[u]) / max(0.01, reached[v] - reached[u]))
            guard f > 0 else { continue }
            var line = Path()
            line.move(to: nodes[u])
            line.addLine(to: lerp(nodes[u], nodes[v], f))
            ctx.stroke(line, with: .color(Color.earth.opacity(0.7)), lineWidth: 1.5)
        }
        var heard = 0
        for (i, p) in nodes.enumerated() {
            let age = t - reached[i]
            if age < 0 {
                ctx.fill(circle(p, 3.5), with: .color(.white.opacity(0.25)))
                continue
            }
            heard += 1
            let r = (i == 0 ? 8 : 5) * easeOutBack(min(1, age / 0.35))
            ctx.fill(circle(p, r), with: .color(Color.earth))
            if age < 0.9 { ctx.stroke(circle(p, r + age * 34), with: .color(Color.earth.opacity(1 - age / 0.9)), lineWidth: 1.5) }
            if age < 1.3 && i != 0 {
                let b = CGRect(x: p.x - 8, y: p.y - 24, width: 16, height: 11)
                var bubble = Path(roundedRect: b, cornerRadius: 4)
                bubble.move(to: CGPoint(x: b.midX - 3, y: b.maxY))
                bubble.addLine(to: CGPoint(x: b.midX, y: b.maxY + 4))
                bubble.addLine(to: CGPoint(x: b.midX + 3, y: b.maxY))
                ctx.fill(bubble, with: .color(.white.opacity(0.9 * min(1, (1.3 - age) * 3))))
                for k in 0..<3 {
                    ctx.fill(circle(CGPoint(x: b.minX + 4 + Double(k) * 4, y: b.midY), 1), with: .color(.black.opacity(0.7)))
                }
            }
        }
        let origin = ctx.resolve(Text((c.sites.first?.name ?? "The canteen").uppercased()).font(.caption2.weight(.bold)).tracking(1.2).foregroundStyle(Color.earth))
        let size = origin.measure(in: CGSize(width: w, height: 40))
        let tag = CGRect(x: nodes[0].x - size.width / 2 - 10, y: nodes[0].y + 16, width: size.width + 20, height: size.height + 10)
        ctx.fill(Path(roundedRect: tag, cornerRadius: tag.height / 2), with: .color(.black.opacity(0.85)))
        ctx.stroke(Path(roundedRect: tag, cornerRadius: tag.height / 2), with: .color(Color.earth.opacity(0.6)), lineWidth: 1)
        ctx.draw(origin, at: CGPoint(x: tag.midX, y: tag.midY), anchor: .center)
        let label = Text(heard > 1 ? "Person to person, changing as it goes" : "It starts with a few overheard words").font(.footnote).foregroundStyle(.white.opacity(0.65))
        ctx.draw(ctx.resolve(label), at: CGPoint(x: w / 2, y: h * 0.88), anchor: .center)
    }
}

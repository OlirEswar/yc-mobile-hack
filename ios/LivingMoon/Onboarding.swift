import AuthenticationServices
import PassKit
import SwiftUI

/// First-run flow: welcome, a playable taste of the god powers, the plan, an optional sign-in and the
/// colony waking. Sign-in and payment are mocked: no account is created and nothing is charged.
struct OnboardingView: View {
    enum Route: Hashable { case tryPower, plan, save, ready }
    enum Plan: String, CaseIterable { case free = "Free", pass = "Colony Pass" }

    var onFinish: () -> Void
    @State private var path: [Route] = []
    @State private var plan: Plan = .free

    var body: some View {
        NavigationStack(path: $path) {
            WelcomeStep { path.append(.tryPower) }
                .toolbarVisibility(.hidden, for: .navigationBar)
                .containerBackground(.clear, for: .navigation)
                .navigationDestination(for: Route.self) { route in
                    Group {
                        switch route {
                        case .tryPower: TryPowerStep { path.append(.plan) }
                        case .plan: PickPlanStep(plan: $plan) { path.append(.save) }
                        case .save: SaveStep { path.append(.ready) }
                        case .ready: ReadyStep(plan: plan, onFinish: onFinish)
                        }
                    }
                    .containerBackground(.clear, for: .navigation)
                }
        }
        .background { OnboardingBackdrop(route: path.last) }
        .preferredColorScheme(.dark)
        .tint(.white)
    }
}

// MARK: - Backdrop

/// Near-black sky, a faint dot field and the moon, which settles somewhere new on each step.
private struct OnboardingBackdrop: View {
    let route: OnboardingView.Route?

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            let (size, center): (CGFloat, CGPoint) = switch route {
            case nil: (w * 0.86, CGPoint(x: w * 0.5, y: h * 0.33))
            case .tryPower, .plan: (w * 1.1, CGPoint(x: w * 0.5, y: -w * 0.47))
            case .save: (w * 0.56, CGPoint(x: w * 0.5, y: h * 0.25))
            case .ready: (w * 0.42, CGPoint(x: w * 0.5, y: h * 0.17))
            }
            ZStack {
                Color.black
                DotField().opacity(0.6)
                Moon()
                    .frame(width: size, height: size)
                    .position(center)
                    .animation(.smooth(duration: 0.9), value: route)
            }
        }
        .ignoresSafeArea()
    }
}

/// The moon with a faint warm glow behind it.
struct Moon: View {
    var body: some View {
        GeometryReader { geo in
            let d = min(geo.size.width, geo.size.height)
            ZStack {
                Circle()
                    .fill(Color.amber.opacity(0.28))
                    .frame(width: d * 0.8, height: d * 0.8)
                    .blur(radius: d * 0.18)
                    .offset(x: d * 0.08, y: d * 0.16)
                MoonSurface()
                    .frame(width: d * 0.9, height: d * 0.9)
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .accessibilityHidden(true)
    }
}

/// The near side of the moon, rendered from NASA's public-domain LROC colour map (CGI Moon Kit).
private struct MoonSurface: View {
    private static let image = (Bundle.main.url(forResource: "onboarding_moon", withExtension: "png")
        ?? Bundle.main.url(forResource: "onboarding_moon", withExtension: "png", subdirectory: "Art"))
        .flatMap { UIImage(contentsOfFile: $0.path) }

    var body: some View {
        if let image = Self.image {
            Image(uiImage: image).resizable().interpolation(.high).scaledToFit()
        }
    }
}

private struct DotField: View {
    var body: some View {
        Canvas { ctx, size in
            let step: CGFloat = 18
            var y: CGFloat = step / 2
            while y < size.height {
                var x: CGFloat = step / 2
                while x < size.width {
                    let fade = 1 - min(1, abs(y - size.height * 0.35) / (size.height * 0.7))
                    ctx.fill(Circle().path(in: CGRect(x: x, y: y, width: 1.2, height: 1.2)), with: .color(.white.opacity(0.1 * fade)))
                    x += step
                }
                y += step
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Dot-matrix numerals

/// Numbers and capital letters drawn as a 5×7 dot display, with faint unlit dots behind them. The value is read as text by VoiceOver.
struct DotMatrixText: View {
    let text: String
    var dot: CGFloat = 5
    var gap: CGFloat = 2.5
    var color: Color = .white

    private static let glyphs: [Character: [String]] = [
        "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
        "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
        "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
        "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
        "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
        "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
        "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
        "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
        "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
        "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
        ".": ["0", "0", "0", "0", "0", "0", "1"],
        "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
        // Letters, for join codes.
        "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
        "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
        "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
        "D": ["11100", "10010", "10001", "10001", "10001", "10010", "11100"],
        "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
        "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
        "G": ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
        "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
        "I": ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
        "J": ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
        "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
        "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
        "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
        "N": ["10001", "10001", "11001", "10101", "10011", "10001", "10001"],
        "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
        "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
        "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
        "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
        "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
        "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
        "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
        "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
        "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
        "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
        "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
        "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    ]

    var body: some View {
        let glyphs = text.compactMap { Self.glyphs[$0] }
        let pitch = dot + gap
        let columns = glyphs.reduce(0) { $0 + $1[0].count } + max(0, glyphs.count - 1)
        Canvas { ctx, _ in
            var x0: CGFloat = 0
            for glyph in glyphs {
                for (row, line) in glyph.enumerated() {
                    for (col, bit) in line.enumerated() {
                        let rect = CGRect(x: x0 + CGFloat(col) * pitch, y: CGFloat(row) * pitch, width: dot, height: dot)
                        ctx.fill(Circle().path(in: rect), with: .color(bit == "1" ? color : color.opacity(0.06)))
                    }
                }
                x0 += CGFloat(glyph[0].count + 1) * pitch
            }
        }
        .frame(width: CGFloat(columns) * pitch - gap, height: 7 * pitch - gap)
        .accessibilityElement()
        .accessibilityLabel(text)
    }
}

// MARK: - Shared pieces

private struct Title: View {
    let lead: String
    let accent: String

    var body: some View {
        Text("\(lead)\(Text(accent).foregroundStyle(Color.amber))")
            .font(.largeTitle.bold())
            .fixedSize(horizontal: false, vertical: true)
    }
}

private extension View {
    func primaryAction() -> some View {
        buttonStyle(.glassProminent)
            .controlSize(.extraLarge)
            .buttonSizing(.flexible)
            .foregroundStyle(.black)
            .fontWeight(.semibold)
    }

    func bodyCopy() -> some View {
        font(.body)
            .foregroundStyle(.secondary)
            .lineSpacing(3)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// A content surface: standard fill and hairline, no glass (glass is for controls).
    func surface(_ radius: CGFloat = 28) -> some View {
        background(Color.white.opacity(0.05), in: .rect(cornerRadius: radius))
            .overlay(RoundedRectangle(cornerRadius: radius).strokeBorder(.white.opacity(0.08)))
    }
}

// MARK: - 1. Welcome

private struct WelcomeStep: View {
    let next: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer()
            HStack(alignment: .center, spacing: 14) {
                DotMatrixText(text: "100", dot: 4, gap: 2)
                Text("colonists.\nNone of them yours.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .padding(.bottom, 28)
            Title(lead: "A hundred lives.\n", accent: "One unseen hand.")
            Text("A moon colony that works, loves and schemes on its own. You only nudge it.")
                .bodyCopy()
                .padding(.top, 12)
            Button("Begin", action: next)
                .primaryAction()
                .padding(.top, 32)
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 16)
    }
}

// MARK: - 2. Try a power

/// Teach by doing: pick a power and watch a sample colony react. Nothing here touches the real world.
private struct TryPowerStep: View {
    let next: () -> Void

    private struct Demo {
        let power: Power
        let mood: Int
        let chain: [(String, String)]
    }

    private let demos: [Demo] = [
        Demo(power: .drought, mood: 38, chain: [
            ("drop.degreesign.slash", "The ice wells run dry"),
            ("fork.knife", "The canteen rations water"),
            ("bubble.left.and.exclamationmark.bubble.right.fill", "Mara blames the council"),
        ]),
        Demo(power: .supplyDrop, mood: 91, chain: [
            ("shippingbox.fill", "A supply pod lands at the pad"),
            ("hands.and.sparkles.fill", "Jo shares the parts with neighbours"),
            ("face.smiling.inverse", "The colony's mood lifts"),
        ]),
        Demo(power: .whisper, mood: 64, chain: [
            ("sparkles", "An idea takes root in Ev's mind"),
            ("person.2.wave.2.fill", "Ev tells Li in the greenhouse"),
            ("megaphone.fill", "By evening, the market believes it"),
        ]),
    ]

    @State private var active: Power?
    @State private var mood = 72
    @State private var shown = 0
    @State private var run: Task<Void, Never>?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Title(lead: "Try being the\n", accent: "unseen force.")
            Text("Pick a power and watch what happens. Nothing here is saved.")
                .bodyCopy()
                .padding(.top, 12)
            colony
                .padding(.top, 28)
            Spacer(minLength: 16)
            GlassEffectContainer(spacing: 10) {
                HStack(spacing: 10) {
                    ForEach(demos, id: \.power) { demo in
                        Button { play(demo) } label: {
                            VStack(spacing: 6) {
                                Image(systemName: demo.power.symbol).font(.title3)
                                Text(demo.power.title).font(.footnote.weight(.semibold))
                            }
                            .frame(maxWidth: .infinity, minHeight: 72)
                        }
                        .buttonStyle(.glass)
                        .tint(active == demo.power ? (demo.power.believed ? .earth : .amber) : nil)
                        .foregroundStyle(active == demo.power ? (demo.power.believed ? Color.earth : .amber) : .primary)
                    }
                }
            }
            Button("Continue", action: next)
                .primaryAction()
                .padding(.top, 16)
        }
        .padding(.horizontal, 24)
        .padding(.top, 8)
        .padding(.bottom, 16)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Skip", action: next) } }
        .sensoryFeedback(.impact(weight: .light), trigger: shown)
    }

    private var colony: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("COLONY MOOD").font(.caption2.weight(.semibold)).tracking(1.2).foregroundStyle(.secondary)
                    DotMatrixText(text: "\(mood)%", dot: 5, gap: 2.5, color: mood < 50 ? .orange : mood > 80 ? .green : .white)
                        .animation(.smooth, value: mood)
                }
                Spacer()
                HStack(spacing: -8) {
                    ForEach(["MA", "JO", "EV", "LI"], id: \.self) { initials in
                        Text(initials)
                            .font(.caption2.weight(.bold))
                            .frame(width: 30, height: 30)
                            .background(Color(white: 0.18), in: .circle)
                            .overlay(Circle().strokeBorder(.black, lineWidth: 2))
                    }
                }
                .accessibilityHidden(true)
            }
            Divider().overlay(.white.opacity(0.08)).padding(.vertical, 18)
            if let demo = demos.first(where: { $0.power == active }) {
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(demo.chain.indices.filter { $0 < shown }, id: \.self) { i in
                        HStack(spacing: 12) {
                            Image(systemName: demo.chain[i].0)
                                .font(.footnote)
                                .frame(width: 30, height: 30)
                                .foregroundStyle(i == 0 ? (demo.power.believed ? Color.earth : .amber) : .secondary)
                                .background(.white.opacity(0.06), in: .circle)
                            Text(demo.chain[i].1).font(.callout)
                            Spacer(minLength: 0)
                        }
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
                .frame(minHeight: 128, alignment: .top)
            } else {
                Text("The colony is quiet. For now.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 128)
            }
        }
        .padding(20)
        .surface()
    }

    private func play(_ demo: Demo) {
        run?.cancel()
        active = demo.power
        shown = 0
        mood = 72
        run = Task {
            for step in 1...demo.chain.count {
                try? await Task.sleep(for: .milliseconds(step == 1 ? 150 : 650))
                guard !Task.isCancelled else { return }
                withAnimation(.smooth(duration: 0.35)) { shown = step }
            }
            withAnimation(.smooth) { mood = demo.mood }
        }
    }
}

// MARK: - 3. Plan

private struct PickPlanStep: View {
    @Binding var plan: OnboardingView.Plan
    let next: () -> Void
    @State private var checkout = false

    private var pass: Bool { plan == .pass }
    private let perks: [(String, String, String, String)] = [
        ("brain.head.profile", "Thoughts a sol", "20", "60"),
        ("person.3.fill", "Colonists", "60", "120"),
        ("moon.haze.fill", "Offline catch-up", "None", "3 sols"),
        ("globe.europe.africa.fill", "Colonies", "1", "3"),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Title(lead: "Choose your\n", accent: "path.")
                Picker("Plan", selection: $plan.animation(.smooth)) {
                    ForEach(OnboardingView.Plan.allCases, id: \.self) { Text($0.rawValue) }
                }
                .pickerStyle(.segmented)
                .controlSize(.large)
                hero
                VStack(spacing: 0) {
                    ForEach(perks.indices, id: \.self) { i in
                        HStack(spacing: 14) {
                            Image(systemName: perks[i].0)
                                .foregroundStyle(pass ? Color.amber : .secondary)
                                .frame(width: 28)
                            Text(perks[i].1)
                            Spacer()
                            Text(pass ? perks[i].3 : perks[i].2)
                                .fontWeight(.semibold)
                                .monospacedDigit()
                                .contentTransition(.numericText())
                        }
                        .padding(.vertical, 16)
                        if i < perks.count - 1 { Divider().overlay(.white.opacity(0.08)) }
                    }
                }
                .padding(.horizontal, 18)
                .surface(24)
                Text("Every god power is free, on every plan.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
            }
            .padding(.horizontal, 24)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .safeAreaBar(edge: .bottom) {
            VStack(spacing: 14) {
                Button(pass ? "Continue · $4.99" : "Start for free") {
                    if pass { checkout = true } else { next() }
                }
                .primaryAction()
                HStack(spacing: 20) {
                    Button("Restore Purchase") {}
                    Button("Terms") {}
                    Button("Privacy") {}
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 24)
            .padding(.top, 8)
            .padding(.bottom, 4)
        }
        .sheet(isPresented: $checkout) {
            CheckoutSheet { checkout = false; next() }
                .presentationDetents([.height(420)])
        }
        .sensoryFeedback(.selection, trigger: plan)
    }

    /// Edge-lit card: a dark centre for the price and colour that gathers at the rim.
    private var hero: some View {
        let edge: [Color] = pass ? [Color(red: 0.55, green: 0.35, blue: 1), .pink, .amber] : [.earth, Color(red: 0.2, green: 0.4, blue: 0.9), .teal]
        return VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(pass ? "Colony Pass" : "Free").font(.headline)
                Spacer()
                Text(pass ? "ONE-TIME" : "FOREVER")
                    .font(.caption2.weight(.bold)).tracking(1.2)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(.white.opacity(0.12), in: .capsule)
            }
            Spacer()
            HStack(alignment: .top, spacing: 8) {
                Text("$").font(.title.weight(.semibold)).foregroundStyle(.white.opacity(0.75))
                DotMatrixText(text: pass ? "4.99" : "0", dot: 6, gap: 3)
            }
            Text(pass ? "Deeper minds, bigger colonies, three histories." : "The whole game. A colony of 60.")
                .font(.callout)
                .foregroundStyle(.white.opacity(0.85))
                .padding(.top, 14)
        }
        .padding(24)
        .frame(height: 210)
        .background {
            ZStack {
                RoundedRectangle(cornerRadius: 34).fill(Color(white: 0.04))
                RoundedRectangle(cornerRadius: 34)
                    .fill(MeshGradient(width: 3, height: 3, points: [
                        [0, 0], [0.5, 0], [1, 0], [0, 0.5], [0.5, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1],
                    ], colors: [
                        edge[0], edge[0].opacity(0.6), edge[1],
                        edge[0].opacity(0.4), .black, edge[1].opacity(0.5),
                        edge[2], edge[2].opacity(0.5), edge[1],
                    ]))
                    .opacity(0.85)
                    .mask(RoundedRectangle(cornerRadius: 34).strokeBorder(lineWidth: 46).blur(radius: 22))
                RoundedRectangle(cornerRadius: 34).strokeBorder(.white.opacity(0.18), lineWidth: 1)
            }
            .clipShape(.rect(cornerRadius: 34))
        }
    }
}

private struct CheckoutSheet: View {
    let done: () -> Void
    @State private var state: PayState = .idle
    private enum PayState { case idle, processing, paid }

    var body: some View {
        VStack(spacing: 0) {
            if state == .paid {
                Spacer()
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 64))
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, .green)
                    .transition(.scale.combined(with: .opacity))
                Text("Welcome, patron.").font(.title2.bold()).padding(.top, 14)
                Text("Colony Pass unlocked.").foregroundStyle(.secondary).padding(.top, 4)
                Spacer()
            } else {
                HStack(spacing: 14) {
                    Moon().frame(width: 52, height: 52)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Colony Pass").font(.headline)
                        Text("One-time purchase").font(.subheadline).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text("$4.99").font(.headline).monospacedDigit()
                }
                .padding(.top, 28)
                Divider().padding(.vertical, 20)
                HStack {
                    Text("Total").font(.headline)
                    Spacer()
                    Text("$4.99").font(.title2.bold()).monospacedDigit()
                }
                Spacer()
                if state == .processing {
                    ProgressView().controlSize(.large).frame(height: 54)
                } else {
                    PayWithApplePayButton(.buy) { pay() }
                        .payWithApplePayButtonStyle(.white)
                        .frame(height: 54)
                        .clipShape(.capsule)
                }
                Label("Test mode. You won't be charged.", systemImage: "lock.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.top, 14)
            }
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 8)
        .sensoryFeedback(.success, trigger: state == .paid)
    }

    private func pay() {
        withAnimation { state = .processing }
        Task {
            try? await Task.sleep(for: .seconds(1.2))
            withAnimation(.spring(duration: 0.5, bounce: 0.35)) { state = .paid }
            try? await Task.sleep(for: .seconds(1.2))
            done()
        }
    }
}

// MARK: - 4. Save (optional sign-in)

/// Sign-in comes after people have seen the game, says why it helps, and can be skipped.
private struct SaveStep: View {
    let next: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer()
            Title(lead: "Keep your\n", accent: "colony.")
            Text("Sign in to pick up Shackleton on any device. Your colonists keep living while you're away.")
                .bodyCopy()
                .padding(.top, 12)
            VStack(spacing: 12) {
                SignInWithAppleButton(.continue) { request in
                    request.requestedScopes = [.fullName, .email]
                } onCompletion: { result in
                    if case let .failure(error) = result, (error as? ASAuthorizationError)?.code == .canceled { return }
                    next()
                }
                .signInWithAppleButtonStyle(.white)
                .frame(height: 54)
                .clipShape(.capsule)
                Button("Continue with Email", systemImage: "envelope.fill", action: next)
                    .buttonStyle(.glass)
                    .controlSize(.extraLarge)
                    .buttonSizing(.flexible)
                    .fontWeight(.semibold)
            }
            .padding(.top, 32)
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 16)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Not Now", action: next) } }
    }
}

// MARK: - 5. Ready

/// A setup checklist in the progress-ring vocabulary: done, working, waiting.
private struct ReadyStep: View {
    let plan: OnboardingView.Plan
    let onFinish: () -> Void
    @State private var done = 2

    private var items: [(String, String)] {
        [("Plan chosen", plan.rawValue),
         ("Powers unlocked", "Seven, all free"),
         ("Colonists seeded", "100 people across 9 places"),
         ("First sol begins", "The ice wells are full")]
    }
    private var finished: Bool { done == items.count }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer()
            Title(lead: "Your colony\nis ", accent: finished ? "awake." : "waking.")
                .contentTransition(.interpolate)
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    ProgressRing(state: finished ? .done : .progress(Double(done) / Double(items.count)))
                    Text("Getting ready").font(.headline)
                    Spacer()
                    Text("\(done)/\(items.count)").monospacedDigit().foregroundStyle(.secondary).contentTransition(.numericText())
                }
                .padding(18)
                Divider().overlay(.white.opacity(0.08))
                VStack(spacing: 0) {
                    ForEach(items.indices, id: \.self) { i in
                        HStack(spacing: 14) {
                            ProgressRing(state: i < done ? .done : i == done ? .working : .waiting)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(items[i].0).foregroundStyle(i <= done ? .primary : .tertiary)
                                Text(items[i].1).font(.footnote).foregroundStyle(i <= done ? .secondary : .tertiary)
                            }
                            Spacer()
                        }
                        .padding(.vertical, 10)
                    }
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 8)
            }
            .surface()
            .padding(.top, 28)
            Button("Enter Shackleton", action: onFinish)
                .primaryAction()
                .disabled(!finished)
                .padding(.top, 24)
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 16)
        .navigationBarBackButtonHidden()
        .sensoryFeedback(.success, trigger: finished)
        .task {
            while done < items.count {
                try? await Task.sleep(for: .seconds(0.9))
                withAnimation(.smooth) { done += 1 }
            }
        }
    }
}

private struct ProgressRing: View {
    enum State: Equatable { case done, working, waiting, progress(Double) }
    let state: State
    @SwiftUI.State private var spin = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            switch state {
            case .done:
                Image(systemName: "checkmark.circle.fill")
                    .resizable()
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.black, .green)
                    .transition(.scale.combined(with: .opacity))
            case .working:
                Circle().stroke(Color.earth.opacity(0.3), style: StrokeStyle(lineWidth: 2, dash: [3.5, 3]))
                Circle().trim(from: 0, to: 0.45).stroke(Color.earth, style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [3.5, 3]))
                    .rotationEffect(.degrees(spin ? 360 : 0))
                    .onAppear {
                        guard !reduceMotion else { return }
                        withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) { spin = true }
                    }
            case .waiting:
                Circle().stroke(.white.opacity(0.2), lineWidth: 2)
            case let .progress(value):
                Circle().stroke(.white.opacity(0.15), lineWidth: 2)
                Circle().trim(from: 0, to: value).stroke(Color.green, style: StrokeStyle(lineWidth: 2, lineCap: .round)).rotationEffect(.degrees(-90))
            }
        }
        .frame(width: 22, height: 22)
        .animation(.smooth, value: state)
    }
}

#Preview { OnboardingView {} }

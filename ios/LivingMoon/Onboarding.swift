import SwiftUI

/// First-run flow: welcome, sign up, how to play, plan, checkout and the colony waking.
/// Everything here is mocked: no account is created and no payment is taken.
struct OnboardingView: View {
    enum Step: Int, CaseIterable { case welcome, account, howToPlay, plan, payment, ready }
    enum Plan: String, CaseIterable { case free = "Free", pass = "Colony Pass" }

    var onFinish: () -> Void
    @State var step: Step = .welcome
    @State private var plan: Plan = .free
    @State private var forward = true

    var body: some View {
        ZStack {
            OnboardingBackdrop(step: step)
            Group {
                switch step {
                case .welcome: WelcomeStep { go(.account) }
                case .account: AccountStep(back: { go(.welcome) }) { go(.howToPlay) }
                case .howToPlay: HowToPlayStep { go(.plan) }
                case .plan: PickPlanStep(plan: $plan, back: { go(.howToPlay) }) { go(plan == .pass ? .payment : .ready) }
                case .payment: PaymentStep(back: { go(.plan) }) { go(.ready) }
                case .ready: ReadyStep(plan: plan, onFinish: onFinish)
                }
            }
            .id(step)
            .transition(.asymmetric(
                insertion: .move(edge: forward ? .trailing : .leading).combined(with: .opacity),
                removal: .move(edge: forward ? .leading : .trailing).combined(with: .opacity)))
        }
        .preferredColorScheme(.dark)
    }

    private func go(_ next: Step) {
        forward = next.rawValue > step.rawValue
        withAnimation(.smooth(duration: 0.45)) { step = next }
    }
}

// MARK: - Backdrop

/// Near-black sky, a sparse star field and one luminous moon that drifts between steps.
private struct OnboardingBackdrop: View {
    let step: OnboardingView.Step

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let (size, center): (CGFloat, CGPoint) = switch step {
            case .welcome: (w * 0.78, CGPoint(x: w * 0.5, y: geo.size.height * 0.32))
            case .account: (w * 0.42, CGPoint(x: w * 0.82, y: geo.size.height * 0.1))
            case .howToPlay: (w * 1.3, CGPoint(x: w * 0.5, y: -w * 0.42))
            case .plan, .payment: (w * 0.4, CGPoint(x: w * 1.02, y: geo.size.height * 0.02))
            case .ready: (w * 0.5, CGPoint(x: w * 0.5, y: geo.size.height * 0.2))
            }
            ZStack {
                Color(red: 0.02, green: 0.024, blue: 0.05)
                StarField()
                Moon(glow: step == .welcome || step == .ready ? 1 : 0.55)
                    .frame(width: size, height: size)
                    .position(center)
                    .animation(.smooth(duration: 0.8), value: step)
            }
        }
        .ignoresSafeArea()
    }
}

struct Moon: View {
    var glow: Double = 1

    var body: some View {
        ZStack {
            Circle()
                .fill(Color.amber.opacity(0.35 * glow))
                .blur(radius: 60)
                .scaleEffect(1.15)
            Circle()
                .fill(Color.earth.opacity(0.25 * glow))
                .blur(radius: 50)
                .offset(x: -30, y: 30)
            Circle()
                .fill(RadialGradient(colors: [Color(white: 0.96), Color(white: 0.62), Color(red: 0.12, green: 0.12, blue: 0.2)],
                                     center: .init(x: 0.34, y: 0.3), startRadius: 0, endRadius: 260))
                .overlay {
                    Canvas { ctx, size in
                        let craters: [(CGFloat, CGFloat, CGFloat)] = [(0.3, 0.38, 0.11), (0.58, 0.28, 0.07), (0.62, 0.6, 0.13), (0.38, 0.7, 0.06), (0.22, 0.56, 0.05)]
                        for (x, y, r) in craters {
                            let rect = CGRect(x: size.width * (x - r), y: size.height * (y - r), width: size.width * r * 2, height: size.height * r * 2)
                            ctx.fill(Circle().path(in: rect), with: .color(.black.opacity(0.12)))
                        }
                    }
                }
                .overlay(Circle().strokeBorder(LinearGradient(colors: [.white.opacity(0.5), .clear, Color.amber.opacity(0.6)], startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 1.5))
                .shadow(color: Color.amber.opacity(0.4 * glow), radius: 40, y: 20)
        }
        .accessibilityHidden(true)
    }
}

private struct StarField: View {
    var body: some View {
        Canvas { ctx, size in
            var rng = SeededRandom(seed: 7)
            for _ in 0..<110 {
                let p = CGPoint(x: rng.next() * size.width, y: rng.next() * size.height)
                let r = 0.6 + rng.next() * 1.2
                ctx.fill(Circle().path(in: CGRect(x: p.x, y: p.y, width: r, height: r)), with: .color(.white.opacity(0.15 + rng.next() * 0.45)))
            }
        }
        .accessibilityHidden(true)
    }
}

private struct SeededRandom {
    var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> CGFloat {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return CGFloat(state >> 33) / CGFloat(UInt32.max >> 1)
    }
}

// MARK: - Shared pieces

private struct StepHeader: View {
    var back: (() -> Void)?
    var progress: Int
    var trailing: AnyView? = nil

    var body: some View {
        HStack {
            if let back {
                Button(action: back) { Image(systemName: "chevron.left").font(.body.weight(.semibold)).frame(width: 44, height: 44) }
                    .buttonStyle(.plain)
                    .glassEffect(.regular.interactive(), in: .circle)
                    .accessibilityLabel("Back")
            }
            Spacer()
            HStack(spacing: 6) {
                ForEach(0..<4) { i in
                    Capsule()
                        .fill(i <= progress ? Color.white : Color.white.opacity(0.2))
                        .frame(width: i == progress ? 22 : 6, height: 6)
                }
            }
            .animation(.smooth, value: progress)
            .accessibilityElement()
            .accessibilityLabel("Step \(progress + 1) of 4")
            Spacer()
            if let trailing { trailing } else { Color.clear.frame(width: 44, height: 44) }
        }
        .frame(height: 44)
    }
}

private struct PrimaryButton: View {
    let title: String
    var busy = false
    var enabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if busy { ProgressView().tint(.black) }
                Text(title).font(.body.weight(.semibold))
            }
            .frame(maxWidth: .infinity, minHeight: 56)
            .foregroundStyle(.black)
            .background(Color.white.opacity(enabled ? 1 : 0.35), in: .capsule)
        }
        .buttonStyle(.plain)
        .disabled(!enabled || busy)
    }
}

private struct Headline: View {
    let lead: String
    let accent: String
    var tint: Color = .amber

    var body: some View {
        Text("\(lead)\(Text(accent).foregroundStyle(tint))")
            .font(.system(size: 38, weight: .regular, design: .serif))
            .lineSpacing(-2)
            .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - 1. Welcome

private struct WelcomeStep: View {
    let next: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer()
            Text("SHACKLETON COLONY")
                .font(.caption.weight(.semibold).monospaced())
                .tracking(2)
                .foregroundStyle(Color.amber)
                .padding(.bottom, 12)
            Headline(lead: "A hundred lives.\n", accent: "One unseen hand.")
            Text("Watch a moon colony work, love and scheme on its own. Nudge it when you dare.")
                .font(.body)
                .foregroundStyle(.secondary)
                .padding(.top, 14)
            PrimaryButton(title: "Get started", action: next)
                .padding(.top, 36)
            Button("I already have an account", action: next)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, minHeight: 44)
                .padding(.top, 6)
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 8)
    }
}

// MARK: - 2. Account

private struct AccountStep: View {
    let back: () -> Void
    let next: () -> Void
    @State private var email = ""
    @State private var signingIn: String?
    @FocusState private var focused: Bool

    private var validEmail: Bool { email.contains("@") && email.contains(".") }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            StepHeader(back: back, progress: 0)
            Spacer(minLength: 24)
            Headline(lead: "Claim your\n", accent: "colony.")
            Text("Your colonists keep living while you're away. Sign in so they're still yours when you return.")
                .foregroundStyle(.secondary)
                .padding(.top, 12)
            VStack(spacing: 12) {
                provider("Continue with Apple", symbol: "apple.logo", filled: true)
                provider("Continue with Google", symbol: "g.circle.fill", filled: false)
                HStack {
                    Rectangle().fill(.white.opacity(0.12)).frame(height: 1)
                    Text("or").font(.footnote).foregroundStyle(.tertiary)
                    Rectangle().fill(.white.opacity(0.12)).frame(height: 1)
                }
                .padding(.vertical, 6)
                HStack(spacing: 12) {
                    Image(systemName: "envelope").foregroundStyle(.secondary)
                    TextField("Email address", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focused)
                        .submitLabel(.continue)
                        .onSubmit { if validEmail { next() } }
                }
                .padding(.horizontal, 20)
                .frame(minHeight: 56)
                .glassEffect(.regular, in: .capsule)
                PrimaryButton(title: "Continue with email", enabled: validEmail, action: next)
            }
            .padding(.top, 32)
            Text("By continuing you agree to the Terms and Privacy Policy.")
                .font(.caption)
                .foregroundStyle(.tertiary)
                .frame(maxWidth: .infinity)
                .padding(.top, 16)
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 8)
    }

    private func provider(_ title: String, symbol: String, filled: Bool) -> some View {
        Button {
            signingIn = title
            Task {
                try? await Task.sleep(for: .milliseconds(700))
                next()
            }
        } label: {
            HStack(spacing: 10) {
                if signingIn == title { ProgressView().tint(filled ? .black : .white) } else { Image(systemName: symbol) }
                Text(title).font(.body.weight(.semibold))
            }
            .frame(maxWidth: .infinity, minHeight: 56)
            .foregroundStyle(filled ? .black : .white)
            .background(filled ? AnyShapeStyle(.white) : AnyShapeStyle(.clear), in: .capsule)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .glassEffect(filled ? .identity : .regular.interactive(), in: .capsule)
        .disabled(signingIn != nil)
    }
}

// MARK: - 3. How to play

private struct HowToPlayStep: View {
    let next: () -> Void
    @State private var page = 0

    private let pages: [(lead: String, accent: String, tint: Color, body: String)] = [
        ("They live\n", "without you.", .earth, "A hundred colonists with jobs, needs, friendships and grudges. Each one decides what to do next, every ten minutes of colony time."),
        ("You are the\n", "unseen force.", .amber, "Dry up the ice wells, call down meteors or drop supplies. Whisper an idea into one mind, or start a rumor and watch it spread."),
        ("Every act\n", "echoes.", Color(red: 0.73, green: 0.55, blue: 1), "Rationing leads to blame, blame to factions. The Chronicle traces each consequence back to what you did."),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Spacer()
                Button { next() } label: {
                    HStack(spacing: 4) { Text("Skip"); Image(systemName: "chevron.right").font(.caption.weight(.semibold)) }
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                        .frame(minHeight: 44)
                }
            }
            .padding(.horizontal, 24)
            TabView(selection: $page) {
                ForEach(pages.indices, id: \.self) { i in
                    VStack(alignment: .leading, spacing: 0) {
                        Group {
                            switch i {
                            case 0: ColonistsIllustration()
                            case 1: PowersIllustration()
                            default: ChainIllustration()
                            }
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        Headline(lead: pages[i].lead, accent: pages[i].accent, tint: pages[i].tint)
                        Text(pages[i].body)
                            .foregroundStyle(.secondary)
                            .padding(.top, 12)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.horizontal, 24)
                    .tag(i)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            HStack(spacing: 6) {
                ForEach(pages.indices, id: \.self) { i in
                    Capsule().fill(i == page ? Color.white : .white.opacity(0.2)).frame(width: i == page ? 22 : 6, height: 6)
                }
            }
            .animation(.smooth, value: page)
            .padding(.horizontal, 24)
            .padding(.vertical, 24)
            PrimaryButton(title: page == pages.count - 1 ? "Choose how to play" : "Next") {
                if page == pages.count - 1 { next() } else { withAnimation(.smooth) { page += 1 } }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 8)
        }
    }
}

private struct ColonistsIllustration: View {
    private let people: [(String, Color, CGFloat, CGFloat)] = [
        ("MA", .earth, -110, -70), ("JO", .amber, 0, -120), ("RK", .green, 110, -60), ("TS", .pink, -70, 60),
        ("EV", Color(red: 0.73, green: 0.55, blue: 1), 80, 80), ("LI", .orange, -140, 10), ("NO", .mint, 140, 20),
    ]

    var body: some View {
        ZStack {
            Circle().strokeBorder(.white.opacity(0.08), style: StrokeStyle(lineWidth: 1, dash: [3, 5])).frame(width: 260, height: 260)
            Circle().strokeBorder(.white.opacity(0.06), style: StrokeStyle(lineWidth: 1, dash: [3, 5])).frame(width: 170, height: 170)
            Moon(glow: 0.5).frame(width: 70, height: 70)
            ForEach(people, id: \.0) { p in
                Text(p.0)
                    .font(.caption.weight(.bold).monospaced())
                    .foregroundStyle(.black.opacity(0.75))
                    .frame(width: 42, height: 42)
                    .background(p.1.gradient, in: .circle)
                    .overlay(Circle().strokeBorder(.white.opacity(0.4), lineWidth: 1))
                    .shadow(color: p.1.opacity(0.5), radius: 12)
                    .offset(x: p.2, y: p.3)
            }
            Text("“Water is short again.”")
                .font(.footnote)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .glassEffect(.regular, in: .capsule)
                .offset(x: -40, y: -150)
        }
        .accessibilityHidden(true)
    }
}

private struct PowersIllustration: View {
    var body: some View {
        let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]
        LazyVGrid(columns: columns, spacing: 10) {
            ForEach(Power.allCases.prefix(6)) { power in
                HStack(spacing: 10) {
                    Image(systemName: power.symbol)
                        .frame(width: 32, height: 32)
                        .background((power.believed ? Color.earth : .amber).opacity(0.18), in: .circle)
                        .foregroundStyle(power.believed ? Color.earth : .amber)
                    Text(power.title).font(.subheadline.weight(.medium)).lineLimit(1)
                    Spacer(minLength: 0)
                }
                .padding(10)
                .glassEffect(.regular, in: .rect(cornerRadius: 20))
            }
        }
        .padding(.top, 40)
        .accessibilityHidden(true)
    }
}

private struct ChainIllustration: View {
    private let rows: [(String, String, Color)] = [
        ("burst.fill", "Meteor storm strikes the ice wells", .amber),
        ("drop.fill", "Water rationed at the canteen", .earth),
        ("bubble.left.and.bubble.right.fill", "Mara blames the council", .pink),
        ("building.columns.fill", "A new faction meets in secret", Color(red: 0.73, green: 0.55, blue: 1)),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(rows.indices, id: \.self) { i in
                HStack(spacing: 14) {
                    Image(systemName: rows[i].0)
                        .font(.subheadline)
                        .foregroundStyle(rows[i].2)
                        .frame(width: 40, height: 40)
                        .glassEffect(.regular.tint(rows[i].2.opacity(0.25)), in: .circle)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Sol 4 · \(8 + i * 2):\(i == 0 ? "10" : "40")").font(.caption.monospacedDigit()).foregroundStyle(.tertiary)
                        Text(rows[i].1).font(.subheadline.weight(.medium))
                    }
                }
                if i < rows.count - 1 {
                    Rectangle().fill(.white.opacity(0.15)).frame(width: 1.5, height: 22).padding(.leading, 19.25)
                }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular, in: .rect(cornerRadius: 28))
        .padding(.top, 40)
        .accessibilityHidden(true)
    }
}

// MARK: - 4. Plan

private struct PickPlanStep: View {
    @Binding var plan: OnboardingView.Plan
    let back: () -> Void
    let next: () -> Void
    @Namespace private var segment

    private var pass: Bool { plan == .pass }
    private var perks: [(String, String, String)] {
        [
            ("brain.head.profile", pass ? "60" : "20", "thoughts a sol"),
            ("person.3.fill", pass ? "120" : "60", "colonists"),
            ("moon.haze.fill", pass ? "3 sols" : "None", "offline catch-up"),
            ("globe.europe.africa.fill", pass ? "3" : "1", pass ? "colonies" : "colony"),
        ]
    }

    var body: some View {
        VStack(spacing: 0) {
            StepHeader(back: back, progress: 2).padding(.horizontal, 24)
            ScrollView {
                VStack(spacing: 20) {
                    Text("Pick your path")
                        .font(.system(size: 38, design: .serif))
                        .padding(.top, 12)
                    HStack(spacing: 0) {
                        ForEach(OnboardingView.Plan.allCases, id: \.self) { option in
                            Button { withAnimation(.smooth(duration: 0.3)) { plan = option } } label: {
                                Text(option.rawValue)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(plan == option ? .black : .secondary)
                                    .padding(.horizontal, 18).frame(minHeight: 38)
                                    .background {
                                        if plan == option { Capsule().fill(.white).matchedGeometryEffect(id: "seg", in: segment) }
                                    }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(4)
                    .glassEffect(.regular, in: .capsule)
                    hero
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                        ForEach(perks, id: \.2) { perk in
                            VStack(alignment: .leading, spacing: 14) {
                                Image(systemName: perk.0)
                                    .font(.title3)
                                    .foregroundStyle(pass ? Color.amber : .secondary)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(perk.1).font(.system(size: 26, weight: .semibold, design: .rounded)).contentTransition(.numericText())
                                    Text(perk.2).font(.footnote).foregroundStyle(.secondary)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(18)
                            .background(.white.opacity(0.05), in: .rect(cornerRadius: 24))
                            .overlay(RoundedRectangle(cornerRadius: 24).strokeBorder(.white.opacity(0.08)))
                        }
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
            }
            .scrollIndicators(.hidden)
            PrimaryButton(title: pass ? "Continue · $4.99" : "Start for free", action: next)
                .padding(.horizontal, 24)
                .padding(.top, 8)
                .padding(.bottom, 8)
        }
    }

    private var hero: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 32)
                .fill(pass
                      ? LinearGradient(colors: [Color(red: 0.36, green: 0.22, blue: 0.62), Color(red: 0.12, green: 0.08, blue: 0.3)], startPoint: .topTrailing, endPoint: .bottomLeading)
                      : LinearGradient(colors: [Color(red: 0.12, green: 0.24, blue: 0.4), Color(red: 0.05, green: 0.08, blue: 0.16)], startPoint: .topTrailing, endPoint: .bottomLeading))
                .overlay(alignment: .topTrailing) {
                    Moon(glow: pass ? 0.9 : 0.4)
                        .frame(width: 130, height: 130)
                        .offset(x: 30, y: -24)
                }
                .overlay(RoundedRectangle(cornerRadius: 32).strokeBorder(LinearGradient(colors: [.white.opacity(0.35), .white.opacity(0.04)], startPoint: .top, endPoint: .bottom), lineWidth: 1))
                .clipShape(.rect(cornerRadius: 32))
            VStack(alignment: .leading, spacing: 4) {
                Text(pass ? "Colony Pass" : "Free forever").font(.system(size: 26, design: .serif))
                Text(pass ? "$4.99 once · no subscription" : "$0 · no card needed").font(.subheadline).foregroundStyle(.white.opacity(0.7))
                Spacer(minLength: 28)
                ForEach(pass ? ["Every god power", "Deeper colonist minds", "Run three histories side by side"] : ["Every god power", "A colony of 60", "Upgrade any time"], id: \.self) { line in
                    Label(line, systemImage: "checkmark.circle.fill")
                        .font(.subheadline)
                        .symbolRenderingMode(.hierarchical)
                        .padding(.top, 4)
                }
            }
            .padding(22)
        }
        .frame(height: 230)
        .animation(.smooth(duration: 0.35), value: plan)
    }
}

// MARK: - 5. Payment

private struct PaymentStep: View {
    enum Method: String { case applePay = "Apple Pay", card = "Visa ···· 4242" }
    let back: () -> Void
    let next: () -> Void
    @State private var method: Method = .applePay
    @State private var state: PayState = .idle
    enum PayState { case idle, processing, paid }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            StepHeader(back: state == .idle ? back : nil, progress: 3)
            if state == .paid {
                Spacer()
                VStack(spacing: 16) {
                    Image(systemName: "checkmark")
                        .font(.system(size: 34, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 84, height: 84)
                        .background(Color.green.gradient, in: .circle)
                        .shadow(color: .green.opacity(0.5), radius: 24)
                        .transition(.scale.combined(with: .opacity))
                    Text("Welcome, patron.").font(.system(size: 32, design: .serif))
                    Text("Colony Pass unlocked.").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                Spacer()
            } else {
                Text("Checkout")
                    .font(.system(size: 38, design: .serif))
                    .padding(.top, 28)
                VStack(spacing: 0) {
                    row("Colony Pass", "$4.99", strong: true)
                    row("One-time purchase", "", dim: true)
                    Divider().overlay(.white.opacity(0.1)).padding(.vertical, 12)
                    row("Tax", "$0.00", dim: true)
                    row("Total", "$4.99", strong: true).padding(.top, 6)
                }
                .padding(20)
                .glassEffect(.regular, in: .rect(cornerRadius: 28))
                .padding(.top, 20)
                Text("PAY WITH")
                    .font(.caption.weight(.semibold).monospaced()).tracking(1.5)
                    .foregroundStyle(.tertiary)
                    .padding(.top, 28).padding(.bottom, 10)
                VStack(spacing: 10) {
                    methodRow(.applePay, symbol: "apple.logo")
                    methodRow(.card, symbol: "creditcard.fill")
                }
                Spacer()
                Label("Test mode. You won't be charged.", systemImage: "lock.fill")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .frame(maxWidth: .infinity)
                    .padding(.bottom, 12)
                PrimaryButton(title: state == .processing ? "Processing…" : "Pay $4.99", busy: state == .processing) {
                    withAnimation { state = .processing }
                    Task {
                        try? await Task.sleep(for: .seconds(1.4))
                        withAnimation(.spring(duration: 0.5, bounce: 0.35)) { state = .paid }
                        try? await Task.sleep(for: .seconds(1.3))
                        next()
                    }
                }
            }
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 8)
    }

    private func row(_ label: String, _ value: String, strong: Bool = false, dim: Bool = false) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(value).monospacedDigit()
        }
        .font(strong ? .body.weight(.semibold) : .subheadline)
        .foregroundStyle(dim ? .secondary : .primary)
        .padding(.vertical, 3)
    }

    private func methodRow(_ m: Method, symbol: String) -> some View {
        Button { withAnimation(.smooth(duration: 0.2)) { method = m } } label: {
            HStack(spacing: 14) {
                Image(systemName: symbol).frame(width: 28)
                Text(m.rawValue).font(.body.weight(.medium))
                Spacer()
                Image(systemName: method == m ? "largecircle.fill.circle" : "circle")
                    .font(.title3)
                    .foregroundStyle(method == m ? Color.amber : .secondary)
            }
            .padding(.horizontal, 18)
            .frame(minHeight: 58)
            .background(.white.opacity(method == m ? 0.08 : 0.03), in: .rect(cornerRadius: 20))
            .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(method == m ? Color.amber.opacity(0.6) : .white.opacity(0.08)))
        }
        .buttonStyle(.plain)
        .disabled(state != .idle)
    }
}

// MARK: - 6. Ready

/// A setup checklist in the progress-ring vocabulary: done, working, waiting.
private struct ReadyStep: View {
    let plan: OnboardingView.Plan
    let onFinish: () -> Void
    @State private var done = 2

    private var items: [(String, String)] {
        [("Account created", "Signed in"),
         ("Plan chosen", plan.rawValue),
         ("Colonists seeded", "100 people, 9 places"),
         ("First sol begins", "The ice wells are full")]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer()
            Headline(lead: "Your colony\nis ", accent: done == items.count ? "awake." : "waking.")
                .contentTransition(.opacity)
            VStack(spacing: 0) {
                HStack {
                    Text("Getting ready").font(.subheadline.weight(.semibold))
                    Spacer()
                    Text("\(done)/\(items.count)").font(.subheadline.monospacedDigit()).foregroundStyle(.secondary).contentTransition(.numericText())
                    ProgressRing(state: done == items.count ? .done : .progress(Double(done) / Double(items.count)))
                }
                .padding(.bottom, 14)
                ForEach(items.indices, id: \.self) { i in
                    HStack(spacing: 14) {
                        ProgressRing(state: i < done ? .done : i == done ? .working : .waiting)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(items[i].0).font(.body.weight(.medium)).foregroundStyle(i <= done ? .primary : .secondary)
                            Text(items[i].1).font(.footnote).foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    .padding(.vertical, 10)
                }
            }
            .padding(20)
            .glassEffect(.regular, in: .rect(cornerRadius: 28))
            .padding(.top, 24)
            PrimaryButton(title: "Enter Shackleton", enabled: done == items.count, action: onFinish)
                .padding(.top, 28)
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 8)
        .task {
            while done < items.count {
                try? await Task.sleep(for: .seconds(1.1))
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
                Circle().fill(Color.green)
                Image(systemName: "checkmark").font(.system(size: 11, weight: .heavy)).foregroundStyle(.white)
            case .working:
                Circle().stroke(Color.earth.opacity(0.3), style: StrokeStyle(lineWidth: 2.5, dash: [4, 3.2]))
                Circle().trim(from: 0, to: 0.4).stroke(Color.earth, style: StrokeStyle(lineWidth: 2.5, lineCap: .round, dash: [4, 3.2]))
                    .rotationEffect(.degrees(spin ? 360 : 0))
                    .onAppear {
                        guard !reduceMotion else { return }
                        withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) { spin = true }
                    }
            case .waiting:
                Circle().stroke(.white.opacity(0.2), lineWidth: 2.5)
            case let .progress(value):
                Circle().stroke(.white.opacity(0.15), lineWidth: 2.5)
                Circle().trim(from: 0, to: value).stroke(Color.green, style: StrokeStyle(lineWidth: 2.5, lineCap: .round)).rotationEffect(.degrees(-90))
            }
        }
        .frame(width: 24, height: 24)
        .animation(.smooth, value: state)
    }
}

#Preview { OnboardingView {} }

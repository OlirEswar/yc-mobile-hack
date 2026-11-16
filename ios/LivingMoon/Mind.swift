import SwiftUI

// What a colonist is doing and feeling, as symbols and colours, plus the cards that show their mind.

extension AgentLite {
    /// The symbol for the bubble over their head: a strong feeling wins over the activity.
    var bubbleSymbol: String {
        switch mood {
        case "afraid", "frightened", "shaken": return "exclamationmark.triangle.fill"
        case "grieving": return "heart.slash.fill"
        case "astonished": return "star.fill"
        case "unsettled": return "sparkles"
        default: break
        }
        return Mind.symbol(activity: activity)
    }

    var bubbleTint: Color { Mind.tint(mood: mood) ?? Mind.tint(activity: activity) }
}

enum Mind {
    static func symbol(activity: String) -> String {
        switch activity {
        case "walking": "figure.walk"
        case "working": "wrench.and.screwdriver.fill"
        case "eating": "fork.knife"
        case "drinking": "drop.fill"
        case "sleeping": "zzz"
        case "resting": "cup.and.saucer.fill"
        case "talking": "ellipsis.bubble.fill"
        case "trading": "creditcard.fill"
        case "giving": "gift.fill"
        case "helping": "cross.case.fill"
        case "stealing": "hand.raised.slash.fill"
        case "investigating": "magnifyingglass"
        case "fleeing": "figure.run"
        case "mourning": "heart.slash.fill"
        default: "ellipsis"
        }
    }

    static func tint(activity: String) -> Color {
        switch activity {
        case "sleeping", "resting": Color(red: 0.45, green: 0.5, blue: 0.75)
        case "drinking": .earth
        case "eating", "trading", "giving": .amber
        case "helping": .green
        case "stealing", "fleeing": .red
        case "investigating": .teal
        default: Color(white: 0.25)
        }
    }

    /// Colour for a mood that should show; nil for the everyday ones.
    static func tint(mood: String) -> Color? {
        switch mood {
        case "afraid", "frightened", "shaken": .red
        case "grieving": Color(red: 0.55, green: 0.6, blue: 0.75)
        case "astonished": .amber
        case "unsettled": .earth
        case "worried", "restless": .orange
        case "cheerful", "hopeful": .green
        default: nil
        }
    }

    static func tint(relationship kind: String, affinity: Double) -> Color {
        switch kind {
        case "family": .amber
        case "rival": .red
        case "friend": .green
        default: affinity < 0 ? .red.opacity(0.8) : .white.opacity(0.7)
        }
    }
}

/// A small capsule naming a mood, coloured by how it feels.
struct MoodChip: View {
    var mood: String

    var body: some View {
        let tint = Mind.tint(mood: mood) ?? .secondary
        Text(mood)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(tint.opacity(0.16), in: .capsule)
    }
}

/// A cartoon thought bubble: a rounded body with two small circles trailing to the thinker.
struct ThoughtBubbleShape: Shape {
    var radius: CGFloat = 22
    var tail: CGFloat = 14

    func path(in rect: CGRect) -> Path {
        var p = Path()
        let body = CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: rect.height - tail)
        p.addRoundedRect(in: body, cornerSize: CGSize(width: radius, height: radius), style: .continuous)
        p.addEllipse(in: CGRect(x: rect.minX + 26, y: body.maxY + 2, width: 9, height: 9))
        p.addEllipse(in: CGRect(x: rect.minX + 17, y: body.maxY + 9, width: 5, height: 5))
        return p
    }
}

/// What is on a colonist's mind right now: the latest thought, what set it off, and the plan it led to.
struct ThoughtCard: View {
    var agent: AgentLite
    var detail: AgentDetail?
    var nowTick: Double

    @State private var pulse = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var thought: ThoughtPublic? { detail?.lastThought }
    private var fresh: Bool { (thought.map { nowTick - $0.tick } ?? .infinity) < 6 }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: thought?.source == "llm" ? "brain.head.profile.fill" : "bolt.heart.fill")
                    .foregroundStyle(Color.earth)
                    .symbolEffect(.pulse, isActive: fresh && !reduceMotion)
                Text(fresh ? "THINKING NOW" : thought == nil ? "ON THEIR MIND" : "LAST THOUGHT")
                    .font(.caption2.weight(.bold)).tracking(1.4)
                    .foregroundStyle(Color.earth)
                Spacer()
                if let thought { Text(Clock.time(thought.tick)).font(.caption2.monospacedDigit()).foregroundStyle(.secondary) }
                MoodChip(mood: agent.alive ? agent.mood : "dead")
            }
            Text("\u{201C}" + (thought?.intent ?? detail?.plan?.intent ?? agent.activityLabel) + "\u{201D}")
                .font(.title3).fontDesign(.serif).italic()
                .fixedSize(horizontal: false, vertical: true)
                .contentTransition(.opacity)
            if let trigger = thought?.trigger {
                Label("because " + trigger, systemImage: "arrow.turn.down.right")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if let plan = detail?.plan, !plan.steps.isEmpty { PlanSteps(plan: plan) }
        }
        .padding(16)
        .padding(.bottom, 14)
        .background {
            ThoughtBubbleShape()
                .fill(Color.earth.opacity(pulse ? 0.13 : 0.08))
                .overlay(ThoughtBubbleShape().stroke(Color.earth.opacity(0.3), lineWidth: 1))
        }
        .animation(.smooth(duration: 0.4), value: thought)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 1.6).repeatForever()) { pulse = true }
        }
    }
}

/// The steps of a plan, done, running and still to come.
struct PlanSteps: View {
    var plan: PlanPublic

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            ForEach(plan.steps.indices, id: \.self) { i in
                let step = plan.steps[i]
                HStack(spacing: 10) {
                    Group {
                        switch step.status {
                        case "done": Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                        case "running": Image(systemName: "circle.dotted").foregroundStyle(Color.amber).symbolEffect(.rotate, options: .repeat(.continuous))
                        case "failed": Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
                        default: Image(systemName: "circle").foregroundStyle(.tertiary)
                        }
                    }
                    .font(.footnote)
                    .frame(width: 18)
                    Text(step.label)
                        .font(.subheadline)
                        .foregroundStyle(step.status == "pending" ? .secondary : .primary)
                        .strikethrough(step.status == "failed")
                }
            }
        }
        .padding(.top, 2)
    }
}

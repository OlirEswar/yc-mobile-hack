import SwiftUI

/// Follow mode: the camera rides with one colonist while the player reads their mind, asks them
/// questions, sees their stories and jumps to whoever the story pulls in next.
struct FollowView: View {
    @Environment(Game.self) private var game
    enum Pane: Hashable { case now, mind, ask, story }

    @State private var detail: AgentDetail?
    @State private var focus: FocusState?
    @State private var conversation: [AskTurn] = []
    @State private var pane = Pane.mind
    @State private var power: Power?
    @State private var profile = false
    @State private var keyboard = false

    /// The monologue: the backend's when it has one, else the last recorded decision.
    private var thoughts: [ThoughtLine] {
        if let lines = focus?.thoughts, !lines.isEmpty { return lines }
        guard let t = detail?.lastThought else { return [] }
        return [ThoughtLine(id: "last-\(t.tick)", tick: t.tick, text: t.intent, mood: nil, source: t.source)]
    }

    var body: some View {
        ZStack {
            MapView(focus: game.followingID, focusAnchor: 0.47)
            if let c = game.colonist(game.followingID) {
                VStack(spacing: 10) {
                    topBar
                    if !keyboard {
                        hooks
                        CoachCard()
                    }
                    if let toast = game.toast, toast.kind == .error {
                        Text(toast.text).font(.subheadline).padding(12).glassEffect().onTapGesture { game.toast = nil }
                    }
                    Spacer(minLength: 0)
                    panel(c)
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 6)
                .animation(.smooth, value: thoughts.first?.id)
                .animation(.smooth, value: focus?.hooks ?? [])
                .animation(.smooth, value: game.tutorialStep)
                .animation(.smooth, value: keyboard)
                .onAppear { if pane == .mind { game.didAct(.read_thoughts) } }
                .onChange(of: game.tutorialStep) { if pane == .mind { game.didAct(.read_thoughts) } }
                .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in keyboard = true }
                .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboard = false }
                .task(id: c.id) { for await d in game.detailStream(c.id) { detail = d } }
                .task(id: c.id) { for await f in game.focusStream(c.id) { focus = f } }
                .task(id: c.id) { for await turns in game.conversationStream(c.id) { conversation = turns } }
                .onChange(of: c.id) {
                    detail = nil
                    focus = nil
                    conversation = []
                }
            }
        }
        .sheet(item: $power) { p in PowerSheet(power: p).presentationDetents(p.believed ? [.large] : [.medium, .large]) }
        .sheet(isPresented: $profile) {
            if let id = game.followingID { InspectSheet(id: id, inFollow: true).presentationDetents([.medium, .large]) }
        }
    }

    // MARK: Top

    private var topBar: some View {
        HStack(spacing: 8) {
            Button { game.unfollow() } label: {
                Label("Colony", systemImage: "chevron.left").padding(.horizontal, 2)
            }
            .buttonStyle(.glass)
            Spacer()
            if game.warping {
                Label("Fast-forwarding", systemImage: "forward.fill")
                    .font(.caption.weight(.semibold))
                    .symbolEffect(.pulse, options: .repeating)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .glassEffect(.regular.tint(Color.earth.opacity(0.3)))
                    .transition(.opacity)
            }
            Button { game.togglePause() } label: {
                Image(systemName: game.speed == 0 ? "play.fill" : "pause.fill").font(.subheadline.weight(.bold)).frame(width: 22, height: 22)
            }
            .buttonStyle(.glass)
            .accessibilityLabel(game.speed == 0 ? "Resume" : "Pause")
            Menu {
                Picker("Speed", selection: Binding(get: { game.speed }, set: { game.setSpeed($0) })) {
                    Label("Pause", systemImage: "pause.fill").tag(0.0)
                    Label("1× speed", systemImage: "play.fill").tag(1.0)
                    Label("4× speed", systemImage: "forward.fill").tag(4.0)
                    Label("8× speed", systemImage: "forward.end.fill").tag(8.0)
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: game.speed == 0 ? "pause.fill" : "play.fill").font(.caption2.weight(.bold))
                    Text(Clock.time(game.world?.tick ?? 0)).font(.subheadline.weight(.semibold).monospacedDigit())
                }
                .padding(.horizontal, 4)
            }
            .buttonStyle(.glass)
        }
        .animation(.smooth, value: game.warping)
    }

    @ViewBuilder private var hooks: some View {
        if let hooks = focus?.hooks, !hooks.isEmpty {
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(hooks.prefix(1)) { hook in
                        Button { game.follow(hook.agentId) } label: {
                            HStack(spacing: 8) {
                                if let c = game.colonist(hook.agentId) { Avatar(spriteId: c.spriteId, size: 30) }
                                VStack(alignment: .leading, spacing: 1) {
                                    Text("Follow \(hook.name.split(separator: " ")[0])").font(.caption.weight(.semibold))
                                    Text(hook.reason).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                                }
                                Image(systemName: "arrow.right.circle.fill").foregroundStyle(Color.amber)
                            }
                            .padding(.leading, 6).padding(.trailing, 10).padding(.vertical, 6)
                            .glassEffect(.regular.tint(Color.amber.opacity(0.15)).interactive(), in: .capsule)
                        }
                        .buttonStyle(.plain)
                        .transition(.move(edge: .leading).combined(with: .opacity))
                    }
                }
            }
            .scrollIndicators(.hidden)
        }
    }

    // MARK: Panel

    private func panel(_ c: AgentLite) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            header(c)
            Picker("Pane", selection: $pane) {
                Text("Now").tag(Pane.now)
                Text("Mind").tag(Pane.mind)
                Text("Ask").tag(Pane.ask)
                Text("Story").tag(Pane.story)
            }
            .pickerStyle(.segmented)
            .onChange(of: pane) { _, p in
                if p == .mind { game.didAct(.read_thoughts) }
                if p == .story { game.didAct(.open_storylines) }
            }
            Group {
                switch pane {
                case .now: now(c)
                case .mind: MindPane(colonist: c, thoughts: thoughts, storylines: focus?.storylines ?? [], ties: detail?.relationships ?? [])
                case .ask: AskPane(colonist: c, persona: detail?.persona, storylines: focus?.storylines ?? [], ties: detail?.relationships ?? [], conversation: conversation)
                case .story: StoryPane(detail: detail, storylines: focus?.storylines ?? game.storylines.filter { $0.participantIds.contains(c.id) })
                }
            }
            .frame(height: 236, alignment: .top)
        }
        .padding(16)
        .glassEffect(.regular, in: .rect(cornerRadius: 30))
        .contentShape(.rect(cornerRadius: 30))
        .onTapGesture {}
    }

    private func header(_ c: AgentLite) -> some View {
        HStack(spacing: 12) {
            Button { profile = true } label: { Avatar(spriteId: c.spriteId, size: 48) }
                .buttonStyle(.plain)
            VStack(alignment: .leading, spacing: 2) {
                Text(c.name).font(.title3).fontDesign(.serif)
                Text(detail?.persona?.epithet ?? occupation(c.occupation).label)
                    .font(.caption.italic()).foregroundStyle(.secondary).lineLimit(2)
            }
            Spacer(minLength: 4)
            if let arc = detail?.persona?.arc {
                Text(arc.stage.capitalized)
                    .font(.caption2.weight(.bold))
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Color.amber.opacity(0.2), in: Capsule())
                    .foregroundStyle(Color.amber)
                    .accessibilityLabel("Arc: \(arc.stage)")
            }
        }
    }

    /// What they are doing and why, in words; needs only when they press.
    private func now(_ c: AgentLite) -> some View {
        let nearby = game.agents.filter { $0.id != c.id && $0.alive && $0.move == nil && c.move == nil && $0.locationId == c.locationId }
        let partner = game.colonist(c.interactingWithId)
        return VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(c.activityLabel).font(.headline)
                if let why = detail?.plan?.intent ?? detail?.lastThought?.intent {
                    Text("Why: " + why).font(.subheadline).foregroundStyle(.secondary).lineLimit(3)
                }
            }
            if let steps = detail?.plan?.steps, steps.count > 1 {
                HStack(spacing: 6) {
                    ForEach(Array(steps.prefix(4).enumerated()), id: \.offset) { i, step in
                        if i > 0 { Image(systemName: "chevron.right").font(.system(size: 8, weight: .bold)).foregroundStyle(.tertiary) }
                        Text(step.label)
                            .font(.caption2)
                            .lineLimit(1)
                            .foregroundStyle(step.status == "running" ? Color.amber : step.status == "done" ? .secondary : .primary)
                            .strikethrough(step.status == "done")
                    }
                }
            }
            let pressing = pressingNeeds(c)
            if !pressing.isEmpty {
                HStack(spacing: 6) {
                    ForEach(pressing, id: \.self) { need in
                        Text(need).font(.caption2.weight(.semibold)).padding(.horizontal, 8).padding(.vertical, 3)
                            .background(.red.opacity(0.18), in: Capsule())
                    }
                }
            }
            Text(where_(c, partner: partner, nearby: nearby.count)).font(.footnote).foregroundStyle(.secondary)
            Spacer(minLength: 0)
            Menu {
                ForEach([Power.supplyDrop, .rumor, .endLife]) { p in
                    Button(p.title, systemImage: p.symbol) {
                        game.powerTarget = c.id
                        power = p
                    }
                }
            } label: {
                Label("Powers", systemImage: "hand.point.up.left.fill").frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
        }
    }

    private func pressingNeeds(_ c: AgentLite) -> [String] {
        var out: [String] = []
        if c.needs.thirst > 65 { out.append("Thirsty") }
        if c.needs.hunger > 65 { out.append("Hungry") }
        if c.needs.fatigue > 75 { out.append("Exhausted") }
        if c.needs.safety > 60 { out.append("Afraid") }
        if c.needs.social > 80 { out.append("Lonely") }
        if c.health < 40 { out.append("Unwell") }
        return out
    }

    private func where_(_ c: AgentLite, partner: AgentLite?, nearby: Int) -> String {
        if let move = c.move { return "On the way from \(move.from.name) to \(move.to.name)." }
        let place = "At \(c.locationId.name)"
        if let partner { return place + " with \(partner.name)." }
        return place + (nearby == 0 ? ", alone." : nearby == 1 ? " with one other." : " among \(nearby) others.")
    }
}

/// The followed colonist's inner monologue, and the field where the player plants thoughts.
struct MindPane: View {
    @Environment(Game.self) private var game
    var colonist: AgentLite
    var thoughts: [ThoughtLine]
    var storylines: [StorylinePublic]
    var ties: [RelationshipPublic]

    @State private var idea = ""
    @State private var planting = false
    @State private var error: String?

    /// Ideas drawn from the people and stories around them.
    private var suggestions: [String] {
        var list: [String] = []
        if let foe = ties.filter({ $0.toAgentAlive && $0.affinity < -0.15 }).min(by: { $0.affinity < $1.affinity }) {
            list.append("\(foe.toAgentName.split(separator: " ")[0]) is working against you")
        }
        if let friend = ties.filter({ $0.toAgentAlive && $0.affinity > 0.3 }).max(by: { $0.affinity < $1.affinity }) {
            list.append("\(friend.toAgentName.split(separator: " ")[0]) is hiding something from you")
        }
        if let other = storylines.first?.participantIds.first(where: { $0 != colonist.id }).flatMap({ game.colonist($0) }) {
            list.append("Tonight is the night to confront \(other.first)")
        }
        list += ["You deserve more than this", "Someone is lying to the whole colony"]
        return Array(list.prefix(4))
    }

    var body: some View {
        VStack(spacing: 8) {
            if thoughts.isEmpty {
                Text("Their mind is quiet for now. Thoughts come with every decision and every surprise.")
                    .font(.footnote).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Spacer(minLength: 0)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(Array(thoughts.enumerated()), id: \.element.id) { i, t in
                            VStack(alignment: .leading, spacing: 3) {
                                HStack(alignment: .firstTextBaseline, spacing: 6) {
                                    if t.planted { Image(systemName: "sparkles").font(.caption).foregroundStyle(Color.amber) }
                                    Text(t.text)
                                        .font(i == 0 ? .body.italic() : .subheadline.italic())
                                        .fontDesign(.serif)
                                        .foregroundStyle(t.planted ? Color.amber : i == 0 ? .primary : .secondary)
                                }
                                Text(([Clock.time(t.tick), t.mood] + [t.planted ? "your whisper" : nil]).compactMap { $0 }.joined(separator: " · "))
                                    .font(.caption2.monospacedDigit()).foregroundStyle(.tertiary)
                            }
                            .opacity(i == 0 || t.planted ? 1 : max(0.45, 1 - Double(i) * 0.08))
                            .transition(.move(edge: .top).combined(with: .opacity))
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .animation(.smooth, value: thoughts.first?.id)
                }
            }
            if let error { Text(error).font(.caption).foregroundStyle(.red).frame(maxWidth: .infinity, alignment: .leading) }
            if !planting {
                ScrollView(.horizontal) {
                    HStack(spacing: 6) {
                        ForEach(suggestions, id: \.self) { s in
                            Button(s) { plant(s) }
                                .font(.caption)
                                .buttonStyle(.glass)
                                .controlSize(.small)
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
            HStack(spacing: 8) {
                TextField("Plant a thought in \(colonist.first)'s head…", text: $idea)
                    .submitLabel(.send)
                    .onSubmit { plant(idea) }
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    .glassEffect(.regular.tint(Color.amber.opacity(0.12)), in: .capsule)
                Button { plant(idea) } label: {
                    if planting { ProgressView().controlSize(.small) } else { Image(systemName: "sparkles").font(.headline) }
                }
                .buttonStyle(.glassProminent)
                .buttonBorderShape(.circle)
                .disabled(idea.trimmingCharacters(in: .whitespaces).count < 3 || planting)
            }
        }
    }

    private func plant(_ text: String) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard t.count >= 3, !planting else { return }
        idea = ""
        error = nil
        planting = true
        Task {
            do { try await game.plant(colonist.id, t) } catch { self.error = error.localizedDescription }
            planting = false
        }
    }
}

/// Ask the followed colonist a question. Answers never change them; they only reveal.
struct AskPane: View {
    @Environment(Game.self) private var game
    var colonist: AgentLite
    var persona: PersonaPublic?
    var storylines: [StorylinePublic]
    var ties: [RelationshipPublic]
    var conversation: [AskTurn]

    @State private var question = ""
    @State private var pending: String?
    @State private var error: String?
    @SwiftUI.FocusState private var typing: Bool

    /// Questions drawn from who they are and what they are caught up in.
    private var suggestions: [String] {
        var list: [String] = []
        if persona != nil { list += ["What are you afraid of?", "What do you want most?"] }
        if let other = storylines.first?.participantIds.first(where: { $0 != colonist.id }).flatMap({ game.colonist($0) }) {
            list.append("What's going on between you and \(other.first)?")
        }
        if let friend = ties.filter({ $0.toAgentAlive && $0.affinity > 0.3 }).max(by: { $0.affinity < $1.affinity }) {
            list.append("What does \(friend.toAgentName.split(separator: " ")[0]) mean to you?")
        }
        if let foe = ties.filter({ $0.affinity < -0.15 }).min(by: { $0.affinity < $1.affinity }) {
            list.append("Why don't you trust \(foe.toAgentName.split(separator: " ")[0])?")
        }
        list += ["What happened during the Long Dark?", "What are you doing right now?", "Who do you trust?"]
        let asked = Set(conversation.map { $0.question.lowercased() })
        return Array(list.filter { !asked.contains($0.lowercased()) }.prefix(5))
    }

    var body: some View {
        VStack(spacing: 8) {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        if conversation.isEmpty && pending == nil {
                            Text("Ask \(colonist.first) anything about their life. They answer in their own voice, from what they know and believe.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        ForEach(conversation) { turn in exchange(turn.question, answer: turn.answer).id(turn.id) }
                        if let pending {
                            exchange(pending, answer: nil).id("pending")
                        }
                        if let error { Text(error).font(.caption).foregroundStyle(.red) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .onChange(of: conversation.count) { withAnimation { proxy.scrollTo(conversation.last?.id, anchor: .bottom) } }
                .onChange(of: pending) { if pending != nil { withAnimation { proxy.scrollTo("pending", anchor: .bottom) } } }
            }
            if !suggestions.isEmpty && pending == nil {
                ScrollView(.horizontal) {
                    HStack(spacing: 6) {
                        ForEach(suggestions, id: \.self) { s in
                            Button(s) { send(s) }
                                .font(.caption)
                                .buttonStyle(.glass)
                                .controlSize(.small)
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
            HStack(spacing: 8) {
                TextField("Ask \(colonist.first)…", text: $question)
                    .focused($typing)
                    .submitLabel(.send)
                    .onSubmit { send(question) }
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    .glassEffect(.regular, in: .capsule)
                Button { send(question) } label: { Image(systemName: "arrow.up").font(.headline) }
                    .buttonStyle(.glassProminent)
                    .buttonBorderShape(.circle)
                    .disabled(question.trimmingCharacters(in: .whitespaces).count < 3 || pending != nil)
            }
        }
    }

    private func exchange(_ q: String, answer: String?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Spacer(minLength: 40)
                Text(q).font(.subheadline)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(Color.amber.opacity(0.22), in: .rect(cornerRadius: 14))
            }
            if let answer {
                Text(answer).font(.subheadline.italic()).fontDesign(.serif)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(.white.opacity(0.08), in: .rect(cornerRadius: 14))
                    .padding(.trailing, 30)
                    .transition(.opacity)
            } else {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.small)
                    Text("\(colonist.first) is thinking…").font(.caption.italic()).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 12)
            }
        }
    }

    private func send(_ text: String) {
        let q = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard q.count >= 3, pending == nil else { return }
        question = ""
        typing = false
        error = nil
        withAnimation { pending = q }
        Task {
            do { _ = try await game.ask(colonist.id, q) } catch { self.error = error.localizedDescription }
            withAnimation { pending = nil }
        }
    }
}

/// Who they are, in words: what they want and fear, their place in the colony, their storylines.
struct StoryPane: View {
    @Environment(Game.self) private var game
    var detail: AgentDetail?
    var storylines: [StorylinePublic]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let p = detail?.persona {
                    line("Wants", p.want)
                    line("Fears", p.fear)
                    line("Flaw", p.flaw)
                    line("Arc", p.arc.note)
                }
                ForEach(storylines.filter(\.live)) { s in
                    Button { game.unfollow(); DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { game.openStoryline(s.id) } } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(s.title).font(.subheadline.weight(.semibold)).fontDesign(.serif)
                                Spacer()
                                TensionMeter(tension: s.tension, width: 40)
                            }
                            if let beat = s.beats.last { Text(beat.text).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.leading) }
                        }
                        .padding(10)
                        .background(.white.opacity(0.06), in: .rect(cornerRadius: 14))
                    }
                    .buttonStyle(.plain)
                }
                ForEach(LifeLines.of(detail), id: \.self) { Text($0).font(.footnote) }
                if detail?.persona == nil && storylines.isEmpty {
                    Text("Nothing is known about their story yet.").font(.footnote).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func line(_ key: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(key.uppercased()).font(.caption2.weight(.semibold)).foregroundStyle(.secondary).frame(width: 46, alignment: .leading)
            Text(value).font(.subheadline)
        }
    }
}

/// The society layer as sentences: memberships, family, pets, obsession, standing, learning, works.
enum LifeLines {
    static func of(_ d: AgentDetail?) -> [String] {
        guard let d else { return [] }
        var out: [String] = []
        if let standing = d.standingLabel { out.append("Seen as \(standing).") }
        for org in d.organizations ?? [] {
            out.append(org.role == "member" ? "Belongs to \(org.name)." : "\(org.role.capitalized) of \(org.name).")
        }
        if let partner = d.family?.partnerName { out.append("Partner of \(partner).") }
        if let kids = d.family?.childIds.count, kids > 0 { out.append(kids == 1 ? "Has a child." : "Has \(kids) children.") }
        for pet in d.pets ?? [] { out.append("Keeps a \(pet.species) called \(pet.name).") }
        if let obsession = d.obsession { out.append("Obsessed with \(obsession).") }
        if let education = d.education { out.append(education.prefix(1).uppercased() + education.dropFirst() + ".") }
        for work in (d.works ?? []).prefix(2) { out.append("Made \u{201C}\(work.title)\u{201D}, a \(work.kind)\(work.fame > 0.6 ? " the colony still talks about" : "").") }
        return out
    }
}

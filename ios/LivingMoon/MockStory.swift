import Foundation

/// The authored sample story the offline mock plays: a cast of key characters, the storylines in
/// motion at Sol 1, the introduction and the tutorial. The live backend's seed owns the real story;
/// this only has to be plausible enough to build and screenshot the story screens without it.
enum MockStory {
    struct Key {
        let slug: String
        let name: String
        let spriteId: String
        let occupation: String
        let home: LocationId
        let factionId: String?
        let background: String
        let persona: PersonaPublic
        let hook: String
        /// Their answer when asked about the Long Dark.
        let longDark: String
        /// Where they spend the first hour, so the starter's script can find them.
        let post: (LocationId, String)?
    }

    static let factions: [(id: String, name: String)] = [
        ("compact", "Founders' Compact"),
        ("union", "Diggers' Union"),
        ("league", "Free Exchange League"),
    ]

    static let starter = "ines"

    static let keys: [Key] = [
        Key(slug: "ines", name: "Ines Okafor", spriteId: "miner_2", occupation: "ice_miner", home: .habitat_a, factionId: "union",
            background: "Born on the rim the year the colony was founded. Lost her mother in the Long Dark and has raised her brother Teo since.",
            persona: PersonaPublic(epithet: "the ice miner skimming water for her sick brother", want: "Keep Teo alive until a shuttle brings real medicine", fear: "Burying Teo beside their mother", flaw: "Lies first and does the arithmetic later", voice: "Clipped, dry, protective; jokes when she is scared", arc: .init(stage: "rising", note: "Her skimming is about to be noticed."), key: true),
            hook: "She has been stealing meltwater from the drill line, and the depot numbers no longer add up.",
            longDark: "I was fifteen. The heaters went, then the lights, then Mum. Everyone says the reactor. I say somebody signed off on a reactor they knew was tired.",
            post: nil),
        Key(slug: "dmitri", name: "Dmitri Vance", spriteId: "official_1", occupation: "quartermaster", home: .habitat_a, factionId: "compact",
            background: "Quartermaster for eleven years. Kept the ration ledgers through the Long Dark and has kept them since, both of them.",
            persona: PersonaPublic(epithet: "the quartermaster who keeps two ledgers", want: "Keep the reserve's numbers clean enough that nobody audits", fear: "The Long Dark ledgers surfacing", flaw: "Mistakes control for safety", voice: "Precise and courteous, with numbers where feelings should be", arc: .init(stage: "setup", note: "Someone is skimming his reserve, and he cannot report it without opening his own books."), key: true),
            hook: "He knows the water is going missing. He also knows why the Long Dark ledgers must never be read.",
            longDark: "Eleven names. I can recite the ration each of them drew that winter. I do, some nights.",
            post: (.depot, "Recounting the water reserve")),
        Key(slug: "teo", name: "Teo Okafor", spriteId: "civilian_3", occupation: "resident", home: .habitat_a, factionId: nil,
            background: "Ines's younger brother. Regolith lung since the quarry collapse two years ago; tells everyone he is fine.",
            persona: PersonaPublic(epithet: "the sick brother who insists he is fine", want: "Stop being the reason Ines takes risks", fear: "That he is already a dead weight", flaw: "Hides how bad it is", voice: "Gentle, teasing, out of breath by the end of a sentence", arc: .init(stage: "setup", note: "His cough is getting worse and he has stopped telling anyone."), key: true),
            hook: "His lungs are failing, and he would rather die quietly than watch his sister become a thief.",
            longDark: "I was nine. Ines made it a game: who can stay under the blankets longest. I didn't know it was a game about heat.",
            post: (.medbay, "Waiting for his inhaler refill")),
        Key(slug: "asha", name: "Asha Tanaka", spriteId: "medic_4", occupation: "medic", home: .habitat_b, factionId: nil,
            background: "Chief medic. Came up on the last consortium shuttle and stayed when it stopped coming back.",
            persona: PersonaPublic(epithet: "the medic rationing the last antivirals", want: "Decide fairly who gets the last twelve doses", fear: "Choosing wrong and being right about it", flaw: "Carries every decision alone", voice: "Warm, tired, painfully honest", arc: .init(stage: "rising", note: "She has started keeping a list of who would get the doses, and Teo is not on it."), key: true),
            hook: "Twelve doses, thirty patients. She has a list, and Teo Okafor is not on it.",
            longDark: "I came after it. I inherited its graves and its paperwork. Half my patients still sleep with the lights on.",
            post: (.medbay, "Counting the antiviral stock")),
        Key(slug: "noor", name: "Noor Haddad", spriteId: "merchant_0", occupation: "trader", home: .habitat_b, factionId: "league",
            background: "Runs the busiest stall on the Exchange and the quietest one behind it.",
            persona: PersonaPublic(epithet: "the trader who sells what the depot loses", want: "Own the colony's water trade before the next shuttle", fear: "Being needed by no one", flaw: "Treats every kindness as a contract", voice: "Charming and quick, always a little amused", arc: .init(stage: "setup", note: "She has noticed Ines's spare water and smells a supplier."), key: true),
            hook: "Somebody is selling depot water on the Exchange. Noor knows exactly who, because she is buying.",
            longDark: "The League kept the shuttles coming that year. The Compact kept the ledgers. Ask yourself which one of us people thank.",
            post: (.market, "Haggling over a crate of filters")),
        Key(slug: "kofi", name: "Kofi Mbeki", spriteId: "engineer_1", occupation: "fabricator", home: .habitat_b, factionId: "union",
            background: "Union organiser at the Fabrication Works. Lost two shift-mates in the Long Dark and has not forgiven the council.",
            persona: PersonaPublic(epithet: "the union organiser counting the days to a strike", want: "Force the council to open the reserve ledgers", fear: "Leading his people into a strike they lose", flaw: "Hears every compromise as a betrayal", voice: "Loud, funny, quotes old Earth labour songs", arc: .init(stage: "rising", note: "He has nearly enough votes to shut the works down."), key: true),
            hook: "One more vote and the works go dark until the council opens its books.",
            longDark: "The council had a reserve that winter. We found out after. Eleven people, and a locked door with food behind it.",
            post: nil),
        Key(slug: "marit", name: "Marit Lindqvist", spriteId: "official_4", occupation: "councilor", home: .habitat_a, factionId: "compact",
            background: "Founder's daughter and head of the council. Believes the colony survives only if someone is allowed to say no.",
            persona: PersonaPublic(epithet: "the councilor who wants the reserve sealed", want: "Seal the reserve under council control before the strike", fear: "The colony tearing itself apart the way it nearly did four years ago", flaw: "Cannot admit the council was wrong", voice: "Formal, measured, cold when cornered", arc: .init(stage: "setup", note: "She is counting votes too, and Dmitri's ledgers are her weakest flank."), key: true),
            hook: "She will seal the reserve to stop a strike, and she needs Dmitri's books to stay closed.",
            longDark: "My father made the call to lock the reserve. It saved sixty people. Nobody remembers the sixty.",
            post: nil),
    ]

    struct Line {
        let storyline: String
        let text: String
        let participants: [String]
        let tension: Double
    }

    struct Seeded {
        let slug: String
        let title: String
        let premise: String
        let participants: [String]
        let tension: Double
        let beats: [String]
        /// Beats the world adds on its own as time passes, in order.
        let later: [Line]
    }

    static let storylines: [Seeded] = [
        Seeded(slug: "water", title: "Water for Teo", premise: "Ines is stealing meltwater to keep her brother breathing. Every flask she skims is one the depot will miss.", participants: ["ines", "teo", "asha"], tension: 0.4,
               beats: ["Teo's inhaler ran dry two sols early.", "Ines filled her first flask off the drill line."],
               later: [Line(storyline: "water", text: "Asha told Teo the antivirals are spoken for.", participants: ["asha", "teo"], tension: 0.08),
                       Line(storyline: "water", text: "Teo coughed blood in the Med Bay and asked Asha not to tell his sister.", participants: ["teo", "asha"], tension: 0.12)]),
        Seeded(slug: "ledger", title: "The Second Ledger", premise: "The depot's water is going missing, and the quartermaster cannot report it without someone reading the books he kept during the Long Dark.", participants: ["dmitri", "marit", "ines"], tension: 0.38,
               beats: ["Dmitri found the water reserve forty litres short."],
               later: [Line(storyline: "ledger", text: "Dmitri moved the Long Dark ledger from the depot to his bunk.", participants: ["dmitri"], tension: 0.1),
                       Line(storyline: "ledger", text: "Marit asked Dmitri, in front of witnesses, when the reserve was last audited.", participants: ["marit", "dmitri"], tension: 0.14)]),
        Seeded(slug: "strike", title: "The Strike Vote", premise: "Kofi needs one more vote to shut the works until the council opens the reserve. Marit needs the reserve sealed before he gets it.", participants: ["kofi", "marit"], tension: 0.45,
               beats: ["Kofi called a union meeting at the Airlock Canteen.", "Marit drafted an order to seal the reserve."],
               later: [Line(storyline: "strike", text: "Kofi won over two quarry hands with a promise of open ledgers.", participants: ["kofi"], tension: 0.1),
                       Line(storyline: "strike", text: "Marit offered the union a seat on the ration board if they called off the vote.", participants: ["marit", "kofi"], tension: 0.12)]),
        Seeded(slug: "market", title: "Black Market Water", premise: "Depot water is turning up on the Exchange. Noor is buying, and she is looking for a steadier supplier.", participants: ["noor", "ines", "dmitri"], tension: 0.3,
               beats: ["Noor sold six litres of unmarked water before noon."],
               later: [Line(storyline: "market", text: "Noor raised her water price by two credits and nobody argued.", participants: ["noor"], tension: 0.08)]),
    ]

    /// The starter's first hour: walk somewhere, meet someone, think about it.
    enum Beat {
        case walk(LocationId, why: String, thought: String)
        case meet(String, speech: String, reply: String, summary: String, storyline: String, tension: Double, thought: String, hook: String?)
        case act(String, label: String, summary: String, storyline: String, tension: Double, thought: String)
    }

    static let script: [Beat] = [
        .walk(.depot, why: "to collect the family water ration", thought: "Ration day. Smile at Dmitri, sign the sheet, don't look at the numbers."),
        .meet("dmitri", speech: "Short again, Dmitri? That's twice this week.", reply: "The reserve is what the reserve is.", summary: "Ines Okafor found her water ration short and said so to Dmitri Vance's face.", storyline: "ledger", tension: 0.12,
              thought: "He wrote something in a second book when he thought I wasn't looking. Two ledgers. Interesting.", hook: "He just wrote her name in a second ledger"),
        .walk(.medbay, why: "to bring Teo his water", thought: "Teo first. Then I can think about Dmitri and his little book."),
        .meet("teo", speech: "Drink it slow. That's a whole shift's worth.", reply: "You look tired, Ines. Where's this coming from?", summary: "Ines Okafor brought her brother Teo a flask of water at the Med Bay.", storyline: "water", tension: 0.08,
              thought: "He asked where the water comes from. He knows. He always knows, and he asks anyway.", hook: nil),
        .meet("asha", speech: "Is there anything for him? Anything at all?", reply: "Twelve doses, Ines. I can't make it thirteen.", summary: "Asha Tanaka told Ines Okafor there is no medicine to spare for Teo.", storyline: "water", tension: 0.12,
              thought: "Twelve doses, and Asha wouldn't meet my eyes. Teo isn't on her list.", hook: "She keeps a list of who gets the last doses"),
        .walk(.market, why: "to see what Noor charges for water", thought: "If the depot won't give it and Asha can't, someone on the Exchange will sell it."),
        .meet("noor", speech: "How much for a litre, no questions?", reply: "For you? Nothing. Bring me ten a week and keep a little for your brother.", summary: "Noor Haddad offered Ines Okafor a deal: steady water for the Exchange, a cut for Teo.", storyline: "market", tension: 0.15,
              thought: "Noor wants me as a supplier. Ten litres a week is a lot of flasks to skim before someone counts.", hook: "She just offered Ines a deal for stolen water"),
        .walk(.ice_wells, why: "for her shift, with an empty flask in her pocket", thought: "Shift time. The drill line runs past the gauge Dmitri never checks."),
        .act("stealing", label: "Skimming meltwater off the drill line", summary: "Ines Okafor skimmed a flask of meltwater off the drill line at the Ice Wells.", storyline: "water", tension: 0.1,
             thought: "Two litres. My hands are steady. Mum would hate this. Mum would do it too."),
    ]

    static let intro = (
        title: "Shackleton Colony",
        setting: [
            "A ring of pressurised domes on the rim of Shackleton crater, at the Moon's south pole. Below, in a crater floor the sun has never touched, the ice wells drill for the only water within 380,000 kilometres.",
            "A hundred people live here. Nobody is coming to save them.",
        ],
        history: [
            HistoryEntry(era: "19 years ago", text: "The Artemis-Meridian consortium founds the colony as a water-export outpost."),
            HistoryEntry(era: "7 years ago", text: "The consortium goes bankrupt on Earth. Shuttles turn irregular and the colony governs itself: the Founders' Compact keeps the council and the ledgers, the miners form the Diggers' Union, the traders the Free Exchange League."),
            HistoryEntry(era: "4 years ago", text: "The Long Dark. A reactor fault and a lost shuttle in the same winter. Eleven people die. Everyone blames someone."),
            HistoryEntry(era: "Sol 1", text: "Water is short, the antivirals are nearly gone, the union is counting votes for a strike, and someone is skimming the depot."),
        ],
        tensions: [
            "The depot's water is disappearing, and the quartermaster has reasons not to look too hard.",
            "Twelve doses of antiviral are left for thirty patients.",
            "The Diggers' Union is one vote from shutting down the works.",
            "Depot water is turning up for sale on the Exchange.",
        ]
    )

    static func tutorial(_ ids: [String: Id]) -> [TutorialStep] {
        [
            TutorialStep(id: "follow", title: "Meet Ines", body: "Ines Okafor is skimming water to keep her brother alive. Follow her to see her day unfold.", advanceOn: "follow_starter", agentId: ids["ines"]),
            TutorialStep(id: "mind", title: "Read her mind", body: "Open Mind to hear what Ines is thinking. Her thoughts come from her needs, her fears and what just happened.", advanceOn: "read_thoughts"),
            TutorialStep(id: "ask", title: "Ask her something", body: "Open Ask and put a question to her: about her brother, the Long Dark, anyone she mentions. Asking never changes her.", advanceOn: "ask_question"),
            TutorialStep(id: "meet", title: "Watch who she meets", body: "Every meeting can push a storyline forward. When someone matters, a hook appears at the top of the screen.", advanceOn: "tap"),
            TutorialStep(id: "switch", title: "Follow the thread", body: "Tap a hook, or tap anyone on the map, to switch to them. Try Dmitri, the quartermaster with two ledgers.", advanceOn: "switch_character", agentId: ids["dmitri"]),
            TutorialStep(id: "stories", title: "Read the storylines", body: "Story lists every storyline this person is part of, with its tension and latest beats. The Stories tab has them all.", advanceOn: "open_storylines"),
            TutorialStep(id: "power", title: "Tip the world", body: "Open Powers and whisper doubt into someone, or drop supplies on them. Then watch what they do with it.", advanceOn: "use_power"),
            TutorialStep(id: "chronicle", title: "Trace the consequences", body: "Back in the colony, the Chronicle shows every event and what caused it. Open it to see your mark on the story.", advanceOn: "open_chronicle"),
        ]
    }

    // MARK: Personas for everyone else

    private static let wants = ["Save enough for a private bunk", "Get on the next shuttle home", "Earn a seat on the ration board", "Prove the Long Dark wasn't their crew's fault", "Win back a friend they wronged", "Open their own stall on the Exchange", "Find out who their father really was", "Keep the household fed without asking anyone for help", "Be the best at their trade on the rim", "Get the union to notice them"]
    private static let fears = ["Another winter like the Long Dark", "Being found out", "Dying somewhere nobody will find them", "Owing anyone anything", "Being ordinary", "The surface", "Losing their household", "That Earth has forgotten them"]
    private static let flaws = ["Proud", "Gossips", "Holds grudges", "Too trusting", "Gambles", "Never says no", "Hoards", "Quick-tempered", "Lies to keep the peace"]
    private static let tags = ["who still writes letters to Earth", "who never misses a canteen card game", "who owes half the Exchange", "with a grudge against the council", "who swears the Long Dark was sabotage", "who grows tomatoes in a locker", "saving for a ticket home", "who knows everyone's business", "who survived the quarry collapse", "who sings on night shift"]
    private static let voices = ["Blunt", "Soft-spoken", "Sarcastic", "Earnest", "Wry", "Formal"]

    static func persona(occupation label: String, pick: (Int) -> Int) -> PersonaPublic {
        PersonaPublic(epithet: "a \(label.lowercased()) \(tags[pick(tags.count)])", want: wants[pick(wants.count)], fear: fears[pick(fears.count)], flaw: flaws[pick(flaws.count)], voice: voices[pick(voices.count)], arc: .init(stage: "setup", note: "Getting by, for now."), key: false)
    }

    /// Inner monologue for an ordinary decision, varied by what they are doing and what they carry.
    static func thought(activity: String, label: String, persona: PersonaPublic, needs: Needs, partner: String?, pick: (Int) -> Int) -> String {
        let want = persona.want.prefix(1).lowercased() + persona.want.dropFirst()
        let fear = persona.fear.prefix(1).lowercased() + persona.fear.dropFirst()
        var options: [String]
        switch activity {
        case "walking": options = ["\(label). One foot, then the other. Keep moving and nobody asks questions.", "The tubes always smell of hot dust. \(label), and thinking about how to \(want).", "Walking gives me time to think. Mostly about \(fear)."]
        case "sleeping": options = ["Lights down. If I dream, let it not be about \(fear).", "Sleep. Tomorrow I'll figure out how to \(want)."]
        case "eating": options = ["Algae paste again. I'd trade a shift for a real egg.", "Eat now, worry later. That's the rim rule."]
        case "talking": options = partner.map { ["\($0) is talking, but what are they not saying?", "I like \($0). I think. Hard to tell who's honest up here.", "If \($0) knew what I want, would they help or laugh?"] } ?? ["Talk is cheap. Water isn't."]
        case "stealing": options = ["Quick. Quiet. Nobody counts this shelf until Thursday.", "If I'm caught, I'll say it was for the household. It's almost true."]
        case "working": options = ["\(label). Same as yesterday. Work buys rations, rations buy time.", "The shift drags. I keep thinking about how to \(want).", "Good work today. Nobody will notice. Fine."]
        default: options = ["\(label). Waiting is the hardest job on the Moon.", "Quiet moment. Too quiet, and I start thinking about \(fear)."]
        }
        if needs.thirst > 70 { options.append("My mouth tastes like regolith. I need water before I need anything else.") }
        if needs.hunger > 70 { options.append("Stomach's been growling since the last shift. Food first, plans later.") }
        return options[pick(options.count)]
    }
}

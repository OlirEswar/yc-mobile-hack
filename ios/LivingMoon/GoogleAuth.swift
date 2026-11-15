import AuthenticationServices
import CryptoKit
import Foundation
import SwiftUI

/// Gmail sign-in with OAuth 2.0 + PKCE for an iOS-type Google client (no client secret), and the
/// on-device digest of recent mail. The access token lives only in memory for one import: it is never
/// stored and never sent to the backend. Only the digest leaves the device, after the player has read it.
enum GoogleAuth {
    /// The iOS OAuth client id from Google Cloud Console, e.g. "1234-abcd.apps.googleusercontent.com".
    /// Empty disables the Gmail import.
    static let clientID = ""
    static let scope = "https://www.googleapis.com/auth/gmail.readonly"

    static var isConfigured: Bool { !clientID.isEmpty }
    /// The reversed client id, which Google uses as the redirect scheme for iOS clients.
    static var redirectScheme: String { "com.googleusercontent.apps." + clientID.replacingOccurrences(of: ".apps.googleusercontent.com", with: "") }
    static var redirectURI: String { redirectScheme + ":/oauth2redirect" }

    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    /// Opens Google's consent page and returns an access token.
    @MainActor
    static func signIn(with session: WebAuthenticationSession) async throws -> String {
        let verifier = randomURLSafe(bytes: 32)
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
        let state = randomURLSafe(bytes: 16)
        var auth = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        auth.queryItems = [
            .init(name: "client_id", value: clientID),
            .init(name: "redirect_uri", value: redirectURI),
            .init(name: "response_type", value: "code"),
            .init(name: "scope", value: scope),
            .init(name: "code_challenge", value: challenge),
            .init(name: "code_challenge_method", value: "S256"),
            .init(name: "state", value: state),
        ]
        let callback = try await session.authenticate(using: auth.url!, callbackURLScheme: redirectScheme, preferredBrowserSession: .ephemeral)
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if let error = items.first(where: { $0.name == "error" })?.value { throw Failure(message: "Google said: \(error)") }
        guard items.first(where: { $0.name == "state" })?.value == state, let code = items.first(where: { $0.name == "code" })?.value else {
            throw Failure(message: "Google did not return a sign-in code.")
        }

        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var form = URLComponents()
        form.queryItems = [
            .init(name: "code", value: code),
            .init(name: "client_id", value: clientID),
            .init(name: "code_verifier", value: verifier),
            .init(name: "grant_type", value: "authorization_code"),
            .init(name: "redirect_uri", value: redirectURI),
        ]
        request.httpBody = Data((form.percentEncodedQuery ?? "").utf8)
        struct Token: Decodable { let access_token: String }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200, let token = try? JSONDecoder().decode(Token.self, from: data) else {
            throw Failure(message: "Google refused the sign-in code.")
        }
        return token.access_token
    }

    // MARK: Gmail

    private struct MessageList: Decodable {
        struct Ref: Decodable { let id: String }
        let messages: [Ref]?
    }

    private struct Message: Decodable, Sendable {
        struct Header: Decodable, Sendable { let name: String; let value: String }
        struct Payload: Decodable, Sendable { let headers: [Header]? }
        let labelIds: [String]?
        let payload: Payload?
        func header(_ name: String) -> String? { payload?.headers?.first { $0.name.caseInsensitiveCompare(name) == .orderedSame }?.value }
        func has(_ label: String) -> Bool { labelIds?.contains(label) == true }
    }

    private static func get<T: Decodable>(_ url: String, token: String) async throws -> T {
        var request = URLRequest(url: URL(string: url)!)
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else { throw Failure(message: "Gmail answered \(status).") }
        return try JSONDecoder().decode(T.self, from: data)
    }

    /// Reads the headers and labels of up to 80 messages from the last 180 days, never bodies, and
    /// returns a plain-text digest: sent vs received, category counts, sender domains and subject lines.
    static func digest(token: String) async throws -> (text: String, messages: Int) {
        let base = "https://gmail.googleapis.com/gmail/v1/users/me/messages"
        let list: MessageList = try await get(base + "?maxResults=80&q=newer_than:180d", token: token)
        let ids = (list.messages ?? []).map(\.id)
        guard !ids.isEmpty else { throw Failure(message: "No mail from the last 180 days.") }

        var messages: [Message] = []
        await withTaskGroup(of: Message?.self) { group in
            var next = 0
            for _ in 0..<6 where next < ids.count {
                let id = ids[next]
                next += 1
                group.addTask { try? await get(base + "/\(id)?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject", token: token) }
            }
            while let m = await group.next() {
                if let m { messages.append(m) }
                if next < ids.count {
                    let id = ids[next]
                    next += 1
                    group.addTask { try? await get(base + "/\(id)?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject", token: token) }
                }
            }
        }
        guard !messages.isEmpty else { throw Failure(message: "Gmail did not return any messages.") }
        return (summarize(messages), messages.count)
    }

    private static func summarize(_ messages: [Message]) -> String {
        let sent = messages.filter { $0.has("SENT") }.count
        let categories = [("CATEGORY_PROMOTIONS", "Promotions"), ("CATEGORY_SOCIAL", "Social"), ("CATEGORY_UPDATES", "Updates"), ("CATEGORY_FORUMS", "Forums")]
            .map { key, label in "\(label) \(messages.filter { $0.has(key) }.count)" }

        var domains: [String: Int] = [:]
        for m in messages where !m.has("SENT") {
            guard let from = m.header("From"), let at = from.lastIndex(of: "@") else { continue }
            let domain = from[from.index(after: at)...].prefix { $0.isLetter || $0.isNumber || $0 == "." || $0 == "-" }.lowercased()
            if !domain.isEmpty { domains[domain, default: 0] += 1 }
        }
        let topDomains = domains.sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }.prefix(12).map { "\($0.key) (\($0.value))" }

        // Subjects the player wrote first, then personal mail, then updates, promotions last.
        func rank(_ m: Message) -> Int {
            if m.has("SENT") { return 0 }
            if m.has("CATEGORY_PROMOTIONS") { return 3 }
            if m.has("CATEGORY_UPDATES") { return 2 }
            return 1
        }
        var seen: Set<String> = []
        var subjects: [String] = []
        for m in messages.sorted(by: { rank($0) < rank($1) }) {
            guard let raw = m.header("Subject") else { continue }
            let stripped = raw.replacingOccurrences(of: #"^\s*((re|fwd?|aw|wg)\s*:\s*)+"#, with: "", options: [.regularExpression, .caseInsensitive])
            let subject = Scrub.text(stripped)
            guard subject.count >= 8, seen.insert(subject.lowercased()).inserted else { continue }
            subjects.append(String(subject.prefix(120)))
            if subjects.count == 40 { break }
        }

        var lines = [
            "Gmail digest of the last 180 days (\(messages.count) messages, headers only).",
            "Sent by me: \(sent). Received: \(messages.count - sent).",
            "Categories: " + categories.joined(separator: ", ") + ".",
            "Top sender domains: " + (topDomains.isEmpty ? "none" : topDomains.joined(separator: ", ")) + ".",
            "Subject lines:",
        ]
        lines += subjects.map { "- " + $0 }
        return String(lines.joined(separator: "\n").prefix(8000))
    }

    private static func randomURLSafe(bytes: Int) -> String {
        var raw = [UInt8](repeating: 0, count: bytes)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes, &raw)
        return Data(raw).base64URL
    }
}

private extension Data {
    var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

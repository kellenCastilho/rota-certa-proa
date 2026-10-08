import UIKit
import Capacitor
import CoreLocation
import AVFoundation
import StoreKit

class DaRotaBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(DaRotaNavigationPlugin())
        bridge?.registerPluginInstance(DaRotaPurchasesPlugin())
    }
}

class DaRotaScreenViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let app = DaRotaBridgeViewController()
        addChild(app)
        app.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(app.view)
        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            app.view.topAnchor.constraint(equalTo: safe.topAnchor),
            app.view.bottomAnchor.constraint(equalTo: safe.bottomAnchor),
            app.view.leadingAnchor.constraint(equalTo: safe.leadingAnchor),
            app.view.trailingAnchor.constraint(equalTo: safe.trailingAnchor)
        ])
        app.didMove(toParent: self)
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = DaRotaScreenViewController()
        window?.makeKeyAndVisible()
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }
    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

@objc(DaRotaNavigationPlugin)
public class DaRotaNavigationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DaRotaNavigationPlugin"
    public let jsName = "DaRotaNavigation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "repeat", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "geocode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reverseGeocode", returnType: CAPPluginReturnPromise)
    ]
    private lazy var navigator = DaRotaNavigator { [weak self] state in
        self?.notifyListeners("navigationState", data: state)
    }
    private lazy var addresses = DaRotaAddressLookup()
    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let d = call.getObject("destination"),
                  let lat = (d["lat"] as? NSNumber)?.doubleValue,
                  let lng = (d["lng"] as? NSNumber)?.doubleValue,
                  lat.isFinite, lng.isFinite, abs(lat) <= 90, abs(lng) <= 180 else {
                call.reject("Destino inválido. Edite o endereço antes de navegar."); return
            }
            self.navigator.start(CLLocationCoordinate2D(latitude: lat, longitude: lng), id: call.getString("destinationId") ?? "", call: call)
        }
    }
    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.navigator.stop(); call.resolve() }
    }
    @objc func `repeat`(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.navigator.repeatInstruction(); call.resolve() }
    }
    @objc func getState(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(self.navigator.snapshot()) }
    }
    @objc func geocode(_ call: CAPPluginCall) {
        let query = call.getString("query") ?? ""
        guard !query.isEmpty, query.count <= 500 else { call.reject("Endereço inválido."); return }
        DispatchQueue.main.async { self.addresses.search(query: query, location: nil, call: call) }
    }
    @objc func reverseGeocode(_ call: CAPPluginCall) {
        guard let lat = call.getDouble("lat"), let lng = call.getDouble("lng"),
              lat.isFinite, lng.isFinite, abs(lat) <= 90, abs(lng) <= 180 else {
            call.reject("Localização inválida."); return
        }
        DispatchQueue.main.async { self.addresses.search(query: nil, location: CLLocation(latitude: lat, longitude: lng), call: call) }
    }
}

// CLGeocoder requests are serialized and throttled; no API key is embedded in the app.
private final class DaRotaAddressLookup {
    private struct Job { let query: String?; let location: CLLocation?; let call: CAPPluginCall }
    private var jobs: [Job] = []
    private let geocoder = CLGeocoder()
    private var busy = false
    private var sequence = 0
    func search(query: String?, location: CLLocation?, call: CAPPluginCall) {
        jobs.append(Job(query: query, location: location, call: call)); next()
    }
    private func next() {
        guard !busy, !jobs.isEmpty else { return }
        busy = true; sequence += 1
        let token = sequence, job = jobs.removeFirst()
        let complete: CLGeocodeCompletionHandler = { [weak self] places, error in
            DispatchQueue.main.async {
                guard let self = self, self.busy, self.sequence == token else { return }
                self.sequence += 1
                if let error = error { job.call.reject("Não foi possível consultar o endereço no iPhone: \(error.localizedDescription)") }
                else {
                    let results: [[String: Any]] = (places ?? []).compactMap { p in
                        guard let c = p.location?.coordinate else { return nil }
                        return ["lat": c.latitude, "lng": c.longitude, "houseNumber": p.subThoroughfare ?? "",
                                "road": p.thoroughfare ?? "", "postalCode": p.postalCode ?? "", "city": p.locality ?? p.subAdministrativeArea ?? "",
                                "uf": p.administrativeArea ?? "", "countryCode": (p.isoCountryCode ?? "").lowercased(),
                                "source": "ios-geocoder"]
                    }
                    job.call.resolve(["results": results])
                }
                // Rate limits vary; do not run overlapping native lookups.
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { self.busy = false; self.next() }
            }
        }
        if let location = job.location { geocoder.reverseGeocodeLocation(location, preferredLocale: Locale(identifier: "pt_BR"), completionHandler: complete) }
        else { geocoder.geocodeAddressString(job.query ?? "", in: nil, preferredLocale: Locale(identifier: "pt_BR"), completionHandler: complete) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in
            guard let self = self, self.busy, self.sequence == token else { return }
            self.sequence += 1; self.geocoder.cancelGeocode()
            job.call.reject("A busca do endereço demorou. Confira sua conexão e tente novamente.")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { self.busy = false; self.next() }
        }
    }
}

// Pure geometry. Progress is monotonic and cannot jump to another lap at a crossing.
struct DaRotaRouteProgress {
    let points: [[Double]]
    let cumulative: [Double]
    var progress = 0.0
    var acquired = false
    init(_ points: [[Double]]) {
        self.points = points
        var sums = [Double](repeating: 0, count: points.count)
        if points.count > 1 {
            for i in 1..<points.count { sums[i] = sums[i - 1] + Self.distance(points[i - 1], points[i]) }
        }
        cumulative = sums
    }
    static func distance(_ a: [Double], _ b: [Double]) -> Double {
        let x = (b[1] - a[1]) * .pi / 180 * cos((a[0] + b[0]) / 2 * .pi / 180)
        let y = (b[0] - a[0]) * .pi / 180
        return hypot(x, y) * 6371000
    }
    mutating func locate(_ p: [Double]) -> Double {
        var best = Double.infinity, along = progress
        guard points.count > 1 else { return best }
        for i in 1..<points.count {
            if acquired && (cumulative[i] < progress - 25 || cumulative[i - 1] > progress + 300) { continue }
            let scale = cos(p[0] * .pi / 180)
            let ax = (points[i - 1][1] - p[1]) * scale, ay = points[i - 1][0] - p[0]
            let dx = (points[i][1] - points[i - 1][1]) * scale, dy = points[i][0] - points[i - 1][0]
            let denominator = dx * dx + dy * dy
            let t = denominator == 0 ? 0 : max(0, min(1, -(ax * dx + ay * dy) / denominator))
            let offset = hypot(ax + t * dx, ay + t * dy) * 111195
            let candidate = cumulative[i - 1] + t * (cumulative[i] - cumulative[i - 1])
            if offset < best - 0.1 || (abs(offset - best) < 0.1 && candidate < along) { best = offset; along = candidate }
        }
        if best <= 60 { progress = max(progress, along); acquired = true }
        return best
    }
    static func stage(_ meters: Double) -> Int { meters <= 30 ? 3 : meters <= 100 ? 2 : meters <= 250 ? 1 : 0 }
}

private struct DaRotaTurn {
    let along: Double
    let type: String
    let modifier: String
    let street: String
    let key: String
    var words: String {
        let road = street.isEmpty ? "a próxima via" : street
        if type == "arrive" { return "Continue até a entrega" }
        if modifier.contains("uturn") { return "Faça o retorno" }
        if type.contains("roundabout") || type == "rotary" { return "Entre na rotatória e siga para \(road)" }
        if modifier.contains("left") { return "Vire à esquerda na \(road)" }
        if modifier.contains("right") { return "Vire à direita na \(road)" }
        return "Siga em frente pela \(road)"
    }
}

// Navigation state is serialized on the main queue.
private final class DaRotaNavigator: NSObject, CLLocationManagerDelegate, AVSpeechSynthesizerDelegate, @unchecked Sendable {
    private let manager = CLLocationManager()
    private let speaker = AVSpeechSynthesizer()
    private let publishState: ([String: Any]) -> Void
    private var active = false, arrived = false, fetching = false
    private var generation = 0, offRouteCount = 0, stepIndex = 0
    private var destination: CLLocationCoordinate2D?
    private var destinationId = ""
    private var position: CLLocation?
    private var route: DaRotaRouteProgress?
    private var turns: [DaRotaTurn] = []
    private var line: [[Double]] = []
    private var totalDuration = 0.0, turnMeters = 0.0
    private var instruction = "Aguardando GPS", message = ""
    private var lastFetch = -Double.infinity, lastSpeech = -Double.infinity
    private var lastStages: [String: Int] = [:]
    private var spoken: Set<String> = []
    private var request: URLSessionDataTask?
    private var pendingStart: CAPPluginCall?
    init(publish: @escaping ([String: Any]) -> Void) {
        publishState = publish
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        manager.distanceFilter = 2
        manager.activityType = .automotiveNavigation
        manager.pausesLocationUpdatesAutomatically = false
        speaker.delegate = self
    }
    func start(_ destination: CLLocationCoordinate2D, id: String, call: CAPPluginCall) {
        guard UIApplication.shared.applicationState == .active else { call.reject("Abra o DaRota para iniciar a navegação."); return }
        guard CLLocationManager.locationServicesEnabled() else { call.reject("Ative a localização nos Ajustes do iPhone."); return }
        let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
        guard modes.contains("location") else { call.reject("A navegação em segundo plano ainda não está configurada."); return }
        stop()
        self.destination = destination; destinationId = id; pendingStart = call
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse: begin()
        default: pendingStart = nil; call.reject("Permita Localização ao usar o DaRota nos Ajustes do iPhone.")
        }
    }
    private func begin() {
        guard let call = pendingStart else { return }
        pendingStart = nil
        guard manager.accuracyAuthorization == .fullAccuracy else {
            call.reject("Ative Localização Precisa para o DaRota nos Ajustes do iPhone."); return
        }
        generation += 1; active = true; message = "Buscando localização precisa..."
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        manager.startUpdatingLocation()
        publish(); call.resolve()
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: begin()
        case .denied, .restricted:
            pendingStart?.reject("Permissão de localização negada. Confira os Ajustes do iPhone.")
            pendingStart = nil; stop()
        default: break
        }
    }
    func stop() {
        pendingStart?.reject("Navegação encerrada."); pendingStart = nil
        active = false; generation += 1
        request?.cancel(); request = nil; fetching = false
        manager.stopUpdatingLocation(); manager.allowsBackgroundLocationUpdates = false
        speaker.stopSpeaking(at: .immediate)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        route = nil; turns = []; line = []; position = nil; destination = nil
        destinationId = ""; arrived = false; stepIndex = 0; offRouteCount = 0
        lastFetch = -Double.infinity; lastSpeech = -Double.infinity
        lastStages = [:]; spoken = []; turnMeters = 0; totalDuration = 0
        instruction = "Aguardando GPS"; message = ""; publish()
    }
    func snapshot() -> [String: Any] {
        let remaining = max(0, (route?.cumulative.last ?? 0) - (route?.progress ?? 0))
        let total = route?.cumulative.last ?? 0
        var state: [String: Any] = ["active": active, "arrived": arrived, "destinationId": destinationId,
            "instruction": instruction, "message": message, "turnMeters": turnMeters,
            "distanceKm": remaining / 1000, "durationMinutes": total > 0 ? totalDuration * remaining / total : 0,
            "line": line, "icon": arrived ? "🏁" : (turns.indices.contains(stepIndex) && turns[stepIndex].modifier.contains("left") ? "⬅️" : turns.indices.contains(stepIndex) && turns[stepIndex].modifier.contains("right") ? "➡️" : "⬆️")]
        if let c = position?.coordinate { state["position"] = ["lat": c.latitude, "lng": c.longitude] }
        return state
    }
    private func publish() { publishState(snapshot()) }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard active, let fix = locations.last else { return }
        guard fix.horizontalAccuracy >= 0, fix.horizontalAccuracy <= 40, abs(fix.timestamp.timeIntervalSinceNow) <= 15 else {
            message = "Sinal de GPS fraco • aguardando posição precisa"; publish(); return
        }
        guard manager.accuracyAuthorization == .fullAccuracy else {
            stop(); return
        }
        position = fix
        guard route != nil else { fetchRoute(); publish(); return }
        progressRoute()
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard active else { return }
        message = "Não foi possível acompanhar o GPS. Confira a localização nos Ajustes."
        publish()
    }
    private func progressRoute() {
        guard let position = position, var currentRoute = route, let destination = destination, !turns.isEmpty else { return }
        let p = [position.coordinate.latitude, position.coordinate.longitude]
        let offset = currentRoute.locate(p); route = currentRoute
        offRouteCount = offset > 60 ? offRouteCount + 1 : 0
        if offRouteCount >= 3 { message = "Fora da rota • recalculando..."; fetchRoute(); publish(); return }
        while stepIndex < turns.count - 1 && currentRoute.progress > turns[stepIndex].along + 15 { stepIndex += 1 }
        let remaining = (currentRoute.cumulative.last ?? 0) - currentRoute.progress
        let toDestination = DaRotaRouteProgress.distance(p, [destination.latitude, destination.longitude])
        arrived = arrived || (position.horizontalAccuracy <= 25 && (toDestination <= 40 || (remaining <= 35 && toDestination <= 80)))
        turnMeters = max(0, turns[stepIndex].along - currentRoute.progress)
        instruction = arrived ? "Você chegou à entrega" : turns[stepIndex].words
        message = "GPS ativo • navegação em andamento"
        announce(); publish()
    }
    private func fetchRoute() {
        let now = ProcessInfo.processInfo.systemUptime
        guard active, !fetching, now - lastFetch >= 20, let from = position?.coordinate, let to = destination else { return }
        fetching = true; lastFetch = now
        let token = generation
        let query = "\(from.longitude),\(from.latitude);\(to.longitude),\(to.latitude)?overview=full&geometries=geojson&steps=true&alternatives=false"
        fetchHost(0, query: query, token: token)
    }
    private func fetchHost(_ hostIndex: Int, query: String, token: Int) {
        guard active, token == generation else { return }
        let hosts = ["https://router.project-osrm.org/route/v1/driving/", "https://routing.openstreetmap.de/routed-car/route/v1/driving/"]
        guard hostIndex < hosts.count, let url = URL(string: hosts[hostIndex] + query) else { routeFailed(token); return }
        var urlRequest = URLRequest(url: url, timeoutInterval: 20)
        urlRequest.setValue("DaRota/1.1 (iOS navigation; contact: darotapro@gmail.com)", forHTTPHeaderField: "User-Agent")
        urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")
        request = URLSession.shared.dataTask(with: urlRequest) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self = self, self.active, self.generation == token else { return }
                guard error == nil, let http = response as? HTTPURLResponse, http.statusCode == 200,
                      let data = data, data.count <= 4_000_000,
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      json["code"] as? String == "Ok",
                      let routes = json["routes"] as? [[String: Any]], let result = routes.first,
                      self.installRoute(result) else {
                    self.fetchHost(hostIndex + 1, query: query, token: token); return
                }
                self.fetching = false; self.request = nil; self.offRouteCount = 0
                self.progressRoute()
            }
        }
        request?.resume()
    }
    private func installRoute(_ result: [String: Any]) -> Bool {
        guard let geometry = result["geometry"] as? [String: Any], let coordinates = geometry["coordinates"] as? [[Double]], coordinates.count >= 2,
              coordinates.allSatisfy({ $0.count >= 2 && $0[0].isFinite && $0[1].isFinite && abs($0[0]) <= 180 && abs($0[1]) <= 90 }),
              let legs = result["legs"] as? [[String: Any]], let steps = legs.first?["steps"] as? [[String: Any]] else { return false }
        let points = coordinates.map { [$0[1], $0[0]] }
        var along = 0.0, newTurns: [DaRotaTurn] = []
        for step in steps {
            guard let m = step["maneuver"] as? [String: Any], let type = m["type"] as? String,
                  let c = m["location"] as? [Double], c.count >= 2,
                  c[0].isFinite, c[1].isFinite else { return false }
            let modifier = m["modifier"] as? String ?? "", street = step["name"] as? String ?? ""
            let turn = DaRotaTurn(along: along, type: type, modifier: modifier, street: street,
                key: "\(type):\(modifier):\(street):\((c[0] * 100000).rounded()):\((c[1] * 100000).rounded())")
            let distance = (step["distance"] as? NSNumber)?.doubleValue ?? 0
            guard distance.isFinite, distance >= 0 else { return false }
            along += distance
            if type != "depart" { newTurns.append(turn) }
        }
        guard !newTurns.isEmpty else { return false }
        route = DaRotaRouteProgress(points); line = points; turns = newTurns; stepIndex = 0
        totalDuration = max(0, ((result["duration"] as? NSNumber)?.doubleValue ?? 0) / 60)
        return true
    }
    private func routeFailed(_ token: Int) {
        guard active, generation == token else { return }
        fetching = false; request = nil
        instruction = "GPS localizado • rota indisponível"; message = "Não foi possível calcular a rota. Tentando novamente..."; publish()
        DispatchQueue.main.asyncAfter(deadline: .now() + 21) { [weak self] in
            guard let self = self, self.active, self.generation == token else { return }
            self.fetchRoute()
        }
    }
    private func announce() {
        guard active, route != nil, offRouteCount == 0, turns.indices.contains(stepIndex), !speaker.isSpeaking,
              ProcessInfo.processInfo.systemUptime - lastSpeech >= 4 else { return }
        let stage = DaRotaRouteProgress.stage(turnMeters), turn = turns[stepIndex]
        let turnKey = destinationId + ":" + turn.key
        let key = arrived ? destinationId + ":arrived" : turnKey + ":\(stage)"
        guard !spoken.contains(key), arrived || stage > (lastStages[turnKey] ?? -1) else { return }
        let distance = turnMeters <= 30 ? ", agora." : turnMeters >= 1000 ? ". Em \(String(format: "%.1f", locale: Locale(identifier: "pt_BR"), turnMeters / 1000)) quilômetros." : ". Em \(max(10, Int((turnMeters / 10).rounded()) * 10)) metros."
        if speak(instruction + (arrived ? "" : distance)) {
            spoken.insert(key); lastStages[turnKey] = stage
            lastSpeech = ProcessInfo.processInfo.systemUptime
        }
    }
    @discardableResult private func speak(_ text: String) -> Bool {
        guard let voice = AVSpeechSynthesisVoice(language: "pt-BR") else { return false }
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playback, mode: .voicePrompt, options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
            try audio.setActive(true)
            let speech = AVSpeechUtterance(string: text)
            speech.voice = voice; speech.rate = AVSpeechUtteranceDefaultSpeechRate * 0.95; speech.volume = 1
            speaker.speak(speech); return true
        } catch { message = "GPS ativo • não foi possível iniciar a voz"; return false }
    }
    func repeatInstruction() { if active && !speaker.isSpeaking { _ = speak(instruction) } }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        DispatchQueue.main.async {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }
}


// Included below in SceneDelegate.swift, which is already compiled by the target.
@objc(DaRotaPurchasesPlugin)
public class DaRotaPurchasesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DaRotaPurchasesPlugin"
    public let jsName = "DaRotaPurchases"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "product", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "transactions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finish", returnType: CAPPluginReturnPromise)
    ]
    private let productId = "com.kellencastilho.darota.premium.mensal"
    private var updates: Task<Void, Never>?
    public override func load() {
        updates = Task { [weak self] in
            for await result in StoreKit.Transaction.updates {
                guard let self = self else { return }
                if case .verified(let t) = result, t.productID == self.productId {
                    self.notifyListeners("transactionUpdated", data: ["transactionId": String(t.id)])
                }
            }
        }
    }
    deinit { updates?.cancel() }
    @objc func product(_ call: CAPPluginCall) {
        Task { @MainActor in
            do {
                guard let p = try await Product.products(for: [productId]).first else {
                    call.reject("Plano indisponível na App Store. Tente novamente mais tarde."); return
                }
                call.resolve(["id": p.id, "price": p.displayPrice])
            } catch { call.reject("Não foi possível carregar o preço da App Store.") }
        }
    }
    @objc func purchase(_ call: CAPPluginCall) {
        guard let tokenText = call.getString("accountToken"), let token = UUID(uuidString: tokenText) else {
            call.reject("Entre na sua conta antes de assinar."); return
        }
        Task { @MainActor in
            do {
                guard let p = try await Product.products(for: [productId]).first else {
                    call.reject("Plano indisponível."); return
                }
                switch try await p.purchase(options: [.appAccountToken(token)]) {
                case .success(let result):
                    guard case .verified(let transaction) = result else { call.reject("Compra não verificada pela Apple."); return }
                    call.resolve(["status": "purchased", "signedTransaction": result.jwsRepresentation, "transactionId": String(transaction.id)])
                case .pending: call.resolve(["status": "pending"])
                case .userCancelled: call.resolve(["status": "cancelled"])
                @unknown default: call.reject("Compra não concluída.")
                }
            } catch { call.reject("Não foi possível concluir a compra. Tente novamente.") }
        }
    }
    private func collect() async -> [[String: String]] {
        var values: [[String: String]] = []
        var seen = Set<UInt64>()
        for await result in StoreKit.Transaction.currentEntitlements {
            if case .verified(let t) = result, t.productID == productId {
                seen.insert(t.id); values.append(["transactionId": String(t.id), "signedTransaction": result.jwsRepresentation])
            }
        }
        // Retain unacknowledged purchases after a failed server request or app exit.
        for await result in StoreKit.Transaction.unfinished {
            if case .verified(let t) = result, t.productID == productId, !seen.contains(t.id) {
                values.append(["transactionId": String(t.id), "signedTransaction": result.jwsRepresentation])
            }
        }
        return values
    }
    @objc func transactions(_ call: CAPPluginCall) {
        Task { @MainActor in call.resolve(["transactions": await collect()]) }
    }
    @objc func restore(_ call: CAPPluginCall) {
        Task { @MainActor in
            do { try await AppStore.sync(); call.resolve(["transactions": await collect()]) }
            catch { call.reject("Não foi possível restaurar. Confira sua conta Apple e tente novamente.") }
        }
    }
    @objc func finish(_ call: CAPPluginCall) {
        guard let id = call.getString("transactionId") else { call.reject("Transação inválida."); return }
        Task { @MainActor in
            for await result in StoreKit.Transaction.unfinished {
                if case .verified(let t) = result, t.productID == productId, String(t.id) == id { await t.finish() }
            }
            call.resolve()
        }
    }
}

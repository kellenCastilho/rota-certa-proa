from http.server import BaseHTTPRequestHandler
import json

import requests
from ortools.constraint_solver import pywrapcp
from ortools.constraint_solver import routing_enums_pb2


OSRM_TABLE_URL = "https://router.project-osrm.org/table/v1/driving"


def build_osrm_matrix(origin, deliveries):
    points = [{"lat": origin["lat"], "lng": origin["lng"]}]
    for delivery in deliveries:
        points.append({
            "lat": delivery["coords"]["lat"],
            "lng": delivery["coords"]["lng"],
        })

    coordinates = ";".join(
        f'{point["lng"]},{point["lat"]}'
        for point in points
    )

    url = (
        f"{OSRM_TABLE_URL}/{coordinates}"
        "?annotations=duration,distance"
    )

    response = requests.get(url, timeout=25)
    response.raise_for_status()
    data = response.json()

    if data.get("code") != "Ok":
        raise RuntimeError(
            data.get("message")
            or "O OSRM não conseguiu montar a matriz."
        )

    durations = data.get("durations")
    distances = data.get("distances")

    if not durations or not distances:
        raise RuntimeError(
            "O OSRM não retornou duração e distância."
        )

    for row in durations:
        if any(value is None for value in row):
            raise RuntimeError(
                "Há pontos sem conexão viária na matriz."
            )

    for row in distances:
        if any(value is None for value in row):
            raise RuntimeError(
                "Há pontos sem conexão viária na matriz."
            )

    return durations, distances


def optimize_order(durations):
    real_node_count = len(durations)
    dummy_end = real_node_count
    matrix_size = real_node_count + 1

    cost_matrix = [
        [0 for _ in range(matrix_size)]
        for _ in range(matrix_size)
    ]

    for i in range(real_node_count):
        for j in range(real_node_count):
            cost_matrix[i][j] = int(round(durations[i][j]))
        cost_matrix[i][dummy_end] = 0

    manager = pywrapcp.RoutingIndexManager(
        matrix_size,
        1,
        [0],
        [dummy_end],
    )

    routing = pywrapcp.RoutingModel(manager)

    def time_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return cost_matrix[from_node][to_node]

    transit_callback_index = routing.RegisterTransitCallback(
        time_callback
    )

    routing.SetArcCostEvaluatorOfAllVehicles(
        transit_callback_index
    )

    search_parameters = pywrapcp.DefaultRoutingSearchParameters()
    search_parameters.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )
    search_parameters.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    search_parameters.time_limit.seconds = 1

    solution = routing.SolveWithParameters(search_parameters)

    if not solution:
        raise RuntimeError(
            "O OR-Tools não encontrou uma rota."
        )

    ordered_nodes = []
    index = routing.Start(0)

    while not routing.IsEnd(index):
        node = manager.IndexToNode(index)
        if node not in (0, dummy_end):
            ordered_nodes.append(node)

        index = solution.Value(
            routing.NextVar(index)
        )

    return ordered_nodes


def calculate_totals(
    ordered_nodes,
    durations,
    distances,
):
    previous_node = 0
    total_duration = 0.0
    total_distance = 0.0

    for node in ordered_nodes:
        total_duration += durations[previous_node][node]
        total_distance += distances[previous_node][node]
        previous_node = node

    return total_duration, total_distance


class handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        body = json.dumps(
            payload,
            ensure_ascii=False,
        ).encode("utf-8")

        self.send_response(status)
        self.send_header(
            "Content-Type",
            "application/json; charset=utf-8",
        )
        self.send_header(
            "Content-Length",
            str(len(body)),
        )
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            content_length = int(
                self.headers.get("Content-Length", "0")
            )
            raw_body = self.rfile.read(content_length)

            payload = json.loads(
                raw_body.decode("utf-8")
                if raw_body
                else "{}"
            )

            origin = payload.get("origin")
            deliveries = payload.get("deliveries", [])

            if (
                not origin
                or not isinstance(origin.get("lat"), (int, float))
                or not isinstance(origin.get("lng"), (int, float))
            ):
                return self.send_json(
                    400,
                    {"error": "Localização inicial inválida."},
                )

            valid_deliveries = []

            for delivery in deliveries:
                coords = delivery.get("coords")

                if delivery.get("completed"):
                    continue

                if (
                    not coords
                    or not isinstance(coords.get("lat"), (int, float))
                    or not isinstance(coords.get("lng"), (int, float))
                ):
                    continue

                valid_deliveries.append(delivery)

            if not valid_deliveries:
                return self.send_json(
                    400,
                    {"error": "Nenhuma entrega localizada."},
                )

            if len(valid_deliveries) > 50:
                return self.send_json(
                    400,
                    {"error": "Este teste aceita até 50 paradas."},
                )

            durations, distances = build_osrm_matrix(
                origin,
                valid_deliveries,
            )

            ordered_nodes = optimize_order(durations)

            ordered_delivery_ids = [
                valid_deliveries[node - 1]["id"]
                for node in ordered_nodes
            ]

            total_duration, total_distance = calculate_totals(
                ordered_nodes,
                durations,
                distances,
            )

            return self.send_json(
                200,
                {
                    "orderedDeliveryIds": ordered_delivery_ids,
                    "distanceMeters": round(total_distance),
                    "durationSeconds": round(total_duration),
                    "engine": "ortools-osrm",
                },
            )

        except requests.RequestException as error:
            print("Erro ao consultar OSRM:", error)

            return self.send_json(
                502,
                {
                    "error":
                    "Não foi possível consultar a malha viária."
                },
            )

        except Exception as error:
            print("Erro ao otimizar rota:", error)

            return self.send_json(
                500,
                {
                    "error":
                    str(error)
                    or "Erro interno ao otimizar a rota."
                },
            )

    def do_GET(self):
        return self.send_json(
            200,
            {
                "ok": True,
                "engine": "ortools-osrm",
            },
        )
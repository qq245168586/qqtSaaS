from pathlib import Path
import unittest

from route_scanner import build_openapi, scan_routes


SOURCE = Path(__file__).resolve().parents[1] / "server" / "src"


class RouteScannerTest(unittest.TestCase):
    def test_scans_regular_array_and_bom_routes(self) -> None:
        routes = {(route.method, route.path) for route in scan_routes(SOURCE)}
        for route in {
            ("get", "/health"),
            ("get", "/tasks/{id}/delivery-notes"),
            ("post", "/tasks/{id}/images"),
            ("get", "/departments"),
            ("delete", "/employees/{id}"),
            ("post", "/bom/parse"),
            ("post", "/kingdee-products/import/preview"),
            ("get", "/boms/{id}/export/kingdee"),
        }:
            self.assertIn(route, routes)

    def test_openapi_has_unique_operations_and_bearer_security(self) -> None:
        document = build_openapi(SOURCE, "https://example.test/api")
        self.assertGreater(document["x-route-count"], 60)
        self.assertEqual(document["paths"]["/health"]["get"].get("security"), None)
        self.assertEqual(
            document["paths"]["/boms"]["get"]["security"], [{"BearerAuth": []}]
        )


if __name__ == "__main__":
    unittest.main()

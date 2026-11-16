from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


HTTP_METHODS = {"Get": "get", "Post": "post", "Put": "put", "Patch": "patch", "Delete": "delete"}
PUBLIC_PATHS = {
    "/health",
    "/auth/access-mode",
    "/auth/enter",
    "/auth/login",
    "/auth/refresh",
}


@dataclass(frozen=True)
class Route:
    method: str
    path: str
    controller: str
    handler: str
    source: str


def _quoted_values(value: str) -> list[str]:
    return [match[1] for match in re.findall(r"(['\"])(.*?)\1", value, re.DOTALL)]


def _join_path(prefix: str, route: str) -> str:
    values = [part.strip("/") for part in (prefix, route) if part.strip("/")]
    path = "/" + "/".join(values)
    return re.sub(r":([A-Za-z_][A-Za-z0-9_]*)", r"{\1}", path)


def scan_routes(source_dir: Path) -> list[Route]:
    routes: list[Route] = []
    controller_pattern = re.compile(
        r"@Controller\((.*?)\)\s*(?:export\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)",
        re.DOTALL,
    )
    route_pattern = re.compile(r"@(Get|Post|Put|Patch|Delete)\((.*?)\)", re.DOTALL)
    handler_pattern = re.compile(r"^\s*(?:async\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(", re.MULTILINE)

    for source in sorted(source_dir.glob("*.ts")):
        text = source.read_text(encoding="utf-8")
        controllers = list(controller_pattern.finditer(text))
        for index, controller in enumerate(controllers):
            section_end = controllers[index + 1].start() if index + 1 < len(controllers) else len(text)
            section = text[controller.end() : section_end]
            prefix_values = _quoted_values(controller.group(1))
            prefix = prefix_values[0] if prefix_values else ""
            decorators = list(route_pattern.finditer(section))
            for route_index, decorator in enumerate(decorators):
                route_end = (
                    decorators[route_index + 1].start()
                    if route_index + 1 < len(decorators)
                    else len(section)
                )
                handler_match = handler_pattern.search(section[decorator.end() : route_end])
                if not handler_match:
                    raise RuntimeError(
                        f"Cannot find handler after {decorator.group(0)!r} in {source.name}"
                    )
                route_values = _quoted_values(decorator.group(2)) or [""]
                for route in route_values:
                    routes.append(
                        Route(
                            method=HTTP_METHODS[decorator.group(1)],
                            path=_join_path(prefix, route),
                            controller=controller.group(2),
                            handler=handler_match.group(1),
                            source=source.name,
                        )
                    )

    unique: dict[tuple[str, str], Route] = {}
    for route in routes:
        key = (route.method, route.path)
        if key in unique:
            raise RuntimeError(f"Duplicate route: {route.method.upper()} {route.path}")
        unique[key] = route
    return sorted(unique.values(), key=lambda item: (item.path, item.method))


def _tag(path: str) -> str:
    first = path.strip("/").split("/", 1)[0]
    labels = {
        "auth": "认证与会话",
        "tasks": "订单任务",
        "ai": "AI订单解析",
        "company-suggestions": "公司匹配学习",
        "assignee-suggestions": "执行人匹配学习",
        "delivery-notes": "送货单",
        "delivery-summary": "送货汇总",
        "print-templates": "打印模板",
        "boms": "BOM与金蝶",
        "bom": "BOM与金蝶",
        "kingdee-products": "BOM与金蝶",
        "departments": "基础资料",
        "employees": "基础资料",
        "categories": "基础资料",
        "customers": "基础资料",
        "customer-categories": "基础资料",
        "products": "基础资料",
        "personnel": "基础资料",
        "companies": "公司资料",
        "users": "账号管理",
        "backup": "备份恢复",
        "files": "文件",
        "health": "系统",
    }
    return labels.get(first, "其他")


def _operation(route: Route) -> dict[str, Any]:
    method_labels = {
        "get": "查询",
        "post": "创建或执行",
        "put": "完整更新",
        "patch": "局部更新",
        "delete": "删除",
    }
    parameters: list[dict[str, Any]] = []
    for name in re.findall(r"\{([A-Za-z_][A-Za-z0-9_]*)\}", route.path):
        parameters.append(
            {
                "name": name,
                "in": "path",
                "required": True,
                "schema": {"type": "string", "pattern": "^\\d+$"},
            }
        )
    operation: dict[str, Any] = {
        "tags": [_tag(route.path)],
        "summary": f"{method_labels[route.method]} {route.path}",
        "description": f"来源：`{route.source}` · `{route.controller}.{route.handler}`",
        "operationId": re.sub(
            r"[^A-Za-z0-9_]+",
            "_",
            f"{route.controller}_{route.handler}_{route.method}_{route.path}",
        ).strip("_"),
        "responses": {
            "200": {
                "description": "成功",
                "content": {
                    "application/json": {"schema": {"$ref": "#/components/schemas/ApiEnvelope"}}
                },
            },
            "400": {"$ref": "#/components/responses/ApiError"},
            "401": {"$ref": "#/components/responses/ApiError"},
            "403": {"$ref": "#/components/responses/ApiError"},
            "404": {"$ref": "#/components/responses/ApiError"},
            "500": {"$ref": "#/components/responses/ApiError"},
        },
    }
    if parameters:
        operation["parameters"] = parameters
    if route.path not in PUBLIC_PATHS:
        operation["security"] = [{"BearerAuth": []}]
    if route.method in {"post", "put", "patch"}:
        upload = route.path.endswith("/images") or "/import" in route.path
        content_type = "multipart/form-data" if upload else "application/json"
        schema: dict[str, Any] = (
            {
                "type": "object",
                "properties": {"file": {"type": "string", "format": "binary"}},
                "required": ["file"],
            }
            if upload
            else {"type": "object", "additionalProperties": True}
        )
        operation["requestBody"] = {
            "required": True,
            "content": {content_type: {"schema": schema}},
        }
    return operation


def build_openapi(source_dir: Path, server_url: str) -> dict[str, Any]:
    routes = scan_routes(source_dir)
    paths: dict[str, dict[str, Any]] = {}
    for route in routes:
        paths.setdefault(route.path, {})[route.method] = _operation(route)
    return {
        "openapi": "3.1.0",
        "info": {
            "title": "意趣订单管理 API",
            "version": "2.0.0",
            "description": (
                "从当前 TypeScript/NestJS 控制器自动扫描生成。"
                "接口统一返回 `{ code, message, data }`；受保护接口使用 Bearer Token。"
            ),
        },
        "servers": [{"url": server_url, "description": "当前阿里云 API"}],
        "tags": [{"name": name} for name in sorted({_tag(route.path) for route in routes})],
        "paths": paths,
        "components": {
            "securitySchemes": {
                "BearerAuth": {"type": "http", "scheme": "bearer", "bearerFormat": "JWT"}
            },
            "schemas": {
                "ApiEnvelope": {
                    "type": "object",
                    "required": ["code", "message", "data"],
                    "properties": {
                        "code": {"type": "integer", "example": 0},
                        "message": {"type": "string", "example": "ok"},
                        "data": {},
                    },
                },
                "ApiError": {
                    "type": "object",
                    "required": ["code", "message", "data"],
                    "properties": {
                        "code": {"type": "integer", "example": 400},
                        "message": {"type": "string"},
                        "data": {"type": "null"},
                    },
                },
            },
            "responses": {
                "ApiError": {
                    "description": "请求失败",
                    "content": {
                        "application/json": {"schema": {"$ref": "#/components/schemas/ApiError"}}
                    },
                }
            },
        },
        "x-route-count": len(routes),
    }


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    print(
        json.dumps(
            build_openapi(root / "server" / "src", "https://114.215.185.184/api"),
            ensure_ascii=False,
            indent=2,
        )
    )
